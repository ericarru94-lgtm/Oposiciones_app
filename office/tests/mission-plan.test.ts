// Fase 5.2.1 · Plan de misión (0013) en la base de datos: propuesta, validación,
// decisiones del administrador, inmutabilidad, ampliaciones y límites de cada
// paso en reserve_budget. PostgreSQL embebido (PGlite) con todas las migraciones.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "@/lib/engine/config";
import { SqlEngineStore } from "@/lib/engine/store-sql";
import type { PlanStepInput } from "@/lib/engine/store";
import { ADMIN, INTRUDER, createTestDb, type TestDb } from "./helpers/db";

let t: TestDb;
const raw = async <T,>(sql: string, params: unknown[] = []) => (await t.db.query<T>(sql, params)).rows;
const svc = <T,>(sql: string, params: unknown[] = []) => t.asService(() => raw<T>(sql, params));
const admin = <T,>(sql: string, params: unknown[] = []) => t.as(ADMIN, () => raw<T>(sql, params));
const store = () => new SqlEngineStore((sql, p) => t.asService(() => raw(sql, p)));
const errCode = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

const MARCUS: PlanStepInput = {
  key: "investigacion", agent: "marcus", title: "Investigar 3 gimnasios boutique",
  instructions: "Busca tres gimnasios boutique reales de Barcelona y guarda sus fichas con fuentes.",
  depends_on: [], tools: ["web.search", "web.fetch", "crm.read", "crm.write", "content.draft"],
  budget_usd: 0.45, max_calls: 4, max_searches: 3,
};
const SOFIA: PlanStepInput = {
  key: "estrategia", agent: "sofia", title: "Estrategia de captación",
  instructions: "Propón una estrategia de captación con las fichas de Marcus.",
  depends_on: ["investigacion"], tools: ["memory.read", "crm.read", "content.draft"],
  budget_usd: 0.2, max_calls: 3, max_searches: 0,
};

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  // Limpieza entre pruebas (los planes no se pueden borrar: solo aquí, sin triggers).
  await t.db.exec(`set session_replication_role = replica;
    delete from public.mission_plan_steps; delete from public.mission_plans; delete from public.task_dependencies;
    delete from public.ai_reservations; delete from public.ai_usage; delete from public.agent_runs; delete from public.tasks;
    delete from public.activity_log;
    set session_replication_role = origin;
    update public.agents set status = 'available', current_task_id = null;
    set session_replication_role = replica; update public.agents set active = (id in ('alex', 'marcus', 'sofia')); set session_replication_role = origin;`);
});

/** Misión nueva tal como la crea la interfaz (sin indicar plan_required). */
async function planMission(input: Record<string, unknown> = {}) {
  const [m] = await svc<{ id: string; plan_required: boolean }>(
    `insert into public.tasks (title, description, agent_id, status, input, created_by, timeout_seconds)
     values ('Estudio gimnasios', 'Estudio comercial en borrador', 'alex', 'assigned', $1, 'admin', 86400) returning id, plan_required`,
    [JSON.stringify({ kind: "mission", round: 1, phase: "planning", ...input })]);
  return m;
}

/** Alex reclama la misión (ejecución con lease) y propone un plan. */
async function claimAlex(worker = "w1") {
  const run = await store().claim(worker, 240, 2);
  expect(run?.agentId).toBe("alex");
  return run!;
}
async function propose(steps: PlanStepInput[] = [MARCUS, SOFIA], worker = "w1") {
  const run = await claimAlex(worker);
  const sub = await store().submitPlan(run.runId, worker, "Investigar y preparar la estrategia comercial.", steps);
  return { run, sub, worker };
}
async function proposeAndWait(steps: PlanStepInput[] = [MARCUS, SOFIA]) {
  const p = await propose(steps);
  await store().awaitPlanApproval(p.run.runId, p.worker, "Plan explicado al administrador.");
  return p;
}
const approve = (planId: string, version: number, hash: string, note: string | null = null) =>
  admin<{ r: { ok: boolean; tasks?: number; reason?: string } }>(`select public.approve_mission_plan($1, $2, $3, $4) r`, [planId, version, hash, note]).then((x) => x[0].r);
const reject = (planId: string, version: number, hash: string, reason: string, mode: "changes" | "reject") =>
  admin<{ r: { ok: boolean; mode?: string; reason?: string } }>(`select public.reject_mission_plan($1, $2, $3, $4, $5) r`, [planId, version, hash, reason, mode]).then((x) => x[0].r);
const task = async (id: string) => (await raw<Record<string, unknown>>(`select *, status::text as status from public.tasks where id = $1`, [id]))[0];

