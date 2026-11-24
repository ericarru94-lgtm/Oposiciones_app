// PI-16 · Cuarta iteración de laboratorio: regresiones de los defectos encontrados en
// la auditoría de concurrencia y de migraciones. Sin red: PGlite con las migraciones
// reales y Claude simulado. La concurrencia REAL (varias conexiones) se comprueba con
// PostgreSQL 17.11 en scripts/lab/pi16-cross.mts; aquí se fija el orden de bloqueos
// en el código de cada función y el comportamiento funcional.
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SqlEngineStore, type Query } from "@/lib/engine/store-sql";
import { runTick } from "@/lib/engine/worker";
import type { ModelClient, ModelRequest, ModelResponse } from "@/lib/engine/types";
import { createTestDb, SUPABASE_STUB_SQL, type TestDb } from "./helpers/db";
import { buildSeedSql } from "@/lib/db/seed";

let t: TestDb;
const svc = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  t.asService(async () => (await t.db.query<T>(sql, params)).rows);
const raw = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await t.db.query<T>(sql, params)).rows;
const store = () => new SqlEngineStore(((sql, params) => svc(sql, params ?? [])) as Query);
const def = async (sig: string) => (await raw<{ d: string }>(`select pg_get_functiondef($1::regprocedure) d`, [sig]))[0].d;
/** Posición de la primera aparición de cada patrón (‑1 si no aparece). */
const at = (s: string, re: RegExp) => s.search(re);

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.db.exec(`set session_replication_role = replica;
    delete from public.task_dependencies; delete from public.approvals; delete from public.companies;
    delete from public.ai_reservations; delete from public.ai_usage; delete from public.agent_runs; delete from public.task_events;
    delete from public.activity_log; delete from public.tasks;
    set session_replication_role = origin;
    update public.agents set status = 'available', current_task_id = null;`);
});

async function missionWith(children: number, opts: { childFirst?: boolean } = {}) {
  const id = (first: string, n: number) => `${first}${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`;
  const mission = id(opts.childFirst ? "f" : "0", 1);
  await raw(`insert into public.tasks (id, title, description, agent_id, status, input, created_by, plan_required, started_at)
    values ($1, 'Misión', 'Ficticia', 'alex', 'in_progress', '{"kind": "mission"}', 'admin', false, now())`, [mission]);
  const subs: { task: string; run: string; worker: string }[] = [];
  for (let i = 0; i < children; i++) {
    const task = id(opts.childFirst ? "0" : "f", i + 2);
    await raw(`insert into public.tasks (id, title, description, agent_id, status, input, parent_task_id, plan_required, locked_by, locked_until, started_at)
      values ($1, 'Sub', 'Ficticia', 'marcus', 'in_progress', '{}', $2, false, $3, now() + interval '1 hour', now())`, [task, mission, `w${i}`]);
    const [r] = await raw<{ id: string }>(`insert into public.agent_runs (task_id, agent_id, attempt, status, worker_id) values ($1, 'marcus', 1, 'running', $2) returning id`, [task, `w${i}`]);
    subs.push({ task, run: r.id, worker: `w${i}` });
  }
  return { mission, subs };
}

