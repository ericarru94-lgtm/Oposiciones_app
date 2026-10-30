// Migración 0008 sobre el estado de producción (0001–0007 + seed + datos):
// transaccional, no toca datos, reaplicable sin efectos y compatible con la
// versión publicada del código (01432bd), que no conoce las tablas nuevas.
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { expect, it } from "vitest";
import { buildSeedSql } from "@/lib/db/seed";
import { SUPABASE_STUB_SQL } from "./helpers/db";

it("0008 sobre 0001–0007 con datos: transaccional, sin tocar datos, permisos mínimos y código anterior compatible", async () => {
  const base = mkdtempSync(join(tmpdir(), "mig8-")); chmodSync(base, 0o777);
  const port = 59500 + Math.floor(Math.random() * 400);
  const pg = new EmbeddedPostgres({ databaseDir: join(base, "d"), user: "postgres", password: "x", port, persistent: false, onLog: () => {} });
  await pg.initialise(); await pg.start();
  const c = new Client({ host: "localhost", port, user: "postgres", password: "x", database: "postgres" }); await c.connect();
  const count = async () => (await c.query(`select (select count(*) from public.companies)::int co, (select count(*) from public.documents)::int d,
      (select count(*) from public.tasks)::int t, (select count(*) from public.ai_usage)::int u,
      (select jsonb_object_agg(key, value) from public.settings where key <> 'confidence_rules') s`)).rows[0];
  try {
    await c.query(SUPABASE_STUB_SQL());
    for (const f of readdirSync("supabase/migrations").sort().filter((f) => f < "0008")) await c.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await c.query(buildSeedSql());
    // Datos como en producción: una misión con ficha, documento y coste.
    const { rows: [m] } = await c.query(`insert into public.tasks (title, agent_id, status, input) values ('Misión previa', 'alex', 'completed', '{"kind":"mission"}') returning id`);
    await c.query(`insert into public.companies (name, city, source, created_by, created_in_task) values ('Previa', 'Barcelona', 'https://previa.example/', 'marcus', $1)`, [m.id]);
    await c.query(`insert into public.documents (title, kind, content, source, task_id, agent_id) values ('Informe', 'report', 'x', 'motor', $1, 'alex')`, [m.id]);
    const before = await count();

    const sql = readFileSync("supabase/migrations/0008_deliveries_facts_realtime.sql", "utf8");
    // Fallo a mitad → nada aplicado.
    await c.query("begin"); await expect(c.query(sql + "\nselect 1/0;")).rejects.toThrow(); await c.query("rollback");
    expect((await c.query(`select to_regclass('public.company_facts') a, to_regclass('public.task_deliveries') b`)).rows[0]).toEqual({ a: null, b: null });
    // Aplicación real; los datos no cambian.
    await c.query("begin"); await c.query(sql); await c.query("commit");
    expect(await count()).toEqual(before);
    expect((await c.query(`select value from public.settings where key = 'confidence_rules'`)).rows[0].value.base)
      .toEqual({ official_direct: 95, official_indirect: 90, directory: 80, third_party: 70, self_declared: 60, inference: 40, none: 0 });

    // RLS activado en las tablas nuevas; claves foráneas e índices.
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
    const defs = await c.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef order by 1`);
    expect(defs.rows.map((x) => x.proname)).toEqual(["decide_approval", "is_admin", "memory_items_versioning"]);
    // La vista respeta RLS de quien consulta.
    const view = await c.query(`select reloptions from pg_class where relname = 'company_facts_current'`);
    expect(view.rows[0].reloptions).toContain("security_invoker=true");

    // Realtime.
    const pub = await c.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`);
    expect(pub.rows.map((r) => r.tablename)).toEqual(expect.arrayContaining(["companies", "documents", "ai_usage", "tool_executions", "task_deliveries", "company_facts", "tasks", "agents"]));

    // Reaplicar no cambia nada (bloques idempotentes en la publicación y los ajustes).
    const pubBefore = pub.rows.length;
    // (Las tablas usan create table: reaplicar falla limpio dentro de una transacción.)
    await c.query("begin"); await expect(c.query(sql)).rejects.toThrow(/already exists/); await c.query("rollback");
    expect((await c.query(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime'`)).rows[0].n).toBe(pubBefore);

    // Código anterior (01432bd): reclama, reserva, registra coste, guarda documento y termina como siempre.
    await c.query(`insert into public.tasks (title, agent_id, status, input) values ('Nueva', 'alex', 'assigned', '{"kind":"mission"}')`);
    await c.query(`set role service_role`);
    const { rows: [cl] } = await c.query(`select * from public.claim_next_task('w', 240, 2)`);
    const res = await c.query(`select public.reserve_budget($1, 'w', 'claude-sonnet-5-5', 0.05, 0, 240) r`, [cl.run_id]);
    expect(res.rows[0].r.ok).toBe(true);
    const rc = await c.query(`select public.record_call($1, 'w', $2, '{}', 'claude-sonnet-5-5', 100, 10, 0, 0, 0, 0.001, 0) r`, [cl.run_id, res.rows[0].r.reservation_id]);
    expect(rc.rows[0].r.continue).toBe(true);
    await c.query(`insert into public.documents (title, kind, content, source, task_id, agent_id) values ('Doc', 'report', 'y', 'motor', $1, 'alex')`, [cl.task_id]);
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
  } finally { await c.end(); await pg.stop(); rmSync(base, { recursive: true, force: true }); }
}, 120_000);
