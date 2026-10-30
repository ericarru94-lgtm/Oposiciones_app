// Correcciones tras la primera misión real (A–E) y repetición con fichas
// reutilizadas. PostgreSQL (PGlite) con las migraciones reales y modelos
// simulados: ninguna llamada a Claude.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { budgetStopMessage } from "@/lib/engine/budget-message";
import { reserveUsd } from "@/lib/engine/cost";
import { SqlEngineStore, type Query } from "@/lib/engine/store-sql";
import type { BudgetSnapshot } from "@/lib/engine/store";
import { runTick, serverToolsFor } from "@/lib/engine/worker";
import { ScriptedClaude } from "./helpers/scripted-claude";
import { ModelError, type ModelClient, type ModelRequest, type ModelResponse } from "@/lib/engine/types";
import { createTestDb, type TestDb } from "./helpers/db";

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
  await t.db.exec(`delete from public.documents; delete from public.ai_reservations; delete from public.companies where created_by <> 'admin';
    delete from public.tasks; delete from public.ai_usage;
    update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 1, "mission_ai_budget_usd": 1}' where key = 'limits';
    update public.agents set status = 'available', current_task_id = null;`);
});

const usage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 };
const who = (r: ModelRequest) => /Eres (\w+),/.exec(r.system)?.[1] ?? "?";
const turn = (r: ModelRequest) => (r.messages.length + 1) / 2;
const first = (r: ModelRequest) => String(r.messages[0].content);
const say = (text: string, r: ModelRequest): ModelResponse => ({ content: [{ type: "text", text }], stopReason: "end_turn", usage, model: r.model });
const use = (calls: { id: string; name: string; input: Record<string, unknown> }[], r: ModelRequest): ModelResponse => ({
  content: calls.map((c) => ({ type: "tool_use", ...c })), stopReason: "tool_use", usage, model: r.model,
});
function lastResults(r: ModelRequest): string {
  const last = r.messages.at(-1);
  return Array.isArray(last?.content) ? last.content.map((b) => String((b as { content?: unknown }).content ?? "")).join("\n") : "";
}

async function mission(input: Record<string, unknown> = {}) {
  const [m] = await raw<{ id: string }>(
    `insert into public.tasks (title, description, agent_id, status, input, created_by, timeout_seconds)
     values ('Estudio gimnasios', 'Estudio comercial en borrador, sin contactar a nadie', 'alex', 'assigned', $1, 'admin', 86400) returning id`,
    [JSON.stringify({ kind: "mission", round: 1, phase: "planning", ...input })],
  );
  return m.id;
}

/** Alex delega en Marcus y Sofia (Sofia depende de Marcus) y luego sintetiza. */
function alexScript(r: ModelRequest): ModelResponse {
  if (first(r).includes("ENTREGAS DEL EQUIPO")) return say("# Informe final", r);
  if (turn(r) === 1) return use([{ id: "dm", name: "tasks__delegate", input: { agent: "marcus", title: "Investigar gimnasios", instructions: "Fichas con fuentes." } }], r);
  if (turn(r) === 2) {
    const id = /task_id ([0-9a-f-]{36})/.exec(lastResults(r))![1];
    return use([{ id: "ds", name: "tasks__delegate", input: { agent: "sofia", title: "Estrategia", instructions: "Estrategia con las fichas.", depends_on: [id] } }], r);
  }
  return say("Plan delegado.", r);
}

