// Ejecutor del piloto de extremo a extremo sobre PostgreSQL con las
// migraciones reales y un modelo simulado con guion (sin llamadas a Claude).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SqlEngineStore, type Query } from "@/lib/engine/store-sql";
import { runTick } from "@/lib/engine/worker";
import type { ModelClient } from "@/lib/engine/types";
import { ScriptedClaude, lastToolResults, who } from "./helpers/scripted-claude";
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
  await t.db.exec(`delete from public.documents; delete from public.tasks; delete from public.ai_usage;
    delete from public.companies where created_by <> 'admin';
    update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 1, "mission_ai_budget_usd": 1}' where key = 'limits';
    update public.agents set status = 'available', current_task_id = null;`);
});

const MISSION = "Preparar un estudio comercial para captar gimnasios en Barcelona. Todo en borrador; no contactar con nadie.";
async function mission() {
  const [m] = await raw<{ id: string }>(
    `insert into public.tasks (title, description, agent_id, status, input, created_by)
     values ('Estudio gimnasios Barcelona', $1, 'alex', 'assigned', '{"kind": "mission", "round": 1, "phase": "planning"}', 'admin') returning id`,
    [MISSION],
  );
  return m.id;
}

describe("ejecutor del piloto", () => {
  it("encargo completo: delegación, dependencias, herramientas reales, síntesis y costes persistidos", async () => {
    const id = await mission();
    const claude = new ScriptedClaude();
    const report = await runTick({ store: store(), client: claude });

    expect(report.runs.map((r) => `${r.agentId}:${r.outcome}`)).toEqual([
      "alex:waiting_agents", "marcus:completed", "sofia:completed", "alex:completed",
    ]);
    // Modelos y herramientas de servidor según la configuración central.
    const byAgent = (n: string) => claude.calls.filter((c) => who(c) === n);
    expect(new Set(byAgent("Alex").map((c) => `${c.model}/${c.effort}`))).toEqual(new Set(["claude-sonnet-5-5/medium"]));
    expect(new Set(byAgent("Marcus").map((c) => `${c.model}/${c.effort}`))).toEqual(new Set(["claude-sonnet-5-5/high"]));
    expect(new Set(byAgent("Sofia").map((c) => `${c.model}/${c.effort}`))).toEqual(new Set(["claude-haiku-5-5/high"]));
    expect(byAgent("Marcus")[0].serverTools?.map((s) => s.type)).toEqual(["web_search_20250305", "web_fetch_20250910"]);
    expect(byAgent("Sofia")[0].serverTools ?? []).toEqual([]);
    expect(byAgent("Alex")[0].tools.map((x) => x.name).sort()).toEqual(["content__draft", "crm__read", "memory__read", "tasks__delegate"]);
    expect(byAgent("Marcus")[0].tools.map((x) => x.name)).not.toContain("email__send");

    // Sofia recibe los resultados de Marcus; Alex, los de ambos.
    expect(String(byAgent("Sofia")[0].messages[0].content)).toContain("Ficha · Gimnasio Real Uno");
    const synth = String(byAgent("Alex").at(-1)!.messages[0].content);
    expect(synth).toContain("Fichas listas");
    expect(synth).toContain("Estrategia de captación");

    // Permisos: email y subdelegación rechazados sin ejecutarse.
    const marcusResults = lastToolResults(byAgent("Marcus")[1]);
    expect(marcusResults).toMatch(/no tiene permiso.*Enviar|Marcus no tiene permiso/);
    expect(marcusResults).toMatch(/Marcus no tiene permiso para usar «Delegar tareas»/);

    // Persistencia real.
    const [m] = await raw<{ status: string; result: string }>(`select status::text as status, result from public.tasks where id = $1`, [id]);
    expect(m.status).toBe("completed");
    expect(m.result).toContain("Informe final");
    const kids = await raw<{ agent_id: string; status: string }>(`select agent_id, status::text as status from public.tasks where parent_task_id = $1 order by agent_id`, [id]);
    expect(kids).toEqual([{ agent_id: "marcus", status: "completed" }, { agent_id: "sofia", status: "completed" }]);
    const companies = await raw<{ name: string; source: string; stage: string; created_by: string }>(
      `select name, source, stage::text as stage, created_by from public.companies where created_by = 'marcus'`);
    expect(companies).toEqual([{ name: "Gimnasio Real Uno", source: "https://gym-uno.example/", stage: "researched", created_by: "marcus" }]);
    const docs = await raw<{ title: string; kind: string; agent_id: string; status: string }>(
      `select title, kind, agent_id, status from public.documents order by created_at`);
    expect(docs).toEqual([
      { title: "Ficha · Gimnasio Real Uno", kind: "client_file", agent_id: "marcus", status: "draft" },
      { title: "Estrategia de captación", kind: "strategy", agent_id: "sofia", status: "draft" },
      { title: "Informe final: Estudio gimnasios Barcelona", kind: "report", agent_id: "alex", status: "draft" },
    ]);
    const execs = await raw<{ tool_id: string; status: string }>(`select tool_id, status from public.tool_executions order by started_at`);
    expect(execs.map((e) => e.tool_id)).not.toContain("email.send");
    expect(execs.every((e) => e.status === "succeeded")).toBe(true);

    // Costes: una fila por llamada, búsquedas web contadas aparte.
    const [cost] = await raw<{ calls: number; searches: number; usd: string }>(
      `select count(*)::int as calls, sum(server_tool_requests)::int as searches, sum(cost_usd)::text as usd from public.ai_usage`);
    expect(cost.calls).toBe(claude.calls.length);
    expect(cost.searches).toBe(2);
    expect(Number(cost.usd)).toBeGreaterThan(0);
    const [mc] = await raw<{ cost_usd: string }>(`select cost_usd::text from public.task_costs where task_id = $1`, [id]);
    expect(Number(mc.cost_usd)).toBeGreaterThan(0);

    // Contrato de eventos.
    const events = new Set((await raw<{ type: string }>(`select type from public.task_events`)).map((e) => e.type));
    for (const e of ["task_assigned", "run_started", "thinking", "researching", "tool_executing", "waiting_for_agent", "run_succeeded"]) {
      expect(events, e).toContain(e);
    }
    const agents = await raw<{ id: string; status: string }>(`select id, status::text as status from public.agents where id in ('alex','marcus','sofia') order by id`);
    expect(agents.every((a) => a.status === "completed")).toBe(true);

    // Otra pasada no repite nada.
    const again = await runTick({ store: store(), client: claude });
    expect(again.runs).toEqual([]);
    expect((await raw(`select 1 from public.documents`)).length).toBe(3);
  });

  it("límite por tarea: si la reserva no cabe, no se llama a Claude", async () => {
    await t.db.exec(`update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 0.001, "mission_ai_budget_usd": 1}' where key = 'limits'`);
    const id = await mission();
    const claude = new ScriptedClaude();
    const report = await runTick({ store: store(), client: claude });
    expect(report.runs).toEqual([{ taskId: id, agentId: "alex", outcome: "budget_stop" }]);
    expect(claude.calls).toHaveLength(0);
    const [m] = await raw<{ status: string; error: string }>(`select status::text as status, error from public.tasks where id = $1`, [id]);
    expect(m).toEqual({ status: "failed", error: expect.stringMatching(/límite de gasto por tarea/) });
  });

  it("sin tiempo para otra llamada: guarda el estado, libera la tarea y la siguiente pasada la retoma", async () => {
    const id = await mission();
    let clock = 0;
    const claude = new ScriptedClaude();
    const slow: ModelClient = { create: (r) => { clock += 200_000; return claude.create(r); } };
    const opts = { store: store(), client: slow, now: () => clock, budgetMs: 280_000, stepReserveMs: 170_000 };

    expect((await runTick(opts)).runs).toEqual([{ taskId: id, agentId: "alex", outcome: "yielded" }]);
    const [locked] = await raw<{ status: string; locked_by: string | null }>(`select status::text as status, locked_by from public.tasks where id = $1`, [id]);
    expect(locked).toEqual({ status: "in_progress", locked_by: null });

    clock = 0;
    expect((await runTick(opts)).runs[0]).toMatchObject({ agentId: "alex", outcome: "yielded" });
    // Misma ejecución (no se cuenta como reintento ni abandono) y la conversación continúa.
    const runs = await raw<{ attempt: number; recoveries: number; steps: number }>(`select attempt, recoveries, steps from public.agent_runs where task_id = $1`, [id]);
    expect(runs).toEqual([{ attempt: 1, recoveries: 0, steps: 2 }]);
    expect(claude.calls[1].messages).toHaveLength(3);
  });
});