describe("misiones nuevas y antiguas", () => {
  it("una misión nueva necesita plan; las subtareas y las tareas que no son misiones no", async () => {
    const m = await planMission();
    expect(m.plan_required).toBe(true);
    const [old] = await svc<{ id: string }>(`insert into public.tasks (title, agent_id, status, input, plan_required) values ('Antigua', 'alex', 'completed', '{"kind":"mission"}', false) returning id`);
    const [sub] = await svc<{ plan_required: boolean }>(
      `insert into public.tasks (title, agent_id, status, parent_task_id, input, plan_required) values ('Sub', 'marcus', 'assigned', $1, '{"kind":"subtask"}', true) returning plan_required`, [old.id]);
    expect(sub.plan_required).toBe(false);
    const [other] = await svc<{ plan_required: boolean }>(`insert into public.tasks (title, agent_id, status) values ('Suelta', 'marcus', 'assigned') returning plan_required`);
    expect(other.plan_required).toBe(false);
  });

  it("desde el navegador no se puede crear una misión sin plan, con límites propios ni saltarse la planificación", async () => {
    const [m] = await admin<Record<string, unknown>>(
      `insert into public.tasks (title, description, agent_id, status, input, plan_required, budget_usd, max_calls, max_searches)
       values ('Encargo', 'Desde la interfaz', 'alex', 'assigned', '{"kind":"mission","phase":"synthesis","round":3}', false, 1, 30, 15)
       returning plan_required, budget_usd, max_calls, max_searches, input`);
    expect(m).toMatchObject({ plan_required: true, budget_usd: null, max_calls: null, max_searches: null });
    expect(m.input).toMatchObject({ phase: "planning", round: 1 });
  });

  it("plan_required y los límites de un paso no se pueden cambiar (ningún rol)", async () => {
    const m = await planMission();
    for (const run of [svc, (sql: string) => raw(sql)]) {
      await expect(run(`update public.tasks set plan_required = false where id = '${m.id}'`)).rejects.toThrow(/no se pueden modificar/);
      await expect(run(`update public.tasks set budget_usd = 1 where id = '${m.id}'`)).rejects.toThrow(/no se pueden modificar/);
    }
  });

  it("delegate_task se niega en una misión con plan y sigue funcionando en las antiguas", async () => {
    await planMission();
    const run = await claimAlex();
    await expect(store().delegate(run.runId, "w1", "tu1", "marcus", "Investigar", "Instrucciones claras de prueba", []))
      .rejects.toThrow(/plan aprobado/);
    await t.db.exec(`set session_replication_role = replica; delete from public.agent_runs; delete from public.tasks; set session_replication_role = origin;`);
    await svc(`insert into public.tasks (title, description, agent_id, status, input, plan_required)
               values ('Antigua', 'Misión antigua', 'alex', 'assigned', '{"kind":"mission","round":1}', false)`);
    const old = await claimAlex();
    const d = await store().delegate(old.runId, "w1", "tu1", "marcus", "Investigar", "Instrucciones claras de prueba", []);
    expect(d.duplicate).toBe(false);
  });
});

