-- HE SIGNAL AI OFFICE · 0014 · PI-16 · Límites web por misión y auditoría de las herramientas web
--
-- ESTADO: EXPERIMENTAL (laboratorio, rama lab/pi-16-alternative-a). NO aplicar en
-- staging ni en producción sin autorización expresa del administrador.
--
-- DEPENDE DE 0013: amplía la reserve_budget de 0013 (límites del paso). En una
-- base sin 0013 esta migración no se aplica.
--
-- Qué hace:
--   1. Cuenta las lecturas web (también las fallidas) y los errores de las
--      herramientas web por llamada (ai_usage) y reserva lecturas (ai_reservations).
--   2. Límites web por misión en la clave settings «web_limits» (validada con
--      techos; solo servidor y migraciones): 10 lecturas (techo 15), 40 llamadas
--      por misión (techo 60) y más de 3 errores web → parada (techo 10).
--   3. reserve_budget: igual que 0013 + llamadas por misión, errores web y
--      lecturas por misión. Nuevo parámetro p_fetches (por defecto 0).
--   4. record_call: igual que 0007 + intentos de lectura y errores web; si los
--      errores de la misión superan el umbral, detiene la misión entera.
--   5. web_tool_events: registro de solo añadir SIN URLs, consultas ni valores de
--      parámetros (dominios, huellas HMAC, longitudes y recuentos).
--   6. stop_mission_security: parada inmediata de la misión por anomalía web.
--
-- Marcha atrás: supabase/checks/0014_rollback.sql (exportar antes los eventos).

-- ═══════════════════════ 0. Comprobaciones previas ═══════════════════════
-- Iteración 4 · Sin esta comprobación, 0014 sobre una base sin 0013 solo fallaba
-- por casualidad (un tipo de 0013 usado en reject_mission_plan) y, aplicada dos
-- veces, por una columna repetida. Ahora el motivo es explícito y la migración
-- entera se deshace (una sola transacción).
do $$
begin
  if to_regclass('public.web_tool_events') is not null
     or exists (select 1 from public.settings where key = 'web_limits') then
    raise exception '0014 ya está aplicada en esta base de datos.';
  end if;
  if to_regclass('public.mission_plans') is null
     or to_regprocedure('public.submit_mission_plan(uuid, text, text, jsonb)') is null
     or to_regprocedure('public.reserve_budget(uuid, text, text, numeric, integer, integer)') is null then
    raise exception '0014 necesita 0013 (plan de misión) aplicada antes.';
  end if;
end $$;

-- ═══════════════════════ 1. Contadores ═══════════════════════
alter table public.ai_reservations
  add column fetches integer not null default 0 check (fetches >= 0);
alter table public.ai_usage
  add column web_fetch_attempts integer not null default 0 check (web_fetch_attempts >= 0),
  add column web_tool_errors integer not null default 0 check (web_tool_errors >= 0);

-- ═══════════════════════ 2. Límites web (settings.web_limits) ═══════════════════════
create function public.web_limits_ceilings() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"max_fetches": 15, "max_mission_calls": 60, "max_web_errors": 10}'::jsonb
$$;