describe("A · Alex y Sofia reciben las fichas aunque la subtarea de Marcus falle", () => {
  it("las fichas creadas antes del fallo llegan completas a Sofia y a Alex, que ve la subtarea como FALLIDA", async () => {
    const id = await mission();
    const calls: ModelRequest[] = [];
    const client: ModelClient = {
      async create(r) {
        calls.push(structuredClone(r));
        switch (who(r)) {
          case "Alex": return alexScript(r);
          case "Marcus":
            if (turn(r) === 1)
              return use([
                { id: "c1", name: "crm__write", input: { name: "Gym Uno", city: "Barcelona", need_detected: "VERIFICADO: sin reserva online.", notes: "VERIFICADO: horario en web. PENDIENTE: WhatsApp.", sources: ["https://gym-uno.example/"] } },
                { id: "c2", name: "crm__write", input: { name: "Gym Dos", city: "Barcelona", need_detected: "ESTIMADO: respuesta lenta.", sources: ["https://gym-dos.example/"] } },
              ], r);
            throw new ModelError("Petición rechazada por la API: prueba.", false, "none");
          case "Sofia":
            return say("", r); // termina sin texto ni documentos
        }
        throw new Error("inesperado");
      },
    };
    await runTick({ store: store(), client });
    const marcus = await raw<{ status: string }>(`select status::text as status from public.tasks where agent_id = 'marcus'`);
    expect(marcus[0].status).toBe("failed");

    const sofia = calls.find((c) => who(c) === "Sofia")!;
    for (const text of ["FICHAS DEL CRM DE LA MISIÓN (2)", "Gym Uno", "Gym Dos", "https://gym-uno.example/", "PENDIENTE: WhatsApp", "ESTADO: FALLIDA"]) {
      expect(first(sofia)).toContain(text);
    }
    const synth = calls.filter((c) => who(c) === "Alex").at(-1)!;
    expect(first(synth)).toContain("FICHAS DEL CRM DE LA MISIÓN (2)");
    expect(first(synth)).toMatch(/Investigar gimnasios[^\n]*\nESTADO: FALLIDA\. Motivo: Petición rechazada[^\n]*fichas del CRM creadas: 2/);
    expect(first(synth)).toMatch(/Estrategia[^\n]*\nESTADO: COMPLETADA SIN RESULTADOS/);
    const companyIds = await raw<{ id: string }>(`select id from public.companies where created_by = 'marcus'`);
    for (const c of companyIds) expect(first(synth)).toContain(`id ${c.id}`);
    expect(synth.system).toMatch(/Nunca digas que no hay empresas identificadas si la sección de fichas tiene alguna/);
    expect((await raw<{ status: string }>(`select status::text as status from public.tasks where id = $1`, [id]))[0].status).toBe("completed");
  });
});

describe("B · salida de 32.000 tokens solo para Sofia, con la reserva y el tiempo ajustados", () => {
  it("Sofia pide 32.000 tokens con 240 s; Alex y Marcus 8.000 con 150 s; la reserva de Sofia lo cubre y se respeta el presupuesto", async () => {
    const id = await mission();
    const calls: ModelRequest[] = [];
    const client: ModelClient = {
      async create(r) {
        calls.push(structuredClone(r));
        if (who(r) === "Alex") return alexScript(r);
        return say("Entrega lista.", r);
      },
    };
    await runTick({ store: store(), client });
    const by = (n: string) => calls.filter((c) => who(c) === n);
    expect(by("Sofia").map((c) => [c.maxTokens, c.timeoutMs])).toEqual([[32_000, 240_000]]);
    for (const c of [...by("Alex"), ...by("Marcus")]) expect([c.maxTokens, c.timeoutMs]).toEqual([8_000, 150_000]);
    const [sofia] = await raw<{ estimate_usd: string }>(`select estimate_usd::text from public.ai_reservations where agent_id = 'sofia'`);
    expect(Number(sofia.estimate_usd)).toBeGreaterThanOrEqual((32_000 * 0.5) / 1e6); // salida máxima de Haiku
    expect(Number(sofia.estimate_usd)).toBeLessThan(0.06);
    const [m] = await raw<{ v: string }>(`select public.committed_usd('mission', $1)::text as v`, [id]);
    expect(Number(m.v)).toBeLessThanOrEqual(1);
    // El paso de Sofia no empieza si no queda tiempo para su llamada completa (240 s + 20 s).
    const id2 = await mission();
    await raw(`update public.tasks set status = 'completed' where id = $1`, [id]);
    let clock = 0;
    const late: ModelClient = { async create(r) { clock += 30_000; calls.push(r); return who(r) === "Alex" ? alexScript(r) : say("ok", r); } };
    const before = calls.length;
    await runTick({ store: store(), client: late, now: () => clock, budgetMs: 280_000, stepReserveMs: 170_000 });
    expect(calls.slice(before).some((c) => who(c) === "Sofia")).toBe(false);
    expect(id2).toBeTruthy();
  });

  it("reserva de Sofia con 32.000 tokens de salida", () => {
    const r = reserveUsd("claude-haiku-5-5", 10_000, { maxOutputTokens: 32_000, searches: 0, fetches: 0, fetchTokens: 0, searchResultTokens: 0 });
    expect(r).toBeCloseTo((10_000 * 0.1 * 1.25 + 32_000 * 0.5) / 1e6, 6);
  });
});

