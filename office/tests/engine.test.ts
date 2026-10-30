import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getAgent } from "@/lib/agents/registry";
import { costUsd, EMPTY_USAGE } from "@/lib/engine/cost";
import { ToolGateway, toolIdFromName, toolNameFor, type ApprovalState, type BeginOutcome, type EnginePort } from "@/lib/engine/gateway";
import { initialState, runStep, type RunState } from "@/lib/engine/loop";
import { ModelError, type ModelClient, type ModelResponse } from "@/lib/engine/types";

const marcus = getAgent("marcus")!;
const ctx = { runId: "run-1", taskId: "task-1", agentId: "marcus" };

// Réplica en memoria de request/consume_approval (huella sobre claves ordenadas).
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
const hash = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");

// Réplica en memoria de request_approval / begin_tool_execution / finish_tool_execution.
class FakeApprovals implements EnginePort {
  rows = new Map<string, { toolId: string; action: string; hash: string; state: ApprovalState; used: boolean; note: string | null }>();
  executions = new Map<string, { id: string; status: "started" | "succeeded" | "failed" | "unknown"; result: string | null }>();
  async requestApproval(i: { toolUseId: string; toolId: string; action: string; args: Record<string, unknown> }) {
    const id = `apr-${i.toolUseId}`;
    if (!this.rows.has(id)) this.rows.set(id, { toolId: i.toolId, action: i.action, hash: hash(i.args), state: "pending", used: false, note: null });
    return id;
  }
  async approvalState(id: string) {
    const r = this.rows.get(id)!;
    return { state: r.state, note: r.note };
  }
  async beginExecution(i: { toolUseId: string; toolId: string; action: string; args: Record<string, unknown>; approvalId?: string }): Promise<BeginOutcome> {
    const e = this.executions.get(i.toolUseId);
    if (e) {
      if (e.status === "started" || e.status === "unknown") {
        e.status = "unknown";
        return { outcome: "uncertain" };
      }
      return { outcome: "replay", status: e.status, result: e.result };
    }
    if (i.approvalId) {
      const r = this.rows.get(i.approvalId);
      if (!r || r.state !== "approved" || r.used || r.toolId !== i.toolId || r.action !== i.action || r.hash !== hash(i.args))
        return { outcome: "denied" };
      r.used = true;
    }
    const id = `exe-${i.toolUseId}`;
    this.executions.set(i.toolUseId, { id, status: "started", result: null });
    return { outcome: "started", executionId: id };
  }
  failNextFinish = false;
  async finishExecution(id: string, ok: boolean, result: string) {
    if (this.failNextFinish) {
      this.failNextFinish = false;
      throw new Error("proceso interrumpido");
    }
    const e = [...this.executions.values()].find((x) => x.id === id)!;
    Object.assign(e, { status: ok ? "succeeded" : "failed", result });
  }
  decide(id: string, state: ApprovalState, note: string | null = null) {
    Object.assign(this.rows.get(id)!, { state, note });
  }
}

const usage = { ...EMPTY_USAGE, inputTokens: 1000, outputTokens: 100 };
function scripted(...responses: ModelResponse[]): ModelClient & { calls: number } {
  const c = {
    calls: 0,
    async create() {
      const r = responses[c.calls++];
      if (!r) throw new Error("sin respuesta preparada");
      return r;
    },
  };
  return c;
}
const toolUse = (id: string, toolId: string, input: Record<string, unknown>): ModelResponse => ({
  content: [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "tool_use", id, name: toolNameFor(toolId as never), input },
  ],
  stopReason: "tool_use",
  usage,
});
const done = (text: string): ModelResponse => ({ content: [{ type: "text", text }], stopReason: "end_turn", usage });

function setup() {
  const approvals = new FakeApprovals();
  const sent = vi.fn(async (args: Record<string, unknown>) => ({ content: `Enviado a ${args.to}` }));
  const crm = vi.fn(async () => ({ content: "0 empresas en el CRM" }));
  const gateway = new ToolGateway(approvals).register("email.send", sent).register("crm.read", crm);
  return { approvals, gateway, sent, crm };
}

const EMAIL = { action: "send", to: "gimnasio@example.com", subject: "Propuesta", body: "Hola" };

