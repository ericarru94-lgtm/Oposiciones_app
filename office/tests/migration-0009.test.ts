// Migración 0009 (fase 5.1): segunda barrera en PostgreSQL para que solo los
// agentes activos reclamen tareas. Se prueba sobre el estado de producción
// (0001–0008 + seed + los nueve agentes con active = true, como en producción)
// en PostgreSQL 17.11 (la versión de producción) y 18.
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres18 from "embedded-postgres";
import EmbeddedPostgres17 from "embedded-postgres-17";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { ACTIVE_AGENT_IDS } from "@/lib/agents/catalog";
import { AGENT_IDS } from "@/lib/agents/registry";
import { buildSeedSql } from "@/lib/db/seed";
import { SUPABASE_STUB_SQL } from "./helpers/db";

const FINGERPRINT = readFileSync("supabase/checks/schema-fingerprint.sql", "utf8");
const MIGRATION = readFileSync("supabase/migrations/0009_active_agents.sql", "utf8");
const INACTIVE = ["daniel", "lucia", "david", "emma", "oscar", "victoria"];
const TABLES = `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`;

describe.each([
  ["PostgreSQL 17.11 (producción)", EmbeddedPostgres17],
  ["PostgreSQL 18", EmbeddedPostgres18],
])("0009 en %s", (_label, EmbeddedPostgres) => {
  it("barrera de agentes activos: transaccional, sin tocar tareas, y el motor sigue igual para los activos", async () => {
    const base = mkdtempSync(join(tmpdir(), "mig9-")); chmodSync(base, 0o777);
    const port = 58000 + Math.floor(Math.random() * 900);
    const pg = new EmbeddedPostgres({ databaseDir: join(base, "d"), user: "postgres", password: "x", port, persistent: false, onLog: () => {} });
    await pg.initialise(); await pg.start();
    const root = new Client({ host: "localhost", port, user: "postgres", password: "x", database: "postgres" }); await root.connect();
    const extra: Client[] = [];
    const svc = async () => {
      const c = new Client({ host: "localhost", port, user: "postgres", password: "x", database: "postgres" });
      await c.connect(); await c.query("set role service_role"); extra.push(c); return c;
    };
    const checksum = async (table: string, where = "") =>
      (await root.query(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) m from public."${table}" t ${where}`)).rows[0].m as string;
    const fingerprint = async () => new Set((await root.query<{ k: string; v: string }>(FINGERPRINT)).rows.map((r) => `${r.k}|${r.v}`));
    const resetQueue = () => root.query(`update public.tasks set status = 'completed', locked_by = null, locked_until = null where status in ('assigned', 'in_progress')`);
    try {
      await root.query(SUPABASE_STUB_SQL());
      for (const f of readdirSync("supabase/migrations").sort().filter((f) => f < "0009")) await root.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
      await root.query(buildSeedSql());
      // Como en producción antes de 0009 (consulta de solo lectura del 02/11/2026): los nueve activos.
      await root.query(`update public.agents set active = true`);
      // Datos previos: una misión terminada y una tarea en cola de un agente que pasará a inactivo.
      await root.query(`insert into public.tasks (title, agent_id, status, input) values ('Misión previa', 'alex', 'completed', '{"kind":"mission"}')`);
      await root.query(`insert into public.tasks (title, agent_id, status) values ('Pendiente de Daniel', 'daniel', 'assigned')`);

      const tablesBefore: Record<string, string> = {};
      for (const { relname } of (await root.query<{ relname: string }>(TABLES)).rows) tablesBefore[relname] = await checksum(relname);
      const agentsOtherCols = `select id, name, role, model, effort, tools, is_coordinator, status from public.agents order by id`;
      const agentsBefore = (await root.query(agentsOtherCols)).rows;
      const fpBefore = await fingerprint();

      // ── Transaccional: un fallo a mitad no deja nada aplicado.
      await root.query("begin"); await expect(root.query(MIGRATION + "\nselect 1/0;")).rejects.toThrow(); await root.query("rollback");
      expect((await root.query(`select count(*)::int n from public.agents where active`)).rows[0].n).toBe(9);
      expect(await fingerprint()).toEqual(fpBefore);

      // ── Aplicación real en una transacción.
      await root.query("begin"); await root.query(MIGRATION); await root.query("commit");

      // Solo cambia agents.active de los seis; ninguna otra tabla ni columna.
      const active = (await root.query(`select id from public.agents where active order by id`)).rows.map((r) => r.id);
      expect(active).toEqual([...ACTIVE_AGENT_IDS].sort());
      expect((await root.query(`select id from public.agents where not active order by id`)).rows.map((r) => r.id)).toEqual([...INACTIVE].sort());
      expect((await root.query(agentsOtherCols)).rows).toEqual(agentsBefore);
      for (const [t, h] of Object.entries(tablesBefore)) if (t !== "agents") expect({ t, h: await checksum(t) }).toEqual({ t, h });
      // Esquema: solo cambia el cuerpo de claim_next_task (misma firma, mismo SECURITY, mismos permisos).
      const fpAfter = await fingerprint();
      const gone = [...fpBefore].filter((x) => !fpAfter.has(x));
      const added = [...fpAfter].filter((x) => !fpBefore.has(x));
      expect(gone.length).toBe(1); expect(added.length).toBe(1);
      expect(gone[0]).toMatch(/^fn\|claim_next_task\(.*\):false:/);
      expect(added[0]).toMatch(/^fn\|claim_next_task\(.*\):false:/);
      expect((await root.query(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and prosecdef`)).rows[0].n)
        .toBe([...fpBefore].filter((x) => /^fn\|.*\):true:/.test(x)).length);

      // ── 1–9. Una tarea por agente: solo los tres activos la reclaman.
      await resetQueue();
      await root.query(`insert into public.tasks (title, agent_id, status) select 'Prueba ' || a, a, 'assigned' from unnest($1::text[]) a`, [AGENT_IDS]);
      const w = await svc();
      const claimed: string[] = [];
      for (let i = 0; i < 12; i++) {
        const { rows } = await w.query(`select * from public.claim_next_task($1, 240, 20)`, [`w${i}`]);
        if (!rows.length) break;
        claimed.push(rows[0].agent_id);
      }
      expect(claimed.sort()).toEqual([...ACTIVE_AGENT_IDS].sort());
      const left = (await root.query(`select agent_id, status, attempts, locked_by from public.tasks where title like 'Prueba %' and agent_id = any($1) order by agent_id`, [INACTIVE])).rows;
      expect(left).toEqual([...INACTIVE].sort().map((a) => ({ agent_id: a, status: "assigned", attempts: 0, locked_by: null })));
      expect((await root.query(`select count(*)::int n from public.agent_runs where agent_id = any($1)`, [INACTIVE])).rows[0].n).toBe(0);

      // ── 10. Una tarea de un inactivo (más prioritaria y más antigua) no bloquea a las elegibles.
      await resetQueue();
      await root.query(`insert into public.tasks (title, agent_id, status, priority, created_at) values ('Urgente inactiva', 'victoria', 'assigned', 'urgent', now() - interval '1 day')`);
      await root.query(`insert into public.tasks (title, agent_id, status) values ('Normal activa', 'marcus', 'assigned')`);
      const { rows: [c10] } = await w.query(`select t.title from public.claim_next_task('w10', 240, 2) c join public.tasks t on t.id = c.task_id`);
      expect(c10.title).toBe("Normal activa");

      // ── 11. Dos workers a la vez sobre una sola tarea elegible: solo uno la obtiene.
      await resetQueue();
      await root.query(`insert into public.tasks (title, agent_id, status) values ('Única', 'sofia', 'assigned')`);
      const [w1, w2] = [await svc(), await svc()];
      const both = await Promise.all([w1.query(`select * from public.claim_next_task('c1', 240, 5)`), w2.query(`select * from public.claim_next_task('c2', 240, 5)`)]);
      expect(both.flatMap((r) => r.rows)).toHaveLength(1);

      // ── 12. Dependencias y leases siguen funcionando.
      await resetQueue();
      const { rows: [a] } = await root.query(`insert into public.tasks (title, agent_id, status) values ('A', 'marcus', 'assigned') returning id`);
      const { rows: [b] } = await root.query(`insert into public.tasks (title, agent_id, status) values ('B', 'sofia', 'assigned') returning id`);
      await root.query(`insert into public.task_dependencies (task_id, depends_on) values ($1, $2)`, [b.id, a.id]);
      const { rows: [ca] } = await w.query(`select * from public.claim_next_task('d1', 240, 5)`);
      expect(ca.task_id).toBe(a.id);
      expect((await w.query(`select * from public.claim_next_task('d2', 240, 5)`)).rows).toHaveLength(0); // B espera a A; A tiene lease
      // Lease caducado → se recupera (resumed) sin crear otra ejecución.
      await root.query(`update public.tasks set locked_until = now() - interval '1 second' where id = $1`, [a.id]);
      const { rows: [again] } = await w.query(`select * from public.claim_next_task('d3', 240, 5)`);
      expect(again).toMatchObject({ task_id: a.id, run_id: ca.run_id, resumed: true });
      await w.query(`select public.complete_run($1, 'd3', 'Hecho')`, [ca.run_id]);
      const { rows: [cb] } = await w.query(`select * from public.claim_next_task('d4', 240, 5)`);
      expect(cb.task_id).toBe(b.id);

      // Marcha atrás documentada: restaura la función de 0007 (huella idéntica a la anterior).
      await root.query(readFileSync("supabase/checks/0009_rollback.sql", "utf8"));
      expect([...(await fingerprint())].filter((x) => x.startsWith("fn|claim_next_task("))).toEqual(gone);
    } finally {
      for (const c of extra) await c.end().catch(() => {});
      await root.end().catch(() => {});
      await pg.stop();
      rmSync(base, { recursive: true, force: true });
    }
  }, 240_000);
});
