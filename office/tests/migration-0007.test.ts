// Migración 0007 sobre el estado de producción (0001–0006 + seed + datos):
// transaccional, no toca datos y es compatible con la versión anterior del código.
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { expect, it } from "vitest";
import { buildSeedSql } from "@/lib/db/seed";
import { SUPABASE_STUB_SQL } from "./helpers/db";

it("0007 sobre 0001–0006 con datos: transaccional, sin tocar datos, y la versión anterior del código sigue funcionando", async () => {
  const base = mkdtempSync(join(tmpdir(), "mig-")); chmodSync(base, 0o777);
  const port = 59000 + Math.floor(Math.random() * 500);
  const pg = new EmbeddedPostgres({ databaseDir: join(base, "d"), user: "postgres", password: "x", port, persistent: false, onLog: () => {} });
  await pg.initialise(); await pg.start();
  const c = new Client({ host: "localhost", port, user: "postgres", password: "x", database: "postgres" }); await c.connect();
  try {
    await c.query(SUPABASE_STUB_SQL());
    const files = readdirSync("supabase/migrations").sort();
    for (const f of files.filter((f) => f < "0007")) await c.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await c.query(buildSeedSql());
    await c.query(`update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 1}' where key = 'limits'`);
    await c.query(`insert into public.companies (name, city, source) values ('Previa', 'Barcelona', 'manual')`);
    const before = (await c.query(`select (select count(*) from public.companies) c, (select value from public.settings where key='limits') l`)).rows[0];
    // Fallo a mitad → nada aplicado (transacción).
    const sql = readFileSync("supabase/migrations/0007_budget_reservations.sql", "utf8");
    await c.query("begin"); await expect(c.query(sql + "\nselect 1/0;")).rejects.toThrow(); await c.query("rollback");
    expect((await c.query(`select to_regclass('public.ai_reservations') r`)).rows[0].r).toBeNull();
    // Aplicación real en una transacción.
    await c.query("begin"); await c.query(sql); await c.query("commit");
    const after = (await c.query(`select (select count(*) from public.companies) c, (select value from public.settings where key='limits') l, (select value from public.settings where key='pilot') p`)).rows[0];
    expect(after.c).toBe(before.c);
    expect(after.l).toEqual({ ...before.l, mission_ai_budget_usd: 1 });
    expect(after.p).toMatchObject({ agents: ["alex", "marcus", "sofia"], max_companies: 5, max_searches: 15, synthesis_reserve_usd: 0.25, stop_on_cost_overrun: true });
    // Código anterior (record_step de 0006) sigue funcionando: rollback de Vercel seguro.
    await c.query(`set role service_role`);
    await c.query(`insert into public.tasks (title, agent_id, status, input) values ('x', 'alex', 'assigned', '{"kind":"mission"}')`).catch(() => {});
    await c.query(`reset role`);
    await c.query(`insert into public.tasks (title, agent_id, status, input) values ('x', 'alex', 'assigned', '{"kind":"mission"}')`);
    await c.query(`set role service_role`);
    const { rows: [cl] } = await c.query(`select * from public.claim_next_task('w', 240, 2)`);
    const r = await c.query(`select public.record_step($1, 'w', '{}', 'claude-sonnet-5-5', 10, 10, 0, 0, 0, 0.001) as r`, [cl.run_id]);
    expect(r.rows[0].r.continue).toBe(true);
    // Sin SECURITY DEFINER nuevas.
    await c.query(`reset role`);
    const defs = await c.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef order by 1`);
    expect(defs.rows.map((x) => x.proname)).toEqual(["decide_approval", "is_admin", "memory_items_versioning"]);
  } finally { await c.end(); await pg.stop(); rmSync(base, { recursive: true, force: true }); }
}, 120_000);