describe("C · mensajes de parada con cifras", () => {
  const snap = (o: Partial<BudgetSnapshot> = {}): BudgetSnapshot => ({
    limits: { monthly: 10, task: 1, mission: 1, synthesisReserve: 0.25 },
    real: { month: 0.26, mission: 0.26, task: 0.22 },
    open: { month: 0, mission: 0, task: 0 },
    uncertain: { month: 0, mission: 0, task: 0 },
    ...o,
  });
  it("misión: reserva necesaria, gasto real, reservas, saldo y límite; no dice que se gastó 1 $", () => {
    const m = budgetStopMessage("mission_budget", 0.5252, snap({ uncertain: { month: 0.05, mission: 0.05, task: 0 } }), true);
    expect(m).toBe(
      "Tarea detenida: la siguiente llamada no cabe en el límite de la misión (1,00 $, de los que 0,25 $ quedan reservados para el informe de Alex). " +
      "Reserva necesaria para la siguiente llamada: 0,5252 $. Gasto real acumulado: 0,26 $ · reservas abiertas: 0,00 $ · reservas inciertas: 0,05 $. " +
      "Saldo disponible: 0,44 $. El límite no se ha gastado entero: lo que no cabe es la reserva prudente de la siguiente llamada.",
    );
    expect(m).not.toMatch(/agotad/);
  });
  it("tarea y mes, incluido el caso en que el límite sí está comprometido entero", () => {
    expect(budgetStopMessage("task_budget", 0.1, snap(), true)).toMatch(/límite por tarea \(1,00 \$\).*Saldo disponible: 0,78 \$/);
    const full = budgetStopMessage("monthly_budget", 0.1, snap({ real: { month: 10, mission: 0, task: 0 } }), false);
    expect(full).toMatch(/límite mensual \(10,00 \$\).*Saldo disponible: 0,00 \$\. El límite está comprometido por completo/);
  });
});

/**
 * Imita la comprobación real de la API («preserved thinking»): dentro de una
 * conversación, la lista de herramientas no puede cambiar. Si cambia, 400.
 */
function strictTools(inner: ModelClient): ModelClient & { rejected: number } {
  const seen = new Map<string, string>();
  const c = {
    rejected: 0,
    async create(r: ModelRequest) {
      const conversation = `${r.system.slice(0, 200)}|${first(r).slice(0, 400)}`;
      const tools = JSON.stringify([r.tools.map((x) => x.name), r.serverTools ?? []]);
      const before = seen.get(conversation);
      if (before !== undefined && before !== tools) {
        c.rejected++;
        throw new ModelError("Petición rechazada por la API: 400 The `tools` list differs from the one this block was created with.", false, "none");
      }
      seen.set(conversation, tools);
      return inner.create(r);
    },
  };
  return c;
}

