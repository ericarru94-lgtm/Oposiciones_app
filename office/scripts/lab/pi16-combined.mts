// PI-16 · Batería COMBINADA de concurrencia real: reservas, búsquedas y lecturas,
// errores web, umbral, parada por sobrecoste (0007), parada de seguridad (PI-16),
// reintentos (reservas liberadas), resultados inciertos y llamadas en espera.
// PostgreSQL 17 embebido, solo 127.0.0.1, datos temporales y ficticios, 12 conexiones.
//
// Uso (desde office/):  npx tsx scripts/lab/pi16-combined.mts [rondas]
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres-17";
import { SUPABASE_STUB_SQL } from "../../tests/helpers/db";
import { buildSeedSql } from "../../src/lib/db/seed";

const ROUNDS = Number(process.argv[2] ?? 10);
const N = 12;
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "OK   " : "FALLA"} ${name} · ${detail}`);
};

const base = mkdtempSync(join(tmpdir(), "pi16-comb-"));
chmodSync(base, 0o777);
const port = 59000 + Math.floor(Math.random() * 400);
const server = new EmbeddedPostgres({
  databaseDir: join(base, "d"), user: "postgres", password: "x", port, persistent: false, onLog: () => {},
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "deadlock_timeout=200ms"],
});
const clients: pg.Client[] = [];
const connect = async () => {
  const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "x", database: "postgres" });
  c.on("error", () => {});
  await c.connect();
  clients.push(c);
  return c;
};

type Out = { kind: string; ok: boolean; value?: unknown; error?: string };

try {
  await server.initialise();
  await server.start();
  const admin = await connect();
  const ver = (await admin.query("show server_version")).rows[0].server_version as string;
  const listen = (await admin.query("show listen_addresses")).rows[0].listen_addresses as string;
  check("A · PostgreSQL local aislado", /^17\./.test(ver) && listen === "127.0.0.1", `versión ${ver}, escucha en ${listen}`);
  await admin.query(SUPABASE_STUB_SQL());
  for (const f of readdirSync("supabase/migrations").sort()) await admin.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await admin.query(buildSeedSql());
  const pool = await Promise.all(Array.from({ length: N }, () => connect()));
  for (const c of pool) await c.query("set role service_role");

  async function setup(webLimits: string, n: number, waiting = 0) {
    await admin.query(`delete from public.ai_reservations; delete from public.ai_usage; delete from public.agent_runs; delete from public.tasks;
      update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 1, "mission_ai_budget_usd": 1}' where key = 'limits';
      update public.settings set value = '${webLimits}' where key = 'web_limits';`);
    const m = (await admin.query(`insert into public.tasks (title, description, agent_id, status, input, created_by, plan_required)
      values ('Misión combinada', 'Prueba combinada con datos ficticios', 'alex', 'in_progress', '{"kind": "mission"}', 'admin', false) returning id`)).rows[0].id as string;
    const runs: { run: string; worker: string; task: string }[] = [];
    for (let i = 0; i < n; i++) {
      const worker = `w${i}`;
      const t = (await admin.query(`insert into public.tasks (title, description, agent_id, status, input, parent_task_id, plan_required, locked_by, locked_until)
        values ('Sub ${i}', 'Subtarea ficticia', 'marcus', 'in_progress', '{}', $1, false, $2, now() + interval '1 hour') returning id`, [m, worker])).rows[0].id as string;
      const status = i < waiting ? "waiting_approval" : "running";
      const run = (await admin.query(`insert into public.agent_runs (task_id, agent_id, attempt, status, worker_id) values ($1, 'marcus', 1, $2, $3) returning id`, [t, status, worker])).rows[0].id as string;
      runs.push({ run, worker, task: t });
    }
    return { mission: m, runs };
  }
  const wrap = (kind: string, p: Promise<unknown>): Promise<Out> => p.then((value) => ({ kind, ok: true, value }), (e: Error) => ({ kind, ok: false, error: e.message }));
  const reserve = (c: pg.Client, x: { run: string; worker: string }, est: number, fetches: number, searches: number) =>
    wrap("reserve", c.query(`select public.reserve_budget($1, $2, 'claude-sonnet-5-5', $3, $4, 240, $5) as r`, [x.run, x.worker, est, searches, fetches]).then((r) => r.rows[0].r));
  const record = (c: pg.Client, x: { run: string; worker: string }, res: string, claudeUsd: number, attempts: number, errors: number, searches = 0) =>
    wrap("record", c.query(
      `select public.record_call($1, $2, $3, '{}'::jsonb, 'claude-sonnet-5-5', 10, 10, 0, 0, $4, $5, $6, 'working'::agent_status, $7, $8) as r`,
      [x.run, x.worker, res, searches, claudeUsd, searches * 0.01, attempts, errors]).then((r) => r.rows[0].r));
  const stopSec = (c: pg.Client, x: { run: string }) => wrap("stop", c.query(`select public.stop_mission_security($1, 'prueba combinada')`, [x.run]));
  const release = (c: pg.Client, x: { run: string }, res: string) => wrap("release", c.query(`select public.close_reservation($1, $2, false)`, [x.run, res]));

  // Errores aceptables (no son fallos del sistema): lease perdido tras la parada y
  // reservas ya cerradas por la parada. Cualquier otro error (interbloqueo incluido) es fallo.
  const ACCEPTED = /lease perdido|ya no tiene el control|La reserva ya está cerrada/;
  async function invariants(label: string, mission: string, outs: Out[], expectStopped: boolean, recordsOk: number) {
    const problems: string[] = [];
    for (const o of outs) if (!o.ok && !ACCEPTED.test(o.error ?? "")) problems.push(`${o.kind}: ${o.error}`);
    const q = async <T,>(sql: string) => (await admin.query(sql, [mission])).rows as T[];
    const [lim] = await q<{ fetch_used: number; search_used: number; calls: number; open: number }>(`
      select (select coalesce(sum(web_fetch_attempts), 0) from public.ai_usage u join public.tasks x on x.id = u.task_id where x.id = $1 or x.parent_task_id = $1)
           + (select coalesce(sum(fetches), 0) from public.ai_reservations where mission_id = $1 and status in ('open', 'uncertain')) as fetch_used,
             (select coalesce(sum(server_tool_requests), 0) from public.ai_usage u join public.tasks x on x.id = u.task_id where x.id = $1 or x.parent_task_id = $1)
           + (select coalesce(sum(searches), 0) from public.ai_reservations where mission_id = $1 and status in ('open', 'uncertain')) as search_used,
             (select count(*) from public.ai_reservations where mission_id = $1 and status <> 'released') as calls,
             (select count(*) from public.ai_reservations where mission_id = $1 and status = 'open') as open`);
    const wl = (await admin.query(`select value from public.settings where key = 'web_limits'`)).rows[0].value;
    // Los intentos reales registrados pueden superar lo reservado solo por lo que informe la API (aquí 1 por reserva).
    if (Number(lim.search_used) > 15) problems.push(`búsquedas ${lim.search_used} > 15`);
    if (Number(lim.calls) > wl.max_mission_calls) problems.push(`llamadas ${lim.calls} > ${wl.max_mission_calls}`);
    const usage = Number((await q<{ n: number }>(`select count(*) n from public.ai_usage u join public.tasks x on x.id = u.task_id where x.id = $1 or x.parent_task_id = $1`))[0].n);
    if (usage !== recordsOk) problems.push(`registros de consumo ${usage} ≠ llamadas registradas con éxito ${recordsOk}`);
    if (expectStopped) {
      const live = Number((await q<{ n: number }>(`select count(*) n from public.agent_runs ar join public.tasks x on x.id = ar.task_id where (x.id = $1 or x.parent_task_id = $1) and ar.status in ('running', 'waiting_approval')`))[0].n);
      const notFailed = Number((await q<{ n: number }>(`select count(*) n from public.tasks where (id = $1 or parent_task_id = $1) and status not in ('failed', 'completed')`))[0].n);
      if (live) problems.push(`${live} ejecuciones siguen vivas tras la parada`);
      if (notFailed) problems.push(`${notFailed} tareas siguen activas tras la parada`);
      if (Number(lim.open)) problems.push(`${lim.open} reservas abiertas tras la parada`);
      // Una misión detenida no continúa: ninguna reserva nueva se concede.
      const x = (await admin.query(`select id run, worker_id worker from public.agent_runs ar where ar.task_id in (select id from public.tasks where parent_task_id = $1) limit 1`, [mission])).rows[0];
      if (x) {
        const r = await reserve(pool[0], { run: x.run, worker: x.worker }, 0.01, 0, 0);
        if (r.ok && (r.value as { ok: boolean }).ok) problems.push("se concedió una reserva tras la parada");
      }
    }
    return { problems, lim };
  }

  const scenarios: { name: string; run: () => Promise<string[]> }[] = [
    {
      // E1 · Sobrecoste simultáneo con reservas en curso.
      name: "E1 · parada por sobrecoste + reservas simultáneas",
      run: async () => {
        const { mission, runs } = await setup('{"max_fetches": 15, "max_mission_calls": 60, "max_web_errors": 3}', N);
        const half = N / 2;
        const res = await Promise.all(runs.slice(0, half).map((x, i) => reserve(pool[i], x, 0.01, 1, 1)));
        const outs = await Promise.all([
          ...runs.slice(0, half).map((x, i) => record(pool[i], x, (res[i].value as { reservation_id: string }).reservation_id, i % 2 === 0 ? 0.05 : 0.001, 1, 0, 1)),
          ...runs.slice(half).map((x, i) => reserve(pool[half + i], x, 0.01, 1, 1)),
        ]);
        const ok = outs.filter((o) => o.kind === "record" && o.ok).length;
        return (await invariants("E1", mission, outs, true, ok)).problems;
      },
    },
    {
      // E2 · Sobrecoste + errores web (umbral) + parada de seguridad + reservas, a la vez.
      name: "E2 · sobrecoste + errores web + parada de seguridad + reservas",
      run: async () => {
        const { mission, runs } = await setup('{"max_fetches": 15, "max_mission_calls": 60, "max_web_errors": 3}', N);
        const k = 8;
        const res = await Promise.all(runs.slice(0, k).map((x, i) => reserve(pool[i], x, 0.01, 1, 1)));
        const rid = (i: number) => (res[i].value as { reservation_id: string }).reservation_id;
        const outs = await Promise.all([
          record(pool[0], runs[0], rid(0), 0.05, 1, 0, 1),            // sobrecoste
          record(pool[1], runs[1], rid(1), 0.001, 1, 2, 1),           // errores web
          record(pool[2], runs[2], rid(2), 0.001, 1, 2, 1),           // errores web (cruza el umbral)
          record(pool[3], runs[3], rid(3), 0.05, 1, 1, 1),            // sobrecoste + error
          record(pool[4], runs[4], rid(4), 0.001, 1, 0, 1),           // normal
          record(pool[5], runs[5], rid(5), 0.001, 1, 0, 1),           // normal
          stopSec(pool[6], runs[6]),                                   // parada de seguridad del motor
          release(pool[7], runs[7], rid(7)),                           // reintento: reserva liberada
          ...runs.slice(k).map((x, i) => reserve(pool[k + i], x, 0.01, 1, 1)),
        ]);
        const ok = outs.filter((o) => o.kind === "record" && o.ok).length;
        return (await invariants("E2", mission, outs, true, ok)).problems;
      },
    },
    {
      // E3 · Resultados inciertos: reservas abiertas sin registrar (proceso cortado) + parada concurrente.
      name: "E3 · reservas inciertas + parada concurrente",
      run: async () => {
        const { mission, runs } = await setup('{"max_fetches": 4, "max_mission_calls": 60, "max_web_errors": 3}', N);
        await Promise.all(runs.slice(0, 4).map((x, i) => reserve(pool[i], x, 0.01, 1, 1))); // 4 abiertas = procesos cortados
        const outs = await Promise.all([
          stopSec(pool[4], runs[4]),
          ...runs.slice(5).map((x, i) => reserve(pool[5 + i], x, 0.01, 1, 1)),
        ]);
        const problems = (await invariants("E3", mission, outs, true, 0)).problems;
        const unc = Number((await admin.query(`select count(*) n from public.ai_reservations where mission_id = $1 and status = 'uncertain'`, [mission])).rows[0].n);
        if (unc < 4) problems.push(`solo ${unc} reservas inciertas (esperado ≥ 4: las abiertas cuentan como consumidas)`);
        const [c] = (await admin.query(`select public.committed_usd('mission', $1) v`, [mission])).rows;
        if (Number(c.v) < 0.04 - 1e-9) problems.push(`comprometido ${c.v} < 0,04: las inciertas no cuentan como gastadas`);
        return problems;
      },
    },
    {
      // E4 · Reintentos: reservas que se liberan y se vuelven a pedir a la vez; el límite de lecturas se cumple.
      name: "E4 · reintentos (liberar y volver a reservar) sin superar límites",
      run: async () => {
        const { mission, runs } = await setup('{"max_fetches": 5, "max_mission_calls": 8, "max_web_errors": 3}', N);
        const first = await Promise.all(runs.map((x, i) => reserve(pool[i], x, 0.01, 1, 1)));
        const outs: Out[] = [...first];
        const rel = await Promise.all(runs.map((x, i) => {
          const v = first[i].value as { ok: boolean; reservation_id?: string };
          return v?.ok ? release(pool[i], x, v.reservation_id!) : Promise.resolve({ kind: "release", ok: true } as Out);
        }));
        const again = await Promise.all(runs.map((x, i) => reserve(pool[i], x, 0.01, 1, 1)));
        outs.push(...rel, ...again);
        const granted = again.reduce((n, o) => n + ((o.value as { ok: boolean; fetches?: number })?.ok ? (o.value as { fetches: number }).fetches : 0), 0);
        const { problems, lim } = await invariants("E4", mission, outs, false, 0);
        if (granted > 5) problems.push(`lecturas concedidas ${granted} > 5`);
        if (Number(lim.fetch_used) > 5) problems.push(`lecturas comprometidas ${lim.fetch_used} > 5`);
        return problems;
      },
    },
    {
      // E5 · Llamadas en espera (waiting_approval) y parada por sobrecoste: se cancelan también.
      name: "E5 · llamadas en espera de aprobación + sobrecoste",
      run: async () => {
        const { mission, runs } = await setup('{"max_fetches": 15, "max_mission_calls": 60, "max_web_errors": 3}', N, 4);
        const active = runs.slice(4);
        const res = await Promise.all(active.slice(0, 4).map((x, i) => reserve(pool[i], x, 0.01, 0, 0)));
        const outs = await Promise.all([
          ...active.slice(0, 4).map((x, i) => record(pool[i], x, (res[i].value as { reservation_id: string }).reservation_id, i === 0 ? 0.05 : 0.001, 0, 0)),
          ...active.slice(4).map((x, i) => reserve(pool[4 + i], x, 0.01, 0, 0)),
        ]);
        const ok = outs.filter((o) => o.kind === "record" && o.ok).length;
        return (await invariants("E5", mission, outs, true, ok)).problems;
      },
    },
    {
      // E6 · Paradas repetidas y simultáneas (idempotencia): sobrecoste x3 + seguridad x3.
      name: "E6 · paradas simultáneas repetidas (idempotencia)",
      run: async () => {
        const { mission, runs } = await setup('{"max_fetches": 15, "max_mission_calls": 60, "max_web_errors": 3}', N);
        const res = await Promise.all(runs.slice(0, 3).map((x, i) => reserve(pool[i], x, 0.01, 0, 0)));
        const outs = await Promise.all([
          ...runs.slice(0, 3).map((x, i) => record(pool[i], x, (res[i].value as { reservation_id: string }).reservation_id, 0.05, 0, 0)),
          ...runs.slice(3, 6).map((x, i) => stopSec(pool[3 + i], x)),
          ...runs.slice(6).map((x, i) => reserve(pool[6 + i], x, 0.01, 0, 0)),
        ]);
        const ok = outs.filter((o) => o.kind === "record" && o.ok).length;
        const problems = (await invariants("E6", mission, outs, true, ok)).problems;
        const cancelled = Number((await admin.query(`select count(*) n from public.task_events e join public.tasks x on x.id = e.task_id where (x.id = $1 or x.parent_task_id = $1) and e.type = 'cancelled'`, [mission])).rows[0].n);
        if (cancelled > N + 1) problems.push(`eventos de cancelación duplicados: ${cancelled} para ${N + 1} tareas`);
        return problems;
      },
    },
  ];

  for (const s of scenarios) {
    const all: string[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const p = await s.run();
      all.push(...p.map((x) => `r${round}: ${x}`));
    }
    const unique = [...new Set(all.map((x) => x.replace(/^r\d+: /, "")))];
    check(s.name, all.length === 0, all.length ? `${all.length} problemas en ${ROUNDS} rondas: ${unique.slice(0, 3).join(" | ")}` : `${ROUNDS} rondas sin problemas`);
  }
} catch (error) {
  check("Z · ejecución", false, (error as Error).message);
} finally {
  for (const c of clients) await c.end().catch(() => {});
  await server.stop().catch(() => {});
  rmSync(base, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\nRESULTADO: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