describe("propuesta y validación", () => {
  it("propone, es idempotente en la misma ejecución y espera al administrador sin ejecutar nada", async () => {
    const m = await planMission();
    const { run, sub, worker } = await propose();
    expect(sub).toMatchObject({ version: 1, kind: "initial", duplicate: false, estimate_usd: 0.65 });
    expect(sub.plan_hash).toMatch(/^[0-9a-f]{64}$/);
    // Misma propuesta → la misma; otra distinta en la misma ejecución → rechazada.
    expect((await store().submitPlan(run.runId, worker, "Investigar y preparar la estrategia comercial.", [MARCUS, SOFIA])).duplicate).toBe(true);
    await expect(store().submitPlan(run.runId, worker, "Otro plan distinto para la misión.", [MARCUS])).rejects.toThrow(/Ya has propuesto un plan/);
    // La huella la calcula la base de datos sobre el plan guardado.
    const [p] = await raw<{ ok: boolean }>(`select plan_hash = encode(sha256(convert_to(plan::text, 'UTF8')), 'hex') ok from public.mission_plans`);
    expect(p.ok).toBe(true);

    await store().awaitPlanApproval(run.runId, worker, "Plan explicado.");
    const mt = await task(m.id);
    expect(mt).toMatchObject({ status: "needs_approval", started_at: null, locked_by: null });
    expect((mt.input as Record<string, unknown>).phase).toBe("plan_review");
    expect(await raw(`select 1 from public.tasks where parent_task_id = $1`, [m.id])).toHaveLength(0);
    expect(await store().claim("w2", 240, 2)).toBeNull(); // nadie trabaja mientras espera
    // El tiempo máximo no corre mientras espera la decisión.
    await svc(`select public.recover_stale()`);
    expect((await task(m.id)).status).toBe("needs_approval");
  });

  it("rechaza pasos con agente, herramientas, dependencias, límites o presupuesto no válidos", async () => {
    await planMission();
    const run = await claimAlex();
    const bad: [string, PlanStepInput[], RegExp][] = [
      ["coordinador", [{ ...MARCUS, agent: "alex" }], /no se puede asignar/],
      ["fuera del piloto", [{ ...MARCUS, agent: "daniel", tools: [] , max_searches: 0 }], /no se puede asignar/],
      ["herramienta bloqueada (aunque Marcus la tenga en el registro)", [{ ...MARCUS, tools: ["crm.write", "email.send"], max_searches: 0 }], /no permitida para marcus/],
      ["delegar desde un paso", [{ ...MARCUS, tools: ["tasks.delegate"], max_searches: 0 }], /no permitida para marcus/],
      ["Sofia con búsqueda web (la tiene en el registro general)", [{ ...SOFIA, depends_on: [], tools: ["web.search"], max_searches: 1 }], /no permitida para sofia/],
      ["Sofia con lectura web", [{ ...SOFIA, depends_on: [], tools: ["web.fetch"] }], /no permitida para sofia/],
      ["Sofia escribiendo en el CRM", [{ ...SOFIA, depends_on: [], tools: ["crm.write"] }], /no permitida para sofia/],
      ["dependencia inexistente", [{ ...SOFIA, depends_on: ["nada"] }], /no existe o de sí mismo/],
      ["dependencia de sí mismo", [{ ...SOFIA, depends_on: ["estrategia"] }], /no existe o de sí mismo/],
      ["ciclo", [{ ...MARCUS, depends_on: ["estrategia"] }, SOFIA], /ciclo/],
      ["clave repetida", [MARCUS, { ...SOFIA, key: "investigacion" }], /repetida/],
      ["clave no válida", [{ ...MARCUS, key: "Investigación!" }], /Clave de paso no válida/],
      ["presupuesto > tarea", [{ ...MARCUS, budget_usd: 1.5 }], /Presupuesto del paso/],
      ["presupuesto con 5 decimales", [{ ...MARCUS, budget_usd: 0.12345 }], /Presupuesto del paso/],
      ["llamadas > 30", [{ ...MARCUS, max_calls: 31 }], /Llamadas máximas/],
      ["búsquedas > 15", [{ ...MARCUS, max_searches: 16 }], /Búsquedas máximas/],
      ["web sin búsquedas", [{ ...MARCUS, max_searches: 0 }], /al menos 1 búsqueda/],
      ["búsquedas sin web", [{ ...SOFIA, depends_on: [], max_searches: 2 }], /deben ser 0/],
      ["no cabe en la misión", [{ ...MARCUS, budget_usd: 0.5 }, { ...SOFIA, budget_usd: 0.3 }], /no cabe en el presupuesto de la misión/],
      ["búsquedas de la misión", [{ ...MARCUS, max_searches: 10 }, { ...MARCUS, key: "otra", max_searches: 6, budget_usd: 0.1 }], /búsquedas/],
      ["demasiados pasos", Array.from({ length: 7 }, (_, i) => ({ ...SOFIA, key: `p${i}`, depends_on: [], budget_usd: 0.05 })), /entre 1 y 6 pasos/],
    ];
    for (const [label, steps, re] of bad) {
      await expect(store().submitPlan(run.runId, "w1", "Plan de prueba no válido.", steps), label).rejects.toThrow(re);
    }
    expect(await raw(`select 1 from public.mission_plans`)).toHaveLength(0);
    // Un agente desactivado tampoco (aunque esté en el piloto).
    await raw(`update public.agents set active = false where id = 'sofia'`);
    await expect(store().submitPlan(run.runId, "w1", "Plan de prueba no válido.", [MARCUS, SOFIA])).rejects.toThrow(/no se puede asignar/);
    await t.db.exec(`set session_replication_role = replica; update public.agents set active = true where id = 'sofia'; set session_replication_role = origin;`);
  });

  it("sin lease no se propone, y solo una misión con plan puede proponer", async () => {
    await planMission();
    const run = await claimAlex();
    await expect(store().submitPlan(run.runId, "otro-worker", "Plan de prueba válido.", [MARCUS])).rejects.toThrow(/lease perdido/);
    await expect(svc(`select public.submit_mission_plan($1, 'w1', 'Plan de prueba válido.', '[]'::jsonb)`, [run.runId])).rejects.toThrow(/al menos un paso/);
    // El navegador no puede llamar a las funciones del motor.
    expect(await errCode(admin(`select public.submit_mission_plan($1, 'w1', 'x', '[]'::jsonb)`, [run.runId]))).toBe("42501");
  });
});