describe("D (revisada) · lista de herramientas constante en cada ejecución", () => {
  it("misión completa con la comprobación de la API activa: ninguna llamada rechazada; Marcus siempre con búsqueda y lectura", async () => {
    const id = await mission();
    const claude = new ScriptedClaude();
    const strict = strictTools(claude);
    await runTick({ store: store(), client: strict });
    expect(strict.rejected).toBe(0);
    expect((await raw<{ status: string }>(`select status::text as status from public.tasks where id = $1`, [id]))[0].status).toBe("completed");
    const marcus = claude.calls.filter((c) => who(c) === "Marcus");
    expect(marcus.length).toBeGreaterThan(1);
    for (const c of marcus) expect(c.serverTools?.map((x) => `${x.name}:${x.max_uses}`)).toEqual(["web_search:1", "web_fetch:1"]);
    // Cada agente usa exactamente la misma lista en todas sus llamadas.
    for (const agent of ["Alex", "Marcus", "Sofia"]) {
      const lists = new Set(claude.calls.filter((c) => who(c) === agent).map((c) => JSON.stringify([c.tools.map((x) => x.name), c.serverTools ?? []])));
      expect({ agent, distinct: lists.size }).toEqual({ agent, distinct: 1 });
    }
  });

  it("orden fijo de las herramientas web y reserva de 3 pasadas", () => {
    expect(serverToolsFor(["web.fetch", "web.search"]).map((t) => t.name)).toEqual(["web_search", "web_fetch"]);
    expect(serverToolsFor([])).toEqual([]);
    const r = reserveUsd("claude-sonnet-5-5", 30_000, { maxOutputTokens: 8_000, searches: 1, fetches: 1, fetchTokens: 8_000, searchResultTokens: 15_000 });
    expect(r).toBeCloseTo((3 * 53_000 * 2 * 1.25 + 8_000 * 10) / 1e6 + 0.01, 6);
  });

  it("sin búsquedas restantes en la misión: la tarea se detiene sin llamar (no se cambia la lista) y la reserva se libera", async () => {
    const id = await mission();
    const claude = new ScriptedClaude();
    // Alex delega; luego se agotan las búsquedas de la misión antes de que trabaje Marcus.
    class Exhaust extends SqlEngineStore {
      async delegate(...a: Parameters<SqlEngineStore["delegate"]>) {
        const r = await super.delegate(...a);
        if (a[3] === "marcus") {
          await raw(`insert into public.ai_usage (agent_id, task_id, model, server_tool_requests, cost_usd) values ('marcus', $1, 'claude-sonnet-5-5', 15, 0.15)`, [id]);
        }
        return r;
      }
    }
    await runTick({ store: new Exhaust(query), client: claude });
    expect(claude.calls.filter((c) => who(c) === "Marcus")).toHaveLength(0);
    const [m] = await raw<{ status: string; error: string }>(`select status::text as status, error from public.tasks where agent_id = 'marcus'`);
    expect(m).toEqual({ status: "failed", error: expect.stringMatching(/máximo de búsquedas web de la misión/) });
    expect(await raw(`select 1 from public.ai_reservations where agent_id = 'marcus' and status <> 'released'`)).toHaveLength(0);
  });
});

describe("Documentos del equipo de hasta 40.000 caracteres", () => {
  it("un documento de Sofia de 21.038 caracteres llega entero a la síntesis de Alex", async () => {
    const id = await mission();
    const long = `INICIO ${"x".repeat(21_000)} SECCION FINAL 3.3`;
    const calls: ModelRequest[] = [];
    const client: ModelClient = {
      async create(r) {
        calls.push(structuredClone(r));
        if (who(r) === "Alex") return alexScript(r);
        if (who(r) === "Sofia" && turn(r) === 1) return use([{ id: "sd", name: "content__draft", input: { title: "Estrategia larga", kind: "strategy", content: long } }], r);
        return say("Hecho.", r);
      },
    };
    await runTick({ store: store(), client });
    const synth = calls.filter((c) => who(c) === "Alex").at(-1)!;
    expect(first(synth)).toContain(long);
    expect(first(synth)).not.toContain("(recortado)");
    expect(id).toBeTruthy();
  });
});

