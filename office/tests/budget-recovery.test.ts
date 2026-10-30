// Prevuelo: reservas de presupuesto, liquidación, respuesta perdida,
// reintentos transitorios, recuperación tras un corte, topes de misión y
// detención. PostgreSQL (PGlite) con las migraciones reales.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SqlEngineStore, type Query } from "@/lib/engine/store-sql";
import { runTick } from "@/lib/engine/worker";
import { ModelError, type ModelClient, type ModelRequest, type ModelResponse } from "@/lib/engine/types";
import { createTestDb, type TestDb } from "./helpers/db";
import { ScriptedClaude, who } from "./helpers/scripted-claude";

let t: TestDb;
const raw = async <T,>(sql: string, params: unknown[] = []) => (await t.db.query<T>(sql, params)).rows;
const query: Query = (sql, params) => t.asService(() => raw(sql, params ?? [])) as never;
const store = () => new SqlEngineStore(query);
const limits = (monthly: number, task: number, mission: number) =>
  t.db.exec(`update public.settings set value = '{"monthly_ai_budget_usd": ${monthly}, "task_ai_budget_usd": ${task}, "mission_ai_budget_usd": ${mission}}' where key = 'limits'`);

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.db.exec(`delete from public.documents; delete from public.ai_reservations; delete from public.tasks; delete from public.ai_usage;
    delete from public.companies where created_by <> 'admin';
    update public.agents set status = 'available', current_task_id = null;`);
  await limits(10, 1, 1);
});

async function mission() {
  const [m] = await raw<{ id: string }>(
    `insert into public.tasks (title, description, agent_id, status, input, created_by, timeout_seconds)
     values ('Estudio gimnasios', 'Encargo de prueba sin contactar a nadie', 'alex', 'assigned', '{"kind": "mission", "round": 1, "phase": "planning"}', 'admin', 86400) returning id`,
  );
  return m.id;
}
const status = async (id: string) =>
  (await raw<{ status: string; error: string | null }>(`select status::text as status, error from public.tasks where id = $1`, [id]))[0];
const reservations = () => raw<{ status: string; agent_id: string; estimate_usd: string; actual_usd: string | null }>(
  `select status, agent_id, estimate_usd::text, actual_usd::text from public.ai_reservations order by created_at`);

describe("presupuesto", () => {
  it("cada llamada se reserva antes y se liquida con el coste real (Claude y búsquedas por separado)", async () => {
    const id = await mission();
    const claude = new ScriptedClaude();
    await runTick({ store: store(), client: claude });
    expect((await status(id)).status).toBe("completed");
    const rs = await reservations();
    expect(rs).toHaveLength(claude.calls.length);
    expect(rs.every((r) => r.status === "settled" && Number(r.actual_usd) <= Number(r.estimate_usd))).toBe(true);
    const [c] = await raw<{ claude: string; search: string; total: string }>(
      `select sum(claude_cost_usd)::text as claude, sum(search_cost_usd)::text as search, sum(cost_usd)::text as total from public.ai_usage`);
    expect(Number(c.search)).toBeCloseTo(0.02); // 2 búsquedas de Marcus
    expect(Number(c.claude) + Number(c.search)).toBeCloseTo(Number(c.total));
    // Las búsquedas que se ofrecen a Marcus nunca superan su reserva.
    expect(claude.calls.filter((r) => who(r) === "Marcus").every((r) => r.serverTools?.some((s) => s.name === "web_search" && s.max_uses === 1))).toBe(true);
  });

  it("límite por misión: las subtareas no pueden comerse la parte reservada al informe de Alex", async () => {
    await limits(10, 1, 0.35); // subtareas: 0,35 − 0,25 de reserva = 0,10; una llamada de Marcus reserva más
    const id = await mission();
    const claude = new ScriptedClaude();
    const report = await runTick({ store: store(), client: claude });
    expect(report.runs.map((r) => `${r.agentId}:${r.outcome}`)).toEqual([
      "alex:waiting_agents", "marcus:budget_stop", "sofia:completed", "alex:completed",
    ]);
    expect(claude.calls.filter((c) => who(c) === "Marcus")).toHaveLength(0);
    const marcus = await raw<{ error: string }>(`select error from public.tasks where agent_id = 'marcus'`);
    expect(marcus[0].error).toMatch(/límite de gasto de la misión/);
    expect((await status(id)).status).toBe("completed"); // Alex informa con lo que hay
    const [m] = await raw<{ v: string }>(`select public.committed_usd('mission', $1)::text as v`, [id]);
    expect(Number(m.v)).toBeLessThanOrEqual(0.35);
  });

  it("límite mensual con reservas abiertas: el saldo comprometido cuenta antes de llamar", async () => {
    await limits(10, 10, 10);
    await mission();
    const [c] = await t.asService(() => raw<{ run_id: string }>(`select * from public.claim_next_task('w1', 240, 5)`));
    const reserve = (run: string, worker: string, usd: number) =>
      t.asService(() => raw<{ r: { ok: boolean; reason?: string } }>(`select public.reserve_budget($1, $2, 'claude-sonnet-5-5', $3, 0) as r`, [run, worker, usd])).then((x) => x[0].r);
    expect((await reserve(c.run_id, "w1", 9.95)).ok).toBe(true);
    // Otra tarea: 9,95 comprometidos + 0,10 > 10 → no se llama.
    await raw(`insert into public.tasks (title, description, agent_id, status, input) values ('Otra', 'Otra misión de prueba', 'sofia', 'assigned', '{"kind": "mission"}')`);
    const [c2] = await t.asService(() => raw<{ run_id: string }>(`select * from public.claim_next_task('w2', 240, 5)`));
    expect(await reserve(c2.run_id, "w2", 0.1)).toEqual({ ok: false, reason: "monthly_budget" });
    // Otra reserva de la misma ejecución con una abierta = llamada anterior incierta.
    expect(await reserve(c.run_id, "w1", 0.01)).toEqual({ ok: false, reason: "uncertain" });
    const [b] = await raw<{ month_spent_usd: string }>(`select * from public.ai_budget_status()`);
    expect(Number(b.month_spent_usd)).toBeCloseTo(9.95); // incierta = gastada
  });
});

