// Fase 5.2.1 · Plan de misión de extremo a extremo: motor real sobre
// PostgreSQL con todas las migraciones y Claude SIMULADO con guion (ninguna
// llamada real). Alex propone → el administrador aprueba → los pasos se
// ejecutan con sus límites → Alex sintetiza (y puede pedir una ampliación).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAgent } from "@/lib/agents/registry";
import { applyPlanDependencyRules, canAmend, minStepBudgetUsd, runMaxSteps, runTools, stepProblems } from "@/lib/engine/plan";
import { SqlEngineStore, type Query } from "@/lib/engine/store-sql";
import type { MissionPlan, PlanStepInput, TaskRow } from "@/lib/engine/store";
import type { ModelClient, ModelRequest, ModelResponse } from "@/lib/engine/types";
import { runTick } from "@/lib/engine/worker";
import { lastToolResults, usage, who } from "./helpers/scripted-claude";
import { ADMIN, createTestDb, type TestDb } from "./helpers/db";

let t: TestDb;
const raw = async <T,>(sql: string, params: unknown[] = []) => (await t.db.query<T>(sql, params)).rows;
const query: Query = (sql, params) => t.asService(() => raw(sql, params ?? [])) as never;
const store = () => new SqlEngineStore(query);

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.db.exec(`set session_replication_role = replica;
    delete from public.mission_plan_steps; delete from public.mission_plans; delete from public.documents;
    delete from public.task_dependencies; delete from public.ai_reservations; delete from public.ai_usage;
    delete from public.agent_runs; delete from public.tasks; delete from public.activity_log;
    delete from public.companies where created_by <> 'admin';
    set session_replication_role = origin;
    update public.agents set status = 'available', current_task_id = null;`);
});

const MARCUS_STEP = {
  key: "investigacion", agent: "marcus", title: "Investigar gimnasios boutique",
  instructions: "Busca gimnasios boutique reales de Barcelona y guarda sus fichas con fuentes.",
  tools: ["web.search", "web.fetch", "crm.read", "crm.write", "content.draft"], budget_usd: 0.45, max_calls: 4, max_searches: 3,
};
const SOFIA_STEP = {
  key: "estrategia", agent: "sofia", title: "Estrategia de captación",
  instructions: "Propón una estrategia de captación con las fichas de Marcus.",
  tools: ["memory.read", "crm.read", "content.draft"], budget_usd: 0.2, max_calls: 3, max_searches: 0,
};
const RESULT = '\n```resultado\n{"resultado": "completed", "objetivos_completados": ["fichas"], "objetivos_pendientes": [], "avisos": []}\n```';

const say = (text: string, model: string): ModelResponse => ({ content: [{ type: "text", text }], stopReason: "end_turn", usage, model });
const use = (id: string, name: string, input: Record<string, unknown>, model: string): ModelResponse => ({
  content: [{ type: "tool_use", id, name, input }], stopReason: "tool_use", usage, model,
});

/** Claude simulado para misiones con plan. */
class PlanClaude implements ModelClient {
  calls: ModelRequest[] = [];
  constructor(private readonly o: {
    steps?: Record<string, unknown>[]; noPlan?: boolean; amend?: Record<string, unknown>[]; marcusCalls?: number;
  } = {}) {}
  async create(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push(structuredClone(req));
    const turn = (req.messages.length + 1) / 2;
    const first = String(req.messages[0].content);
    switch (who(req)) {
      case "Alex":
        if (first.includes("PLAN APROBADO")) {
          if (this.o.amend && req.tools.some((x) => x.name === "mission__plan") && turn === 1) {
            return use("tu-amend", "mission__plan", { summary: "Falta concretar la propuesta para el mejor gimnasio.", steps: this.o.amend }, req.model);
          }
          if (turn === 2 && lastToolResults(req).includes("Plan propuesto")) return say("Pido una ampliación: falta concretar la propuesta.", req.model);
          return say("# Informe final\n1. Gimnasio Real Uno (fuente: https://gym-uno.example/)", req.model);
        }
        if (this.o.noPlan) return say("Creo que lo mejor es investigar gimnasios.", req.model);
        if (turn === 1) return use("tu-plan", "mission__plan", { summary: "Marcus investiga y Sofia prepara la estrategia.", steps: this.o.steps ?? [MARCUS_STEP, SOFIA_STEP] }, req.model);
        return say("Plan propuesto: Marcus investiga (0,45 $) y Sofia prepara la estrategia (0,20 $).", req.model);
      case "Marcus":
        if (turn === 1 && (this.o.marcusCalls ?? 2) >= 2) {
          return use("m1", "crm__write", { name: "Gimnasio Real Uno", city: "Barcelona", need_detected: "No tiene reserva online (verificado en su web).", sources: ["https://gym-uno.example/"] }, req.model);
        }
        return say(`Fichas listas: 1 empresa con fuente.${RESULT}`, req.model);
      case "Sofia":
        if (turn === 1) return use("s1", "content__draft", { title: "Estrategia de captación", kind: "strategy", content: "PREVISIÓN: 2 reuniones al mes. RESULTADO REAL: ninguno todavía. Presupuesto estimado 0 €." }, req.model);
        return say(`Estrategia lista.${RESULT}`, req.model);
    }
    throw new Error(`Llamada inesperada de ${who(req)}`);
  }
  by(name: string) {
    return this.calls.filter((c) => who(c) === name);
  }
}