create function public.web_limits_error(p_value jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  c jsonb := public.web_limits_ceilings();
  k text;
  v jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    return 'el valor debe ser un objeto JSON';
  end if;
  if (select array_agg(x order by x) from jsonb_object_keys(p_value) x)
     is distinct from array['max_fetches', 'max_mission_calls', 'max_web_errors'] then
    return 'web_limits debe tener exactamente max_fetches, max_mission_calls y max_web_errors';
  end if;
  foreach k in array array['max_fetches', 'max_mission_calls', 'max_web_errors'] loop
    v := p_value -> k;
    if jsonb_typeof(v) <> 'number' or v::numeric <> trunc(v::numeric) or v::numeric < 0
       or v::numeric > (c ->> k)::numeric then
      return format('web_limits.%s debe ser un entero entre 0 y %s', k, c ->> k);
    end if;
  end loop;
  if (p_value ->> 'max_mission_calls')::integer < 1 then
    return 'web_limits.max_mission_calls debe ser al menos 1';
  end if;
  return null;
end;
$$;

create function public.web_limits_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  err text;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.key = 'web_limits' and (tg_op = 'DELETE' or new.key is distinct from old.key) then
    raise exception 'La clave «web_limits» no se puede borrar ni renombrar.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.key = 'web_limits' then
    err := public.web_limits_error(new.value);
    if err is not null then
      raise exception 'Ajuste no válido: %.', err using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
-- Solo servidor: authenticated no puede modificar web_limits (política de 0012)
-- y el guard solo llama a web_limits_error cuando la clave es web_limits.
revoke all on function public.web_limits_ceilings() from public, anon, authenticated;
grant execute on function public.web_limits_ceilings() to service_role;
revoke all on function public.web_limits_error(jsonb) from public, anon, authenticated;
grant execute on function public.web_limits_error(jsonb) to service_role;
revoke all on function public.web_limits_guard() from public, anon, authenticated, service_role;

create trigger settings_web_limits_guard
  before insert or update or delete on public.settings
  for each row execute function public.web_limits_guard();

insert into public.settings (key, value)
values ('web_limits', '{"max_fetches": 10, "max_mission_calls": 40, "max_web_errors": 3}'::jsonb)
on conflict (key) do nothing;

-- ═══════════════════════ 3. reserve_budget (0013 + PI-16) ═══════════════════════
-- Igual que 0013, más:
--   - llamadas por misión (max_mission_calls)  → motivo mission_calls
--   - errores web de la misión (max_web_errors) → motivo web_errors
--   - lecturas web por misión (max_fetches)     → se conceden como mucho las que quedan
-- Las reservas inciertas cuentan como consumidas (también sus lecturas).
drop function public.reserve_budget(uuid, text, text, numeric, integer, integer);
create function public.reserve_budget(
  p_run_id uuid, p_worker text, p_model text, p_estimate_usd numeric, p_searches integer default 0,
  p_lease_seconds integer default 240, p_fetches integer default 0
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_limits jsonb;
  v_pilot jsonb;
  v_mission uuid;
  v_monthly numeric;
  v_task_limit numeric;
  v_mission_limit numeric;
  v_searches_max integer;
  v_searches_used integer;
  v_task_searches integer;
  v_granted integer;
  v_web jsonb;
  v_fetches_max integer;
  v_fetches_used integer;
  v_fetches_granted integer;
  v_id uuid;
begin
  if p_estimate_usd is null or p_estimate_usd <= 0 or p_searches < 0 or p_fetches is null or p_fetches < 0 then
    raise exception 'Reserva no válida.';
  end if;
  if p_lease_seconds not between 30 and 290 then
    raise exception 'El lease debe estar entre 30 y 290 segundos.';
  end if;
  -- Serializa TODAS las reservas: nadie más comprueba el saldo a la vez.
  -- 0014 · El bloqueo de limits va ANTES del lease (fila de la tarea): orden único
  -- limits → tarea, el mismo que usa record_call al detener una misión por errores
  -- web. Con el orden de 0013 (tarea → limits) había interbloqueos (prueba real C6).
  select value into v_limits from public.settings where key = 'limits' for update;
  -- 0014 (iteración 4) · Después de limits, la MISIÓN y solo entonces la propia
  -- tarea (assert_lease). Orden canónico de tareas: misión → subtareas. Sin él,
  -- await_subtasks (misión → subtareas) y la reserva de una subtarea (subtarea →
  -- misión, por la clave ajena de ai_reservations) se interbloqueaban (prueba X12).
  perform 1 from public.tasks where id = (
    select coalesce(x.parent_task_id, x.id) from public.tasks x join public.agent_runs ar on ar.task_id = x.id where ar.id = p_run_id)
  for update;
  t := public.assert_lease(p_run_id, p_worker);
  select value into v_pilot from public.settings where key = 'pilot';
  select value into v_web from public.settings where key = 'web_limits';
  v_mission := coalesce(t.parent_task_id, t.id);

  if exists (select 1 from public.ai_reservations r where r.run_id = p_run_id and r.status = 'open') then
    update public.ai_reservations set status = 'uncertain', closed_at = now()
     where run_id = p_run_id and status = 'open';
    return jsonb_build_object('ok', false, 'reason', 'uncertain');
  end if;

  v_monthly := nullif(v_limits ->> 'monthly_ai_budget_usd', '')::numeric;
  v_task_limit := nullif(v_limits ->> 'task_ai_budget_usd', '')::numeric;
  v_mission_limit := nullif(v_limits ->> 'mission_ai_budget_usd', '')::numeric;
  -- Las subtareas no pueden comerse la parte reservada al informe del coordinador.
  if v_mission_limit is not null and t.parent_task_id is not null then
    v_mission_limit := v_mission_limit - coalesce((v_pilot ->> 'synthesis_reserve_usd')::numeric, 0);
  end if;

  -- 0013 · El dinero comprometido por los planes aprobados de OTRAS misiones
  -- abiertas no se puede usar (la propia misión gasta de lo suyo).
  if v_monthly is not null and public.committed_usd('month', null) + public.plan_outstanding_usd(v_mission) + p_estimate_usd > v_monthly then
    return jsonb_build_object('ok', false, 'reason', 'monthly_budget');
  end if;
  if v_mission_limit is not null and public.committed_usd('mission', v_mission) + p_estimate_usd > v_mission_limit then
    return jsonb_build_object('ok', false, 'reason', 'mission_budget');
  end if;
  -- 0013 · Presupuesto del paso del plan (nunca mayor que el límite por tarea:
  -- se comprueba antes para dar el motivo más preciso).
  if t.budget_usd is not null and public.committed_usd('task', t.id) + p_estimate_usd > t.budget_usd then
    return jsonb_build_object('ok', false, 'reason', 'step_budget');
  end if;
  if v_task_limit is not null and public.committed_usd('task', t.id) + p_estimate_usd > v_task_limit then
    return jsonb_build_object('ok', false, 'reason', 'task_budget');
  end if;
  if t.max_calls is not null
     and (select count(*) from public.ai_reservations r where r.task_id = t.id and r.status <> 'released') >= t.max_calls then
    return jsonb_build_object('ok', false, 'reason', 'max_calls');
  end if;

  -- 0014 · PI-16 · Llamadas por misión (todas salvo las liberadas: también las inciertas).
  if (select count(*) from public.ai_reservations r where r.mission_id = v_mission and r.status <> 'released')
     >= coalesce((v_web ->> 'max_mission_calls')::integer, 40) then
    return jsonb_build_object('ok', false, 'reason', 'mission_calls');
  end if;
  -- 0014 · PI-16 · Errores de herramientas web de la misión por encima del umbral.
  if (select coalesce(sum(u.web_tool_errors), 0) from public.ai_usage u
       where u.task_id in (select x.id from public.tasks x where x.id = v_mission or x.parent_task_id = v_mission))
     > coalesce((v_web ->> 'max_web_errors')::integer, 3) then
    return jsonb_build_object('ok', false, 'reason', 'web_errors');
  end if;

  v_searches_max := coalesce((v_pilot ->> 'max_searches')::integer, 15);
  select coalesce(sum(u.server_tool_requests), 0) into v_searches_used from public.ai_usage u
   where u.task_id in (select x.id from public.tasks x where x.id = v_mission or x.parent_task_id = v_mission);
  v_searches_used := v_searches_used + coalesce((select sum(r.searches) from public.ai_reservations r
                                                  where r.mission_id = v_mission and r.status in ('open', 'uncertain')), 0);
  v_granted := greatest(0, least(p_searches, v_searches_max - v_searches_used));
  if t.max_searches is not null then
    select coalesce(sum(u.server_tool_requests), 0) into v_task_searches from public.ai_usage u where u.task_id = t.id;
    v_task_searches := v_task_searches + coalesce((select sum(r.searches) from public.ai_reservations r
                                                    where r.task_id = t.id and r.status in ('open', 'uncertain')), 0);
    v_granted := greatest(0, least(v_granted, t.max_searches - v_task_searches));
  end if;

  -- 0014 · PI-16 · Lecturas web por misión: usadas (también fallidas) + reservadas abiertas o inciertas.
  v_fetches_max := coalesce((v_web ->> 'max_fetches')::integer, 10);
  select coalesce(sum(u.web_fetch_attempts), 0) into v_fetches_used from public.ai_usage u
   where u.task_id in (select x.id from public.tasks x where x.id = v_mission or x.parent_task_id = v_mission);
  v_fetches_used := v_fetches_used + coalesce((select sum(r.fetches) from public.ai_reservations r
                                                where r.mission_id = v_mission and r.status in ('open', 'uncertain')), 0);
  v_fetches_granted := greatest(0, least(p_fetches, v_fetches_max - v_fetches_used));

  insert into public.ai_reservations (run_id, task_id, mission_id, agent_id, model, estimate_usd, searches, fetches)
  values (p_run_id, t.id, v_mission, t.agent_id, p_model, p_estimate_usd, v_granted, v_fetches_granted)
  returning id into v_id;
  update public.tasks set locked_until = now() + make_interval(secs => p_lease_seconds), heartbeat_at = now()
   where id = t.id;
  update public.agent_runs set heartbeat_at = now() where id = p_run_id;
  return jsonb_build_object('ok', true, 'reservation_id', v_id, 'searches', v_granted, 'fetches', v_fetches_granted);
end;
$$;

-- ═══════════════════════ 4. record_call (0007 + PI-16) ═══════════════════════
drop function public.record_call(uuid, text, uuid, jsonb, text, bigint, bigint, bigint, bigint, integer, numeric, numeric, public.agent_status);
create function public.record_call(
  p_run_id uuid, p_worker text, p_reservation_id uuid, p_state jsonb, p_model text,
  p_input_tokens bigint, p_output_tokens bigint, p_cache_read_tokens bigint, p_cache_write_tokens bigint,
  p_server_tool_requests integer, p_claude_cost_usd numeric, p_search_cost_usd numeric,
  p_agent_status public.agent_status default 'working',
  p_web_fetch_attempts integer default 0, p_web_tool_errors integer default 0
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  r public.ai_reservations;
  t public.tasks;
  v_cost numeric := p_claude_cost_usd + p_search_cost_usd;
  v_month numeric;
  v_mission numeric;
  v_task numeric;
  v_limits jsonb;
  v_web_errors integer;
begin
  if p_claude_cost_usd < 0 or p_search_cost_usd < 0 or p_input_tokens < 0 or p_output_tokens < 0
     or p_web_fetch_attempts is null or p_web_fetch_attempts < 0 or p_web_tool_errors is null or p_web_tool_errors < 0 then
    raise exception 'Consumo no válido.';
  end if;
  -- 0014 · Orden de bloqueos único: TODAS las llamadas toman primero el mismo
  -- bloqueo global que reserve_budget y cancel_mission (limits). Cualquier
  -- llamada puede detener la misión (sobrecoste de 0007 o errores web de PI-16) y
  -- cancel_mission bloquea tareas, reservas y ejecuciones: sin este orden había
  -- interbloqueos y misiones sin detener (concurrencia real C5, C6 y E1–E6).
  perform 1 from public.settings where key = 'limits' for update;
  -- 0014 (iteración 4) · La misión antes que la reserva, la ejecución y la propia
  -- tarea: esta llamada puede acabar en cancel_mission, que bloquea misión →
  -- subtareas; tomarla ya aquí mantiene el orden canónico en toda la función.
  perform 1 from public.tasks where id = (
    select coalesce(x.parent_task_id, x.id) from public.tasks x join public.agent_runs ar on ar.task_id = x.id where ar.id = p_run_id)
  for update;
  select * into r from public.ai_reservations where id = p_reservation_id and run_id = p_run_id for update;
  if r.id is null then
    raise exception 'Reserva desconocida para esta ejecución.';
  end if;
  if r.status not in ('open', 'uncertain') then
    raise exception 'La reserva ya está cerrada.';
  end if;

  insert into public.ai_usage (agent_id, task_id, run_id, model, input_tokens, output_tokens, cache_read_tokens,
                               cache_write_tokens, server_tool_requests, cost_usd, claude_cost_usd, search_cost_usd, reservation_id,
                               web_fetch_attempts, web_tool_errors)
  values (r.agent_id, r.task_id, p_run_id, p_model, p_input_tokens, p_output_tokens, p_cache_read_tokens,
          p_cache_write_tokens, p_server_tool_requests, v_cost, p_claude_cost_usd, p_search_cost_usd, r.id,
          p_web_fetch_attempts, p_web_tool_errors);
  update public.ai_reservations set status = 'settled', actual_usd = v_cost, closed_at = now() where id = r.id;
  -- Sobrecoste: el coste real superó la reserva (supuesto de tamaño de búsqueda
  -- incumplido). Queda registrado y visible; las siguientes reservas ya lo cuentan.
  if v_cost > r.estimate_usd then
    insert into public.task_events (task_id, agent_id, type, message, data)
    values (r.task_id, r.agent_id, 'cost_overrun',
            'El coste real (' || round(v_cost, 4) || ' $) superó la reserva (' || round(r.estimate_usd, 4) || ' $).',
            jsonb_build_object('reservation_id', r.id, 'estimate_usd', r.estimate_usd, 'actual_usd', v_cost));
  end if;
  update public.agent_runs ar
     set steps = ar.steps + 1, model = p_model, heartbeat_at = now(),
         input_tokens = ar.input_tokens + p_input_tokens,
         output_tokens = ar.output_tokens + p_output_tokens,
         cache_read_tokens = ar.cache_read_tokens + p_cache_read_tokens,
         cache_write_tokens = ar.cache_write_tokens + p_cache_write_tokens,
         server_tool_requests = ar.server_tool_requests + p_server_tool_requests,
         cost_usd = ar.cost_usd + v_cost
   where ar.id = p_run_id;

  -- 0014 (iteración 4) · max_uses lo aplica Anthropic, no el motor. Si una
  -- respuesta trae MÁS intentos de lectura de los reservados para esta llamada, la
  -- API no respetó el límite: el consumo queda registrado (cuenta para los límites
  -- de la misión) y la misión entera se detiene por seguridad. Así el exceso de
  -- lecturas queda acotado a UNA petición. (Las búsquedas de más no detienen: su
  -- coste y el límite de 15 por misión ya las cuentan; decisión pendiente.)
  if p_web_fetch_attempts > r.fetches then
    perform public.cancel_mission(r.mission_id,
      'Detenida por seguridad: la API ejecutó más lecturas web de las reservadas en una llamada ('
      || p_web_fetch_attempts || ' de ' || r.fetches || ').');
    insert into public.activity_log (actor_type, actor_id, action, entity_type, entity_id, details)
    values ('system', r.agent_id, 'security.web_stop', 'task', r.mission_id::text,
            jsonb_build_object('run_id', p_run_id, 'reason', 'web_overuse', 'fetch_attempts', p_web_fetch_attempts, 'fetches_reserved', r.fetches));
    return jsonb_build_object('continue', false, 'reason', 'web_overuse');
  end if;
  -- Política del piloto: un sobrecoste detiene TODA la misión (decisión del
  -- administrador). El gasto ya está registrado; no se hace ninguna llamada más.
  if v_cost > r.estimate_usd
     and coalesce((select (value ->> 'stop_on_cost_overrun')::boolean from public.settings where key = 'pilot'), true) then
    perform public.cancel_mission(r.mission_id,
      'Detenida automáticamente por sobrecoste: una llamada costó ' || round(v_cost, 4) || ' $ y la reserva era de '
      || round(r.estimate_usd, 4) || ' $.');
    return jsonb_build_object('continue', false, 'reason', 'cost_overrun');
  end if;

  -- 0014 · PI-16 · Demasiados errores de herramientas web: se detiene TODA la
  -- misión (el consumo ya está registrado). Mismo patrón que el sobrecoste.
  -- Solo las llamadas con errores pueden cruzar el umbral, y esas están
  -- SERIALIZADAS por el bloqueo de limits tomado al principio: cada una ve,
  -- al sumar, los errores ya confirmados de las demás (sin él, llamadas
  -- simultáneas superaban el umbral sin detener la misión: prueba real C5).
  if p_web_tool_errors > 0 then
    select coalesce(sum(u.web_tool_errors), 0) into v_web_errors from public.ai_usage u
     where u.task_id in (select x.id from public.tasks x where x.id = r.mission_id or x.parent_task_id = r.mission_id);
  else
    v_web_errors := 0;
  end if;
  if p_web_tool_errors > 0 and v_web_errors > coalesce((select (value ->> 'max_web_errors')::integer from public.settings where key = 'web_limits'), 3) then
    perform public.cancel_mission(r.mission_id,
      'Detenida por seguridad: ' || v_web_errors || ' errores de herramientas web en la misión (umbral superado).');
    insert into public.activity_log (actor_type, actor_id, action, entity_type, entity_id, details)
    values ('system', r.agent_id, 'security.web_stop', 'task', r.mission_id::text,
            jsonb_build_object('run_id', p_run_id, 'reason', 'web_errors', 'web_tool_errors', v_web_errors));
    return jsonb_build_object('continue', false, 'reason', 'web_errors');
  end if;

  -- ¿Sigue teniendo la tarea este trabajador?
  select x.* into t from public.tasks x join public.agent_runs ar on ar.task_id = x.id
   where ar.id = p_run_id and ar.status = 'running' for update of x;
  if t.id is null or t.locked_by is distinct from p_worker or t.locked_until < now() then
    return jsonb_build_object('continue', false, 'reason', 'lease_lost');
  end if;
  update public.agent_runs set state = p_state where id = p_run_id;
  update public.tasks set heartbeat_at = now() where id = t.id;
  perform public.set_agent_state(t.agent_id, p_agent_status, t.id, null);

  select value into v_limits from public.settings where key = 'limits';
  v_month := public.committed_usd('month', null);
  v_mission := public.committed_usd('mission', r.mission_id);
  v_task := public.committed_usd('task', t.id);
  return jsonb_build_object('continue', true, 'month_usd', v_month, 'mission_usd', v_mission, 'task_usd', v_task,
    'budget_warning', nullif(v_limits ->> 'monthly_ai_budget_usd', '') is not null
                      and v_month >= 0.8 * (v_limits ->> 'monthly_ai_budget_usd')::numeric);
end;
$$;

-- ═══════════════════════ 4b. cancel_mission (0007 + orden de bloqueos) ═══════════════════════
create or replace function public.cancel_mission(p_mission_id uuid, p_reason text)
returns integer language plpgsql set search_path = '' as $$
declare
  v_n integer;
begin
  -- 0014 · Orden único de bloqueos: limits → misión → subtareas (por id) →
  -- reservas → ejecuciones → agentes (el mismo que reserve_budget, record_call y
  -- recover_stale). Con el orden de 0007 la parada por sobrecoste y la de
  -- seguridad se interbloqueaban con reservas simultáneas (batería E1–E6).
  -- Iteración 4: la misión SIEMPRE antes que sus subtareas (no por id): el alta de
  -- empresas (trigger de cuota: misión → subtarea) y await_subtasks bloquean en
  -- ese orden; con «por id» la parada se interbloqueaba y la misión seguía viva (X5, X14).
  perform 1 from public.settings where key = 'limits' for update;
  perform 1 from public.tasks where id = p_mission_id for update;
  perform 1 from public.tasks where parent_task_id = p_mission_id order by id for update;
  if not exists (select 1 from public.tasks where id = p_mission_id and parent_task_id is null) then
    raise exception 'Misión no encontrada.';
  end if;
  update public.ai_reservations set status = 'uncertain', closed_at = now()
   where mission_id = p_mission_id and status = 'open';
  update public.agent_runs set status = 'cancelled', finished_at = now(), error = left(p_reason, 500)
   where status in ('running', 'waiting_approval')
     and task_id in (select id from public.tasks where id = p_mission_id or parent_task_id = p_mission_id);
  with c as (
    update public.tasks
       set status = 'failed', error = left(p_reason, 500), locked_by = null, locked_until = null
     where (id = p_mission_id or parent_task_id = p_mission_id)
       and status not in ('completed', 'failed')
    returning id, agent_id, status
  ), ev as (
    insert into public.task_events (task_id, agent_id, type, to_status, message)
    select id, agent_id, 'cancelled', 'failed', left(p_reason, 500) from c
    returning task_id
  )
  select count(*) into v_n from ev;
  update public.agents a set status = 'available', current_task_id = null, status_detail = null, status_updated_at = now()
   where a.current_task_id in (select id from public.tasks where id = p_mission_id or parent_task_id = p_mission_id);
  return v_n;
end;
$$;

-- ═══════════════ 4c. recover_stale y reject_mission_plan (iteración 4) ═══════════════
-- Ambas modifican tareas y ejecuciones de varias misiones sin el orden canónico:
-- recover_stale bloqueaba ejecuciones antes que tareas (aprobaciones caducadas) y
-- tareas en cualquier orden (tiempo agotado); reject_mission_plan tomaba plan →
-- misión → limits, al revés que approve_mission_plan y que las reservas. Pruebas
-- reales X8 y X11: interbloqueos, y la parada podía perderse.
create or replace function public.recover_stale()
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_expired integer;
  v_timed_out integer;
begin
  -- Sin trabajo pendiente no se bloquea nada (se llama en cada tick del motor).
  if not exists (select 1 from public.approvals a where a.status = 'pending' and a.expires_at <= now())
     and not exists (select 1 from public.tasks t where t.status in ('in_progress', 'needs_approval')
                       and t.started_at + make_interval(secs => t.timeout_seconds) <= now()) then
    update public.agents a set status = 'available', current_task_id = null, status_updated_at = now()
     where a.current_task_id is not null
       and not exists (select 1 from public.tasks t where t.id = a.current_task_id
                        and t.status in ('in_progress', 'needs_approval'));
    return jsonb_build_object('expired_approvals', 0, 'timed_out_tasks', 0);
  end if;
  -- Orden canónico: limits → (por misión) misión → subtareas → ejecuciones.
  perform 1 from public.settings where key = 'limits' for update;
  perform 1 from public.tasks t
   where t.id in (
     select coalesce(x.parent_task_id, x.id) from public.tasks x
      where x.id in (select ar.task_id from public.agent_runs ar join public.approvals a on a.run_id = ar.id
                      where a.status = 'pending' and a.expires_at <= now())
         or (x.status in ('in_progress', 'needs_approval') and x.started_at + make_interval(secs => x.timeout_seconds) <= now())
     union
     select x.id from public.tasks x
      where x.id in (select ar.task_id from public.agent_runs ar join public.approvals a on a.run_id = ar.id
                      where a.status = 'pending' and a.expires_at <= now())
         or (x.status in ('in_progress', 'needs_approval') and x.started_at + make_interval(secs => x.timeout_seconds) <= now()))
   order by coalesce(t.parent_task_id, t.id), (t.parent_task_id is not null), t.id
   for update;

  with expired as (
    update public.approvals set status = 'expired', decided_at = now()
     where status = 'pending' and expires_at <= now()
    returning run_id
  ), runs as (
    update public.agent_runs ar set status = 'failed', finished_at = now(), error = 'La aprobación caducó.'
     where ar.id in (select run_id from expired) and ar.status = 'waiting_approval'
    returning ar.task_id, ar.agent_id
  ), tasks_upd as (
    update public.tasks t set status = 'failed', error = 'La aprobación caducó.'
     where t.id in (select task_id from runs) and t.status = 'needs_approval'
    returning t.id, t.agent_id
  )
  select count(*) into v_expired from tasks_upd;

  with timed as (
    update public.tasks t
       set status = 'failed', error = 'Se agotó el tiempo máximo de la tarea.', locked_by = null, locked_until = null
     where t.status in ('in_progress', 'needs_approval')
       and t.started_at + make_interval(secs => t.timeout_seconds) <= now()
    returning t.id, t.agent_id
  ), runs as (
    update public.agent_runs ar set status = 'timed_out', finished_at = now(), error = 'Tiempo máximo agotado.'
     where ar.task_id in (select id from timed) and ar.status in ('running', 'waiting_approval')
    returning ar.id
  ), ev as (
    insert into public.task_events (task_id, agent_id, type, to_status, message)
    select id, agent_id, 'timed_out', 'failed', 'Se agotó el tiempo máximo de la tarea.' from timed
    returning task_id
  )
  select count(*) into v_timed_out from ev;

  update public.agents a set status = 'available', current_task_id = null, status_updated_at = now()
   where a.current_task_id is not null
     and not exists (select 1 from public.tasks t where t.id = a.current_task_id
                      and t.status in ('in_progress', 'needs_approval'));

  return jsonb_build_object('expired_approvals', v_expired, 'timed_out_tasks', v_timed_out);
end;
$$;

create or replace function public.reject_mission_plan(p_plan_id uuid, p_version integer, p_hash text, p_reason text, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.mission_plans;
  m public.tasks;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if p_mode not in ('changes', 'reject') then
    raise exception 'Decisión no válida.';
  end if;
  if length(v_reason) not between 3 and 2000 then
    raise exception 'Indica el motivo (3–2000 caracteres).';
  end if;
  -- 0014 (iteración 4) · Igual que approve_mission_plan: limits ANTES del plan y de
  -- la misión. Rechazar acaba en cancel_mission (limits); con plan → misión →
  -- limits se interbloqueaba con la aprobación simultánea y con las reservas (X11).
  perform 1 from public.settings where key = 'limits' for update;
  p := public.lock_plan_for_decision(p_plan_id, p_version, p_hash);
  if p.expires_at <= now() then
    return public.expire_mission_plan(p);
  end if;
  select x.* into m from public.tasks x where x.id = p.mission_id;

  if p_mode = 'changes' then
    if p.version >= 3 then
      raise exception 'Se alcanzó el máximo de 3 versiones del plan: apruébalo o recházalo definitivamente.';
    end if;
    update public.mission_plans set status = 'changes_requested', decided_by = auth.uid(), decided_at = now(), decision_note = v_reason
     where id = p.id;
    update public.tasks
       set status = 'assigned', attempts = 0, started_at = null, locked_by = null, locked_until = null,
           input = input || jsonb_build_object('phase', case when p.kind = 'amendment' then 'synthesis' else 'planning' end,
                                               'plan_feedback', v_reason, 'plan_feedback_version', p.version)
     where id = m.id;
    insert into public.task_events (task_id, agent_id, type, from_status, to_status, message, data)
    values (m.id, m.agent_id, 'plan_changes_requested', 'needs_approval', 'assigned',
            format('Cambios pedidos en el plan v%s', p.version), jsonb_build_object('plan_id', p.id, 'reason', v_reason));
    perform public.set_agent_state(m.agent_id, 'receiving', m.id, 'Rehaciendo el plan');
    insert into public.activity_log (actor_type, actor_id, action, entity_type, entity_id, details)
    values ('admin', auth.uid()::text, 'plan.changes_requested', 'mission_plan', p.id::text,
            jsonb_build_object('mission_id', p.mission_id, 'version', p.version, 'plan_hash', p.plan_hash, 'reason', v_reason));
    return jsonb_build_object('ok', true, 'mode', 'changes');
  end if;

  update public.mission_plans set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = v_reason
   where id = p.id;
  perform public.cancel_mission(m.id, 'Plan rechazado por el administrador: ' || v_reason);
  insert into public.activity_log (actor_type, actor_id, action, entity_type, entity_id, details)
  values ('admin', auth.uid()::text, 'plan.rejected', 'mission_plan', p.id::text,
          jsonb_build_object('mission_id', p.mission_id, 'version', p.version, 'plan_hash', p.plan_hash, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'mode', 'reject');
end;
$$;

-- ═══════════════════════ 5. Auditoría: web_tool_events ═══════════════════════
-- Sin claves ajenas a propósito: es un historial de solo añadir y no debe
-- impedir ni sufrir borrados en cascada de otras tablas.
create table public.web_tool_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  mission_id uuid not null,
  task_id uuid not null,
  run_id uuid not null,
  agent_id text,
  tool text not null check (tool in ('search', 'fetch')),
  call_index integer not null check (call_index >= 0),
  domain text check (domain is null or domain ~ '^[a-z0-9.-]{1,253}$'),
  result_domain text check (result_domain is null or result_domain ~ '^[a-z0-9.-]{1,253}$'),
  path_hmac text check (path_hmac is null or path_hmac ~ '^[0-9a-f]{64}$'),
  url_length integer check (url_length is null or url_length >= 0),
  query_param_count integer check (query_param_count is null or query_param_count >= 0),
  query_param_length integer check (query_param_length is null or query_param_length >= 0),
  query_hmac text check (query_hmac is null or query_hmac ~ '^[0-9a-f]{64}$'),
  query_length integer check (query_length is null or query_length >= 0),
  error_code text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  in_search_results boolean,
  severity text not null check (severity in ('info', 'alert', 'stop')),
  reasons text[] not null default '{}' check (cardinality(reasons) <= 10),
  key_id text not null check (key_id ~ '^[A-Za-z0-9_-]{1,20}$')
);
create index web_tool_events_mission_idx on public.web_tool_events (mission_id, created_at);
create index web_tool_events_alerts_idx on public.web_tool_events (severity) where severity <> 'info';
alter table public.web_tool_events enable row level security;
create policy "admin: leer eventos web" on public.web_tool_events for select to authenticated using (public.is_admin());
revoke all on public.web_tool_events from anon;
revoke insert, update, delete, truncate, references, trigger on public.web_tool_events from authenticated;
grant select on public.web_tool_events to authenticated;
revoke update, delete, truncate, references, trigger on public.web_tool_events from service_role;

create function public.web_tool_events_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'web_tool_events es un historial de solo añadir: % no está permitido.', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.web_tool_events_append_only() from public, anon, authenticated, service_role;
create trigger web_tool_events_append_only
  before update or delete on public.web_tool_events
  for each row execute function public.web_tool_events_append_only();
create trigger web_tool_events_no_truncate
  before truncate on public.web_tool_events
  for each statement execute function public.web_tool_events_append_only();

-- Inserta los eventos de UNA llamada y registra en activity_log un resumen (sin
-- URLs) si hay alertas o paradas. No exige el lease: los eventos de la última
-- llamada se guardan aunque la misión ya se haya detenido (sobrecoste, errores).
create function public.record_web_events(p_run_id uuid, p_worker text, p_events jsonb)
returns integer language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_mission uuid;
  v_n integer;
  v_worst text;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'Eventos no válidos.';
  end if;
  if jsonb_array_length(p_events) > 50 then
    raise exception 'Demasiados eventos en una llamada.';
  end if;
  select x.* into t from public.tasks x join public.agent_runs ar on ar.task_id = x.id where ar.id = p_run_id;
  if t.id is null then
    raise exception 'Ejecución desconocida.';
  end if;
  v_mission := coalesce(t.parent_task_id, t.id);
  with ins as (
    insert into public.web_tool_events (mission_id, task_id, run_id, agent_id, tool, call_index, domain, result_domain,
                                        path_hmac, url_length, query_param_count, query_param_length, query_hmac,
                                        query_length, error_code, in_search_results, severity, reasons, key_id)
    select v_mission, t.id, p_run_id, t.agent_id, e.tool, e.call_index, e.domain, e.result_domain, e.path_hmac,
           e.url_length, e.query_param_count, e.query_param_length, e.query_hmac, e.query_length, e.error_code,
           e.in_search_results, e.severity, coalesce(e.reasons, '{}'), e.key_id
      from jsonb_to_recordset(p_events) as e(tool text, call_index integer, domain text, result_domain text,
           path_hmac text, url_length integer, query_param_count integer, query_param_length integer,
           query_hmac text, query_length integer, error_code text, in_search_results boolean, severity text,
           reasons text[], key_id text)
    returning severity
  )
  select count(*), max(case severity when 'stop' then 'stop' when 'alert' then 'alert' else null end)
    into v_n, v_worst from ins;
  if v_worst is not null then
    insert into public.activity_log (actor_type, actor_id, action, entity_type, entity_id, details)
    values ('system', t.agent_id, 'security.web_anomaly', 'task', v_mission::text,
            jsonb_build_object('run_id', p_run_id, 'severity', v_worst));
  end if;
  return v_n;
end;
$$;

-- Parada inmediata de la misión por anomalía web (no depende del lease: la
-- parada debe ser efectiva aunque la ejecución ya lo haya perdido).
create function public.stop_mission_security(p_run_id uuid, p_reason text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_mission uuid;
  v_n integer;
begin
  select x.* into t from public.tasks x join public.agent_runs ar on ar.task_id = x.id where ar.id = p_run_id;
  if t.id is null then
    raise exception 'Ejecución desconocida.';
  end if;
  v_mission := coalesce(t.parent_task_id, t.id);
  v_n := public.cancel_mission(v_mission, 'Detenida por seguridad (PI-16): ' || left(coalesce(p_reason, 'anomalía web'), 300));
  insert into public.activity_log (actor_type, actor_id, action, entity_type, entity_id, details)
  values ('system', t.agent_id, 'security.web_stop', 'task', v_mission::text,
          jsonb_build_object('run_id', p_run_id, 'reason', left(coalesce(p_reason, ''), 300)));
  return jsonb_build_object('stopped', true, 'mission_id', v_mission, 'tasks', v_n);
end;
$$;

-- ═══════════════════════ 6. Comprobación de esquema para el motor ═══════════════════════
-- El motor la llama ANTES de ejecutar a un agente con herramientas web: solo
-- con evidencia positiva (ok = true) se usan. Sin esta función (base sin 0014)
-- la llamada falla y el motor también se detiene (fallo cerrado).
create function public.pi16_schema_status() returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  missing text[] := '{}';
  v_limits jsonb;
begin
  if to_regclass('public.mission_plans') is null or to_regclass('public.mission_plan_steps') is null then
    missing := missing || '0013:mission_plans'::text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'max_searches') then
    missing := missing || '0013:tasks.max_searches'::text;
  end if;
  if to_regclass('public.web_tool_events') is null then
    missing := missing || '0014:web_tool_events'::text;
  end if;
  if to_regprocedure('public.reserve_budget(uuid, text, text, numeric, integer, integer, integer)') is null then
    missing := missing || '0014:reserve_budget'::text;
  end if;
  if to_regprocedure('public.record_call(uuid, text, uuid, jsonb, text, bigint, bigint, bigint, bigint, integer, numeric, numeric, public.agent_status, integer, integer)') is null then
    missing := missing || '0014:record_call'::text;
  end if;
  if to_regprocedure('public.record_web_events(uuid, text, jsonb)') is null then
    missing := missing || '0014:record_web_events'::text;
  end if;
  if to_regprocedure('public.stop_mission_security(uuid, text)') is null then
    missing := missing || '0014:stop_mission_security'::text;
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public'
        and (table_name, column_name) in (('ai_reservations', 'fetches'), ('ai_usage', 'web_fetch_attempts'), ('ai_usage', 'web_tool_errors'))) <> 3 then
    missing := missing || '0014:columnas'::text;
  end if;
  select value into v_limits from public.settings where key = 'web_limits';
  if v_limits is null or to_regprocedure('public.web_limits_error(jsonb)') is null or public.web_limits_error(v_limits) is not null then
    missing := missing || '0014:web_limits'::text;
  end if;
  return jsonb_build_object('ok', cardinality(missing) = 0, 'missing', to_jsonb(missing), 'version', '0014');
end;
$$;

-- ═══════════════════════ 7. Permisos ═══════════════════════
do $$
declare f text;
begin
  foreach f in array array[
    'public.reserve_budget(uuid, text, text, numeric, integer, integer, integer)',
    'public.record_call(uuid, text, uuid, jsonb, text, bigint, bigint, bigint, bigint, integer, numeric, numeric, public.agent_status, integer, integer)',
    'public.record_web_events(uuid, text, jsonb)',
    'public.stop_mission_security(uuid, text)',
    'public.pi16_schema_status()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