describe("E · teléfono de hasta 100 caracteres con validación", () => {
  it("acepta números reales con separadores y rechaza texto o cifras absurdas", async () => {
    const id = await mission();
    const { pilotGateway } = await import("@/lib/engine/pilot-tools");
    const [c] = await t.asService(() => raw<{ run_id: string }>(`select * from public.claim_next_task('w', 240, 5)`));
    const gw = pilotGateway({ store: store(), runId: c.run_id, taskId: id, worker: "w", clientId: null, missionId: id, reuseIds: [] });
    const marcus = { id: "marcus", name: "Marcus", tools: ["crm.write" as const] };
    const phones = [
      "+34 933 000 000 / +34 600 111 222", // dos números: válido (33 caracteres)
      "+34 (93) 300-00-00; +34 600.111.222", // otros separadores: válido
      "+34 933 000 000 / +34 600 111 222 / +34 600 333 444", // 33 cifras (máx. 30): no
      "+34 933 000 000 (recepción, ext. 2)", // letras: no
      "llamar por la tarde", // texto: no
      "12", // pocas cifras: no
      "9".repeat(101), // más de 100 caracteres: no
    ];
    const ok = [];
    for (const [i, p] of phones.entries()) {
      const r = await gw.execute(
        { agent: marcus, toolUseId: `p${i}`, toolId: "crm.write", args: { name: `Tel ${i}`, city: "Barcelona", need_detected: "VERIFICADO: prueba de teléfono.", phone: p, sources: ["https://x.example/"] } },
        { runId: c.run_id, taskId: id, agentId: "marcus" },
      );
      ok.push(r.kind === "result" && !r.output.isError);
    }
    expect(ok).toEqual([true, true, false, false, false, false, false]);
  });
});

describe("Tiempo por agente", () => {
  it("si no queda tiempo para la llamada de Sofia, la pasada termina en lugar de reintentar en bucle", async () => {
    const id = await mission();
    // Marcus y Alex ya hicieron su parte; solo queda Sofia.
    await raw(`update public.tasks set status = 'completed' where id = $1`, [id]);
    await raw(`insert into public.tasks (title, description, agent_id, status, parent_task_id, input) values ('Estrategia', 'Estrategia con las fichas.', 'sofia', 'assigned', $1, '{"kind":"subtask"}')`, [id]);
    let clock = 0;
    let claims = 0;
    class Counting extends SqlEngineStore {
      async claim(w: string, l: number, m: number) { claims++; clock += 30_000; return super.claim(w, l, m); }
    }
    // Quedan 250 s: más que la reserva general (170 s) pero menos que la llamada de Sofia (240 + 20 s).
    const report = await runTick({ store: new Counting(query), client: { async create() { throw new Error("no debe llamar"); } }, now: () => clock, budgetMs: 280_000, stepReserveMs: 170_000 });
    expect(report.runs.map((r) => r.outcome)).toEqual(["yielded"]);
    expect(claims).toBe(1);
  });
});