describe("decisiones del administrador", () => {
  it("aprobar: solo el administrador, con versión y huella exactas; crea las subtareas con sus límites y dependencias", async () => {
    const m = await planMission();
    const { sub } = await proposeAndWait();
    // Ni otro usuario, ni el servidor, ni con la huella o la versión equivocadas.
    expect(await errCode(t.as(INTRUDER, () => raw(`select public.approve_mission_plan($1, 1, $2)`, [sub.plan_id, sub.plan_hash])))).toBe("42501");
    expect(await errCode(svc(`select public.approve_mission_plan($1, 1, $2)`, [sub.plan_id, sub.plan_hash]))).toBe("42501");
    await expect(approve(sub.plan_id, 1, "0".repeat(64))).rejects.toThrow(/ha cambiado/);
    await expect(approve(sub.plan_id, 2, sub.plan_hash)).rejects.toThrow(/ha cambiado/);

    const r = await approve(sub.plan_id, 1, sub.plan_hash, "Adelante");
    expect(r).toMatchObject({ ok: true, tasks: 2 });
    const kids = await raw<{ id: string; agent_id: string; plan_step_key: string; budget_usd: number; max_calls: number; max_searches: number; idempotency_key: string; status: string }>(
      `select id, agent_id, plan_step_key, budget_usd::float8 budget_usd, max_calls, max_searches, idempotency_key, status::text status
         from public.tasks where parent_task_id = $1 order by created_at`, [m.id]);
    expect(kids.map((k) => [k.plan_step_key, k.agent_id, k.budget_usd, k.max_calls, k.max_searches, k.status])).toEqual([
      ["investigacion", "marcus", 0.45, 4, 3, "assigned"], ["estrategia", "sofia", 0.2, 3, 0, "assigned"],
    ]);
    expect(kids[0].idempotency_key).toBe(`plan:${m.id}:investigacion`);
    const deps = await raw<{ task_id: string; depends_on: string }>(`select task_id, depends_on from public.task_dependencies`);
    expect(deps).toContainEqual({ task_id: kids[1].id, depends_on: kids[0].id });
    expect(deps.filter((d) => d.task_id === m.id).map((d) => d.depends_on).sort()).toEqual(kids.map((k) => k.id).sort());
    const mt = await task(m.id);
    expect(mt.status).toBe("assigned");
    expect(mt.input).toMatchObject({ phase: "synthesis", round: 2 });
    // Auditoría con el administrador real (no falsificable desde el navegador: 0011).
    const [log] = await raw<{ actor_type: string; actor_id: string; details: Record<string, unknown> }>(
      `select actor_type, actor_id, details from public.activity_log where action = 'plan.approved'`);
    expect(log).toMatchObject({ actor_type: "admin", actor_id: ADMIN, details: { version: 1, plan_hash: sub.plan_hash, steps: 2 } });
    expect(await errCode(admin(`insert into public.activity_log (actor_type, actor_id, action) values ('admin', $1, 'plan.approved')`, [ADMIN]))).toBe("42501");
    // Una sola vez: segunda aprobación imposible; el orden lo da claim (Marcus antes que Sofia).
    await expect(approve(sub.plan_id, 1, sub.plan_hash)).rejects.toThrow(/ya no está pendiente/);
    expect((await store().claim("w9", 240, 2))?.agentId).toBe("marcus");
  });

  it("la aprobación revalida con el saldo y los agentes de ese momento", async () => {
    await planMission();
    const { sub } = await proposeAndWait();
    await raw(`update public.settings set value = '{"monthly_ai_budget_usd": 10, "mission_ai_budget_usd": 0.8, "task_ai_budget_usd": 1}' where key = 'limits'`);
    await expect(approve(sub.plan_id, 1, sub.plan_hash)).rejects.toThrow(/no cabe en el presupuesto de la misión/);
    await raw(`update public.settings set value = '{"monthly_ai_budget_usd": 10, "mission_ai_budget_usd": 1, "task_ai_budget_usd": 1}' where key = 'limits'`);
    await raw(`update public.agents set active = false where id = 'marcus'`);
    await expect(approve(sub.plan_id, 1, sub.plan_hash)).rejects.toThrow(/no se puede asignar/);
    await t.db.exec(`set session_replication_role = replica; update public.agents set active = true where id = 'marcus'; set session_replication_role = origin;`);
    expect((await approve(sub.plan_id, 1, sub.plan_hash)).ok).toBe(true);
  });

  it("pedir cambios devuelve el plan a Alex con el motivo; máximo 3 versiones; luego solo aprobar o rechazar", async () => {
    const m = await planMission();
    let p = await proposeAndWait();
    expect(await errCode(reject(p.sub.plan_id, 1, p.sub.plan_hash, "x", "changes"))).not.toBe("ok"); // motivo obligatorio
    expect((await reject(p.sub.plan_id, 1, p.sub.plan_hash, "Menos presupuesto para Marcus", "changes")).mode).toBe("changes");
    let mt = await task(m.id);
    expect(mt.status).toBe("assigned");
    expect(mt.input).toMatchObject({ phase: "planning", plan_feedback: "Menos presupuesto para Marcus", plan_feedback_version: 1 });

    // v2 (otra ejecución) → cambios → v3 → ya no se pueden pedir cambios.
    p = await proposeAndWait([{ ...MARCUS, budget_usd: 0.4 }, SOFIA]);
    expect(p.sub.version).toBe(2);
    await reject(p.sub.plan_id, 2, p.sub.plan_hash, "Quita a Sofia", "changes");
    p = await proposeAndWait([{ ...MARCUS, budget_usd: 0.4 }]);
    expect(p.sub.version).toBe(3);
    await expect(reject(p.sub.plan_id, 3, p.sub.plan_hash, "Otra vuelta", "changes")).rejects.toThrow(/máximo de 3 versiones/);
    const statuses = await raw<{ version: number; status: string }>(`select version, status from public.mission_plans order by version`);
    expect(statuses).toEqual([{ version: 1, status: "changes_requested" }, { version: 2, status: "changes_requested" }, { version: 3, status: "pending" }]);
    expect((await approve(p.sub.plan_id, 3, p.sub.plan_hash)).tasks).toBe(1);
    mt = await task(m.id);
    expect(mt.input).not.toHaveProperty("plan_feedback");
  });

  it("rechazar cancela la misión definitivamente", async () => {
    const m = await planMission();
    const { sub } = await proposeAndWait();
    expect((await reject(sub.plan_id, 1, sub.plan_hash, "No es el momento", "reject")).mode).toBe("reject");
    expect((await task(m.id)).status).toBe("failed");
    expect((await raw<{ status: string }>(`select status from public.mission_plans`))[0].status).toBe("rejected");
    expect(await raw(`select 1 from public.activity_log where action = 'plan.rejected' and actor_id = $1`, [ADMIN])).toHaveLength(1);
    expect(await store().claim("w2", 240, 2)).toBeNull();
    await expect(approve(sub.plan_id, 1, sub.plan_hash)).rejects.toThrow(/ya no está pendiente/);
  });

  it("un plan sin decisión caduca a las 72 h: no se puede aprobar y la misión se detiene", async () => {
    const m = await planMission();
    const { sub } = await proposeAndWait();
    const [{ hours }] = await raw<{ hours: number }>(`select extract(epoch from expires_at - created_at) / 3600 hours from public.mission_plans`);
    expect(Math.round(Number(hours))).toBe(72);
    await t.db.exec(`set session_replication_role = replica; update public.mission_plans set expires_at = now() - interval '1 minute'; set session_replication_role = origin;`);
    expect(await approve(sub.plan_id, 1, sub.plan_hash)).toMatchObject({ ok: false, reason: "expired" });
    expect((await raw<{ status: string }>(`select status from public.mission_plans`))[0].status).toBe("expired");
    expect((await task(m.id)).status).toBe("failed");
    expect(await raw(`select 1 from public.tasks where parent_task_id = $1`, [m.id])).toHaveLength(0);
  });
});

