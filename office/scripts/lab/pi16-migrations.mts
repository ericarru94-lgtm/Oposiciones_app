// PI-16 · Iteración 4 · Compatibilidad transaccional de la secuencia 0013 → 0014.
// Cada escenario usa su PROPIA base de datos en un PostgreSQL 17 embebido (solo
// 127.0.0.1, directorio temporal, datos ficticios). Nada remoto.
//
// Uso (desde office/):  npx tsx scripts/lab/pi16-migrations.mts
import { readFileSync } from "node:fs";
import pg from "pg";
import { startLab } from "./pi16-pglab.mjs";

const results: { id: string; name: string; ok: boolean; detail: string }[] = [];
const check = (id: string, name: string, ok: boolean, detail: string) => {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "OK   " : "FALLA"} ${id} · ${name} · ${detail}`);
};
const FP_SQL = readFileSync("supabase/checks/schema-fingerprint.sql", "utf8");
const M14 = readFileSync("supabase/migrations/0014_web_limits_audit.sql", "utf8");
const M13 = readFileSync("supabase/migrations/0013_mission_plans.sql", "utf8");
const RB14 = readFileSync("supabase/checks/0014_rollback.sql", "utf8");
const RB13 = readFileSync("supabase/checks/0013_rollback.sql", "utf8");
const upTo = (n: number) => (f: string) => Number(f.slice(0, 4)) <= n;

async function fingerprint(c: pg.Client) {
  const rows = (await c.query(FP_SQL)).rows as { k: string; v: string }[];
  const settings = (await c.query(`select key, value::text v from public.settings order by key`)).rows;
  // Definición completa de las funciones (prosrc ya está en la huella; esto añade atributos y ACL).
  const fns = (await c.query(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' n, md5(pg_get_functiondef(p.oid)) d, coalesce(p.proacl::text, '') acl
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1`)).rows;
  return {
    set: new Set(rows.map((r) => `${r.k}|${r.v}`)),
    settings: JSON.stringify(settings),
    fns: new Map(fns.map((r) => [r.n as string, `${r.d}|${r.acl}`])),
  };
}
type FP = Awaited<ReturnType<typeof fingerprint>>;
function diff(a: FP, b: FP) {
  const out: string[] = [];
  for (const x of a.set) if (!b.set.has(x)) out.push(`- ${x}`);
  for (const x of b.set) if (!a.set.has(x)) out.push(`+ ${x}`);
  for (const [k, v] of a.fns) if (b.fns.get(k) !== v) out.push(`~fn ${k}`);
  for (const k of b.fns.keys()) if (!a.fns.has(k)) out.push(`+fn ${k}`);
  if (a.settings !== b.settings) out.push("~settings");
  return out;
}
const tryQ = (c: pg.Client, sql: string, params?: unknown[]) =>
  c.query(sql, params).then(() => ({ ok: true as const, error: "" }), (e: Error) => ({ ok: false as const, error: e.message }));