async function planMission() {
  const [m] = await raw<{ id: string }>(
    `insert into public.tasks (title, description, agent_id, status, input, created_by, timeout_seconds)
     values ('Estudio gimnasios', 'Estudio comercial en borrador, sin contactar a nadie.', 'alex', 'assigned', '{"kind":"mission","round":1,"phase":"planning"}', 'admin', 86400) returning id`);
  return m.id;
}
const pendingPlan = async () => (await raw<{ id: string; version: number; plan_hash: string; plan: { steps: { key: string; depends_on: string[] }[] } }>(
  `select id, version, plan_hash, plan from public.mission_plans where status = 'pending'`))[0];
const approvePending = async () => {
  const p = await pendingPlan();
  return t.as(ADMIN, () => raw(`select public.approve_mission_plan($1, $2, $3, null)`, [p.id, p.version, p.plan_hash]));
};
const status = async (id: string) => (await raw<{ status: string; error: string | null; input: Record<string, unknown> }>(
  `select status::text status, error, input from public.tasks where id = $1`, [id]))[0];
const names = (req: ModelRequest) => req.tools.map((x) => x.name).sort();

describe("misión con plan de extremo a extremo (Claude simulado)", () => {
  it("Alex propone → nada se ejecuta → el administrador aprueba → pasos con sus límites → informe con control del plan", async () => {
    const id = await planMission();
    const claude = new PlanClaude();

    // 1. Planificación: solo leer y proponer. Nunca delegar.
    let report = await runTick({ store: store(), client: claude });
    expect(report.runs.map((r) => `${r.agentId}:${r.outcome}`)).toEqual(["alex:waiting_plan_approval"]);
    expect(claude.by("Alex").map(names)).toEqual([
      ["crm__read", "memory__read", "mission__plan"], ["crm__read", "memory__read", "mission__plan"],
    ]);
    const firstPrompt = String(claude.by("Alex")[0].messages[0].content);
    expect(firstPrompt).toContain("PRESUPUESTO PARA EL PLAN");
    expect(firstPrompt).toMatch(/Disponible para los pasos: 0,75 \$/);
    expect(claude.by("Alex")[0].system).toContain("NO delegas directamente");
    expect(lastToolResults(claude.by("Alex")[1])).toMatch(/Plan propuesto: versión 1.*NADA se ejecuta/);
    expect((await status(id)).status).toBe("needs_approval");
    expect(await raw(`select 1 from public.tasks where parent_task_id = $1`, [id])).toHaveLength(0);
    // El sistema añadió que Sofia espera a Marcus (y el administrador lo ve en el plan).
    const plan = await pendingPlan();
    expect(plan.plan.steps.find((s) => s.key === "estrategia")!.depends_on).toEqual(["investigacion"]);
    // Sin aprobación, ninguna pasada hace nada.
    expect((await runTick({ store: store(), client: claude })).runs).toEqual([]);
    expect(claude.calls).toHaveLength(2);

    // 2. Aprobación y ejecución de los pasos.
    await approvePending();
    report = await runTick({ store: store(), client: claude });
    expect(report.runs.map((r) => `${r.agentId}:${r.outcome}`)).toEqual(["marcus:completed", "sofia:completed", "alex:completed"]);
    // Marcus: solo las herramientas del paso (con búsqueda y lectura web, lista constante); Sofia: las suyas.
    expect(new Set(claude.by("Marcus").map((c) => JSON.stringify(names(c))))).toEqual(new Set([JSON.stringify(["content__draft", "crm__read", "crm__write"])]));
    expect(claude.by("Marcus").every((c) => c.serverTools?.length === 2)).toBe(true);
    expect(names(claude.by("Sofia")[0])).toEqual(["content__draft", "crm__read", "memory__read"]);
    expect(String(claude.by("Marcus")[0].messages[0].content)).toMatch(/LÍMITES APROBADOS DE ESTE PASO DEL PLAN: 0,45 \$ de gasto, 4 llamadas y 3 búsquedas/);
    // Síntesis: plan aprobado y entregas; puede ampliar (ronda 2) pero no delegar.
    const synth = claude.by("Alex").at(-1)!;
    expect(String(synth.messages[0].content)).toContain("PLAN APROBADO (versión 1)");
    expect(names(synth)).toEqual(["content__draft", "crm__read", "memory__read", "mission__plan"]);

    const m = await status(id);
    expect(m.status).toBe("completed");
    const [doc] = await raw<{ content: string }>(`select content from public.documents where task_id = $1 and kind = 'report'`, [id]);
    expect(doc.content).toContain("Paso «investigacion» (marcus) del plan v1: completed");
    expect(doc.content).toContain("Paso «estrategia» (sofia) del plan v1: completed");
    // Costes dentro de los límites de cada paso.
    const costs = await raw<{ plan_step_key: string; budget_usd: number; spent: number; calls: number }>(
      `select t.plan_step_key, t.budget_usd::float8 budget_usd, coalesce(sum(u.cost_usd), 0)::float8 spent, count(u.id)::int calls
         from public.tasks t left join public.ai_usage u on u.task_id = t.id where t.parent_task_id = $1 group by 1, 2`, [id]);
    for (const c of costs) expect(c.spent).toBeLessThanOrEqual(c.budget_usd);
    expect((await runTick({ store: store(), client: claude })).runs).toEqual([]);
  });

  it("si Alex termina la planificación sin proponer un plan, la misión se detiene y no se ejecuta nada", async () => {
    const id = await planMission();
    const report = await runTick({ store: store(), client: new PlanClaude({ noPlan: true }) });
    expect(report.runs.map((r) => r.outcome)).toEqual(["failed"]);
    expect(await status(id)).toMatchObject({ status: "failed", error: expect.stringMatching(/sin proponer un plan/) });
    expect(await raw(`select 1 from public.tasks where parent_task_id = $1`, [id])).toHaveLength(0);
  });

  it("un plan que el motor rechaza (herramienta bloqueada, presupuesto insuficiente) no llega a proponerse", async () => {
    const id = await planMission();
    const claude = new PlanClaude({ steps: [{ ...MARCUS_STEP, tools: ["crm.write", "email.send"], max_searches: 0 }, { ...SOFIA_STEP, budget_usd: 0.0001 }] });
    await runTick({ store: store(), client: claude });
    const results = lastToolResults(claude.by("Alex")[1]);
    expect(results).toMatch(/Plan no válido, no se ha propuesto nada/);
    expect(results).toMatch(/marcus no tiene email\.send/);
    expect(results).toMatch(/no alcanza ni para una llamada de sofia/);
    expect(await raw(`select 1 from public.mission_plans`)).toHaveLength(0);
    expect((await status(id)).status).toBe("failed"); // terminó sin plan
  });

  it("las herramientas del paso mandan: un paso de Marcus sin web no recibe búsqueda ni escritura en el CRM", async () => {
    await planMission();
    const claude = new PlanClaude({ steps: [{ ...MARCUS_STEP, tools: ["crm.read", "content.draft"], max_searches: 0, budget_usd: 0.2 }], marcusCalls: 1 });
    await runTick({ store: store(), client: claude });
    await approvePending();
    await runTick({ store: store(), client: claude });
    const marcus = claude.by("Marcus");
    expect(marcus.length).toBeGreaterThan(0);
    expect(marcus.every((c) => (c.serverTools ?? []).length === 0)).toBe(true);
    expect(names(marcus[0])).toEqual(["content__draft", "crm__read"]);
  });

  it("presupuesto del paso agotado: el paso se detiene sin llamar a Claude y Alex lo ve como fallo", async () => {
    const id = await planMission();
    const claude = new PlanClaude();
    await runTick({ store: store(), client: claude });
    await approvePending();
    // 0,20 $ ya gastados en el paso: con la reserva de la siguiente llamada (~0,32 $) no cabe en
    // sus 0,45 $, aunque sí en lo que queda de la misión (salta el límite del paso, no el de la misión).
    const [mk] = await raw<{ id: string }>(`select id from public.tasks where parent_task_id = $1 and plan_step_key = 'investigacion'`, [id]);
    await raw(`insert into public.ai_usage (agent_id, task_id, model, input_tokens, output_tokens, cost_usd) values ('marcus', $1, 'claude-sonnet-5-5', 1, 1, 0.2)`, [mk.id]);
    const before = claude.by("Marcus").length;
    const report = await runTick({ store: store(), client: claude });
    expect(report.runs.map((r) => `${r.agentId}:${r.outcome}`)).toEqual(["marcus:budget_stop", "sofia:completed", "alex:completed"]);
    expect(claude.by("Marcus").length).toBe(before);
    expect((await status(mk.id)).error).toMatch(/no cabe en el presupuesto aprobado del paso \(0,45 \$\)/);
    const [doc] = await raw<{ content: string }>(`select content from public.documents where task_id = $1 and kind = 'report'`, [id]);
    expect(doc.content).toMatch(/⚠ El paso «investigacion» \(marcus\) terminó en fallo/);
  });

  it("llamadas máximas del paso: el motor no supera las aprobadas", async () => {
    const id = await planMission();
    const claude = new PlanClaude({ steps: [{ ...MARCUS_STEP, max_calls: 1 }, SOFIA_STEP] });
    await runTick({ store: store(), client: claude });
    await approvePending();
    await runTick({ store: store(), client: claude });
    expect(claude.by("Marcus")).toHaveLength(1);
    const [mk] = await raw<{ status: string; error: string }>(`select status::text status, error from public.tasks where parent_task_id = $1 and plan_step_key = 'investigacion'`, [id]);
    expect(mk.status).toBe("failed");
    expect((await status(id)).status).toBe("completed");
  });

  it("ampliación en la síntesis: otra aprobación expresa, solo pasos nuevos y después ya no se puede ampliar", async () => {
    const id = await planMission();
    const extra = [{ key: "propuesta", agent: "sofia", title: "Propuesta para el mejor gimnasio", instructions: "Concreta la propuesta para Gimnasio Real Uno con las fichas.", tools: ["crm.read", "content.draft"], budget_usd: 0.05, max_calls: 3, max_searches: 0 }];
    const claude = new PlanClaude({ amend: extra });
    await runTick({ store: store(), client: claude });
    await approvePending();
    let report = await runTick({ store: store(), client: claude });
    expect(report.runs.map((r) => `${r.agentId}:${r.outcome}`)).toEqual(["marcus:completed", "sofia:completed", "alex:waiting_plan_approval"]);
    // La ejecución de Alex mantuvo la misma lista de herramientas en todas sus llamadas.
    const amendRun = claude.by("Alex").slice(-2);
    expect(names(amendRun[0])).toEqual(names(amendRun[1]));
    const p = await pendingPlan();
    expect(p.version).toBe(2);
    expect(p.plan.steps.map((s) => s.key)).toEqual(["investigacion", "estrategia", "propuesta"]);
    expect(await raw(`select 1 from public.tasks where parent_task_id = $1 and plan_step_key = 'propuesta'`, [id])).toHaveLength(0);
    expect((await runTick({ store: store(), client: claude })).runs).toEqual([]);

    await approvePending();
    report = await runTick({ store: store(), client: claude });
    expect(report.runs.map((r) => `${r.agentId}:${r.outcome}`)).toEqual(["sofia:completed", "alex:completed"]);
    // Ronda 3: sin «mission__plan».
    expect(names(claude.by("Alex").at(-1)!)).toEqual(["content__draft", "crm__read", "memory__read"]);
    expect(String(claude.by("Alex").at(-1)!.messages[0].content)).toContain("Ya no se puede ampliar el plan");
    expect((await status(id)).status).toBe("completed");
    expect(await raw(`select 1 from public.tasks where parent_task_id = $1`, [id])).toHaveLength(3);
  });

  it("la lista de herramientas no cambia al reanudar la ejecución tras proponer una ampliación (otra pasada)", async () => {
    const id = await planMission();
    const extra = [{ key: "propuesta", agent: "sofia", title: "Propuesta concreta", instructions: "Concreta la propuesta para el mejor gimnasio.", tools: ["content.draft"], budget_usd: 0.05, max_calls: 2, max_searches: 0 }];
    const claude = new PlanClaude({ amend: extra });
    await runTick({ store: store(), client: claude });
    await approvePending();
    // Cada llamada «tarda» 200 s: cada pasada hace una sola llamada y la ejecución se reanuda en la siguiente.
    let clock = 0;
    const slow: ModelClient = { create: (r) => { clock += 200_000; return claude.create(r); } };
    for (let i = 0; i < 20 && (await status(id)).status !== "needs_approval"; i++) {
      clock = 0;
      await runTick({ store: store(), client: slow, now: () => clock, budgetMs: 280_000, stepReserveMs: 170_000 });
    }
    expect((await status(id)).status).toBe("needs_approval");
    const synth = claude.by("Alex").filter((c) => String(c.messages[0].content).includes("PLAN APROBADO (versión 1)"));
    expect(synth.length).toBe(2); // propuesta + explicación, en dos pasadas distintas
    expect(names(synth[1])).toEqual(names(synth[0]));
    expect(names(synth[0])).toContain("mission__plan");
  });

  it("barrera del motor: una subtarea colada sin paso aprobado (saltándose la base de datos) no se ejecuta", async () => {
    const id = await planMission();
    const claude = new PlanClaude();
    await runTick({ store: store(), client: claude });
    await approvePending();
    // Solo es posible desactivando los triggers (como haría alguien con acceso total a la base de datos).
    await t.db.exec(`set session_replication_role = replica;
      insert into public.tasks (title, description, agent_id, status, parent_task_id, input, priority, created_at)
      values ('Colada', 'Subtarea fuera del plan', 'marcus', 'assigned', '${id}', '{"kind":"subtask","round":1}', 'urgent', now() - interval '1 day');
      set session_replication_role = origin;`);
    const report = await runTick({ store: store(), client: claude });
    const smuggled = (await raw<{ id: string; status: string; error: string }>(`select id, status::text status, error from public.tasks where title = 'Colada'`))[0];
    expect(report.runs.find((r) => r.taskId === smuggled.id)?.outcome).toBe("not_in_plan");
    expect(smuggled).toMatchObject({ status: "failed", error: expect.stringMatching(/no procede de un paso aprobado/) });
    expect(claude.calls.filter((c) => who(c) === "Marcus" && String(c.messages[0].content).includes("Subtarea fuera del plan"))).toHaveLength(0);
  });

  it("pedir cambios: Alex recibe el motivo y su versión anterior y propone otra", async () => {
    await planMission();
    const claude = new PlanClaude();
    await runTick({ store: store(), client: claude });
    const p = await pendingPlan();
    await t.as(ADMIN, () => raw(`select public.reject_mission_plan($1, 1, $2, 'Reduce el presupuesto de Marcus a 0,30 $', 'changes')`, [p.id, p.plan_hash]));
    await runTick({ store: store(), client: claude });
    const retry = String(claude.by("Alex").at(-2)!.messages[0].content);
    expect(retry).toContain("EL ADMINISTRADOR HA PEDIDO CAMBIOS en la versión 1");
    expect(retry).toContain("Reduce el presupuesto de Marcus a 0,30 $");
    expect(retry).toContain("Te quedan 2 versiones");
    expect((await pendingPlan()).version).toBe(2);
  });
});