describe("inmutabilidad", () => {
  it("planes y pasos no se pueden modificar, borrar ni aprobar por otra vía", async () => {
    await planMission();
    const { sub } = await proposeAndWait();
    for (const run of [svc, (sql: string) => raw(sql)]) {
      await expect(run(`update public.mission_plans set plan = '{}'::jsonb`)).rejects.toThrow(/no se puede modificar/);
      await expect(run(`update public.mission_plans set estimate_usd = 0`)).rejects.toThrow(/no se puede modificar/);
      await expect(run(`update public.mission_plan_steps set budget_usd = 1`)).rejects.toThrow(/no se pueden modificar/);
      await expect(run(`delete from public.mission_plans`)).rejects.toThrow();
      await expect(run(`delete from public.mission_plan_steps`)).rejects.toThrow();
    }
    // El servidor no puede aprobar ni rechazar por su cuenta, ni crear un plan ya aprobado.
    await expect(svc(`update public.mission_plans set status = 'approved', decided_by = '${ADMIN}'`)).rejects.toThrow(/Solo el administrador/);
    await expect(svc(`insert into public.mission_plans (mission_id, version, kind, plan, plan_hash, estimate_usd, status, proposed_by, expires_at)
                      select mission_id, 2, 'initial', plan, 'x', 0, 'approved', 'alex', now() from public.mission_plans`)).rejects.toThrow(/empieza pendiente/);
    // Un paso añadido a escondidas a un plan pendiente impide decidir sobre él.
    await svc(`insert into public.mission_plan_steps (plan_id, step_key, position, agent_id, title, instructions, tools, budget_usd, max_calls, max_searches)
               values ($1, 'extra', 9, 'marcus', 'Paso extra', 'Instrucciones del paso extra', '{}', 0.1, 1, 0)`, [sub.plan_id]);
    await expect(approve(sub.plan_id, 1, sub.plan_hash)).rejects.toThrow(/no coinciden con el plan/);
    // El navegador solo puede leer (RLS de administrador); otro usuario no ve nada.
    expect(await admin(`select 1 from public.mission_plans`)).toHaveLength(1);
    expect(await t.as(INTRUDER, () => raw(`select 1 from public.mission_plans`))).toHaveLength(0);
    expect(await errCode(admin(`insert into public.mission_plan_steps (plan_id, step_key, position, agent_id, title, instructions, budget_usd, max_calls, max_searches) values ($1, 'x', 10, 'marcus', 'abc', 'instrucciones', 0.1, 1, 0)`, [sub.plan_id]))).toBe("42501");
  });
});