describe("costes", () => {
  it("usa los precios oficiales, la caché y la búsqueda web", () => {
    expect(costUsd("claude-opus-5-5", { ...EMPTY_USAGE, inputTokens: 1_000_000, outputTokens: 100_000 })).toBeCloseTo(6);
    expect(costUsd("claude-sonnet-5-5", { ...EMPTY_USAGE, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.2);
    expect(costUsd("claude-sonnet-5-5", { ...EMPTY_USAGE, cacheWriteTokens: 1_000_000 })).toBeCloseTo(2.5);
    expect(costUsd("claude-haiku-5-5", { ...EMPTY_USAGE, webSearchRequests: 3 })).toBeCloseTo(0.03);
  });

  it("aplica el tramo largo de Haiku 5.5 por encima de 100.000 tokens", () => {
    expect(costUsd("claude-haiku-5-5", { ...EMPTY_USAGE, inputTokens: 100_000, outputTokens: 1000 })).toBeCloseTo(0.0105);
    expect(costUsd("claude-haiku-5-5", { ...EMPTY_USAGE, inputTokens: 200_000, outputTokens: 1000 })).toBeCloseTo(0.1025);
  });
});

describe("puerta de herramientas", () => {
  it("nombres válidos para la API y reversibles", () => {
    expect(toolNameFor("email.send")).toBe("email__send");
    expect(toolIdFromName("email__send")).toBe("email.send");
  });

  it("nunca ejecuta una acción con aprobación pendiente, ajena o modificada", async () => {
    const { approvals, gateway, sent } = setup();
    const call = { agent: marcus, toolUseId: "t1", toolId: "email.send", args: EMAIL };
    const first = await gateway.execute(call, ctx);
    expect(first.kind).toBe("approval_required");
    const approvalId = (first as { approvalId: string }).approvalId;
    expect((await gateway.execute({ ...call, approvalId }, ctx)).kind).toBe("result"); // pendiente → error
    approvals.decide(approvalId, "approved");
    const changed = await gateway.execute({ ...call, approvalId, args: { ...EMAIL, body: "Otro texto" } }, ctx);
    expect(changed).toMatchObject({ kind: "result", output: { isError: true } });
    expect(sent).not.toHaveBeenCalled();
    const ok = await gateway.execute({ ...call, approvalId }, ctx);
    expect(ok).toMatchObject({ kind: "result", output: { content: "Enviado a gimnasio@example.com" } });
    // Misma llamada otra vez: devuelve lo ya hecho, no vuelve a enviar.
    const again = await gateway.execute({ ...call, approvalId }, ctx);
    expect(again).toMatchObject({ output: { content: "Enviado a gimnasio@example.com" } });
    // Otra llamada distinta con la misma aprobación: denegada (un solo uso).
    const reuse = await gateway.execute({ ...call, toolUseId: "t2", approvalId }, ctx);
    expect(reuse).toMatchObject({ output: { isError: true } });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("no repite una acción externa si el proceso se corta tras ejecutarla", async () => {
    const { approvals, gateway, sent } = setup();
    const call = { agent: marcus, toolUseId: "t9", toolId: "email.send", args: EMAIL };
    const first = (await gateway.execute(call, ctx)) as { approvalId: string };
    approvals.decide(first.approvalId, "approved");
    approvals.failNextFinish = true; // el email sale, pero el resultado no llega a guardarse
    await expect(gateway.execute({ ...call, approvalId: first.approvalId }, ctx)).rejects.toThrow(/interrumpido/);
    const retry = await gateway.execute({ ...call, approvalId: first.approvalId }, ctx);
    expect(retry).toMatchObject({ output: { isError: true, content: expect.stringContaining("Resultado incierto") } });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("un reintento tras completar devuelve el resultado guardado sin repetir", async () => {
    const { approvals, gateway, sent } = setup();
    const call = { agent: marcus, toolUseId: "t8", toolId: "email.send", args: EMAIL };
    const first = (await gateway.execute(call, ctx)) as { approvalId: string };
    approvals.decide(first.approvalId, "approved");
    await gateway.execute({ ...call, approvalId: first.approvalId }, ctx);
    const replay = await gateway.execute({ ...call, approvalId: first.approvalId }, ctx);
    expect(replay).toMatchObject({ output: { content: "Enviado a gimnasio@example.com" } });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("las lecturas no se registran como ejecuciones", async () => {
    const { approvals, gateway, crm } = setup();
    await gateway.execute({ agent: marcus, toolUseId: "r1", toolId: "crm.read", args: {} }, ctx);
    await gateway.execute({ agent: marcus, toolUseId: "r1", toolId: "crm.read", args: {} }, ctx);
    expect(crm).toHaveBeenCalledTimes(2);
    expect(approvals.executions.size).toBe(0);
  });

  it("deniega herramientas sin permiso y no simula las no conectadas", async () => {
    const { gateway } = setup();
    const denied = await gateway.execute({ agent: marcus, toolUseId: "t", toolId: "tasks.delegate", args: {} }, ctx);
    expect(denied).toMatchObject({ output: { isError: true } });
    const missing = await gateway.execute({ agent: marcus, toolUseId: "t", toolId: "web.search", args: {} }, ctx);
    expect(missing).toMatchObject({ output: { isError: true, content: expect.stringContaining("fase 3") } });
  });

  it("captura los errores de las herramientas", async () => {
    const approvals = new FakeApprovals();
    const gateway = new ToolGateway(approvals).register("crm.read", async () => {
      throw new Error("timeout");
    });
    const r = await gateway.execute({ agent: marcus, toolUseId: "t", toolId: "crm.read", args: {} }, ctx);
    expect(r).toMatchObject({ output: { isError: true, content: expect.stringContaining("timeout") } });
  });
});

describe("bucle del agente", () => {
  const base = (s: ReturnType<typeof setup>, client: ModelClient, state: RunState) => ({
    agent: marcus, runId: "run-1", taskId: "task-1", client, gateway: s.gateway, engine: s.approvals, toolSchemas: {}, state,
  });

  it("ejecuta herramientas permitidas, devuelve resultados y termina", async () => {
    const s = setup();
    const client = scripted(toolUse("t1", "crm.read", {}), done("No hay empresas todavía."));
    const a = await runStep(base(s, client, initialState("Revisa el CRM")));
    expect(a.kind).toBe("continue");
    const last = a.state.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: "0 empresas en el CRM" }]);
    // El bloque de pensamiento se conserva intacto.
    expect(a.state.messages[1].content).toContainEqual({ type: "thinking", thinking: "", signature: "sig" });
    const b = await runStep(base(s, client, a.state));
    expect(b).toMatchObject({ kind: "completed", result: "No hay empresas todavía." });
    expect(b.costUsd).toBeCloseTo(costUsd("claude-opus-5-5", usage));
  });

  it("se pausa ante una acción que requiere aprobación y la reanuda al aprobarse", async () => {
    const s = setup();
    const client = scripted(toolUse("t1", "email.send", EMAIL), done("Propuesta enviada."));
    const a = await runStep(base(s, client, initialState("Envía la propuesta")));
    expect(a.kind).toBe("waiting_approval");
    expect(s.sent).not.toHaveBeenCalled();
    // Mientras está pendiente no se llama al modelo ni se gasta nada.
    const still = await runStep(base(s, client, a.state));
    expect(still).toMatchObject({ kind: "waiting_approval", costUsd: 0 });
    expect(client.calls).toBe(1);
    s.approvals.decide("apr-t1", "approved");
    const b = await runStep(base(s, client, a.state));
    expect(s.sent).toHaveBeenCalledWith(EMAIL, expect.anything());
    expect(b).toMatchObject({ kind: "completed", result: "Propuesta enviada." });
  });

  it("si rechazas la acción, Claude lo sabe y no se ejecuta", async () => {
    const s = setup();
    const client = scripted(toolUse("t1", "email.send", EMAIL), done("Entendido, no la envío."));
    const a = await runStep(base(s, client, initialState("Envía la propuesta")));
    s.approvals.decide("apr-t1", "rejected", "Todavía no");
    const b = await runStep(base(s, client, a.state));
    expect(s.sent).not.toHaveBeenCalled();
    const resultMsg = b.state.messages.find(
      (m) => Array.isArray(m.content) && m.content.some((c) => c.type === "tool_result" && c.is_error),
    );
    expect(JSON.stringify(resultMsg)).toContain("Todavía no");
  });

  it("clasifica rechazos de seguridad y errores de red", async () => {
    const s = setup();
    const refusal = await runStep(
      base(s, scripted({ content: [], stopReason: "refusal", usage }), initialState("x")),
    );
    expect(refusal).toMatchObject({ kind: "failed", retryable: false });
    const overloaded: ModelClient = { create: async () => { throw new ModelError("overloaded", true); } };
    expect(await runStep(base(s, overloaded, initialState("x")))).toMatchObject({ kind: "failed", retryable: true });
  });

  it("corta al llegar al máximo de pasos", async () => {
    const s = setup();
    const r = await runStep({ ...base(s, scripted(), { ...initialState("x"), steps: 3 }), maxSteps: 3 });
    expect(r).toMatchObject({ kind: "failed", retryable: false });
  });
});
