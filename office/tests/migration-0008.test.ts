// Migración 0008 sobre el estado de producción (0001–0007 + seed + datos), en
// PostgreSQL 17.11 (la versión de producción) y 18: transaccional, aditiva
// (la huella del esquema solo gana elementos, salvo las dos revocaciones
// previstas), no toca datos y es compatible con el código publicado (01432bd).
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres18 from "embedded-postgres";
import EmbeddedPostgres17 from "embedded-postgres-17";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { buildSeedSql } from "@/lib/db/seed";
import { SUPABASE_STUB_SQL } from "./helpers/db";

const FINGERPRINT = readFileSync("supabase/checks/schema-fingerprint.sql", "utf8");
const TABLES = `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`;

describe.each([
  ["PostgreSQL 17.11 (producción)", EmbeddedPostgres17],
  ["PostgreSQL 18", EmbeddedPostgres18],
])("0008 en %s", (_label, EmbeddedPostgres) => {
  it("sobre 0001–0007 con datos: transaccional, aditiva, sin tocar datos, permisos mínimos y código anterior compatible", async () => {
    const base = mkdtempSync(join(tmpdir(), "mig8-")); chmodSync(base, 0o777);
    const port = 59000 + Math.floor(Math.random() * 900);
    const pg = new EmbeddedPostgres({ databaseDir: join(base, "d"), user: "postgres", password: "x", port, persistent: false, onLog: () => {} });
    await pg.initialise(); await pg.start();
    const c = new Client({ host: "localhost", port, user: "postgres", password: "x", database: "postgres" }); await c.connect();
    /** Huella del contenido de cada tabla (md5 de todas sus filas). */
    const checksums = async () => {
      const out: Record<string, string> = {};
      for (const { relname } of (await c.query<{ relname: string }>(TABLES)).rows) {
        const { rows: [r] } = await c.query(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) m from public."${relname}" t`);
        out[relname] = r.m;
      }
      return out;
    };
    const fingerprint = async () => new Set((await c.query<{ k: string; v: string }>(FINGERPRINT)).rows.map((r) => `${r.k}|${r.v}`));
    try {
      await c.query(SUPABASE_STUB_SQL());
      for (const f of readdirSync("supabase/migrations").sort().filter((f) => f < "0008")) await c.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
      await c.query(buildSeedSql());
      // Datos como en producción: misión con ficha y documento, reservas liquidadas y liberadas, ejecuciones.
      const { rows: [m] } = await c.query(`insert into public.tasks (title, agent_id, status, input) values ('Misión previa', 'alex', 'completed', '{"kind":"mission"}') returning id`);
      await c.query(`insert into public.companies (name, city, source, created_by, created_in_task) values ('Previa', 'Barcelona', 'https://previa.example/', 'marcus', $1)`, [m.id]);
      await c.query(`insert into public.documents (title, kind, content, source, task_id, agent_id) values ('Informe', 'report', 'x', 'motor', $1, 'alex')`, [m.id]);
      await c.query(`insert into public.tasks (title, agent_id, status, input) values ('Previa 2', 'alex', 'assigned', '{"kind":"mission"}')`);
      await c.query(`set role service_role`);
      const { rows: [pc] } = await c.query(`select * from public.claim_next_task('w', 240, 2)`);
      const pr = await c.query(`select public.reserve_budget($1, 'w', 'claude-sonnet-5-5', 0.05, 0, 240) r`, [pc.run_id]);
      await c.query(`select public.record_call($1, 'w', $2, '{}', 'claude-sonnet-5-5', 100, 10, 0, 0, 0, 0.001, 0)`, [pc.run_id, pr.rows[0].r.reservation_id]);
      const pr2 = await c.query(`select public.reserve_budget($1, 'w', 'claude-sonnet-5-5', 0.05, 0, 240) r`, [pc.run_id]);
      await c.query(`select public.close_reservation($1, $2, false)`, [pc.run_id, pr2.rows[0].r.reservation_id]);
      await c.query(`select public.complete_run($1, 'w', 'Hecho')`, [pc.run_id]);
      await c.query(`reset role`);
      expect((await c.query(`select array_agg(distinct status order by status) s from public.ai_reservations`)).rows[0].s).toEqual(["released", "settled"]);

      const dataBefore = await checksums();
      const fpBefore = await fingerprint();
      const sql = readFileSync("supabase/migrations/0008_deliveries_facts_realtime.sql", "utf8");

      // Fallo a mitad → nada aplicado.
      await c.query("begin"); await expect(c.query(sql + "\nselect 1/0;")).rejects.toThrow(); await c.query("rollback");
      expect((await c.query(`select to_regclass('public.company_facts') a, to_regclass('public.task_deliveries') b`)).rows[0]).toEqual({ a: null, b: null });
      expect(await checksums()).toEqual(dataBefore);
      expect(await fingerprint()).toEqual(fpBefore);

      // Aplicación real en una transacción.
      await c.query("begin"); await c.query(sql); await c.query("commit");

      // Contenido idéntico en todas las tablas anteriores; settings solo gana la fila confidence_rules.
      const dataAfter = await checksums();
      for (const [t, h] of Object.entries(dataBefore)) if (t !== "settings") expect({ t, h: dataAfter[t] }).toEqual({ t, h });
      expect((await c.query(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) m from public.settings t where key <> 'confidence_rules'`)).rows[0].m).toBe(dataBefore.settings);
      expect((await c.query(`select value from public.settings where key = 'confidence_rules'`)).rows[0].value.base)
        .toEqual({ official_direct: 95, official_indirect: 90, directory: 80, third_party: 70, self_declared: 60, inference: 40, none: 0 });
      expect(Object.keys(dataAfter).filter((t) => !(t in dataBefore)).sort()).toEqual(["company_facts", "task_deliveries"]);

      // Aditiva: del esquema solo desaparecen los permisos de escritura revocados a propósito.
      const fpAfter = await fingerprint();
      expect([...fpBefore].filter((x) => !fpAfter.has(x)).sort()).toEqual([
        "grant|documents:authenticated:DELETE,INSERT,SELECT,UPDATE",
        "grant|task_dependencies:authenticated:DELETE,INSERT,SELECT,UPDATE",
      ]);
      const added = [...fpAfter].filter((x) => !fpBefore.has(x));
      expect(added).toEqual(expect.arrayContaining(["grant|documents:authenticated:SELECT", "grant|task_dependencies:authenticated:SELECT"]));
      // Ninguna función existente cambia (mismo código y mismos permisos).
      expect(added.filter((x) => /^(fn|fexec)\|/.test(x) && !/(fact_confidence|record_company_fact|advance_deliveries|company_facts_immutable)\(/.test(x))).toEqual([]);

      // RLS en las tablas nuevas; claves foráneas e índices.
      const rls = await c.query(`select relname, relrowsecurity from pg_class where relname in ('company_facts', 'task_deliveries') order by 1`);
      expect(rls.rows).toEqual([{ relname: "company_facts", relrowsecurity: true }, { relname: "task_deliveries", relrowsecurity: true }]);
      const fks = await c.query(`select conrelid::regclass::text t, confrelid::regclass::text r from pg_constraint where contype = 'f' and conrelid::regclass::text in ('company_facts', 'task_deliveries') order by 1, 2`);
      expect(fks.rows).toEqual(expect.arrayContaining([
        { t: "company_facts", r: "companies" }, { t: "company_facts", r: "company_facts" }, { t: "company_facts", r: "tasks" },
        { t: "task_deliveries", r: "tasks" },
      ]));
      const idx = await c.query(`select count(*)::int n from pg_indexes where tablename in ('company_facts', 'task_deliveries')`);
      expect(idx.rows[0].n).toBeGreaterThanOrEqual(4);

      // Permisos: authenticated solo lee lo nuevo y ya no escribe documentos ni dependencias; anon, nada.
      const grants = await c.query(`select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) p
        from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')
         and table_name in ('company_facts', 'task_deliveries', 'documents', 'task_dependencies', 'company_facts_current')
        group by 1, 2 order by 1, 2`);
      expect(grants.rows).toEqual([
        { table_name: "company_facts", grantee: "authenticated", p: "SELECT" },
        { table_name: "company_facts_current", grantee: "authenticated", p: "SELECT" },
        { table_name: "documents", grantee: "authenticated", p: "SELECT" },
        { table_name: "task_deliveries", grantee: "authenticated", p: "SELECT" },
        { table_name: "task_dependencies", grantee: "authenticated", p: "SELECT" },
      ]);
      const exec = await c.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute') order by 1`);
      expect(exec.rows.map((x) => x.proname)).toEqual(["ai_budget_status", "decide_approval", "is_admin"]);
      const anonExec = await c.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute') order by 1`);
      expect(anonExec.rows).toEqual([]);
      const defs = await c.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef order by 1`);
      expect(defs.rows.map((x) => x.proname)).toEqual(["decide_approval", "is_admin", "memory_items_versioning"]);
      const view = await c.query(`select reloptions from pg_class where relname = 'company_facts_current'`);
      expect(view.rows[0].reloptions).toContain("security_invoker=true");

      // Realtime: las 7 tablas anteriores (las mismas que en producción) siguen y se añaden 6.
      const pub = await c.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`);
      expect(pub.rows.map((r) => r.tablename)).toEqual([
        "agent_runs", "agents", "ai_reservations", "ai_usage", "approvals", "companies", "company_facts",
        "documents", "messages", "task_deliveries", "task_events", "tasks", "tool_executions",
      ]);

      // Reaplicar por error falla limpio dentro de una transacción y no cambia nada.
      const fpApplied = await fingerprint();
      await c.query("begin"); await expect(c.query(sql)).rejects.toThrow(/already exists/); await c.query("rollback");
      expect(await fingerprint()).toEqual(fpApplied);

      // Código anterior (01432bd): reclama, reserva, registra coste, guarda documento y termina como siempre.
      await c.query(`insert into public.tasks (title, agent_id, status, input) values ('Nueva', 'alex', 'assigned', '{"kind":"mission"}')`);
      await c.query(`set role service_role`);
      const { rows: [cl] } = await c.query(`select * from public.claim_next_task('w', 240, 2)`);
      const res = await c.query(`select public.reserve_budget($1, 'w', 'claude-sonnet-5-5', 0.05, 0, 240) r`, [cl.run_id]);
      expect(res.rows[0].r.ok).toBe(true);
      const rc = await c.query(`select public.record_call($1, 'w', $2, '{}', 'claude-sonnet-5-5', 100, 10, 0, 0, 0, 0.001, 0) r`, [cl.run_id, res.rows[0].r.reservation_id]);
      expect(rc.rows[0].r.continue).toBe(true);
      await c.query(`insert into public.documents (title, kind, content, source, task_id, agent_id) values ('Doc', 'report', 'y', 'motor', $1, 'alex')`, [cl.task_id]);
      await c.query(`insert into public.task_dependencies (task_id, depends_on) values ($1, $2)`, [cl.task_id, m.id]);
      await c.query(`select public.complete_run($1, 'w', 'Hecho')`, [cl.run_id]);
      // Y el código nuevo con un hecho registrado.
      await c.query(`reset role`);
      await c.query(`insert into public.tasks (title, agent_id, status, input) values ('Otra', 'marcus', 'assigned', '{"kind":"subtask"}')`);
      await c.query(`set role service_role`);
      const { rows: [cl2] } = await c.query(`select * from public.claim_next_task('w', 240, 2)`);
      const { rows: [co] } = await c.query(`select id from public.companies limit 1`);
      const f = await c.query(`select public.record_company_fact($1, 'w', $2, 'telefono', '+34 600', 'https://previa.example/', 'official_direct', 'verified', null, null, null, null) r`, [cl2.run_id, co.id]);
      expect(f.rows[0].r.confidence_score).toBe(95);
      await c.query(`reset role`);

      // Marcha atrás de emergencia: el esquema vuelve exactamente al de la 0007.
      await c.query(readFileSync("supabase/checks/0008_rollback.sql", "utf8"));
      expect(await fingerprint()).toEqual(fpBefore);
    } finally { await c.end(); await pg.stop(); rmSync(base, { recursive: true, force: true }); }
  }, 180_000);
});