describe("ampliaciones en la síntesis", () => {
  async function approvedAndDone() {
    const m = await planMission();
    const { sub } = await proposeAndWait();
    await approve(sub.plan_id, 1, sub.plan_hash);
    await raw(`update public.tasks set status = 'completed' where parent_task_id = $1`, [m.id]);
    return { m, base: sub };
  }

  it("solo añade pasos nuevos, copia los aprobados tal cual y necesita otra aprobación", async () => {
    const { m, base } = await approvedAndDone();
    const run = await claimAlex();
    expect((await task(m.id)).input).toMatchObject({ phase: "synthesis", round: 2 });
    // No se puede reescribir un paso aprobado (clave repetida) ni hacer que uno aprobado dependa de uno nuevo.
    await expect(store().submitPlan(run.runId, "w1", "Ampliación de prueba.", [{ ...MARCUS, budget_usd: 0.1 }])).rejects.toThrow(/repetida/);
    const extra: PlanStepInput = { ...SOFIA, key: "correccion", title: "Corregir la estrategia", depends_on: ["estrategia"], budget_usd: 0.1 };
    const sub = await store().submitPlan(run.runId, "w1", "Falta concretar la estrategia de captación.", [extra]);
    expect(sub).toMatchObject({ version: 2, kind: "amendment", estimate_usd: 0.1 });
    const steps = await raw<{ step_key: string; carried: boolean; task_id: string | null }>(
      `select step_key, carried, task_id from public.mission_plan_steps where plan_id = $1 order by position`, [sub.plan_id]);
    expect(steps.map((s) => [s.step_key, s.carried, !!s.task_id])).toEqual([["investigacion", true, true], ["estrategia", true, true], ["correccion", false, false]]);
    await store().awaitPlanApproval(run.runId, "w1", "Pido una corrección.");
    // Ningún paso nuevo se ejecuta antes de la aprobación.
    expect(await raw(`select 1 from public.tasks where parent_task_id = $1 and plan_step_key = 'correccion'`, [m.id])).toHaveLength(0);
    expect(await store().claim("w2", 240, 2)).toBeNull();

    expect((await approve(sub.plan_id, 2, sub.plan_hash)).tasks).toBe(1);
    const plans = await raw<{ version: number; status: string }>(`select version, status from public.mission_plans order by version`);
    expect(plans).toEqual([{ version: 1, status: "superseded" }, { version: 2, status: "approved" }]);
    expect((await task(m.id)).input).toMatchObject({ phase: "synthesis", round: 3 });
    expect(await raw(`select 1 from public.tasks where parent_task_id = $1`, [m.id])).toHaveLength(3);
    void base;

    // Ronda 3 > 2: ya no se puede ampliar.
    await raw(`update public.tasks set status = 'completed' where parent_task_id = $1`, [m.id]);
    const run3 = await claimAlex("w3");
    await expect(store().submitPlan(run3.runId, "w3", "Otra ampliación más.", [{ ...extra, key: "otra" }])).rejects.toThrow(/máximo de rondas/);
  });

  it("si cambia el plan aprobado de base, la ampliación no se puede aprobar", async () => {
    const { m } = await approvedAndDone();
    const run = await claimAlex();
    const sub = await store().submitPlan(run.runId, "w1", "Falta concretar la estrategia.", [{ ...SOFIA, key: "correccion", depends_on: [], budget_usd: 0.1 }]);
    await store().awaitPlanApproval(run.runId, "w1", "Pido una corrección.");
    await t.db.exec(`set session_replication_role = replica; update public.mission_plans set status = 'superseded' where version = 1; set session_replication_role = origin;`);
    await expect(approve(sub.plan_id, 2, sub.plan_hash)).rejects.toThrow(/base ha cambiado/);
    expect(await raw(`select 1 from public.tasks where parent_task_id = $1`, [m.id])).toHaveLength(2);
  });
});

describe("límites de cada paso en reserve_budget", () => {
  async function marcusRun(step: Partial<PlanStepInput> = {}) {
    await planMission();
    const { sub } = await proposeAndWait([{ ...MARCUS, ...step }]);
    await approve(sub.plan_id, 1, sub.plan_hash);
    const run = await store().claim("wm", 240, 2);
    expect(run?.agentId).toBe("marcus");
    return run!;
  }

  it("presupuesto del paso: lo comprometido más la reserva no puede superarlo (motivo step_budget)", async () => {
    const run = await marcusRun({ budget_usd: 0.3 });
    expect(await store().reserve(run.runId, "wm", "claude-sonnet-5-5", 0.31, 0, 240)).toEqual({ ok: false, reason: "step_budget" });
    const ok = await store().reserve(run.runId, "wm", "claude-sonnet-5-5", 0.3, 1, 240);
    expect(ok.ok).toBe(true);
  });

  it("llamadas máximas: cuentan todas las reservas salvo las liberadas (motivo max_calls)", async () => {
    const run = await marcusRun({ max_calls: 2 });
    const s = store();
    for (let i = 0; i < 2; i++) {
      const r = await s.reserve(run.runId, "wm", "claude-sonnet-5-5", 0.01, 0, 240);
      if (!r.ok) throw new Error("reserva");
      await s.closeReservation(run.runId, r.reservation_id, i === 0); // una incierta (cuenta) y una liberada (no cuenta)
    }
    const third = await s.reserve(run.runId, "wm", "claude-sonnet-5-5", 0.01, 0, 240);
    expect(third.ok).toBe(true);
    if (third.ok) await raw(`update public.ai_reservations set status = 'settled', actual_usd = 0.01 where id = $1`, [third.reservation_id]);
    expect(await s.reserve(run.runId, "wm", "claude-sonnet-5-5", 0.01, 0, 240)).toEqual({ ok: false, reason: "max_calls" });
  });

  it("búsquedas del paso: se conceden como mucho las que quedan del paso", async () => {
    const run = await marcusRun({ max_searches: 1 });
    const s = store();
    const a = await s.reserve(run.runId, "wm", "claude-sonnet-5-5", 0.01, 1, 240);
    expect(a).toMatchObject({ ok: true, searches: 1 });
    if (a.ok) await s.closeReservation(run.runId, a.reservation_id, true); // incierta: la búsqueda cuenta
    expect(await s.reserve(run.runId, "wm", "claude-sonnet-5-5", 0.01, 1, 240)).toMatchObject({ ok: true, searches: 0 });
  });
});

