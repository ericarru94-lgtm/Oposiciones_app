// Piloto: delegación de Alex con límites y ciclo completo del encargo.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";

let t: TestDb;
const q = async <T,>(sql: string, params: unknown[] = []) => (await t.db.query<T>(sql, params)).rows;
const svc = <T,>(sql: string, params: unknown[] = []) => t.asService(() => q<T>(sql, params));
type Claim = { task_id: string; run_id: string; agent_id: string; attempt: number };
const claim = (w = "w1") => svc<Claim>(`select * from public.claim_next_task($1, 240, 5)`, [w]);

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.db.exec(`delete from public.tasks; delete from public.ai_usage;
    update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 1}' where key = 'limits';
    update public.agents set status = 'available', current_task_id = null;`);
});

async function mission() {
  const [m] = await q<{ id: string }>(
    `insert into public.tasks (title, description, agent_id, status, input)
     values ('Estudio gimnasios', 'Encargo de prueba', 'alex', 'assigned', '{"kind": "mission", "round": 1}') returning id`,
  );
  const [c] = await claim();
  expect(c.task_id).toBe(m.id);
  return { missionId: m.id, runId: c.run_id };
}
const delegate = (runId: string, toolUse: string, agent: string, deps: string[] = [], worker = "w1") =>
  svc<{ r: { task_id: string; duplicate: boolean } }>(
    `select public.delegate_task($1, $7, $2, $3, $4, $5, $6::uuid[]) as r`,
    [runId, toolUse, agent, `Subtarea para ${agent}`, "Instrucciones detalladas de la subtarea", deps, worker],
  ).then((x) => x[0].r);

describe("delegación de Alex", () => {
  it("crea subtareas idempotentes, con dependencias, y marca al agente como «recibiendo tarea»", async () => {
    const { runId, missionId } = await mission();
    const m = await delegate(runId, "tu1", "marcus");
    expect((await delegate(runId, "tu1", "marcus")).duplicate).toBe(true);
    const s = await delegate(runId, "tu2", "sofia", [m.task_id]);
    const kids = await q<{ agent_id: string; parent_task_id: string; status: string }>(
      `select agent_id, parent_task_id, status from public.tasks where parent_task_id = $1 order by agent_id`, [missionId]);
    expect(kids).toEqual([
      { agent_id: "marcus", parent_task_id: missionId, status: "assigned" },
      { agent_id: "sofia", parent_task_id: missionId, status: "assigned" },
    ]);
    const deps = await q(`select 1 from public.task_dependencies where task_id = $1 and depends_on = $2`, [s.task_id, m.task_id]);
    expect(deps).toHaveLength(1);
    expect((await q<{ status: string }>(`select status from public.agents where id = 'marcus'`))[0].status).toBe("receiving");
  });

  it("solo el coordinador, sin subdelegación, solo agentes del piloto y como máximo 6", async () => {
    const { runId } = await mission();
    await expect(delegate(runId, "x", "alex")).rejects.toThrow(/No se puede delegar/);
    await expect(delegate(runId, "y", "david")).rejects.toThrow(/No se puede delegar/);
    for (let i = 0; i < 6; i++) await delegate(runId, `ok${i}`, i % 2 ? "marcus" : "sofia");
    await expect(delegate(runId, "seventh", "marcus")).rejects.toThrow(/máximo de subtareas/);
    // Marcus no puede delegar desde su subtarea.
    await svc(`select public.await_subtasks($1, 'w1', 'Plan')`, [runId]);
    const [c] = await claim("w2");
    expect(c.agent_id).not.toBe("alex");
    await expect(delegate(c.run_id, "z", "sofia", [], "w2")).rejects.toThrow(/coordinador|encargo principal/);
  });

  it("ciclo completo: Alex delega, espera, retoma la síntesis cuando terminan y no se reclama antes", async () => {
    const { runId, missionId } = await mission();
    const m = await delegate(runId, "a", "marcus");
    const s = await delegate(runId, "b", "sofia", [m.task_id]);
    const wait = await svc<{ r: { pending: number; round: number } }>(`select public.await_subtasks($1, 'w1', 'Plan delegado') as r`, [runId]);
    expect(wait[0].r).toEqual({ pending: 2, round: 2 });
    expect((await q<{ status: string }>(`select status from public.agents where id = 'alex'`))[0].status).toBe("waiting_agent");

    const [mc] = await claim("w2");
    expect(mc.task_id).toBe(m.task_id); // Sofia espera a Marcus; Alex espera a ambos
    expect(await claim("w3")).toHaveLength(0);
    await svc(`select public.complete_run($1, 'w2', 'Fichas listas')`, [mc.run_id]);
    const [sc] = await claim("w3");
    expect(sc.task_id).toBe(s.task_id);
    expect(await claim("w4")).toHaveLength(0);
    await svc(`select public.complete_run($1, 'w3', 'Estrategia lista')`, [sc.run_id]);

    const [ac] = await claim("w4");
    expect(ac).toMatchObject({ task_id: missionId, agent_id: "alex", attempt: 2 });
    const [phase] = await q<{ input: { phase: string; round: number } }>(`select input from public.tasks where id = $1`, [missionId]);
    expect(phase.input).toMatchObject({ phase: "synthesis", round: 2 });
    // Una ronda de correcciones permitida; después, no más delegación.
    const fix = await delegate(ac.run_id, "c", "marcus", [], "w4");
    await svc(`select public.await_subtasks($1, 'w4', 'Corrección')`, [ac.run_id]);
    const [fc] = await claim("w5");
    await svc(`select public.complete_run($1, 'w5', 'Corregido')`, [fc.run_id]);
    expect(fc.task_id).toBe(fix.task_id);
    const [final] = await claim("w6");
    await expect(delegate(final.run_id, "d", "sofia", [], "w6")).rejects.toThrow(/máximo de rondas/);
    expect((await svc<{ s: string }>(`select public.complete_run($1, 'w6', 'Informe final') as s`, [final.run_id]))[0].s).toBe("completed");
  });

  it("una subtarea fallida no bloquea para siempre al coordinador", async () => {
    const { runId, missionId } = await mission();
    await delegate(runId, "a", "marcus");
    await svc(`select public.await_subtasks($1, 'w1', 'Plan')`, [runId]);
    const [mc] = await claim("w2");
    await svc(`select public.fail_run($1, 'w2', 'Error', false)`, [mc.run_id]);
    const [ac] = await claim("w3");
    expect(ac.task_id).toBe(missionId);
  });
});