// ───────────── 1. Orden canónico de bloqueos (defectos X5, X8, X11, X12, X14) ─────────────
describe("1 · orden canónico: limits → misión → subtareas → reservas → ejecuciones", () => {
  it("cancel_mission bloquea la misión ANTES que sus subtareas (no por id)", async () => {
    const d = await def("public.cancel_mission(uuid, text)");
    const lim = at(d, /key = 'limits' for update/);
    const mis = at(d, /where id = p_mission_id for update/);
    const subs = at(d, /where parent_task_id = p_mission_id order by id for update/);
    const res = at(d, /update public\.ai_reservations/);
    const runs = at(d, /update public\.agent_runs/);
    expect([lim, mis, subs, res, runs].every((x) => x > 0)).toBe(true);
    expect(lim < mis && mis < subs && subs < res && res < runs).toBe(true);
    expect(d).not.toMatch(/id = p_mission_id or parent_task_id = p_mission_id order by id for update/);
  });

  it("reserve_budget y record_call toman limits y la misión antes que su tarea, su reserva o su ejecución", async () => {
    const r = await def("public.reserve_budget(uuid, text, text, numeric, integer, integer, integer)");
    expect(at(r, /key = 'limits' for update/)).toBeLessThan(at(r, /coalesce\(x\.parent_task_id, x\.id\)[\s\S]*?for update/));
    expect(at(r, /coalesce\(x\.parent_task_id, x\.id\)/)).toBeLessThan(at(r, /assert_lease\(/));
    const c = await def("public.record_call(uuid, text, uuid, jsonb, text, bigint, bigint, bigint, bigint, integer, numeric, numeric, public.agent_status, integer, integer)");
    const lim = at(c, /key = 'limits' for update/);
    const mis = at(c, /coalesce\(x\.parent_task_id, x\.id\)/);
    expect(lim > 0 && lim < mis).toBe(true);
    expect(mis).toBeLessThan(at(c, /from public\.ai_reservations where id = p_reservation_id/));
    expect(mis).toBeLessThan(at(c, /update public\.agent_runs ar/));
  });

  it("reject_mission_plan toma limits antes del plan y de la misión, como approve_mission_plan", async () => {
    for (const sig of ["public.reject_mission_plan(uuid, integer, text, text, text)", "public.approve_mission_plan(uuid, integer, text, text)"]) {
      const d = await def(sig);
      expect(at(d, /key = 'limits' for update/), sig).toBeGreaterThan(0);
      expect(at(d, /key = 'limits' for update/), sig).toBeLessThan(at(d, /lock_plan_for_decision\(/));
      expect(at(d, /is_admin\(\)/), sig).toBeLessThan(at(d, /key = 'limits' for update/));
    }
  });

  it("recover_stale: sin trabajo no bloquea nada; con trabajo, limits y tareas (misión primero) antes de las ejecuciones", async () => {
    const d = await def("public.recover_stale()");
    const early = at(d, /return jsonb_build_object\('expired_approvals', 0/);
    const lim = at(d, /key = 'limits' for update/);
    const order = at(d, /order by coalesce\(t\.parent_task_id, t\.id\), \(t\.parent_task_id is not null\), t\.id/);
    const runs = at(d, /update public\.agent_runs ar set status = 'failed'/);
    expect(early > 0 && early < lim && lim < order && order < runs).toBe(true);
    expect(await svc(`select public.recover_stale() r`)).toEqual([{ r: { expired_approvals: 0, timed_out_tasks: 0 } }]);
  });

  it("recover_stale sigue caducando aprobaciones y tareas sin tiempo (comportamiento intacto)", async () => {
    const { subs } = await missionWith(2);
    await raw(`update public.tasks set status = 'needs_approval', locked_by = null, locked_until = null where id = $1`, [subs[0].task]);
    await raw(`update public.agent_runs set status = 'waiting_approval' where id = $1`, [subs[0].run]);
    await t.db.exec(`set session_replication_role = replica`);
    await raw(`insert into public.approvals (task_id, agent_id, tool_id, risk, summary, run_id, tool_use_id, args_hash, expires_at)
      values ($1, 'marcus', 'crm.write', 'medium', 'x', $2, 'tu', 'h', now() - interval '1 minute')`, [subs[0].task, subs[0].run]);
    await t.db.exec(`set session_replication_role = origin`);
    await raw(`update public.tasks set started_at = now() - interval '2 days', timeout_seconds = 60 where id = $1`, [subs[1].task]);
    const [{ r }] = await svc<{ r: { expired_approvals: number; timed_out_tasks: number } }>(`select public.recover_stale() r`);
    expect(r).toEqual({ expired_approvals: 1, timed_out_tasks: 1 });
    const runs = await raw<{ status: string }>(`select status::text from public.agent_runs order by status`);
    expect(runs.map((x) => x.status)).toEqual(["failed", "timed_out"]);
  });

  it("la cancelación sigue siendo completa e idempotente con cualquier orden de ids", async () => {
    for (const childFirst of [true, false]) {
      await t.db.exec(`set session_replication_role = replica; delete from public.agent_runs; delete from public.task_events; delete from public.tasks; set session_replication_role = origin;`);
      const { mission } = await missionWith(3, { childFirst });
      const [{ n }] = await svc<{ n: number }>(`select public.cancel_mission($1, 'Prueba') n`, [mission]);
      expect(n).toBe(4);
      const [{ n: again }] = await svc<{ n: number }>(`select public.cancel_mission($1, 'Prueba') n`, [mission]);
      expect(again).toBe(0);
      expect(await raw(`select 1 from public.agent_runs where status in ('running', 'waiting_approval')`)).toHaveLength(0);
      expect(await raw(`select 1 from public.tasks where status not in ('failed', 'completed')`)).toHaveLength(0);
    }
  });
});

// ───────────── 2. max_uses: la API ejecuta más lecturas de las reservadas ─────────────
describe("2 · lecturas de más en una respuesta (max_uses no respetado)", () => {
  const rec = (x: { run: string; worker: string }, res: string, attempts: number) =>
    svc<{ r: { continue: boolean; reason?: string } }>(
      `select public.record_call($1, $2, $3, '{}'::jsonb, 'claude-sonnet-5-5', 10, 10, 0, 0, 1, 0.001, 0.01, 'working'::agent_status, $4, 0) r`,
      [x.run, x.worker, res, attempts]).then((rows) => rows[0].r);
  const reserve = (x: { run: string; worker: string }) =>
    svc<{ r: { ok: boolean; reservation_id: string } }>(`select public.reserve_budget($1, $2, 'claude-sonnet-5-5', 0.5, 1, 240, 1) r`, [x.run, x.worker]).then((rows) => rows[0].r);

  it("dentro de lo reservado la misión continúa", async () => {
    const { subs } = await missionWith(1);
    const r = await reserve(subs[0]);
    expect(await rec(subs[0], r.reservation_id, 1)).toMatchObject({ continue: true });
  });

  it("más intentos de lectura que los reservados: consumo registrado, misión detenida y auditada", async () => {
    const { mission, subs } = await missionWith(2);
    const r = await reserve(subs[0]);
    expect(await rec(subs[0], r.reservation_id, 3)).toEqual({ continue: false, reason: "web_overuse" });
    const [u] = await raw<{ web_fetch_attempts: number }>(`select web_fetch_attempts from public.ai_usage where reservation_id = $1`, [r.reservation_id]);
    expect(u.web_fetch_attempts).toBe(3);
    expect(await raw(`select 1 from public.tasks where (id = $1 or parent_task_id = $1) and status <> 'failed'`, [mission])).toHaveLength(0);
    const [log] = await raw<{ details: { reason: string; fetch_attempts: number; fetches_reserved: number } }>(
      `select details from public.activity_log where action = 'security.web_stop'`);
    expect(log.details).toMatchObject({ reason: "web_overuse", fetch_attempts: 3, fetches_reserved: 1 });
    // Ninguna llamada más: la siguiente reserva de la misión se rechaza.
    expect((await svc<{ r: { ok: boolean } }>(`select public.reserve_budget($1, $2, 'claude-sonnet-5-5', 0.5, 1, 240, 1) r`, [subs[1].run, subs[1].worker]).catch(() => [{ r: { ok: false } }]))[0].r.ok).toBe(false);
  });

  it("motor: una respuesta con dos lecturas detiene la misión sin otra llamada (resultado web_overuse)", async () => {
    await raw(`insert into public.tasks (title, description, agent_id, status, input, created_by, plan_required)
      values ('Estudio', 'Ficticio', 'marcus', 'assigned', '{}', 'admin', false)`);
    const usage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 1, webFetchRequests: 2 };
    const calls: ModelRequest[] = [];
    const client: ModelClient = {
      async create(r): Promise<ModelResponse> {
        calls.push(r);
        return {
          content: [
            { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "clinicas barcelona" } },
            { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://a.example/", title: "a", encrypted_content: "x" },
              { type: "web_search_result", url: "https://b.example/", title: "b", encrypted_content: "x" }] },
            { type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: "https://a.example/" } },
            { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: "https://a.example/", content: { type: "document" } } },
            { type: "server_tool_use", id: "f2", name: "web_fetch", input: { url: "https://b.example/" } },
            { type: "web_fetch_tool_result", tool_use_id: "f2", content: { type: "web_fetch_result", url: "https://b.example/", content: { type: "document" } } },
            { type: "text", text: "Sigo investigando." },
          ] as never,
          stopReason: "pause_turn", usage, model: r.model,
        };
      },
    };
    const report = await runTick({ store: store(), client });
    expect(report.runs.map((r) => r.outcome)).toEqual(["web_overuse"]);
    expect(calls).toHaveLength(1);
    expect(await raw(`select 1 from public.ai_reservations where status = 'open'`)).toHaveLength(0);
  });
});