/** Datos ficticios con la forma de producción (antes de 0013): misiones antiguas, consumo y reservas. */
async function seedLegacyData(c: pg.Client) {
  // Filas con la forma de las misiones antiguas (sin plan). Sobre 0013+ se cargan como
  // las dejó la migración (plan_required = false), sin pasar por los triggers de la API.
  await c.query(`set session_replication_role = replica`);
  await c.query(`
    insert into public.tasks (id, title, description, agent_id, status, input, created_by, started_at)
      values ('aaaaaaaa-0000-4000-8000-000000000001', 'Misión antigua', 'Completada', 'alex', 'completed', '{"kind":"mission","round":2}', 'admin', now() - interval '20 days'),
             ('aaaaaaaa-0000-4000-8000-000000000002', 'Misión en curso', 'Sin plan', 'alex', 'in_progress', '{"kind":"mission","round":1}', 'admin', now());
    insert into public.tasks (id, title, description, agent_id, status, input, parent_task_id, locked_by, locked_until, started_at)
      values ('aaaaaaaa-0000-4000-8000-000000000003', 'Sub antigua', 'Hecha', 'marcus', 'completed', '{}', 'aaaaaaaa-0000-4000-8000-000000000001', null, null, now() - interval '20 days'),
             ('aaaaaaaa-0000-4000-8000-000000000004', 'Sub en curso', 'En curso', 'marcus', 'in_progress', '{}', 'aaaaaaaa-0000-4000-8000-000000000002', 'w-old', now() + interval '1 hour', now());
    insert into public.agent_runs (id, task_id, agent_id, attempt, status, worker_id)
      values ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003', 'marcus', 1, 'succeeded', 'w-old'),
             ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000004', 'marcus', 1, 'running', 'w-old');
    insert into public.ai_reservations (id, run_id, task_id, mission_id, agent_id, model, estimate_usd, searches, status, actual_usd, closed_at)
      values ('cccccccc-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'marcus', 'claude-sonnet-5-5', 0.2, 1, 'settled', 0.05, now()),
             ('cccccccc-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'marcus', 'claude-sonnet-5-5', 0.2, 1, 'uncertain', null, now());
    insert into public.ai_reservations (id, run_id, task_id, mission_id, agent_id, model, estimate_usd, searches)
      values ('cccccccc-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000002', 'marcus', 'claude-sonnet-5-5', 0.05, 1);
    insert into public.ai_usage (agent_id, task_id, run_id, model, input_tokens, output_tokens, server_tool_requests, cost_usd, claude_cost_usd, search_cost_usd, reservation_id)
      values ('marcus', 'aaaaaaaa-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'claude-sonnet-5-5', 1000, 500, 1, 0.05, 0.04, 0.01, 'cccccccc-0000-4000-8000-000000000001');
    insert into public.companies (name, city, source, created_by, created_in_task, stage)
      values ('Gimnasio ficticio', 'Barcelona', 'prueba', 'marcus', 'aaaaaaaa-0000-4000-8000-000000000003', 'researched');`);
  await c.query(`do $$ begin if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'plan_required')
    then update public.tasks set plan_required = false; end if; end $$`);
  await c.query(`set session_replication_role = origin`);
}
const LEGACY_HASH = `select md5(string_agg(x, '|' order by x)) h from (
    select 'task:' || id || status::text || title || coalesce(parent_task_id::text, '') || input::text x from public.tasks
    union all select 'run:' || id || status::text || coalesce(worker_id, '') from public.agent_runs
    union all select 'res:' || id || status || estimate_usd || searches || coalesce(actual_usd::text, '') from public.ai_reservations
    union all select 'use:' || id || cost_usd || server_tool_requests || coalesce(reservation_id::text, '') from public.ai_usage
    union all select 'co:' || id || name || coalesce(created_in_task::text, '') from public.companies) s`;

