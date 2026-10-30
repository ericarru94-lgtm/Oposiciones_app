// Concurrencia real: PostgreSQL 18 (embedded-postgres) con varias conexiones
// simultáneas. PGlite tiene una sola conexión y no puede demostrarlo.
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSeedSql } from "@/lib/db/seed";
import { ADMIN, SUPABASE_STUB_SQL } from "./helpers/db";

let pg: EmbeddedPostgres;
let base: string;
const port = 55000 + Math.floor(Math.random() * 4000);
const clients: Client[] = [];

async function connect(role: "service_role" | "postgres" = "service_role") {
  const c = new Client({ host: "localhost", port, user: "postgres", password: "x", database: "postgres" });
  await c.connect();
  if (role === "service_role") await c.query("set role service_role");
  clients.push(c);
  return c;
}

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "office-pg-"));
  chmodSync(base, 0o777);
  pg = new EmbeddedPostgres({ databaseDir: join(base, "data"), user: "postgres", password: "x", port, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  const admin = await connect("postgres");
  await admin.query(SUPABASE_STUB_SQL());
  for (const f of readdirSync("supabase/migrations").sort()) {
    await admin.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
  }
  await admin.query(buildSeedSql());
  await admin.query(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@hesignal.test');
                     insert into public.admins (user_id, email) values ('${ADMIN}', 'admin@hesignal.test');`);
}, 120_000);

afterAll(async () => {
  for (const c of clients) await c.end().catch(() => {});
  await pg?.stop();
  if (base) rmSync(base, { recursive: true, force: true });
});

async function approvedRun(agent: string) {
  const root = await connect("postgres");
  const svc = await connect();
  await root.query(`insert into public.tasks (title, agent_id, status) values ('Concurrencia', $1, 'assigned')`, [agent]);
  const { rows: [c] } = await svc.query(`select * from public.claim_next_task('w1', 240, 9) where agent_id = $1`, [agent]);
  const args = JSON.stringify({ action: "send", to: "a@example.com" });
  const { rows: [{ id }] } = await svc.query(
    `select public.request_approval($1, 'w1', 'tu1', 'email.send', 'external_action', 'send', $2, 'x') as id`, [c.run_id, args]);
  await svc.query(`select public.pause_for_approval($1, 'w1', '{}')`, [c.run_id]);
  await root.query(`set role authenticated; select set_config('request.jwt.claim.sub', '${ADMIN}', false);
                    select public.decide_approval('${id}', true); reset role;`);
  await svc.query(`select * from public.claim_next_task('w1', 240, 9)`);
  return { runId: c.run_id as string, approvalId: id as string, args };
}

describe("concurrencia real (PostgreSQL 18)", () => {
  it("dos consumos simultáneos de la misma aprobación: solo uno gana", async () => {
    const { runId, approvalId, args } = await approvedRun("marcus");
    const a = await connect();
    const b = await connect();
    await a.query("begin");
    const first = await a.query(`select public.consume_approval($1, $2, 'email.send', 'send', $3) as ok`, [approvalId, runId, args]);
    // B se queda esperando el bloqueo de fila de A…
    let bDone = false;
    const second = b.query(`select public.consume_approval($1, $2, 'email.send', 'send', $3) as ok`, [approvalId, runId, args])
      .then((r) => { bDone = true; return r; });
    await new Promise((r) => setTimeout(r, 400));
    expect(bDone).toBe(false);
    await a.query("commit");
    // …y al soltarlo vuelve a evaluar la condición y ya no la cumple.
    expect(first.rows[0].ok).toBe(true);
    expect((await second).rows[0].ok).toBe(false);
  });

  it("diez intentos en paralelo de iniciar la ejecución aprobada: una sola ejecución", async () => {
    const { runId, approvalId, args } = await approvedRun("emma");
    const conns = await Promise.all(Array.from({ length: 10 }, () => connect()));
    const results = await Promise.allSettled(
      conns.map((c, i) =>
        c.query(`select public.begin_tool_execution($1, 'w1', $2, 'email.send', 'send', $3, $4) as r`,
          [runId, `tu-par-${i}`, args, approvalId]),
      ),
    );
    const started = results.filter((r) => r.status === "fulfilled" && r.value.rows[0].r.outcome === "started");
    expect(started).toHaveLength(1);
    const root = await connect("postgres");
    const { rows } = await root.query(`select count(*)::int as n from public.tool_executions where run_id = $1`, [runId]);
    expect(rows[0].n).toBe(1);
  });

  it("varios trabajadores a la vez nunca cogen la misma tarea", async () => {
    const root = await connect("postgres");
    await root.query(`insert into public.tasks (title, agent_id, status)
                      select 'Paralela ' || a, a, 'assigned' from unnest(array['sofia','daniel','lucia','david']) a`);
    const workers = await Promise.all(Array.from({ length: 8 }, () => connect()));
    const results = await Promise.all(
      workers.map((w, i) => w.query(`select * from public.claim_next_task($1, 240, 20)`, [`par-${i}`])),
    );
    const ids = results.flatMap((r) => r.rows.map((x) => x.task_id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(4);
  });
});
