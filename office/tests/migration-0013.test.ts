// Migración 0013 (fase 5.2.1): plan de misión aprobado por el administrador.
// Se prueba sobre el estado tras 0012 (0001–0012 + seed, con los valores de
// producción y misiones antiguas) en PostgreSQL 17.11 (producción) y 18:
// aditiva, transaccional, sin tocar datos, misiones antiguas intactas,
// decisiones concurrentes, marcha atrás exacta y volver a aplicar.
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres18 from "embedded-postgres";
import EmbeddedPostgres17 from "embedded-postgres-17";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { buildSeedSql } from "@/lib/db/seed";
import { ADMIN, SUPABASE_STUB_SQL } from "./helpers/db";

const FINGERPRINT = readFileSync("supabase/checks/schema-fingerprint.sql", "utf8");
const MIGRATION = readFileSync("supabase/migrations/0013_mission_plans.sql", "utf8");
const ROLLBACK = readFileSync("supabase/checks/0013_rollback.sql", "utf8");
const NEW_COLUMNS = ["plan_required", "plan_id", "plan_step_key", "budget_usd", "max_calls", "max_searches"];
const STEPS = [
  { key: "investigacion", agent: "marcus", title: "Investigar gimnasios", instructions: "Busca gimnasios reales con fuentes.", depends_on: [], tools: ["web.search", "crm.write"], budget_usd: 0.45, max_calls: 4, max_searches: 3 },
  { key: "estrategia", agent: "sofia", title: "Estrategia", instructions: "Estrategia con las fichas de Marcus.", depends_on: ["investigacion"], tools: ["content.draft"], budget_usd: 0.2, max_calls: 3, max_searches: 0 },
];