describe("Repetición de la misión con las 5 fichas existentes", () => {
  async function previousFichas() {
    const old = await mission();
    await raw(`update public.tasks set status = 'completed' where id = $1`, [old]);
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const [r] = await t.asService(() => raw<{ id: string }>(
        `insert into public.companies (name, city, website, need_detected, notes, source, created_by, created_in_task, stage)
         values ($1, 'Barcelona', $2, 'VERIFICADO: reserva online.', 'VERIFICADO: web. PENDIENTE: WhatsApp e Instagram.', $2, 'marcus', $3, 'researched') returning id`,
        [`Estudio ${i}`, `https://estudio${i}.example/`, old]));
      ids.push(r.id);
    }
    return ids;
  }

  it("Marcus completa lo pendiente sin duplicar ni superar 5 empresas; Sofia y Alex trabajan con las fichas", async () => {
    const reuse = await previousFichas();
    const id = await mission({ reuse_company_ids: reuse });
    const calls: ModelRequest[] = [];
    const client: ModelClient = {
      async create(r) {
        calls.push(structuredClone(r));
        switch (who(r)) {
          case "Alex": return alexScript(r);
          case "Marcus":
            if (turn(r) === 1)
              return use([
                // Completar una ficha reutilizada: notas nuevas y una fuente más.
                { id: "u1", name: "crm__write", input: { company_id: reuse[0], instagram: "@estudio1", notes: "VERIFICADO: web e Instagram activo. PENDIENTE: WhatsApp.", sources: ["https://instagram.com/estudio1"] } },
                // Una sexta empresa: rechazada (5 reutilizadas = tope).
                { id: "n1", name: "crm__write", input: { name: "Gimnasio Nuevo", city: "Barcelona", need_detected: "VERIFICADO: algo.", sources: ["https://nuevo.example/"] } },
                // Una existente por nombre: no se duplica.
                { id: "d1", name: "crm__write", input: { name: "Estudio 2", city: "Barcelona", need_detected: "VERIFICADO: duplicado.", sources: ["https://estudio2.example/"] } },
                // Una ficha que no es de la misión: rechazada.
                { id: "x1", name: "crm__write", input: { company_id: "7f3c1e2a-9b4d-4c8e-a1f2-3d5e6f708192", notes: "x", sources: ["https://x.example/"] } },
              ], r);
            return say("Fichas completadas.", r);
          case "Sofia":
            return say("Estrategia con 5 fichas.", r);
        }
        throw new Error("inesperado");
      },
    };
    await runTick({ store: store(), client });

    const by = (n: string) => calls.filter((c) => who(c) === n);
    // Alex planifica viendo las 5 fichas y la instrucción de no repetir la investigación.
    expect(first(by("Alex")[0])).toMatch(/parte de 5 fichas ya investigadas[\s\S]*FICHAS DEL CRM DE LA MISIÓN \(5\)/);
    // Marcus tiene siempre búsqueda y lectura (lista constante).
    expect(by("Marcus")[0].serverTools?.map((s) => s.name)).toEqual(["web_search", "web_fetch"]);
    expect(first(by("Marcus")[0])).toContain("Tope de la misión: 5 empresas en total; ya hay 5 (5 reutilizadas)");
    const results = lastResults(by("Marcus")[1]);
    expect(results).toMatch(/Ficha «Estudio 1» completada/);
    expect(results).toMatch(/máximo de 5 empresas en esta misión \(incluidas las reutilizadas\)/);
    expect(results).toMatch(/«Estudio 2» ya está en el CRM .*no se ha duplicado\. Para añadir datos, usa company_id/);
    expect(results).toMatch(/no pertenece a esta misión/);

    const all = await raw<{ name: string; instagram: string | null; notes: string; source: string }>(
      `select name, instagram, notes, source from public.companies where created_by = 'marcus' order by name`);
    expect(all.map((c) => c.name)).toEqual(["Estudio 1", "Estudio 2", "Estudio 3", "Estudio 4", "Estudio 5"]);
    expect(all[0]).toMatchObject({ instagram: "@estudio1", notes: "VERIFICADO: web e Instagram activo. PENDIENTE: WhatsApp." });
    expect(all[0].source.split(" | ").sort()).toEqual(["https://estudio1.example/", "https://instagram.com/estudio1"]);

    // Sofia y Alex reciben las 5 fichas (con la ficha ya completada).
    expect(first(by("Sofia")[0])).toMatch(/FICHAS DEL CRM DE LA MISIÓN \(5\)[\s\S]*@estudio1/);
    const synth = by("Alex").at(-1)!;
    expect(first(synth)).toMatch(/FICHAS DEL CRM DE LA MISIÓN \(5\)/);
    for (const r of reuse) expect(first(synth)).toContain(`id ${r}`);
    expect((await raw<{ status: string }>(`select status::text as status from public.tasks where id = $1`, [id]))[0].status).toBe("completed");
    // Idempotencia: otra pasada no repite nada.
    const n = calls.length;
    await runTick({ store: store(), client });
    expect(calls.length).toBe(n);
  });

  it("Sofia trabaja con las fichas reutilizadas aunque Marcus falle", async () => {
    const reuse = await previousFichas();
    await mission({ reuse_company_ids: reuse });
    const calls: ModelRequest[] = [];
    const client: ModelClient = {
      async create(r) {
        calls.push(structuredClone(r));
        if (who(r) === "Alex") return alexScript(r);
        if (who(r) === "Marcus") throw new ModelError("Petición rechazada por la API: prueba.", false, "none");
        return say("Estrategia.", r);
      },
    };
    await runTick({ store: store(), client });
    const sofia = calls.find((c) => who(c) === "Sofia")!;
    expect(first(sofia)).toMatch(/ESTADO: FALLIDA[\s\S]*FICHAS DEL CRM DE LA MISIÓN \(5\)/);
  });
});
