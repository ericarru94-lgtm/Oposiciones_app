// PI-16 · Iteración 4 · Batería de CONCURRENCIA CRUZADA con PostgreSQL 17 real.
// Combina las funciones que bloquean tareas, reservas, ejecuciones y límites:
// save_run_state, heartbeat_run, reserve_budget, record_call, cancel_mission,
// stop_mission_security, recover_stale, claim_next_task, close_reservation,
// await_subtasks, approve/reject_mission_plan y el alta de empresas (trigger de cuota).
//
// Para forzar los entrelazados peligrosos de forma DETERMINISTA se instalan, SOLO
// en esta base de datos temporal, triggers de laboratorio que duermen unos ms en
// un punto concreto cuando la sesión lo pide (GUC pi16lab.<punto>). No forman parte
// de ninguna migración. Cada ronda alterna el orden de los identificadores
// (subtarea < misión y misión < subtarea), porque los ciclos dependen de él.
//
// Aislamiento: PostgreSQL embebido, solo 127.0.0.1, directorio temporal, datos
// ficticios, sin variables de entorno ni red externa.
//
// Uso (desde office/):  npx tsx scripts/lab/pi16-cross.mts [rondas] [filtro]
import pg from "pg";
import { startLab } from "./pi16-pglab.mjs";
import { SqlEngineStore } from "../../src/lib/engine/store-sql";