describe("gasto", () => {
  it("el límite por tarea suma todos sus intentos", async () => {
    await q(`insert into public.tasks (title, agent_id, status) values ('Cara', 'marcus', 'assigned')`);
    const step = (run: string, w: string, cost: number) =>
      svc<{ r: { continue: boolean; reason?: string } }>(
        `select public.record_step($1, $2, '{}', 'claude-sonnet-5-5', 10, 10, 0, 0, 0, $3) as r`, [run, w, cost]);
    const [c1] = await claim("w1");
    expect((await step(c1.run_id, "w1", 0.6))[0].r.continue).toBe(true);
    await svc(`select public.fail_run($1, 'w1', 'Error 529', true)`, [c1.run_id]);
    await q(`update public.tasks set run_after = now()`);
    const [c2] = await claim("w2");
    expect(c2.attempt).toBe(2);
    expect((await step(c2.run_id, "w2", 0.5))[0].r).toMatchObject({ continue: false, reason: "task_budget" });
  });

  it("avisa al superar el 80 % del presupuesto mensual", async () => {
    await q(`insert into public.ai_usage (model, cost_usd) values ('claude-sonnet-5-5', 8.1)`);
    await q(`insert into public.tasks (title, agent_id, status) values ('Aviso', 'sofia', 'assigned')`);
    const [c] = await claim();
    const [r] = await svc<{ r: { budget_warning: boolean } }>(
      `select public.record_step($1, 'w1', '{}', 'claude-haiku-5-5', 1, 1, 0, 0, 0, 0.001) as r`, [c.run_id]);
    expect(r.r.budget_warning).toBe(true);
  });

  it("registra la actividad visible sin aceptar eventos inventados", async () => {
    await q(`insert into public.tasks (title, agent_id, status) values ('Act', 'marcus', 'assigned')`);
    const [c] = await claim();
    await svc(`select public.set_run_activity($1, 'w1', 'researching', 'researching', 'Buscando gimnasios')`, [c.run_id]);
    expect((await q<{ status: string }>(`select status from public.agents where id = 'marcus'`))[0].status).toBe("researching");
    await expect(
      svc(`select public.set_run_activity($1, 'w1', 'working', 'completed', 'x')`, [c.run_id]),
    ).rejects.toThrow(/no válido/);
  });

  it("las funciones nuevas solo las ejecuta el motor", async () => {
    for (const fn of ["delegate_task(uuid,text,text,text,text,text,uuid[])", "await_subtasks(uuid,text,text)",
      "set_run_activity(uuid,text,agent_status,text,text)"]) {
      const [r] = await q<{ a: boolean; s: boolean }>(
        `select has_function_privilege('authenticated', 'public.${fn}', 'execute') as a,
                has_function_privilege('service_role', 'public.${fn}', 'execute') as s`);
      expect(r).toEqual({ a: false, s: true });
    }
  });
});