describe("recuperación", () => {
  it("respuesta perdida: cuenta como gastada, la tarea se detiene y la llamada no se repite", async () => {
    const id = await mission();
    let calls = 0;
    const lost: ModelClient = { async create() { calls++; throw new ModelError("Sin respuesta de Claude.", true, "unknown"); } };
    expect((await runTick({ store: store(), client: lost })).runs[0].outcome).toBe("uncertain");
    expect(await reservations()).toMatchObject([{ status: "uncertain", agent_id: "alex" }]);
    expect(await status(id)).toEqual({ status: "failed", error: expect.stringMatching(/incierto/) });
    await runTick({ store: store(), client: lost });
    expect(calls).toBe(1);
  });

  it("error transitorio sin cobro (429): misma ejecución y misma conversación, se libera la reserva", async () => {
    const id = await mission();
    const claude = new ScriptedClaude();
    let first = true;
    const flaky: ModelClient = {
      async create(r) {
        if (first) { first = false; throw new ModelError("Claude ha limitado las peticiones (429).", true, "none"); }
        return claude.create(r);
      },
    };
    expect((await runTick({ store: store(), client: flaky })).runs[0].outcome).toBe("deferred");
    expect(await reservations()).toMatchObject([{ status: "released" }]);
    const [d] = await raw<{ status: string; wait: boolean }>(`select status::text as status, run_after > now() as wait from public.tasks where id = $1`, [id]);
    expect(d).toEqual({ status: "in_progress", wait: true });
    await raw(`update public.tasks set run_after = now() where id = $1`, [id]);
    await runTick({ store: store(), client: flaky });
    const runs = await raw<{ attempt: number }>(`select attempt from public.agent_runs where task_id = $1`, [id]);
    expect(runs.map((r) => r.attempt)).toEqual([1, 2]); // 2 = fase de síntesis tras esperar al equipo
    expect((await status(id)).status).toBe("completed");
  });

  it("corte después de guardar la respuesta: al recuperar se ejecutan sus herramientas sin repetir la llamada ni duplicar nada", async () => {
    const id = await mission();
    const claude = new ScriptedClaude();
    let crashed = false;
    class CrashOnce extends SqlEngineStore {
      async saveRunState(runId: string, worker: string, state: unknown, release: boolean) {
        if (!crashed) { crashed = true; throw new Error("proceso cortado"); }
        return super.saveRunState(runId, worker, state, release);
      }
    }
    expect((await runTick({ store: new CrashOnce(query), client: claude })).runs[0].outcome).toBe("error");
    const kids1 = await raw(`select id from public.tasks where parent_task_id = $1`, [id]);
    expect(kids1).toHaveLength(1); // la delegación ya se hizo antes del corte
    await raw(`update public.tasks set locked_until = now() - interval '1 second' where id = $1`, [id]);
    await runTick({ store: store(), client: claude });
    expect((await status(id)).status).toBe("completed");
    const kids = await raw<{ agent_id: string }>(`select agent_id from public.tasks where parent_task_id = $1 order by agent_id`, [id]);
    expect(kids.map((k) => k.agent_id)).toEqual(["marcus", "sofia"]);
    // Alex: 3 llamadas de planificación + 1 de síntesis, igual que sin corte.
    expect(claude.calls.filter((c) => who(c) === "Alex")).toHaveLength(4);
    expect((await raw(`select 1 from public.ai_usage`)).length).toBe(claude.calls.length);
  });

  it("el lease se renueva en cada reserva y el coste se guarda aunque el lease se pierda", async () => {
    const id = await mission();
    let renewed = 0;
    const client: ModelClient = {
      async create(req: ModelRequest): Promise<ModelResponse> {
        const [l] = await raw<{ s: number }>(`select extract(epoch from locked_until - now())::int as s from public.tasks where id = $1`, [id]);
        renewed = l.s;
        // Simula que otra pasada se ha quedado la tarea mientras tanto.
        await raw(`update public.tasks set locked_by = 'otra-pasada' where id = $1`, [id]);
        return { content: [{ type: "text", text: "plan" }], stopReason: "end_turn", model: req.model,
          usage: { inputTokens: 5000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 } };
      },
    };
    expect((await runTick({ store: store(), client })).runs[0].outcome).toBe("lease_lost");
    expect(renewed).toBeGreaterThan(200);
    const [u] = await raw<{ n: number; usd: string }>(`select count(*)::int as n, sum(cost_usd)::text as usd from public.ai_usage`);
    expect(u.n).toBe(1);
    expect(Number(u.usd)).toBeCloseTo(0.02);
    expect(await reservations()).toMatchObject([{ status: "settled" }]);
  });

  it("dos pasadas a la vez sobre la misma misión no duplican tareas ni llamadas", async () => {
    const id = await mission();
    const claude = new ScriptedClaude();
    for (let i = 0; i < 4; i++) {
      await Promise.all([runTick({ store: store(), client: claude }), runTick({ store: store(), client: claude })]);
    }
    expect((await status(id)).status).toBe("completed");
    expect(claude.calls.map(who).sort()).toEqual(["Alex", "Alex", "Alex", "Alex", "Marcus", "Marcus", "Marcus", "Sofia", "Sofia"]);
    expect((await raw(`select 1 from public.tasks where parent_task_id = $1`, [id])).length).toBe(2);
    expect((await raw(`select 1 from public.documents`)).length).toBe(3);
  });
});