describe("reglas del motor para el plan (sin base de datos)", () => {
  const alex = getAgent("alex")!;
  const mission = (input: Record<string, unknown>, plan_required = true): TaskRow => ({
    id: "m", title: "x", description: "x", agent_id: "alex", status: "in_progress", parent_task_id: null, client_id: null, result: null,
    input: { kind: "mission", ...input }, plan_required,
  });
  const plan = (status: MissionPlan["status"], run = "r0"): MissionPlan => ({
    id: status, mission_id: "m", version: 1, kind: "initial", summary: "", plan_hash: "", estimate_usd: 0, status, proposed_run_id: run,
    expires_at: "", decided_at: null, decision_note: null, created_at: "", steps: [],
  });

  it("herramientas por fase: las misiones antiguas no cambian; las nuevas nunca delegan", () => {
    for (const ph of ["planning", "synthesis"]) {
      expect([...runTools(alex, mission({ phase: ph }, false))].sort()).toEqual(["content.draft", "crm.read", "memory.read", "tasks.delegate"]);
    }
    expect([...runTools(alex, mission({ phase: "planning" }))].sort()).toEqual(["crm.read", "memory.read", "mission.plan"]);
    expect([...runTools(alex, mission({ phase: "synthesis", round: 2 }), { plans: [plan("approved")] })].sort()).toEqual(["content.draft", "crm.read", "memory.read", "mission.plan"]);
    expect(runTools(alex, mission({ phase: "synthesis", round: 3 }), { plans: [plan("approved")] })).not.toContain("mission.plan");
    for (const ph of ["planning", "synthesis"]) expect(runTools(alex, mission({ phase: ph }), { plans: [plan("approved")] })).not.toContain("tasks.delegate");
    const marcus = getAgent("marcus")!;
    const sub: TaskRow = { ...mission({}), id: "s", parent_task_id: "m", agent_id: "marcus", input: { kind: "subtask" } };
    expect(runTools(marcus, sub, { stepTools: ["crm.read", "email.send"] })).toEqual(["crm.read"]); // nunca más que lo habilitado
  });

  it("ampliar: no con una propuesta pendiente, no con 3 versiones y no pasada la ronda máxima", () => {
    const m = mission({ phase: "synthesis", round: 2 });
    expect(canAmend(m, [plan("approved")], 2)).toBe(true);
    expect(canAmend(m, [plan("approved"), plan("pending")], 2)).toBe(false);
    expect(canAmend(m, [plan("changes_requested"), plan("changes_requested"), plan("approved")], 2)).toBe(false);
    expect(canAmend(mission({ phase: "synthesis", round: 3 }), [plan("approved")], 2)).toBe(false);
    expect(canAmend(m, [], 2)).toBe(false);
  });

  it("pasos máximos: planificación corta y límite del paso", () => {
    expect(runMaxSteps(mission({ phase: "planning" }))).toBe(4);
    expect(runMaxSteps(mission({ phase: "planning" }, false))).toBe(30);
    expect(runMaxSteps({ ...mission({}), parent_task_id: "m", input: { kind: "subtask" }, max_calls: 3 })).toBe(3);
  });

  it("presupuesto mínimo, comprobaciones previas y orden Sofia → Marcus", () => {
    const withWeb = minStepBudgetUsd("marcus", ["web.search", "web.fetch"]);
    expect(withWeb).toBeGreaterThan(minStepBudgetUsd("marcus", []));
    expect(withWeb).toBeLessThan(1);
    const step: PlanStepInput = { ...MARCUS_STEP, depends_on: [] };
    expect(stepProblems(step)).toEqual([]);
    expect(stepProblems({ ...step, budget_usd: withWeb / 2 }).join()).toMatch(/no alcanza/);
    expect(stepProblems({ ...step, agent: "daniel" }).join()).toMatch(/no puede recibir pasos/);
    expect(stepProblems({ ...step, agent: "alex" }).join()).toMatch(/no puede recibir pasos/);
    const { steps, notes } = applyPlanDependencyRules([{ ...SOFIA_STEP, depends_on: [] }, step]);
    expect(steps[0].depends_on).toEqual(["investigacion"]);
    expect(notes.join()).toMatch(/esperará/);
  });
});