describe("comprobación A · herramientas por agente en la base de datos", () => {
  it("plan_step_tools() coincide con AGENT_TOOLS (sin delegar ni proponer) y no incluye a Alex", async () => {
    const [{ v }] = await raw<{ v: Record<string, string[]> }>(`select public.plan_step_tools() v`);
    expect(Object.keys(v).sort()).toEqual(["marcus", "sofia"]);
    for (const id of ["marcus", "sofia"]) {
      expect([...v[id]].sort()).toEqual(AGENT_TOOLS[id].enabled.filter((x) => x !== "tasks.delegate" && x !== "mission.plan").slice().sort());
    }
    expect(v.sofia).not.toContain("web.search");
  });

  it("además exige que el agente tenga la herramienta en agents.tools", async () => {
    await planMission();
    const run = await claimAlex();
    await raw(`update public.agents set tools = array_remove(tools, 'crm.write') where id = 'marcus'`);
    try {
      await expect(store().submitPlan(run.runId, "w1", "Plan de prueba no válido.", [MARCUS])).rejects.toThrow(/herramientas que marcus no tiene/);
    } finally {
      await raw(`update public.agents set tools = array_append(tools, 'crm.write') where id = 'marcus'`);
    }
  });
});

describe("comprobación B · ninguna otra vía crea subtareas de una misión con plan", () => {
  const child = (parent: string, extra = "") =>
    `insert into public.tasks (title, description, agent_id, status, parent_task_id, input${extra ? ", plan_id" : ""})
     values ('Colada', 'Subtarea fuera del plan', 'marcus', 'assigned', '${parent}', '{"kind":"subtask","round":1}'${extra})`;

  it("ni el navegador, ni el servidor, ni SQL directo sin paso del plan; delegate_task tampoco", async () => {
    const m = await planMission();
    expect(await errCode(admin(child(m.id)))).toBe("42501");
    expect(await errCode(svc(child(m.id)))).toBe("42501");
    expect(await errCode(raw(child(m.id)))).toBe("42501"); // postgres, pero sin plan_id
    // Ni con un plan_id de otra cosa desde la API.
    const { sub } = await proposeAndWait();
    expect(await errCode(svc(child(m.id, `, '${sub.plan_id}'`)))).toBe("42501");
    expect(await raw(`select 1 from public.tasks where parent_task_id = $1`, [m.id])).toHaveLength(0);
    // La única vía: la aprobación.
    await approve(sub.plan_id, 1, sub.plan_hash);
    expect(await raw(`select 1 from public.tasks where parent_task_id = $1`, [m.id])).toHaveLength(2);
  });

  it("no se puede mover una tarea a una misión con plan ni cambiar el agente o las instrucciones de un paso", async () => {
    const m = await planMission();
    const { sub } = await proposeAndWait();
    await approve(sub.plan_id, 1, sub.plan_hash);
    const [loose] = await svc<{ id: string }>(`insert into public.tasks (title, agent_id, status) values ('Suelta', 'marcus', 'completed') returning id`);
    await expect(svc(`update public.tasks set parent_task_id = $1 where id = $2`, [m.id, loose.id])).rejects.toThrow(/no se puede mover/);
    await expect(raw(`update public.tasks set parent_task_id = $1 where id = $2`, [m.id, loose.id])).rejects.toThrow(/no se puede mover/);
    const [step] = await raw<{ id: string }>(`select id from public.tasks where parent_task_id = $1 and plan_step_key = 'investigacion'`, [m.id]);
    for (const set of ["agent_id = 'sofia'", "description = 'Otra cosa distinta'", "title = 'Otro título'", "parent_task_id = null"]) {
      await expect(svc(`update public.tasks set ${set} where id = $1`, [step.id]), set).rejects.toThrow();
    }
    // El administrador tampoco puede reescribir las instrucciones aprobadas (sí tiene UPDATE de description en general).
    expect(await errCode(admin(`update public.tasks set description = 'Reescrita' where id = $1`, [step.id]))).toBe("42501");
    // El motor sigue pudiendo cambiar el estado de un paso.
    await svc(`update public.tasks set status = 'completed' where id = $1`, [step.id]);
  });

  it("las misiones antiguas siguen creando subtareas como siempre", async () => {
    const [old] = await svc<{ id: string }>(`insert into public.tasks (title, description, agent_id, status, input, plan_required)
      values ('Antigua', 'Misión antigua', 'alex', 'assigned', '{"kind":"mission","round":1}', false) returning id`);
    expect(await errCode(svc(child(old.id)))).toBe("ok");
  });
});