describe.each([
  ["PostgreSQL 17.11 (producción)", EmbeddedPostgres17],
  ["PostgreSQL 18", EmbeddedPostgres18],
])("0013 en %s", (_label, EmbeddedPostgres) => {
  it("aditiva y transaccional, misiones antiguas intactas, decisiones concurrentes seguras, marcha atrás y volver a aplicar", async () => {
    const base = mkdtempSync(join(tmpdir(), "mig13-")); chmodSync(base, 0o777);
    const port = 59000 + Math.floor(Math.random() * 900);
    const pg = new EmbeddedPostgres({ databaseDir: join(base, "d"), user: "postgres", password: "x", port, persistent: false, onLog: () => {} });
    await pg.initialise(); await pg.start();
    const conn = async () => { const c = new Client({ host: "localhost", port, user: "postgres", password: "x", database: "postgres" }); await c.connect(); return c; };
    const root = await conn();
    const clients: Client[] = [root];
    const svc = async () => {
      const c = await conn(); clients.push(c);
      await c.query(`set role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
      return c;
    };
    const asAdmin = async () => {
      const c = await conn(); clients.push(c);
      await c.query(`set role authenticated; select set_config('request.jwt.claim.sub', '${ADMIN}', false),
        set_config('request.jwt.claims', '{"role":"authenticated","sub":"${ADMIN}"}', false), set_config('request.jwt.claim.role', 'authenticated', false)`);
      return c;
    };
    const checksum = async (table: string, minus: string[] = []) =>
      (await root.query(`select md5(coalesce(string_agg((to_jsonb(t) - $1::text[])::text, '|' order by (to_jsonb(t) - $1::text[])::text), '')) m from public."${table}" t`, [minus])).rows[0].m as string;
    const fingerprint = async () => new Set((await root.query<{ k: string; v: string }>(FINGERPRINT)).rows.map((r) => `${r.k}|${r.v}`));
    const tableNames = async () => (await root.query<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`)).rows.map((r) => r.relname);
    try {
      // ── Estado tras 0012 con misiones antiguas (como producción: 9 tareas, gasto real).
      await root.query(SUPABASE_STUB_SQL());
      for (const f of readdirSync("supabase/migrations").sort().filter((f) => f < "0013")) await root.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
      await root.query(buildSeedSql());
      await root.query(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@hesignal.test');
                        insert into public.admins (user_id, email) values ('${ADMIN}', 'admin@hesignal.test');`);
      const { rows: [old] } = await root.query(`insert into public.tasks (title, agent_id, status, input) values ('Misión antigua', 'alex', 'completed', '{"kind":"mission","round":2,"phase":"synthesis"}') returning id`);
      await root.query(`insert into public.tasks (title, agent_id, status, parent_task_id, input) values ('Subtarea antigua', 'marcus', 'completed', $1, '{"kind":"subtask","round":1}')`, [old.id]);
      await root.query(`insert into public.ai_usage (agent_id, task_id, model, input_tokens, output_tokens, cost_usd) values ('alex', $1, 'claude-sonnet-5-5', 10, 10, 0.1)`, [old.id]);
      const tables: Record<string, string> = {};
      for (const name of await tableNames()) tables[name] = await checksum(name, name === "tasks" ? NEW_COLUMNS : []);
      const fpBefore = await fingerprint();

      // ── Transaccional: un fallo a mitad no deja nada.
      await root.query("begin"); await expect(root.query(MIGRATION + "\nselect 1/0;")).rejects.toThrow(); await root.query("rollback");
      expect(await fingerprint()).toEqual(fpBefore);
      // ── Aplicación real: no cambia ningún dato; las misiones antiguas quedan sin plan.
      await root.query("begin"); await root.query(MIGRATION); await root.query("commit");
      for (const [name, h] of Object.entries(tables)) expect({ name, h: await checksum(name, name === "tasks" ? NEW_COLUMNS : []) }).toEqual({ name, h });
      expect((await root.query(`select count(*)::int n from public.tasks where plan_required`)).rows[0].n).toBe(0);
      // Aplicarla dos veces por error falla sin tocar nada.
      await root.query("begin"); await expect(root.query(MIGRATION)).rejects.toThrow(/already exists/); await root.query("rollback");

      // Seguridad: las únicas SECURITY DEFINER nuevas son las dos decisiones; solo authenticated las ejecuta.
      const fpAfter = await fingerprint();
      const added = [...fpAfter].filter((x) => !fpBefore.has(x));
      expect(added.filter((x) => /^fn\|.*\):true:/.test(x)).map((x) => x.split("(")[0]).sort()).toEqual(["fn|approve_mission_plan", "fn|reject_mission_plan"]);
      for (const f of ["approve_mission_plan", "reject_mission_plan"]) {
        expect(added.filter((x) => x.startsWith(`fexec|${f}(`)).map((x) => x.split(":").slice(-2).join(":")).sort())
          .toEqual(["anon:false", "authenticated:true", "service_role:false"]);
      }
      for (const f of ["submit_mission_plan", "await_plan_approval", "validate_mission_plan", "mission_plan_steps_json", "plan_outstanding_usd", "plan_step_tools"]) {
        expect(added.filter((x) => x.startsWith(`fexec|${f}(`)).map((x) => x.split(":").slice(-2).join(":")).sort())
          .toEqual(["anon:false", "authenticated:false", "service_role:true"]);
      }
      for (const f of ["lock_plan_for_decision", "expire_mission_plan"]) {
        expect(added.filter((x) => x.startsWith(`fexec|${f}(`)).every((x) => x.endsWith(":false"))).toBe(true);
      }
      expect(added.filter((x) => x.startsWith("grant|mission_plan")).sort()).toEqual([
        "grant|mission_plan_steps:authenticated:SELECT", "grant|mission_plan_steps:service_role:INSERT,SELECT,UPDATE",
        "grant|mission_plans:authenticated:SELECT", "grant|mission_plans:service_role:INSERT,SELECT,UPDATE",
      ]);
      // Ninguna política, permiso ni publicación anterior se pierde.
      expect([...fpBefore].filter((x) => !fpAfter.has(x)).filter((x) => !/^fn\|(delegate_task|reserve_budget)\(/.test(x))).toEqual([]);

      // ── Plan pendiente real (servidor con lease).
      const s = await svc();
      const { rows: [m] } = await s.query(`insert into public.tasks (title, description, agent_id, status, input, created_by, timeout_seconds)
        values ('Nueva', 'Misión nueva', 'alex', 'assigned', '{"kind":"mission","round":1,"phase":"planning"}', 'admin', 86400) returning id, plan_required`);
      expect(m.plan_required).toBe(true);
      const { rows: [run] } = await s.query(`select * from public.claim_next_task('w1', 240, 2)`);
      const { rows: [{ r: sub }] } = await s.query(`select public.submit_mission_plan($1, 'w1', 'Plan de prueba de la migración.', $2::jsonb) r`, [run.run_id, JSON.stringify(STEPS)]);
      await s.query(`select public.await_plan_approval($1, 'w1', 'Plan explicado')`, [run.run_id]);

      // ── Dos aprobaciones a la vez: una gana, la otra espera y falla; las subtareas se crean una vez.
      const a = await asAdmin(); const b = await asAdmin();
      await a.query("begin");
      await a.query(`select public.approve_mission_plan($1, 1, $2)`, [sub.plan_id, sub.plan_hash]);
      const second = b.query(`select public.approve_mission_plan($1, 1, $2)`, [sub.plan_id, sub.plan_hash]).then(() => "ok", (e: Error) => e.message);
      await new Promise((r) => setTimeout(r, 300));
      await a.query("commit");
      expect(await second).toMatch(/ya no está pendiente/);
      expect((await root.query(`select count(*)::int n from public.tasks where parent_task_id = $1`, [m.id])).rows[0].n).toBe(2);
      expect((await root.query(`select count(*)::int n from public.activity_log where action = 'plan.approved'`)).rows[0].n).toBe(1);

      // ── Aprobar y rechazar a la vez sobre otro plan: solo una decisión.
      await root.query(`update public.tasks set status = 'completed' where parent_task_id = $1`, [m.id]);
      const { rows: [run2] } = await s.query(`select * from public.claim_next_task('w2', 240, 2)`);
      const { rows: [{ r: sub2 }] } = await s.query(`select public.submit_mission_plan($1, 'w2', 'Ampliación de prueba.', $2::jsonb) r`,
        [run2.run_id, JSON.stringify([{ ...STEPS[1], key: "correccion", depends_on: [], budget_usd: 0.05 }])]);
      await s.query(`select public.await_plan_approval($1, 'w2', 'Ampliación')`, [run2.run_id]);
      await a.query("begin");
      await a.query(`select public.reject_mission_plan($1, 2, $2, 'No hace falta', 'changes')`, [sub2.plan_id, sub2.plan_hash]);
      const racing = b.query(`select public.approve_mission_plan($1, 2, $2)`, [sub2.plan_id, sub2.plan_hash]).then(() => "ok", (e: Error) => e.message);
      await new Promise((r) => setTimeout(r, 300));
      await a.query("commit");
      expect(await racing).toMatch(/ya no está pendiente/);
      expect((await root.query(`select count(*)::int n from public.tasks where parent_task_id = $1`, [m.id])).rows[0].n).toBe(2);

      // ── Concurrencia económica: dos misiones aprobadas a la vez no comprometen más que el mes.
      await root.query(`update public.tasks set status = 'completed', locked_by = null, locked_until = null where status <> 'completed'`);
      await root.query(`update public.settings set value = '{"monthly_ai_budget_usd": 1.5, "mission_ai_budget_usd": 1, "task_ai_budget_usd": 1}' where key = 'limits'`);
      const proposeIn = async (worker: string) => {
        const { rows: [mm] } = await s.query(`insert into public.tasks (title, description, agent_id, status, input, created_by, timeout_seconds)
          values ('Mes ' || $1, 'Misión de prueba', 'alex', 'assigned', '{"kind":"mission","round":1,"phase":"planning"}', 'admin', 86400) returning id`, [worker]);
        const { rows: [rr] } = await s.query(`select * from public.claim_next_task($1, 240, 5)`, [worker]);
        expect(rr.task_id).toBe(mm.id);
        const { rows: [{ r }] } = await s.query(`select public.submit_mission_plan($1, $2, 'Plan que llena el mes.', $3::jsonb) r`, [rr.run_id, worker, JSON.stringify(STEPS)]);
        await s.query(`select public.await_plan_approval($1, $2, 'Plan')`, [rr.run_id, worker]);
        return { mission: mm.id as string, plan: r as { plan_id: string; plan_hash: string } };
      };
      const p1 = await proposeIn("mes1");
      const p2 = await proposeIn("mes2"); // cada plan: 0,65 $ + 0,25 $ de reserva = 0,90 $; los dos (1,80 $) no caben en 1,50 $
      await a.query("begin");
      await a.query(`select public.approve_mission_plan($1, 1, $2)`, [p1.plan.plan_id, p1.plan.plan_hash]);
      const other = b.query(`select public.approve_mission_plan($1, 1, $2)`, [p2.plan.plan_id, p2.plan.plan_hash]).then(() => "ok", (e: Error) => e.message);
      await new Promise((r) => setTimeout(r, 300));
      await a.query("commit");
      expect(await other).toMatch(/presupuesto mensual.*comprometidos por otros planes aprobados/);
      expect((await root.query(`select public.plan_outstanding_usd(null)::float8 v`)).rows[0].v).toBeCloseTo(0.9, 4);
      // Una reserva de otra misión que espera a una aprobación en curso ve el dinero ya comprometido.
      await root.query(`update public.tasks set status = 'in_review' where parent_task_id = $1`, [p1.mission]);
      const { rows: [lm] } = await s.query(`insert into public.tasks (title, description, agent_id, status, input, plan_required)
        values ('Antigua', 'Misión antigua', 'alex', 'assigned', '{"kind":"mission","round":1}', false) returning id`);
      const { rows: [lr] } = await s.query(`select * from public.claim_next_task('legacy', 240, 5)`);
      expect(lr.task_id).toBe(lm.id);
      const s3 = await svc();
      const { rows: [{ v: freeNow }] } = await root.query(`select (1.5 - public.committed_usd('month', null) - public.plan_outstanding_usd(null))::float8 v`);
      await a.query("begin");
      await a.query(`select 1 from public.settings where key = 'limits' for update`); // como una aprobación en curso
      const reservation = s3.query(`select public.reserve_budget($1, 'legacy', 'claude-sonnet-5-5', $2, 0, 240) r`, [lr.run_id, freeNow + 0.01]).then((x) => x.rows[0].r);
      await new Promise((r) => setTimeout(r, 300));
      await a.query("commit");
      expect(await reservation).toEqual({ ok: false, reason: "monthly_budget" });
      const { rows: [{ r: fits }] } = await s3.query(`select public.reserve_budget($1, 'legacy', 'claude-sonnet-5-5', $2, 0, 240) r`, [lr.run_id, Math.max(0.01, freeNow - 0.01)]);
      expect(fits.ok).toBe(true);
      await root.query(`update public.ai_reservations set status = 'released' where status = 'open'`);
      await root.query(`update public.tasks set status = 'completed', locked_by = null, locked_until = null where status <> 'completed'`);
      await root.query(`update public.settings set value = '{"monthly_ai_budget_usd": 10, "mission_ai_budget_usd": 1, "task_ai_budget_usd": 1}' where key = 'limits'`);

      // ── Marcha atrás: vuelve EXACTAMENTE al esquema de 0012 (salvo el archivo de planes) sin borrar filas.
      const plansBefore = await checksum("mission_plans");
      const stepsBefore = await checksum("mission_plan_steps");
      const tasksBefore = await checksum("tasks", NEW_COLUMNS);
      await root.query("begin"); await root.query(ROLLBACK); await root.query("commit");
      const fpRolled = await fingerprint();
      const archive = (x: string) => x.includes("mission_plan");
      expect([...fpRolled].filter((x) => !fpBefore.has(x) && !archive(x))).toEqual([]);
      expect([...fpBefore].filter((x) => !fpRolled.has(x))).toEqual([]);
      expect(await checksum("mission_plans")).toBe(plansBefore);
      expect(await checksum("mission_plan_steps")).toBe(stepsBefore);
      expect(await checksum("tasks")).toBe(tasksBefore);
      // El archivo es de solo lectura para la API.
      expect([...fpRolled].filter((x) => x.startsWith("grant|mission_plan")).sort()).toEqual([
        "grant|mission_plan_steps:authenticated:SELECT", "grant|mission_plan_steps:service_role:SELECT",
        "grant|mission_plans:authenticated:SELECT", "grant|mission_plans:service_role:SELECT",
      ]);
      // Tras la marcha atrás, el camino antiguo vuelve a funcionar (delegate_task de 0006).
      const s2 = await svc();
      await root.query(`update public.tasks set status = 'completed', locked_by = null, locked_until = null where status <> 'completed'`);
      const { rows: [legacy] } = await s2.query(`insert into public.tasks (title, description, agent_id, status, input) values ('Tras marcha atrás', 'x', 'alex', 'assigned', '{"kind":"mission","round":1}') returning id`);
      const { rows: [run3] } = await s2.query(`select * from public.claim_next_task('w3', 240, 2)`);
      expect(run3.task_id).toBe(legacy.id);
      const { rows: [{ r: d }] } = await s2.query(`select public.delegate_task($1, 'w3', 'tu', 'marcus', 'Investigar', 'Instrucciones claras', '{}') r`, [run3.run_id]);
      expect(d.duplicate).toBe(false);

      // ── Volver a aplicar: reutiliza el archivo de planes.
      await root.query("begin"); await root.query(MIGRATION); await root.query("commit");
      expect(await checksum("mission_plans")).toBe(plansBefore);
      const fpAgain = await fingerprint();
      expect([...fpAgain].filter((x) => !fpAfter.has(x))).toEqual([]);
      expect([...fpAfter].filter((x) => !fpAgain.has(x))).toEqual([]);
    } finally {
      for (const c of clients) await c.end().catch(() => {});
      await pg.stop();
      rmSync(base, { recursive: true, force: true });
    }
  }, 180_000);
});