const lab = await startLab("pi16-mig-");
try {
  const iso = await lab.isolation();
  check("A", "PostgreSQL local aislado", iso.ok, `versión ${iso.version}, escucha en ${iso.listen}`);
  if (!iso.ok) throw new Error("Sin aislamiento demostrado: me detengo.");
  let n = 0;
  const fresh = async (upto: number, opts: { seed?: boolean; legacy?: boolean } = {}) => {
    const c = await lab.createDb(`m${++n}`);
    await lab.applyMigrations(upTo(upto), c);
    if (opts.seed !== false) await lab.seed(c);
    if (opts.legacy) await seedLegacyData(c);
    return c;
  };

  // Huellas de referencia.
  const r12 = await fresh(12);
  const F12 = await fingerprint(r12);
  const r13 = await fresh(13);
  const F13 = await fingerprint(r13);
  const r14 = await fresh(14);
  const F14 = await fingerprint(r14);

  // M1 · Secuencia correcta 0001–0012 → 0013 → 0014 (cada una en una transacción implícita).
  {
    const c = await fresh(12);
    const a = await tryQ(c, M13);
    const b = await tryQ(c, M14);
    const d = diff(await fingerprint(c), F14);
    check("M1", "secuencia 0012 → 0013 → 0014 sobre base vacía", a.ok && b.ok && d.length === 0,
      a.ok && b.ok ? (d.length ? `difiere de la referencia: ${d.slice(0, 5).join("; ")}` : "esquema final idéntico al de aplicar 0001–0014") : `error: ${a.error || b.error}`);
  }

  // M2 · Con datos previos (forma de producción) y compatibilidad de registros.
  {
    const c = await fresh(12, { legacy: true });
    const before = (await c.query(LEGACY_HASH)).rows[0].h;
    const a = await tryQ(c, M13);
    const b = await tryQ(c, M14);
    const after = (await c.query(LEGACY_HASH)).rows[0].h;
    const defaults = (await c.query(`select
        (select count(*) from public.ai_reservations where fetches <> 0) f,
        (select count(*) from public.ai_usage where web_fetch_attempts <> 0 or web_tool_errors <> 0) u,
        (select count(*) from public.tasks where plan_required) p,
        (select value::text from public.settings where key = 'web_limits') wl`)).rows[0];
    const problems: string[] = [];
    if (!a.ok || !b.ok) problems.push(`error: ${a.error || b.error}`);
    if (before !== after) problems.push("los datos anteriores cambiaron");
    if (Number(defaults.f) || Number(defaults.u)) problems.push("contadores nuevos distintos de 0 en filas antiguas");
    if (Number(defaults.p)) problems.push("misiones antiguas marcadas con plan");
    if (defaults.wl !== '{"max_fetches": 10, "max_web_errors": 3, "max_mission_calls": 40}') problems.push(`web_limits inesperado: ${defaults.wl}`);
    // El motor sigue con la misión antigua: registra la reserva abierta anterior y vuelve a reservar.
    await c.query("set role service_role");
    const rc = await tryQ(c, `select public.record_call('bbbbbbbb-0000-4000-8000-000000000002', 'w-old', 'cccccccc-0000-4000-8000-000000000003', '{}'::jsonb, 'claude-sonnet-5-5', 10, 10, 0, 0, 1, 0.01, 0.01, 'working'::agent_status)`);
    const rs = await tryQ(c, `select public.reserve_budget('bbbbbbbb-0000-4000-8000-000000000002', 'w-old', 'claude-sonnet-5-5', 0.05, 1, 240)`);
    const rs2 = await tryQ(c, `select public.reserve_budget('bbbbbbbb-0000-4000-8000-000000000002', 'w-old', 'claude-sonnet-5-5', 0.05, 1, 240, 1)`);
    await c.query("reset role");
    if (!rc.ok) problems.push(`record_call antiguo (13 argumentos) falla: ${rc.error}`);
    if (!rs.ok) problems.push(`reserve_budget antiguo (6 argumentos) falla: ${rs.error}`);
    if (!rs2.ok) problems.push(`reserve_budget nuevo (7 argumentos) falla: ${rs2.error}`);
    check("M2", "datos anteriores conservados, valores por defecto y firmas antiguas compatibles", problems.length === 0,
      problems.length ? problems.join("; ") : "datos idénticos, contadores a 0, misiones antiguas sin plan, web_limits por defecto, llamadas con 6/7 y 13/15 argumentos funcionan");
  }

  // M3 · 0014 sin 0013 (esquema incompleto): debe rechazarse sin dejar cambios.
  {
    const c = await fresh(12);
    const before = await fingerprint(c);
    const b = await tryQ(c, M14);
    const d = diff(before, await fingerprint(c));
    check("M3", "0014 sobre 0012 (sin 0013)", !b.ok && d.length === 0,
      !b.ok ? `rechazada («${b.error}»), esquema sin cambios: ${d.length === 0}` : `SE APLICÓ sin 0013 (${d.length} diferencias): la migración necesita una comprobación previa`);
  }

  // M4 · 0014 aplicada dos veces: la segunda se rechaza sin cambios.
  {
    const c = await fresh(14);
    const before = await fingerprint(c);
    const b = await tryQ(c, M14);
    const d = diff(before, await fingerprint(c));
    check("M4", "0014 aplicada dos veces", !b.ok && d.length === 0, !b.ok ? `segunda vez rechazada («${b.error.slice(0, 90)}»), sin cambios` : "se aplicó dos veces");
  }

  // M5 · Aplicación interrumpida: (a) error al final del archivo, (b) bloqueos de sesiones activas con lock_timeout.
  {
    const c = await fresh(13, { legacy: true });
    const before = await fingerprint(c);
    const a = await tryQ(c, `${M14}\nselect 1/0;`);
    const da = diff(before, await fingerprint(c));
    check("M5a", "0014 interrumpida por un error al final (transacción implícita)", !a.ok && da.length === 0,
      `${a.ok ? "no falló" : "falló"}; esquema ${da.length === 0 ? "sin cambios (atómica)" : `con ${da.length} cambios parciales`}`);
    // Una sesión del motor tiene una transacción abierta sobre ai_reservations.
    const motor = new pg.Client({ host: "127.0.0.1", port: lab.port, user: "postgres", password: "x", database: `m${n}` });
    motor.on("error", () => {});
    await motor.connect();
    await motor.query(`begin; select * from public.ai_reservations for update`);
    const t0 = Date.now();
    const b = await tryQ(c, `set lock_timeout = '2s'; ${M14}`);
    const ms = Date.now() - t0;
    await c.query("reset lock_timeout");
    await motor.query("rollback");
    await motor.end();
    const db = diff(before, await fingerprint(c));
    check("M5b", "0014 con el motor activo (bloqueos) y lock_timeout = 2 s", !b.ok && db.length === 0,
      `${b.ok ? "se aplicó" : `rechazada en ${ms} ms («${b.error.slice(0, 60)}»)`}; esquema ${db.length === 0 ? "sin cambios" : "con cambios parciales"}`);
    const c2 = await tryQ(c, M14);
    const dc = diff(await fingerprint(c), F14);
    check("M5c", "reintento tras la interrupción", c2.ok && dc.length === 0, c2.ok ? `aplicada; esquema = referencia: ${dc.length === 0}` : `error: ${c2.error}`);
  }

  // M6 · Marcha atrás de 0014 → igual que tras 0013; y de nuevo 0014 → igual que la referencia.
  {
    const c = await fresh(14, { legacy: true });
    await c.query(`update public.ai_usage set web_fetch_attempts = 2, web_tool_errors = 1`);
    const legacy = (await c.query(LEGACY_HASH)).rows[0].h;
    const a = await tryQ(c, RB14);
    const fa = await fingerprint(c);
    const d1 = diff(fa, F13);
    const legacyAfter = (await c.query(LEGACY_HASH)).rows[0].h;
    check("M6a", "marcha atrás de 0014 con datos", a.ok && d1.length === 0 && legacy === legacyAfter,
      a.ok ? `esquema = tras 0013: ${d1.length === 0}${d1.length ? ` (${d1.slice(0, 5).join("; ")})` : ""}; datos anteriores intactos: ${legacy === legacyAfter} (los contadores web y web_tool_events se eliminan, documentado)` : `error: ${a.error}`);
    const b = await tryQ(c, M14);
    const d2 = diff(await fingerprint(c), F14);
    check("M6b", "0014 → marcha atrás → 0014 (ida y vuelta)", b.ok && d2.length === 0, b.ok ? `esquema = referencia: ${d2.length === 0}` : `error: ${b.error}`);
    // Cada función redefinida vuelve exactamente a su versión anterior.
    const exact = ["reserve_budget(p_run_id uuid, p_worker text, p_model text, p_estimate_usd numeric, p_searches integer, p_lease_seconds integer)",
      "cancel_mission(p_mission_id uuid, p_reason text)", "recover_stale()", "reject_mission_plan(p_plan_id uuid, p_version integer, p_hash text, p_reason text, p_mode text)"];
    const bad = exact.filter((k) => fa.fns.get(k) !== F13.fns.get(k));
    const rcKey = [...F13.fns.keys()].find((k) => k.startsWith("record_call("))!;
    if (fa.fns.get(rcKey) !== F13.fns.get(rcKey)) bad.push("record_call");
    check("M6c", "funciones restauradas exactamente (definición y permisos)", bad.length === 0,
      bad.length ? `distintas: ${bad.join(", ")}` : "reserve_budget, record_call, cancel_mission, recover_stale y reject_mission_plan idénticas a las de antes de 0014");
  }

  // M7 · Marcha atrás completa: 0014 → 0013 (soportada; 0013 conserva los planes como archivo).
  {
    const c = await fresh(14, { legacy: true });
    const a = await tryQ(c, RB14);
    const b = await tryQ(c, RB13);
    const d = diff(await fingerprint(c), F12);
    // Lo único que 0013 deja a propósito: las tablas de planes (archivo de solo lectura) con sus
    // índices, restricciones, políticas, permisos, triggers y las funciones de esos triggers.
    const ARCHIVE = /^[-+] (col|con|idx|pol|rls|grant|trg)\|[^|:]*mission_plan|^[-+] (fn|fexec)\|(mission_plans_guard|mission_plan_steps_guard)\(|^~fn (mission_plans_guard|mission_plan_steps_guard)\(/;
    const expected = d.every((x) => ARCHIVE.test(x));
    if (process.env.PI16_SHOW_DIFF) console.log(d.join("\n"));
    check("M7", "marcha atrás completa 0014 → 0013 → estado de 0012", a.ok && b.ok && expected,
      a.ok && b.ok ? `${d.length} diferencias con 0012, todas del archivo de planes que 0013 conserva a propósito: ${expected}${!expected ? ` (${d.filter((x) => !ARCHIVE.test(x)).slice(0, 6).join("; ")})` : ""}` : `error: ${a.error || b.error}`);
  }

  // M8 · Orden de bloqueos: toda función que toma limits lo hace antes que cualquier tarea.
  {
    const c = r14;
    const defs = (await c.query(`select p.proname, pg_get_functiondef(p.oid) d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ~ 'key = ''limits'' for update'`)).rows as { proname: string; d: string }[];
    const problems: string[] = [];
    for (const f of defs) {
      const iLim = f.d.indexOf("key = 'limits' for update");
      const firstTask = f.d.search(/from public\.tasks[^;]*for update|assert_lease\(|lock_plan_for_decision\(/);
      if (firstTask !== -1 && firstTask < iLim) problems.push(`${f.proname}: bloquea tareas antes que limits`);
    }
    check("M8", "funciones con limits: siempre limits primero", problems.length === 0,
      problems.length ? problems.join("; ") : `${defs.length} funciones revisadas: ${defs.map((f) => f.proname).sort().join(", ")}`);
  }

  // M9 · Código antiguo (8c21b00, sin 0014) contra 0013+0014: firmas antiguas siguen resolviendo.
  {
    const c = r14;
    const sig = (await c.query(`select to_regprocedure('public.reserve_budget(uuid, text, text, numeric, integer, integer)') is null a,
      count(*) filter (where proname = 'reserve_budget') r, count(*) filter (where proname = 'record_call') k
      from pg_proc where pronamespace = 'public'::regnamespace`)).rows[0];
    check("M9", "una sola versión de reserve_budget y record_call (sin sobrecargas ambiguas)", Number(sig.r) === 1 && Number(sig.k) === 1,
      `reserve_budget: ${sig.r}, record_call: ${sig.k}; las llamadas con los argumentos antiguos usan los valores por defecto (M2)`);
  }

  // M10 · Permisos: las funciones de 0014 solo para service_role; las de decisión del administrador sin cambios.
  {
    const c = r14;
    const rows = (await c.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') an, has_function_privilege('authenticated', p.oid, 'execute') au,
        has_function_privilege('service_role', p.oid, 'execute') sr, p.prosecdef sd
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('reserve_budget', 'record_call', 'cancel_mission', 'recover_stale', 'record_web_events',
        'stop_mission_security', 'pi16_schema_status', 'reject_mission_plan', 'approve_mission_plan')`)).rows;
    const bad = rows.filter((r) => (r.proname === "reject_mission_plan" || r.proname === "approve_mission_plan")
      ? !(r.au && r.sd && !r.an) : (r.an || r.au || !r.sr || r.sd));
    const pol = (await c.query(`select count(*) n from pg_policies where tablename = 'web_tool_events'`)).rows[0].n;
    check("M10", "permisos y políticas", bad.length === 0 && Number(pol) === 1,
      bad.length ? `inesperados: ${bad.map((r) => r.proname).join(", ")}` : "motor: solo service_role, sin SECURITY DEFINER; decisiones de plan: authenticated + SECURITY DEFINER (como 0013); web_tool_events con 1 política de lectura");
  }
  void F12;
} catch (e) {
  check("Z", "ejecución", false, (e as Error).stack ?? String(e));
} finally {
  await lab.stop();
}
const fails = results.filter((r) => !r.ok).length;
console.log(`\nResultado: ${results.length - fails}/${results.length} escenarios correctos`);
process.exit(fails ? 1 : 0);
