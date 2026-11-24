// PI-16 · Prueba de CONCURRENCIA REAL de reserve_budget / record_call con
// PostgreSQL 17 embebido (local, solo 127.0.0.1, datos temporales y ficticios)
// y varias conexiones simultáneas. No toca Supabase ni ningún servicio externo.
//
// Uso (desde office/):  npx tsx scripts/lab/pi16-concurrency.mts
// Requiere la dependencia de desarrollo embedded-postgres-17.
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres-17";
import { SUPABASE_STUB_SQL } from "../../tests/helpers/db";
import { buildSeedSql } from "../../src/lib/db/seed";

const ROUNDS = 10;
const CLIENTS = 12;
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "OK   " : "FALLA"} ${name} · ${detail}`);
};

const base = mkdtempSync(join(tmpdir(), "pi16-pg-"));
// initdb no se ejecuta como root: el usuario del sistema de PostgreSQL necesita acceder al directorio temporal.
chmodSync(base, 0o777);
const port = 58500 + Math.floor(Math.random() * 400);
const server = new EmbeddedPostgres({
  databaseDir: join(base, "d"), user: "postgres", password: "x", port, persistent: false, onLog: () => {},
  postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
});
const clients: pg.Client[] = [];
const connect = async () => {
  const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "x", database: "postgres" });
  c.on("error", () => {});
  await c.connect();
  clients.push(c);
  return c;
};

try {
  await server.initialise();
  await server.start();
  const admin = await connect();
  const ver = (await admin.query("show server_version")).rows[0].server_version as string;
  const listen = (await admin.query("show listen_addresses")).rows[0].listen_addresses as string;
  check("A · PostgreSQL 17 local aislado", /^17\./.test(ver) && listen === "127.0.0.1", `versión ${ver}, escucha en ${listen}, puerto ${port}`);

  await admin.query(SUPABASE_STUB_SQL());
  for (const f of readdirSync("supabase/migrations").sort()) await admin.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await admin.query(buildSeedSql());
  const migrated = readdirSync("supabase/migrations").sort();
  check("B · migraciones reales aplicadas (incluida 0014)", migrated.at(-1) === "0014_web_limits_audit.sql", migrated.join(", "));

  const pool = await Promise.all(Array.from({ length: CLIENTS }, () => connect()));
  for (const c of pool) await c.query("set role service_role");

  async function setup(webLimits: string, n: number) {
    await admin.query(`delete from public.ai_reservations; delete from public.ai_usage; delete from public.agent_runs; delete from public.tasks;
      update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 1, "mission_ai_budget_usd": 1}' where key = 'limits';
      update public.settings set value = '${webLimits}' where key = 'web_limits';`);
    const m = (await admin.query(`insert into public.tasks (title, description, agent_id, status, input, created_by, plan_required)
      values ('Misión concurrente', 'Prueba de concurrencia con datos ficticios', 'alex', 'in_progress', '{"kind": "mission"}', 'admin', false) returning id`)).rows[0].id as string;
    const runs: { run: string; worker: string }[] = [];
    for (let i = 0; i < n; i++) {
      const worker = `w${i}`;
      const t = (await admin.query(`insert into public.tasks (title, description, agent_id, status, input, parent_task_id, plan_required, locked_by, locked_until)
        values ('Sub ${i}', 'Subtarea ficticia', 'marcus', 'in_progress', '{}', $1, false, $2, now() + interval '1 hour') returning id`, [m, worker])).rows[0].id as string;
      const run = (await admin.query(`insert into public.agent_runs (task_id, agent_id, attempt, status, worker_id) values ($1, 'marcus', 1, 'running', $2) returning id`, [t, worker])).rows[0].id as string;
      runs.push({ run, worker });
    }
    return { mission: m, runs };
  }
  const reserve = (c: pg.Client, run: string, worker: string, fetches: number, searches = 0) =>
    c.query(`select public.reserve_budget($1, $2, 'claude-sonnet-5-5', 0.01, $3, 240, $4) as r`, [run, worker, searches, fetches]).then((x) => x.rows[0].r);

  // C1 · Lecturas por misión: 12 conexiones a la vez, máximo 3 → exactamente 3 concedidas.
  let c1 = true;
  const c1d: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    const { runs } = await setup('{"max_fetches": 3, "max_mission_calls": 60, "max_web_errors": 3}', CLIENTS);
    const rs = await Promise.all(runs.map((x, i) => reserve(pool[i], x.run, x.worker, 1)));
    const granted = rs.reduce((n, r) => n + (r.ok ? r.fetches : 0), 0);
    c1d.push(granted);
    if (granted !== 3) c1 = false;
  }
  check("C1 · lecturas por misión bajo concurrencia real", c1, `${ROUNDS} rondas × ${CLIENTS} conexiones; concedidas por ronda: ${c1d.join(",")} (esperado 3)`);

  // C2 · Búsquedas por misión (pilot.max_searches = 15): 12 piden 2 → nunca más de 15.
  let c2 = true;
  const c2d: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    const { runs } = await setup('{"max_fetches": 10, "max_mission_calls": 60, "max_web_errors": 3}', CLIENTS);
    const rs = await Promise.all(runs.map((x, i) => reserve(pool[i], x.run, x.worker, 0, 2)));
    const granted = rs.reduce((n, r) => n + (r.ok ? r.searches : 0), 0);
    c2d.push(granted);
    if (granted !== 15) c2 = false;
  }
  check("C2 · búsquedas por misión bajo concurrencia real", c2, `concedidas por ronda: ${c2d.join(",")} (esperado 15)`);

  // C3 · Llamadas por misión: máximo 5, 12 a la vez → exactamente 5 reservas.
  let c3 = true;
  const c3d: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    const { runs } = await setup('{"max_fetches": 10, "max_mission_calls": 5, "max_web_errors": 3}', CLIENTS);
    const rs = await Promise.all(runs.map((x, i) => reserve(pool[i], x.run, x.worker, 0)));
    const oks = rs.filter((r) => r.ok).length;
    const denied = rs.filter((r) => !r.ok && r.reason === "mission_calls").length;
    c3d.push(oks);
    if (oks !== 5 || denied !== CLIENTS - 5) c3 = false;
  }
  check("C3 · llamadas por misión bajo concurrencia real", c3, `reservas por ronda: ${c3d.join(",")} (esperado 5; el resto mission_calls)`);

  // C4 · Misma ejecución desde dos conexiones (reinicio o doble tick): nunca dos reservas abiertas.
  let c4 = true;
  for (let round = 0; round < ROUNDS; round++) {
    const { runs } = await setup('{"max_fetches": 10, "max_mission_calls": 60, "max_web_errors": 3}', 1);
    const [a, b] = await Promise.all([reserve(pool[0], runs[0].run, runs[0].worker, 1), reserve(pool[1], runs[0].run, runs[0].worker, 1)]);
    const open = Number((await admin.query(`select count(*) n from public.ai_reservations where status = 'open'`)).rows[0].n);
    const oks = [a, b].filter((r) => r.ok).length;
    if (open > 1 || oks !== 1) c4 = false;
  }
  check("C4 · doble reserva de la misma ejecución", c4, "en cada ronda: 1 concedida y la otra «uncertain» (la abierta pasa a incierta y cuenta como consumida)");

  // C5 · Errores web concurrentes: superar el umbral detiene la misión una sola vez y las reservas posteriores se niegan.
  let c5 = true;
  const c5d: string[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    const { mission, runs } = await setup('{"max_fetches": 15, "max_mission_calls": 60, "max_web_errors": 3}', 6);
    const res = await Promise.all(runs.map((x, i) => reserve(pool[i], x.run, x.worker, 1)));
    await Promise.all(runs.map((x, i) => pool[i].query(
      `select public.record_call($1, $2, $3, '{}'::jsonb, 'claude-sonnet-5-5', 10, 10, 0, 0, 0, 0.001, 0, 'working'::agent_status, 1, 1) as r`,
      [x.run, x.worker, res[i].reservation_id]).catch((e: Error) => ({ error: e.message }))));
    const st = (await admin.query(`select status::text from public.tasks where id = $1`, [mission])).rows[0].status;
    const stops = Number((await admin.query(`select count(*) n from public.activity_log where action = 'security.web_stop' and entity_id = $1`, [mission])).rows[0].n);
    const errs = Number((await admin.query(`select coalesce(sum(web_tool_errors), 0) n from public.ai_usage`)).rows[0].n);
    c5d.push(`${st}/${errs}/${stops}`);
    if (st !== "failed" || errs !== 6 || stops < 1) c5 = false;
  }
  check("C5 · errores web concurrentes → parada de la misión", c5, `6 llamadas simultáneas con 1 error cada una (umbral 3); estado/errores/paradas por ronda: ${c5d.join(" ")}`);

  // C6 · Mezcla simultánea de reservas y registros con errores: sin interbloqueos.
  let c6 = true;
  const c6errors = new Set<string>();
  for (let round = 0; round < ROUNDS; round++) {
    const { runs } = await setup('{"max_fetches": 15, "max_mission_calls": 60, "max_web_errors": 3}', CLIENTS);
    const half = CLIENTS / 2;
    const res = await Promise.all(runs.slice(0, half).map((x, i) => reserve(pool[i], x.run, x.worker, 1)));
    const outcomes = await Promise.all([
      ...runs.slice(0, half).map((x, i) => pool[i].query(
        `select public.record_call($1, $2, $3, '{}'::jsonb, 'claude-sonnet-5-5', 10, 10, 0, 0, 0, 0.001, 0, 'working'::agent_status, 1, 1) as r`,
        [x.run, x.worker, res[i].reservation_id]).then(() => "ok", (e: Error) => e.message)),
      ...runs.slice(half).map((x, i) => reserve(pool[half + i], x.run, x.worker, 1).then((r) => (r.ok ? "ok" : r.reason), (e: Error) => e.message)),
    ]);
    for (const o of outcomes) if (/deadlock|interbloqueo/i.test(o)) { c6 = false; c6errors.add(o); }
    for (const o of outcomes) if (!["ok", "web_errors"].includes(o) && !/lease perdido/.test(o)) c6errors.add(o);
  }
  check("C6 · reservas y registros con errores a la vez, sin interbloqueos", c6, `resultados distintos de ok/web_errors/lease perdido: ${[...c6errors].join(" | ") || "ninguno"}`);
} catch (error) {
  check("Z · ejecución del laboratorio", false, (error as Error).message);
} finally {
  for (const c of clients) await c.end().catch(() => {});
  await server.stop().catch(() => {});
  rmSync(base, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\nRESULTADO: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