describe("topes y detención", () => {
  it("máximo 5 empresas por misión, aplicado por la base de datos", async () => {
    const id = await mission();
    for (let i = 1; i <= 5; i++) {
      await t.asService(() => raw(`insert into public.companies (name, city, source, created_by, created_in_task) values ($1, 'Barcelona', 'https://x.example/', 'marcus', $2)`, [`Gym ${i}`, id]));
    }
    await expect(
      t.asService(() => raw(`insert into public.companies (name, city, source, created_by, created_in_task) values ('Gym 6', 'Barcelona', 'https://x.example/', 'marcus', $1)`, [id])),
    ).rejects.toThrow(/máximo de 5 empresas/);
  });

  it("máximo de búsquedas por misión: la reserva concede solo las que quedan", async () => {
    const id = await mission();
    const [c] = await t.asService(() => raw<{ run_id: string; task_id: string }>(`select * from public.claim_next_task('w1', 240, 5)`));
    await raw(`insert into public.ai_usage (agent_id, task_id, run_id, model, server_tool_requests, cost_usd) values ('marcus', $1, $2, 'claude-sonnet-5-5', 14, 0.14)`, [id, c.run_id]);
    const [r] = await t.asService(() => raw<{ r: { ok: boolean; searches: number } }>(`select public.reserve_budget($1, 'w1', 'claude-sonnet-5-5', 0.2, 3) as r`, [c.run_id]));
    expect(r.r).toMatchObject({ ok: true, searches: 1 });
  });

  it("detener misión: subtareas y ejecuciones canceladas, llamadas en curso cuentan como gastadas", async () => {
    const id = await mission();
    const [c] = await t.asService(() => raw<{ run_id: string }>(`select * from public.claim_next_task('w1', 240, 5)`));
    await t.asService(() => raw(`select public.delegate_task($1, 'w1', 'tu1', 'marcus', 'Investigar', 'Instrucciones claras', '{}'::uuid[])`, [c.run_id]));
    await t.asService(() => raw(`select public.reserve_budget($1, 'w1', 'claude-sonnet-5-5', 0.1, 0)`, [c.run_id]));
    const [n] = await t.asService(() => raw<{ n: number }>(`select public.cancel_mission($1, 'Detenida por el administrador') as n`, [id]));
    expect(n.n).toBe(2);
    const all = await raw<{ status: string }>(`select status::text as status from public.tasks`);
    expect(all.every((x) => x.status === "failed")).toBe(true);
    expect(await reservations()).toMatchObject([{ status: "uncertain" }]);
    expect((await raw(`select 1 from public.task_events where type = 'cancelled'`)).length).toBe(2);
    expect((await runTick({ store: store(), client: new ScriptedClaude() })).runs).toEqual([]);
  });
});