// ───────────── 3. Migraciones: comprobaciones previas de 0014 ─────────────
describe("3 · 0014 se niega a aplicarse sin 0013 o dos veces (sin cambios parciales)", () => {
  const M14 = readFileSync("supabase/migrations/0014_web_limits_audit.sql", "utf8");
  it("sin 0013: error explícito y ningún objeto de 0014", async () => {
    const db = new PGlite();
    try {
      await db.exec(SUPABASE_STUB_SQL());
      for (const f of readdirSync("supabase/migrations").sort().filter((f) => Number(f.slice(0, 4)) <= 12)) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
      await db.exec(buildSeedSql());
      await expect(db.exec(`begin; ${M14} commit;`)).rejects.toThrow(/0014 necesita 0013/);
      await db.exec("rollback").catch(() => {});
      expect((await db.query(`select to_regclass('public.web_tool_events') t, (select count(*)::int from public.settings where key = 'web_limits') n`)).rows[0]).toEqual({ t: null, n: 0 });
    } finally {
      await db.close();
    }
  });
  it("ya aplicada: error explícito («ya está aplicada»)", async () => {
    await expect(t.db.exec(`begin; ${M14} commit;`)).rejects.toThrow(/0014 ya está aplicada/);
    await t.db.exec("rollback").catch(() => {});
  });
});