const ROUNDS = Number(process.argv[2] ?? 6);
const FILTER = process.argv[3] ?? "";
const ADMIN = "11111111-1111-1111-1111-111111111111";
const N = 12;
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "OK   " : "FALLA"} ${name} · ${detail}`);
};

type Out = { kind: string; ok: boolean; value?: unknown; error?: string };
const wrap = (kind: string, p: Promise<unknown>): Promise<Out> =>
  p.then((value) => ({ kind, ok: true, value }), (e: Error) => ({ kind, ok: false, error: e.message }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
// uuid con el primer dígito elegido: "0" ordena antes que "f".
const uid = (first: "0" | "f") => `${first}${hex(7)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;

const lab = await startLab("pi16-cross-");
try {
  const iso = await lab.isolation();
  check("A · PostgreSQL local aislado", iso.ok, `versión ${iso.version}, escucha en ${iso.listen}`);
  if (!iso.ok) throw new Error("Sin aislamiento demostrado: me detengo.");
  const admin = lab.admin;
  await lab.applyMigrations();
  await lab.seed();
  await admin.query(`
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@hesignal.test');
    insert into public.admins (user_id, email) values ('${ADMIN}', 'admin@hesignal.test');
    -- Triggers SOLO de laboratorio: retardo opcional por sesión (pi16lab.<punto>, segundos).
    create function public.zz_lab_sleep() returns trigger language plpgsql as $$
    begin
      perform pg_sleep(coalesce(nullif(current_setting('pi16lab.' || tg_argv[0], true), ''), '0')::float8);
      return case when tg_op = 'DELETE' then old else new end;
    end $$;
    grant execute on function public.zz_lab_sleep() to service_role, authenticated;
    create trigger zz_lab_companies before insert on public.companies for each row execute function public.zz_lab_sleep('companies');
    create trigger zz_lab_runs after update on public.agent_runs for each row execute function public.zz_lab_sleep('runs');
    create trigger zz_lab_deps before insert on public.task_dependencies for each row execute function public.zz_lab_sleep('deps');
    create trigger zz_lab_plans after update on public.mission_plans for each row execute function public.zz_lab_sleep('plans');
    create trigger zz_lab_tasksb before update on public.tasks for each row execute function public.zz_lab_sleep('tasksb');
    create trigger zz_lab_resv after update on public.ai_reservations for each row execute function public.zz_lab_sleep('resv');`);

  const pool: pg.Client[] = [];
  for (let i = 0; i < N + 12; i++) {
    const c = await lab.connect();
    await c.query("set role service_role; set statement_timeout = '20s'");
    pool.push(c);
  }
  // Conexiones con retardo fijo en un punto (una por punto y uso).
  const delayed = new Map<string, pg.Client>();
  async function slow(point: string, secs: number, role = "service_role") {
    const key = `${point}:${secs}:${role}`;
    let c = delayed.get(key);
    if (!c) {
      c = await lab.connect();
      await c.query(`set role ${role}; set statement_timeout = '20s'; set pi16lab.${point} = '${secs}'`);
      if (role === "authenticated") await c.query(`select set_config('request.jwt.claim.sub', '${ADMIN}', false)`);
      delayed.set(key, c);
    }
    return c;
  }
  const adminConn = await lab.connect();
  await adminConn.query(`set role authenticated; set statement_timeout = '20s'; select set_config('request.jwt.claim.sub', '${ADMIN}', false)`);
  const store = new SqlEngineStore(async (sql, params) => (await pool[N].query(sql, params as unknown[])).rows);

  async function clean() {
    await admin.query(`set session_replication_role = replica;
      delete from public.mission_plan_steps; delete from public.mission_plans; delete from public.task_dependencies;
      delete from public.approvals; delete from public.companies; delete from public.ai_reservations; delete from public.ai_usage;
      delete from public.agent_runs; delete from public.task_events; delete from public.tasks;
      set session_replication_role = origin;
      update public.agents set status = 'available', current_task_id = null;
      update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 1, "mission_ai_budget_usd": 1}' where key = 'limits';
      update public.settings set value = '{"max_fetches": 15, "max_mission_calls": 60, "max_web_errors": 3}' where key = 'web_limits';`);
  }

  type Sub = { run: string; worker: string; task: string };
  /** Misión sin plan (las subtareas se insertan directamente, como hace el motor de pruebas). */
  async function setup(n: number, childFirst: boolean, opts: { waiting?: number; status?: string; agents?: string[]; alexRun?: boolean } = {}) {
    await clean();
    const mFirst = childFirst ? "f" : "0";
    const cFirst = childFirst ? "0" : "f";
    const mission = uid(mFirst);
    await admin.query(`insert into public.tasks (id, title, description, agent_id, status, input, created_by, plan_required, locked_by, locked_until, started_at)
      values ($1, 'Misión cruzada', 'Prueba con datos ficticios', 'alex', 'in_progress', '{"kind": "mission", "round": 1}', 'admin', false,
              ${opts.alexRun ? "'alex-w', now() + interval '1 hour'" : "null, null"}, now())`, [mission]);
    let alex: Sub | null = null;
    if (opts.alexRun) {
      const run = (await admin.query(`insert into public.agent_runs (task_id, agent_id, attempt, status, worker_id) values ($1, 'alex', 1, 'running', 'alex-w') returning id`, [mission])).rows[0].id;
      alex = { run, worker: "alex-w", task: mission };
    }
    const subs: Sub[] = [];
    for (let i = 0; i < n; i++) {
      const worker = `w${i}`;
      const task = uid(cFirst);
      const waiting = i < (opts.waiting ?? 0);
      const agent = opts.agents?.[i % opts.agents.length] ?? (i % 2 ? "sofia" : "marcus");
      await admin.query(`insert into public.tasks (id, title, description, agent_id, status, input, parent_task_id, plan_required, locked_by, locked_until, started_at)
        values ($1, $2, 'Subtarea ficticia', $3, $4, '{}', $5, false, $6, $7, now())`,
        [task, `Sub ${i}`, agent, opts.status ?? (waiting ? "needs_approval" : "in_progress"), mission, waiting ? null : worker, waiting ? null : new Date(Date.now() + 3600e3)]);
      const run = (await admin.query(`insert into public.agent_runs (task_id, agent_id, attempt, status, worker_id) values ($1, $2, 1, $3, $4) returning id`,
        [task, agent, waiting ? "waiting_approval" : "running", worker])).rows[0].id as string;
      subs.push({ run, worker, task });
    }
    return { mission, subs, alex };
  }

  // ── Operaciones ──
  const reserve = (c: pg.Client, x: Sub, est = 0.01, searches = 0, fetches = 0) =>
    wrap("reserve", c.query(`select public.reserve_budget($1, $2, 'claude-sonnet-5-5', $3, $4, 240, $5) as r`, [x.run, x.worker, est, searches, fetches]).then((r) => r.rows[0].r));
  const record = (c: pg.Client, x: Sub, res: string, usd: number, errors = 0, searches = 0, attempts = 0) =>
    wrap("record", c.query(
      `select public.record_call($1, $2, $3, '{}'::jsonb, 'claude-sonnet-5-5', 10, 10, 0, 0, $4, $5, $6, 'working'::agent_status, $7, $8) as r`,
      [x.run, x.worker, res, searches, usd, searches * 0.01, attempts, errors]).then((r) => r.rows[0].r));
  const saveState = (c: pg.Client, x: Sub, release = false) =>
    wrap("save", c.query(`select public.save_run_state($1, $2, '{"k": 1}'::jsonb, $3)`, [x.run, x.worker, release]));
  const heartbeat = (c: pg.Client, x: Sub) => wrap("heartbeat", c.query(`select public.heartbeat_run($1, $2, 240)`, [x.run, x.worker]));
  const cancel = (c: pg.Client, mission: string) => wrap("cancel", c.query(`select public.cancel_mission($1, 'Parada de prueba')`, [mission]));
  const stopSec = (c: pg.Client, x: Sub) => wrap("stop", c.query(`select public.stop_mission_security($1, 'prueba cruzada')`, [x.run]));
  const release = (c: pg.Client, x: Sub, res: string) => wrap("release", c.query(`select public.close_reservation($1, $2, false)`, [x.run, res]));
  const company = (c: pg.Client, x: Sub, name: string) => wrap("company", c.query(
    `insert into public.companies (name, city, source, created_by, created_in_task, stage) values ($1, 'Barcelona', 'prueba', 'marcus', $2, 'researched') returning id`, [name, x.task]));
  const recover = (c: pg.Client) => wrap("recover", c.query(`select public.recover_stale()`));
  const claim = (c: pg.Client, w: string) => wrap("claim", c.query(`select * from public.claim_next_task($1, 240, 50)`, [w]).then((r) => r.rows[0] ?? null));
  const awaitSubs = (c: pg.Client, x: Sub) => wrap("await", c.query(`select public.await_subtasks($1, $2, 'Esperando al equipo')`, [x.run, x.worker]));
  const resId = (o: Out) => (o.value as { reservation_id?: string } | undefined)?.reservation_id;

  // Errores esperables (no son fallos del sistema): pérdida de lease tras la parada,
  // reserva ya cerrada, alta de empresa rechazada por cuota y decisiones de plan ya tomadas.
  const ACCEPTED = /lease perdido|ya no tiene el control|La reserva ya está cerrada|máximo de \d+ empresas|ya no está pendiente|no está esperando la aprobación|No hay subtareas pendientes/;

  async function invariants(mission: string, outs: Out[], o: { stopped: boolean; extraRecords?: number }) {
    const problems: string[] = [];
    for (const x of outs) if (!x.ok && !ACCEPTED.test(x.error ?? "")) problems.push(`${x.kind}: ${x.error}`);
    const q = async <T,>(sql: string) => (await admin.query(sql, [mission])).rows as T[];
    const fam = `(select id from public.tasks where id = $1 or parent_task_id = $1)`;
    const [lim] = await q<{ search_used: string; fetch_used: string; calls: string; open: string; dup: string; usage: string }>(`
      select (select coalesce(sum(server_tool_requests), 0) from public.ai_usage where task_id in ${fam})
           + (select coalesce(sum(searches), 0) from public.ai_reservations where mission_id = $1 and status in ('open', 'uncertain')) search_used,
             (select coalesce(sum(web_fetch_attempts), 0) from public.ai_usage where task_id in ${fam})
           + (select coalesce(sum(fetches), 0) from public.ai_reservations where mission_id = $1 and status in ('open', 'uncertain')) fetch_used,
             (select count(*) from public.ai_reservations where mission_id = $1 and status <> 'released') calls,
             (select count(*) from public.ai_reservations where mission_id = $1 and status = 'open') open,
             (select count(*) from (select reservation_id from public.ai_usage where task_id in ${fam} group by 1 having count(*) > 1) d) dup,
             (select count(*) from public.ai_usage where task_id in ${fam}) usage`);
    if (Number(lim.search_used) > 15) problems.push(`búsquedas ${lim.search_used} > 15`);
    if (Number(lim.fetch_used) > 15) problems.push(`lecturas ${lim.fetch_used} > 15`);
    if (Number(lim.calls) > 60) problems.push(`llamadas ${lim.calls} > 60`);
    if (Number(lim.dup)) problems.push(`${lim.dup} reservas con consumo duplicado`);
    const okRecords = outs.filter((x) => x.kind === "record" && x.ok).length + (o.extraRecords ?? 0);
    if (Number(lim.usage) !== okRecords) problems.push(`consumo registrado ${lim.usage} ≠ llamadas registradas con éxito ${okRecords}`);
    // Coherencia: una ejecución viva exige tarea en curso con lease del mismo trabajador.
    const [incoh] = await q<{ n: string }>(`select count(*) n from public.agent_runs ar join public.tasks t on t.id = ar.task_id
      where t.id in ${fam} and ar.status = 'running' and (t.status <> 'in_progress' or t.locked_by is distinct from ar.worker_id)`);
    if (Number(incoh.n)) problems.push(`${incoh.n} ejecuciones 'running' con la tarea incoherente`);
    if (o.stopped) {
      const [s] = await q<{ live: string; active: string; ev: string; dupev: string }>(`
        select (select count(*) from public.agent_runs where task_id in ${fam} and status in ('running', 'waiting_approval')) live,
               (select count(*) from public.tasks where id in ${fam} and status not in ('failed', 'completed')) active,
               (select count(*) from public.tasks where id = $1 and status = 'failed') ev,
               (select count(*) from (select task_id from public.task_events where task_id in ${fam} and type = 'cancelled' group by 1 having count(*) > 1) d) dupev`);
      if (Number(s.live)) problems.push(`${s.live} ejecuciones vivas tras la parada`);
      if (Number(s.active)) problems.push(`${s.active} tareas activas tras la parada`);
      if (Number(s.ev) !== 1) problems.push("la misión no quedó detenida");
      if (Number(s.dupev)) problems.push(`${s.dupev} tareas canceladas dos veces`);
      if (Number(lim.open)) problems.push(`${lim.open} reservas abiertas tras la parada`);
      // Ninguna tarea continúa: ni reservas nuevas ni reclamaciones de sus tareas.
      const x = (await admin.query(`select ar.id run, ar.worker_id worker, ar.task_id task from public.agent_runs ar where ar.task_id in (select id from public.tasks where parent_task_id = $1) limit 1`, [mission])).rows[0];
      if (x) {
        const r = await reserve(pool[0], x, 0.01);
        if (r.ok && (r.value as { ok: boolean }).ok) problems.push("se concedió una reserva tras la parada");
        const h = await heartbeat(pool[0], x);
        if (h.ok) problems.push("heartbeat aceptado tras la parada");
      }
      const cl = await claim(pool[0], "late");
      const ct = cl.value as { task_id?: string } | null;
      if (ct?.task_id) {
        const fromMission = (await admin.query(`select 1 from public.tasks where id = $1 and (id = $2 or parent_task_id = $2)`, [ct.task_id, mission])).rowCount;
        if (fromMission) problems.push("se reclamó una tarea de la misión detenida");
      }
    }
    return problems;
  }

  const scenarios: { id: string; name: string; run: (childFirst: boolean) => Promise<string[]> }[] = [
    {
      id: "X1", name: "save_run_state mientras se cancela la misión",
      run: async (cf) => {
        const { mission, subs } = await setup(N, cf);
        const s1 = await slow("runs", 0.15);
        const outs = await Promise.all([
          ...subs.map((x, i) => (i === 0 ? saveState(s1, x) : saveState(pool[i], x))),
          (async () => { await sleep(30); return cancel(pool[N + 1], mission); })(),
          ...subs.slice(1, 6).map((x, i) => (async () => { await sleep(10 + i * 15); return saveState(pool[N + 2 + i], x, i % 2 === 0); })()),
        ]);
        return invariants(mission, outs, { stopped: true });
      },
    },
    {
      id: "X2", name: "heartbeat_run mientras se cancela la misión",
      run: async (cf) => {
        const { mission, subs } = await setup(N, cf);
        const s1 = await slow("runs", 0.15);
        const outs = await Promise.all([
          ...subs.map((x, i) => (i === 0 ? heartbeat(s1, x) : heartbeat(pool[i], x))),
          (async () => { await sleep(30); return cancel(pool[N + 1], mission); })(),
          (async () => { await sleep(5); return stopSec(pool[N + 2], subs[3]); })(),
        ]);
        return invariants(mission, outs, { stopped: true });
      },
    },
    {
      id: "X3", name: "save_run_state + heartbeat + record_call simultáneos en la MISMA ejecución",
      run: async (cf) => {
        const { mission, subs } = await setup(4, cf);
        const outs: Out[] = [];
        for (const x of subs) {
          const r = await reserve(pool[0], x, 0.05);
          outs.push(r);
          const sRec = await slow("runs", 0.2);
          // record_call duerme tras actualizar su ejecución; heartbeat y save_run_state llegan entretanto.
          outs.push(...await Promise.all([
            record(sRec, x, resId(r)!, 0.001),
            (async () => { await sleep(50); return heartbeat(pool[1], x); })(),
            (async () => { await sleep(60); return saveState(pool[2], x); })(),
            (async () => { await sleep(70); return heartbeat(pool[3], x); })(),
          ]));
        }
        return invariants(mission, outs, { stopped: false });
      },
    },
    {
      id: "X4", name: "reservas de presupuesto durante cancelaciones",
      run: async (cf) => {
        const { mission, subs } = await setup(N, cf);
        const sRes = await slow("resv", 0.1);
        const pre = await Promise.all(subs.slice(0, 4).map((x, i) => reserve(pool[i], x, 0.01, 1, 1)));
        const outs = await Promise.all([
          ...subs.map((x, i) => reserve(pool[i], x, 0.02, 1, 1)),
          (async () => { await sleep(5); return cancel(sRes, mission); })(),
          (async () => { await sleep(8); return cancel(pool[N + 1], mission); })(),
        ]);
        return invariants(mission, [...pre, ...outs], { stopped: true });
      },
    },
    {
      id: "X5", name: "registro de consumo con sobrecoste mientras Marcus da de alta una empresa",
      run: async (cf) => {
        const { mission, subs } = await setup(4, cf, { agents: ["marcus", "sofia"] });
        const r = await reserve(pool[0], subs[1], 0.01);
        const sComp = await slow("companies", 0.3);
        const outs = await Promise.all([
          company(sComp, subs[0], `Gimnasio ${hex(4)}`),
          (async () => { await sleep(80); return record(pool[1], subs[1], resId(r)!, 0.05); })(),
          (async () => { await sleep(90); return saveState(pool[2], subs[2]); })(),
        ]);
        return invariants(mission, [r, ...outs], { stopped: true });
      },
    },
    {
      id: "X6", name: "errores web simultáneos a la parada de seguridad",
      run: async (cf) => {
        const { mission, subs } = await setup(N, cf);
        const res = await Promise.all(subs.slice(0, 8).map((x, i) => reserve(pool[i], x, 0.05, 1, 1)));
        const sRuns = await slow("runs", 0.1);
        const outs = await Promise.all([
          ...subs.slice(0, 8).map((x, i) => record(i === 0 ? sRuns : pool[i], x, resId(res[i])!, 0.001, 1, 1, 1)),
          stopSec(pool[8], subs[9]),
          (async () => { await sleep(15); return stopSec(pool[9], subs[10]); })(),
          ...subs.slice(8).map((x, i) => saveState(pool[10 + (i % 2)], x)),
        ]);
        return invariants(mission, [...res, ...outs], { stopped: true });
      },
    },
    {
      id: "X7", name: "reintentos (liberar y volver a reservar, registrar dos veces) durante una cancelación",
      run: async (cf) => {
        const { mission, subs } = await setup(8, cf);
        const res = await Promise.all(subs.map((x, i) => reserve(pool[i], x, 0.01)));
        const outs = await Promise.all([
          ...subs.slice(0, 4).map(async (x, i) => {
            const a = await release(pool[i], x, resId(res[i])!);
            const b = await reserve(pool[i], x, 0.01);
            return [a, b];
          }),
          ...subs.slice(4).map(async (x, i) => {
            // El motor reintenta el registro tras un error de red: la segunda vez no duplica.
            const a = await record(pool[4 + i], x, resId(res[4 + i])!, 0.001);
            const b = await record(pool[4 + i], x, resId(res[4 + i])!, 0.001);
            return [a, b];
          }),
          (async () => { await sleep(3); return [await cancel(pool[N + 1], mission)]; })(),
        ]);
        return invariants(mission, [...res, ...outs.flat()], { stopped: true });
      },
    },
    {
      id: "X8", name: "ejecuciones esperando aprobación: recover_stale (aprobaciones caducadas) mientras se cancela",
      run: async (cf) => {
        const { mission, subs } = await setup(6, cf, { waiting: 6 });
        for (const x of subs) {
          // Aprobación ya caducada (solo laboratorio: se salta el trigger que exige caducidad futura).
          await admin.query(`set session_replication_role = replica`);
          await admin.query(`insert into public.approvals (task_id, agent_id, tool_id, risk, summary, run_id, tool_use_id, args_hash, expires_at)
            select $1, ar.agent_id, 'crm.write', 'medium', 'Prueba', ar.id, 'tu-' || ar.id, 'h', now() - interval '1 minute' from public.agent_runs ar where ar.id = $2`, [x.task, x.run]);
          await admin.query(`set session_replication_role = origin`);
        }
        // recover_stale bloquea las ejecuciones y después las tareas: duerme justo antes de la primera tarea.
        const sRec = await slow("tasksb", 0.25);
        const outs = await Promise.all([
          recover(sRec),
          (async () => { await sleep(60); return cancel(pool[1], mission); })(),
          (async () => { await sleep(70); return recover(pool[2]); })(),
        ]);
        return invariants(mission, outs, { stopped: true });
      },
    },
    {
      id: "X9", name: "reservas abiertas e inciertas + registro de inciertas + cancelación",
      run: async (cf) => {
        const { mission, subs } = await setup(8, cf);
        const res = await Promise.all(subs.map((x, i) => reserve(pool[i], x, 0.01)));
        // Mitad inciertas (resultado desconocido de la API); el motor puede registrarlas después.
        await Promise.all(subs.slice(0, 4).map((x, i) => pool[i].query(`select public.close_reservation($1, $2, true)`, [x.run, resId(res[i])])));
        const outs = await Promise.all([
          ...subs.slice(0, 4).map((x, i) => record(pool[i], x, resId(res[i])!, 0.001)),
          cancel(pool[N + 1], mission),
          ...subs.slice(4).map((x, i) => record(pool[4 + i], x, resId(res[4 + i])!, 0.001)),
        ]);
        const problems = await invariants(mission, [...res, ...outs], { stopped: true });
        const reopened = (await admin.query(`select count(*) n from public.ai_reservations where mission_id = $1 and status = 'open'`, [mission])).rows[0].n;
        if (Number(reopened)) problems.push(`${reopened} reservas reabiertas`);
        return problems;
      },
    },
    {
      id: "X10", name: "cancelaciones repetidas (admin, sobrecoste y seguridad a la vez)",
      run: async (cf) => {
        const { mission, subs } = await setup(N, cf);
        const res = await Promise.all(subs.slice(0, 3).map((x, i) => reserve(pool[i], x, 0.01)));
        const outs = await Promise.all([
          cancel(pool[3], mission), cancel(pool[4], mission), cancel(pool[5], mission),
          stopSec(pool[6], subs[5]), stopSec(pool[7], subs[6]), stopSec(pool[8], subs[7]),
          ...subs.slice(0, 3).map((x, i) => record(pool[9 + i], x, resId(res[i])!, 0.05)),
        ]);
        return invariants(mission, [...res, ...outs], { stopped: true });
      },
    },
    {
      id: "X11", name: "decisiones de plan simultáneas (aprobar × rechazar) y rechazo × sobrecoste",
      run: async (cf) => {
        await clean();
        const mid = uid(cf ? "f" : "0");
        await pool[N].query(`insert into public.tasks (id, title, description, agent_id, status, input, created_by, timeout_seconds)
          values ($1, 'Estudio', 'Misión con plan (ficticia)', 'alex', 'assigned', '{"kind": "mission", "round": 1, "phase": "planning"}', 'admin', 86400)`, [mid]);
        const run = await store.claim("alex-w", 240, 5);
        const step = (key: string, agent: string, deps: string[]) => ({ key, agent, title: `Paso ${key}`, instructions: "Instrucciones de prueba suficientemente claras.",
          depends_on: deps, tools: agent === "marcus" ? ["web.search", "crm.read"] : ["crm.read"], budget_usd: 0.2, max_calls: 3, max_searches: agent === "marcus" ? 2 : 0 });
        const sub = await store.submitPlan(run!.runId, "alex-w", "Plan de prueba para concurrencia.", [step("a", "marcus", []), step("b", "sofia", ["a"])]);
        await store.awaitPlanApproval(run!.runId, "alex-w", "Plan explicado.");
        // Estado artificial (solo laboratorio): una subtarea ejecutándose mientras el plan está pendiente,
        // para cruzar el rechazo con una parada por sobrecoste.
        const child = uid(cf ? "0" : "f");
        await admin.query(`set session_replication_role = replica;
          insert into public.tasks (id, title, description, agent_id, status, input, parent_task_id, plan_required, locked_by, locked_until, started_at)
            values ('${child}', 'Hijo', 'Subtarea ficticia', 'marcus', 'in_progress', '{}', '${mid}', false, 'wc', now() + interval '1 hour', now());
          set session_replication_role = origin;`);
        const crun = (await admin.query(`insert into public.agent_runs (task_id, agent_id, attempt, status, worker_id) values ($1, 'marcus', 1, 'running', 'wc') returning id`, [child])).rows[0].id;
        const cx: Sub = { run: crun, worker: "wc", task: child };
        const r = await reserve(pool[0], cx, 0.01);
        const sRej = await slow("plans", 0.25, "authenticated");
        const outs = await Promise.all([
          wrap("reject", sRej.query(`select public.reject_mission_plan($1, $2, $3, 'Rechazo de prueba', 'reject')`, [sub.plan_id, sub.version, sub.plan_hash])),
          (async () => { await sleep(60); return wrap("approve", adminConn.query(`select public.approve_mission_plan($1, $2, $3, null)`, [sub.plan_id, sub.version, sub.plan_hash])); })(),
          (async () => { await sleep(70); return record(pool[1], cx, resId(r)!, 0.05); })(),
        ]);
        const problems = await invariants(mid, [r, ...outs], { stopped: true });
        const decided = outs.filter((o) => (o.kind === "reject" || o.kind === "approve") && o.ok).length;
        if (decided !== 1) problems.push(`${decided} decisiones de plan aplicadas (debe ser exactamente 1)`);
        return problems;
      },
    },
    {
      id: "X12", name: "Alex espera a sus subtareas (await_subtasks) mientras ellas reservan y se cancela",
      run: async (cf) => {
        const { mission, subs, alex } = await setup(6, cf, { alexRun: true });
        const sDeps = await slow("deps", 0.25);
        const outs = await Promise.all([
          awaitSubs(sDeps, alex!),
          ...subs.map((x, i) => (async () => { await sleep(40 + i * 5); return reserve(pool[i], x, 0.01); })()),
          (async () => { await sleep(120); return cancel(pool[N + 1], mission); })(),
        ]);
        return invariants(mission, outs, { stopped: true });
      },
    },
    {
      id: "X13", name: "claim_next_task mientras se cancela",
      run: async (cf) => {
        const { mission, subs } = await setup(8, cf, { status: "assigned" });
        await admin.query(`update public.agent_runs set status = 'failed', finished_at = now() where task_id in (select id from public.tasks where parent_task_id = $1)`, [mission]);
        await admin.query(`update public.tasks set locked_by = null, locked_until = null, started_at = null where parent_task_id = $1`, [mission]);
        void subs;
        const outs = await Promise.all([
          ...Array.from({ length: 6 }, (_, i) => claim(pool[i], `cw${i}`)),
          (async () => { await sleep(2); return cancel(pool[N + 1], mission); })(),
          ...Array.from({ length: 4 }, (_, i) => (async () => { await sleep(4); return claim(pool[6 + i], `cx${i}`); })()),
        ]);
        return invariants(mission, outs, { stopped: true });
      },
    },
    {
      id: "X14", name: "alta de empresas (cuota por misión) mientras se cancela",
      run: async (cf) => {
        const { mission, subs } = await setup(4, cf, { agents: ["marcus"] });
        const sComp = await slow("companies", 0.25);
        const outs = await Promise.all([
          company(sComp, subs[0], `Box ${hex(4)}`),
          ...subs.slice(1).map((x, i) => company(pool[i], x, `Academia ${hex(4)}`)),
          (async () => { await sleep(60); return cancel(pool[N + 1], mission); })(),
          (async () => { await sleep(70); return heartbeat(pool[N + 2], subs[1]); })(),
        ]);
        return invariants(mission, outs, { stopped: true });
      },
    },
    {
      id: "X15", name: "lecturas de más (max_uses no respetado) con reservas y guardados simultáneos",
      run: async (cf) => {
        const { mission, subs } = await setup(8, cf);
        const res = await Promise.all(subs.slice(0, 4).map((x, i) => reserve(pool[i], x, 0.05, 1, 1)));
        const outs = await Promise.all([
          record(pool[0], subs[0], resId(res[0])!, 0.001, 0, 1, 3),
          ...subs.slice(1, 4).map((x, i) => record(pool[1 + i], x, resId(res[1 + i])!, 0.001, 0, 1, 1)),
          ...subs.slice(4).map((x, i) => reserve(pool[4 + i], x, 0.05, 1, 1)),
          ...subs.slice(4).map((x, i) => saveState(pool[8 + i], x)),
        ]);
        const problems = await invariants(mission, [...res, ...outs], { stopped: true });
        const overuse = outs.some((o) => o.kind === "record" && (o.value as { reason?: string } | undefined)?.reason === "web_overuse");
        if (!overuse) problems.push("la lectura de más no detuvo la misión");
        return problems;
      },
    },
  ];

  for (const s of scenarios) {
    if (FILTER && !FILTER.split(",").includes(s.id)) continue;
    const failures: string[] = [];
    const t0 = Date.now();
    for (let r = 0; r < ROUNDS; r++) {
      const cf = r % 2 === 0;
      const p = await s.run(cf);
      for (const x of p) failures.push(`ronda ${r + 1} (${cf ? "subtarea<misión" : "misión<subtarea"}): ${x}`);
    }
    const uniq = [...new Set(failures)];
    check(`${s.id} · ${s.name}`, failures.length === 0,
      failures.length === 0 ? `${ROUNDS} rondas, sin interbloqueos ni incoherencias (${Date.now() - t0} ms)` : `${failures.length} problemas: ${uniq.slice(0, 4).join(" | ")}`);
  }
} catch (e) {
  check("Z · ejecución de la batería", false, (e as Error).stack ?? String(e));
} finally {
  await lab.stop();
}
const fails = results.filter((r) => !r.ok).length;
console.log(`\nResultado: ${results.length - fails}/${results.length} comprobaciones superadas`);
process.exit(fails ? 1 : 0);
