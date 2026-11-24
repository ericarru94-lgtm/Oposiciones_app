// PI-16 · Iteración 4 · Rendimiento y contención de la fila «limits».
// PostgreSQL 17 embebido (solo 127.0.0.1, datos ficticios). Mide, por carga y número
// de conexiones: operaciones/s, latencia (media, p50, p95, p99), espera por bloqueos
// (muestreo de pg_stat_activity), errores e interbloqueos. Cada operación es una
// llamada autocommit a una función: su latencia ≈ duración de la transacción.
//
// Uso (desde office/):  npx tsx scripts/lab/pi16-bench.mts [segundos] [repeticiones] [conexiones,...]
import { writeFileSync } from "node:fs";
import pg from "pg";
import { startLab } from "./pi16-pglab.mjs";

const SECS = Number(process.argv[2] ?? 3);
const REPS = Number(process.argv[3] ?? 3);
const CONNS = (process.argv[4] ?? "1,4,8,12,20,30").split(",").map(Number);
const OUT = process.argv[5] ?? "";

type Ctx = { c: pg.Client; w: string; mission: string; task: string; run: string; i: number; rotate: boolean };
type Load = { id: string; name: string; op: (x: Ctx) => Promise<void> };

const lab = await startLab("pi16-bench-", ["-c", "shared_buffers=128MB"]);
const rows: Record<string, unknown>[] = [];
try {
  const iso = await lab.isolation();
  console.log(`PostgreSQL ${iso.version}, escucha en ${iso.listen}, aislado: ${iso.ok}`);
  if (!iso.ok) throw new Error("Sin aislamiento demostrado: me detengo.");
  const admin = lab.admin;
  await lab.applyMigrations();
  await lab.seed();
  // Presupuesto amplio dentro de los techos para que la carga no se corte por saldo.
  await admin.query(`update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 1, "mission_ai_budget_usd": 1}' where key = 'limits';
    update public.settings set value = '{"max_fetches": 15, "max_mission_calls": 60, "max_web_errors": 10}' where key = 'web_limits';`);

  const max = Math.max(...CONNS);
  const pool: pg.Client[] = [];
  for (let i = 0; i < max; i++) {
    const c = await lab.connect();
    await c.query("set role service_role; set statement_timeout = '30s'");
    pool.push(c);
  }
  const monitor = await lab.connect();

  async function newMission(x: Ctx) {
    // Misión nueva para esta conexión (no se cronometra): los límites por misión
    // (60 llamadas, 15 búsquedas, 15 lecturas) obligan a rotar.
    const m = (await x.c.query(`insert into public.tasks (title, description, agent_id, status, input, created_by, plan_required, started_at, timeout_seconds)
      values ('Bench', 'Carga ficticia', 'alex', 'in_progress', '{"kind": "mission"}', 'admin', false, now(), 86400) returning id`)).rows[0].id;
    const t = (await x.c.query(`insert into public.tasks (title, description, agent_id, status, input, parent_task_id, plan_required, locked_by, locked_until, started_at, timeout_seconds)
      values ('Sub', 'Carga ficticia', 'marcus', 'in_progress', '{}', $1, false, $2, now() + interval '1 hour', now(), 86400) returning id`, [m, x.w])).rows[0].id;
    const r = (await x.c.query(`insert into public.agent_runs (task_id, agent_id, attempt, status, worker_id) values ($1, 'marcus', 1, 'running', $2) returning id`, [t, x.w])).rows[0].id;
    x.mission = m; x.task = t; x.run = r;
  }
  async function reserve(x: Ctx, searches = 0, fetches = 0): Promise<string | null> {
    const r = (await x.c.query(`select public.reserve_budget($1, $2, 'claude-haiku-5-5', 0.0001, $3, 240, $4) r`, [x.run, x.w, searches, fetches])).rows[0].r;
    if (!r.ok) return null;
    // Igual que el motor: si se conceden menos búsquedas o lecturas de las pedidas, no se llama.
    if ((r.searches ?? 0) < searches || (r.fetches ?? 0) < fetches) {
      await x.c.query(`select public.close_reservation($1, $2, false)`, [x.run, r.reservation_id]);
      return null;
    }
    return r.reservation_id;
  }
  const record = (x: Ctx, res: string, searches = 0, attempts = 0, errors = 0) =>
    x.c.query(`select public.record_call($1, $2, $3, '{}'::jsonb, 'claude-haiku-5-5', 10, 10, 0, 0, $4, 0.00005, 0, 'working'::agent_status, $5, $6)`,
      [x.run, x.w, res, searches, attempts, errors]);

  const ALL: Load[] = [
    { id: "normal", name: "operaciones normales (save_run_state + heartbeat, sin limits)", op: async (x) => {
      if (x.i % 2) await x.c.query(`select public.save_run_state($1, $2, '{"k": 1}'::jsonb, false)`, [x.run, x.w]);
      else await x.c.query(`select public.heartbeat_run($1, $2, 240)`, [x.run, x.w]);
    } },
    { id: "reserve", name: "reservas concurrentes (reserve_budget + liberar)", op: async (x) => {
      const r = await reserve(x);
      if (!r) { x.rotate = true; return; }
      await x.c.query(`select public.close_reservation($1, $2, false)`, [x.run, r]);
    } },
    { id: "web", name: "búsquedas y lecturas (reserva con 1+1 y registro)", op: async (x) => {
      const r = await reserve(x, 1, 1);
      if (!r) { x.rotate = true; return; }
      await record(x, r, 1, 1, 0);
    } },
    { id: "errors", name: "errores web (registro con 1 error; umbral 10 por misión)", op: async (x) => {
      const r = await reserve(x);
      if (!r) { x.rotate = true; return; }
      const out = (await record(x, r, 0, 0, 1)).rows[0];
      void out;
      if (x.i % 8 === 7) x.rotate = true; // antes de superar el umbral de 10
    } },
    { id: "cancel", name: "cancelaciones (cancel_mission de misiones con 1 subtarea)", op: async (x) => {
      await x.c.query(`select public.cancel_mission($1, 'Bench')`, [x.mission]);
      x.rotate = true;
    } },
    { id: "mixed", name: "carga mixta (50 % reserva+registro, 20 % save, 10 % heartbeat, 10 % eventos web, 5 % parada, 5 % recover_stale)", op: async (x) => {
      const k = x.i % 20;
      if (k < 10) {
        const r = await reserve(x, k % 3 === 0 ? 1 : 0, 0);
        if (!r) { x.rotate = true; return; }
        await record(x, r, k % 3 === 0 ? 1 : 0);
      } else if (k < 14) await x.c.query(`select public.save_run_state($1, $2, '{"k": 1}'::jsonb, false)`, [x.run, x.w]);
      else if (k < 16) await x.c.query(`select public.heartbeat_run($1, $2, 240)`, [x.run, x.w]);
      else if (k < 18) await x.c.query(`select public.record_web_events($1, $2, '[]'::jsonb)`, [x.run, x.w]).catch(() => {});
      else if (k === 18) { await x.c.query(`select public.cancel_mission($1, 'Bench')`, [x.mission]); x.rotate = true; }
      else await x.c.query(`select public.recover_stale()`);
    } },
  ];

  const only = (process.env.PI16_LOADS ?? "").split(",").filter(Boolean);
  const loads = only.length ? ALL.filter((l) => only.includes(l.id)) : ALL;
  const pct = (a: number[], p: number) => a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0;
  for (let rep = 1; rep <= REPS; rep++) {
    for (const load of loads) {
      for (const n of CONNS) {
        // Limpieza entre mediciones.
        await admin.query(`set session_replication_role = replica;
          delete from public.ai_reservations; delete from public.ai_usage; delete from public.agent_runs; delete from public.task_events;
          delete from public.web_tool_events; delete from public.activity_log; delete from public.tasks;
          set session_replication_role = origin; update public.agents set status = 'available', current_task_id = null;`);
        const ctxs: Ctx[] = [];
        for (let i = 0; i < n; i++) {
          const x: Ctx = { c: pool[i], w: `b${i}`, mission: "", task: "", run: "", i: 0, rotate: false };
          await newMission(x);
          ctxs.push(x);
        }
        const lat: number[] = [];
        let errors = 0, deadlocks = 0;
        const errSamples = new Set<string>();
        let lockSamples = 0, samples = 0, waiting = 0;
        let stop = false;
        const mon = (async () => {
          while (!stop) {
            const r = (await monitor.query(`select count(*) filter (where wait_event_type = 'Lock') l from pg_stat_activity where backend_type = 'client backend' and state = 'active' and pid <> pg_backend_pid()`)).rows[0];
            samples++; waiting += Number(r.l); if (Number(r.l) > 0) lockSamples++;
            await new Promise((res) => setTimeout(res, 5));
          }
        })();
        const end = Date.now() + SECS * 1000;
        await Promise.all(ctxs.map(async (x) => {
          while (Date.now() < end) {
            const t0 = performance.now();
            try { await load.op(x); if (!x.rotate) lat.push(performance.now() - t0); }
            catch (e) {
              const m = (e as Error).message;
              errors++; if (/deadlock/.test(m)) deadlocks++;
              errSamples.add(m.slice(0, 80));
              x.rotate = true;
            }
            x.i++;
            // Rotación de misión (límites por misión o parada): no se cronometra. En las
            // cargas «cancel» y mixta la parada sí cuenta, con su propia medición.
            if (x.rotate) { if (load.id === "cancel" || load.id === "mixed") lat.push(performance.now() - t0); x.rotate = false; await newMission(x); }
          }
        }));
        stop = true; await mon;
        lat.sort((a, b) => a - b);
        const mean = lat.reduce((s, v) => s + v, 0) / Math.max(1, lat.length);
        const row = { rep, load: load.id, conns: n, ops: lat.length, ops_s: +(lat.length / SECS).toFixed(1), mean_ms: +mean.toFixed(2),
          p50: +pct(lat, 50).toFixed(2), p95: +pct(lat, 95).toFixed(2), p99: +pct(lat, 99).toFixed(2),
          lock_wait_pct: +((100 * lockSamples) / Math.max(1, samples)).toFixed(1), avg_waiting: +(waiting / Math.max(1, samples)).toFixed(2),
          errors, deadlocks, err: [...errSamples].join(" / ") };
        rows.push(row);
        console.log(JSON.stringify(row));
      }
    }
  }
} finally {
  await lab.stop();
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows, null, 1));
process.exit(0);