describe("comprobación C · saldo mensual comprometido por los planes aprobados", () => {
  const limits = (monthly: number) => raw(`update public.settings set value = $1 where key = 'limits'`,
    [JSON.stringify({ monthly_ai_budget_usd: monthly, mission_ai_budget_usd: 1, task_ai_budget_usd: 1 })]);

  it("lo aprobado queda comprometido: otra misión no puede aprobar ni gastar ese dinero; al terminar se libera", async () => {
    await limits(1.5);
    try {
      const a = await planMission();
      const b = await planMission(); // creada antes de los pasos de A: es la siguiente que reclama Alex
      const pa = await proposeAndWait();
      await approve(pa.sub.plan_id, 1, pa.sub.plan_hash);
      const [{ envelope }] = await raw<{ envelope: number }>(`select envelope_usd::float8 envelope from public.mission_plans where id = $1`, [pa.sub.plan_id]);
      expect(envelope).toBeCloseTo(0.65 + 0.25, 4);
      expect(Number((await raw<{ v: string }>(`select public.plan_outstanding_usd(null)::text v`))[0].v)).toBeCloseTo(0.9, 4);

      // Segunda misión: su plan (0,90 $ con la reserva) no cabe en lo que queda del mes (1,5 − 0,9).
      const runB = await store().claim("wb", 240, 2);
      expect(runB?.taskId).toBe(b.id);
      await expect(store().submitPlan(runB!.runId, "wb", "Otro plan en la misma semana.", [MARCUS, SOFIA]))
        .rejects.toThrow(/presupuesto mensual.*comprometidos por otros planes aprobados/);
      // Con un plan más pequeño (0,30 + 0,25 ≤ 0,60) sí.
      const small = await store().submitPlan(runB!.runId, "wb", "Plan pequeño que cabe en el mes.", [{ ...SOFIA, depends_on: [], budget_usd: 0.3 }]);
      await store().awaitPlanApproval(runB!.runId, "wb", "Plan pequeño");
      // Mientras tanto, otra cosa no puede gastar lo comprometido por A: 0,05 $ de A gastados → quedan 0,85 comprometidos.
      await raw(`insert into public.ai_usage (agent_id, task_id, model, input_tokens, output_tokens, cost_usd) values ('alex', $1, 'claude-sonnet-5-5', 1, 1, 0.05)`, [a.id]);
      expect(Number((await raw<{ v: string }>(`select public.plan_outstanding_usd(null)::text v`))[0].v)).toBeCloseTo(0.85, 4);
      // Aprobar B revalida con el saldo de ese momento: 0,05 gastados + 0,85 comprometidos + 0,55 ≤ 1,5.
      expect((await approve(small.plan_id, 1, small.plan_hash)).ok).toBe(true);
      // Ahora quedan 1,5 − 0,05 − 0,85 − 0,55 = 0,05 $: una misión antigua no puede reservar 0,10 $.
      const [legacy] = await svc<{ id: string }>(`insert into public.tasks (title, description, agent_id, status, input, plan_required)
        values ('Antigua', 'Misión antigua', 'alex', 'assigned', '{"kind":"mission","round":1}', false) returning id`);
      // Los pasos de A y B quedan «en revisión»: no se reclaman y las misiones siguen abiertas.
      await raw(`update public.tasks set status = 'in_review' where parent_task_id in ($1, $2)`, [a.id, b.id]);
      const runL = await store().claim("wl", 240, 5);
      expect(runL?.taskId).toBe(legacy.id);
      expect(await store().reserve(runL!.runId, "wl", "claude-sonnet-5-5", 0.1, 0, 240)).toEqual({ ok: false, reason: "monthly_budget" });
      // Al cancelar A, su dinero comprometido se libera.
      await svc(`select public.cancel_mission($1, 'fin de la prueba')`, [a.id]);
      expect(Number((await raw<{ v: string }>(`select public.plan_outstanding_usd($1)::text v`, [b.id]))[0].v)).toBe(0);
      expect((await store().reserve(runL!.runId, "wl", "claude-sonnet-5-5", 0.1, 0, 240)).ok).toBe(true);
    } finally {
      await limits(10);
    }
  });

  it("el dinero comprometido solo lo fija la aprobación y no se puede cambiar", async () => {
    await planMission();
    const { sub } = await proposeAndWait();
    await expect(svc(`update public.mission_plans set envelope_usd = 0 where id = $1`, [sub.plan_id])).rejects.toThrow();
    await approve(sub.plan_id, 1, sub.plan_hash);
    for (const run of [svc, (sql: string, p?: unknown[]) => raw(sql, p)]) {
      await expect(run(`update public.mission_plans set envelope_usd = 0 where id = $1`, [sub.plan_id])).rejects.toThrow(/no se puede modificar/);
    }
  });
});