describe("reserva conservadora", () => {
  it("cubre el peor caso con los límites del piloto y usa el contador exacto cuando existe", async () => {
    const { reserveUsd } = await import("@/lib/engine/cost");
    const { costUsd } = await import("@/lib/engine/cost");
    const { SERVER_TOOLS, SEARCH_RESULT_TOKENS_ASSUMED, ENGINE } = await import("@/lib/engine/config");
    expect(SERVER_TOOLS["web.search"].type).toBe("web_search_20250305"); // sin filtrado dinámico
    for (const P of [5_000, 30_000, 80_000]) {
      const b = { maxOutputTokens: ENGINE.maxTokens, searches: 1, fetches: 1, fetchTokens: 8_000, searchResultTokens: SEARCH_RESULT_TOKENS_ASSUMED };
      const r = reserveUsd("claude-sonnet-5-5", P, b);
      // Peor caso dentro de los supuestos: 3 pasadas sin caché, contexto completo en cada una, salida máxima, 1 búsqueda.
      const C = P + 8_000 + SEARCH_RESULT_TOKENS_ASSUMED;
      const worst = costUsd("claude-sonnet-5-5", { inputTokens: 0, cacheWriteTokens: 3 * C, cacheReadTokens: 0, outputTokens: ENGINE.maxTokens, webSearchRequests: 1 });
      expect(r).toBeGreaterThanOrEqual(worst - 1e-6);
    }
    // Haiku por encima de 100.000 tokens usa el tramo caro.
    expect(reserveUsd("claude-haiku-5-5", 150_000, { maxOutputTokens: 8_000, searches: 0, fetches: 0, fetchTokens: 0, searchResultTokens: 0 }))
      .toBeCloseTo((150_000 * 0.5 * 1.25 + 8_000 * 2.5) / 1e6, 5);
  });

  it("el contador exacto se usa para la reserva y un sobrecoste queda registrado como aviso", async () => {
    const id = await mission();
    const counted: number[] = [];
    const client: ModelClient = {
      async countTokens() { counted.push(1); return 100; }, // prompt diminuto → reserva mínima
      async create(req: ModelRequest): Promise<ModelResponse> {
        // Gasta más de lo reservado (simula resultados web más grandes de lo supuesto).
        return { content: [{ type: "text", text: "plan" }], stopReason: "end_turn", model: req.model,
          usage: { inputTokens: 200_000, outputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 } };
      },
    };
    await runTick({ store: store(), client });
    expect(counted).toHaveLength(1);
    const [r] = await reservations();
    expect(Number(r.actual_usd)).toBeGreaterThan(Number(r.estimate_usd));
    const ev = await raw<{ type: string }>(`select type from public.task_events where task_id = $1 and type = 'cost_overrun'`, [id]);
    expect(ev).toHaveLength(1);
    // El gasto real (no la reserva) es lo que cuenta a partir de ahora.
    const [m] = await raw<{ v: string }>(`select public.committed_usd('mission', $1)::text as v`, [id]);
    expect(Number(m.v)).toBeCloseTo(Number(r.actual_usd));
  });
});
