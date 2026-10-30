-- HE SIGNAL AI OFFICE · 0007 · Reservas de presupuesto y recuperación segura
--
-- Sin operaciones destructivas: tabla y columnas nuevas, claves nuevas en
-- settings (sin pisar las existentes), funciones nuevas y CREATE OR REPLACE
-- de dos funciones (ai_budget_status y claim_next_task, mismas firmas).
--
-- 1. Reserva atómica ANTES de cada llamada a Claude: la fila de límites se
--    bloquea (FOR UPDATE), así dos llamadas nunca comprueban el mismo saldo.
--    Lo gastado cuenta ai_usage + reservas abiertas + reservas inciertas.
-- 2. Límites: mensual, por tarea y por MISIÓN (encargo + subtareas + todos
--    sus reintentos), con una parte reservada para el informe de Alex.
-- 3. Liquidación con el coste real (Claude y búsquedas por separado), aunque
--    el lease se haya perdido: un gasto pagado nunca se pierde.
-- 4. Llamada con resultado desconocido = «incierta»: cuenta como gastada y
--    no se repite automáticamente.
-- 5. Lease renovado en cada reserva; reintentos transitorios sin perder la
--    conversación (defer_run); reparto de tareas serializado.
-- 6. Topes de misión en la base de datos: 5 fichas del CRM y 15 búsquedas.
-- 7. Detener una misión (solo el servidor, a petición del administrador).

-- ═══════════════════════ 1. Configuración ═══════════════════════
update public.settings set value = '{"mission_ai_budget_usd": 1}'::jsonb || value
 where key = 'limits' and not (value ? 'mission_ai_budget_usd');
update public.settings
   set value = '{"max_companies": 5, "max_searches": 15, "synthesis_reserve_usd": 0.25}'::jsonb || value
 where key = 'pilot';

-- ═══════════════════════ 2. Datos ═══════════════════════
alter table public.ai_usage add column claude_cost_usd numeric(12, 6) not null default 0;
alter table public.ai_usage add column search_cost_usd numeric(12, 6) not null default 0;
alter table public.ai_usage add column reservation_id uuid;

alter table public.companies add column created_in_task uuid references public.tasks (id) on delete set null;

create table public.ai_reservations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  mission_id uuid not null references public.tasks (id) on delete cascade,
  agent_id text references public.agents (id) on delete set null,
  model text not null,
  estimate_usd numeric(12, 6) not null check (estimate_usd > 0),
  searches integer not null default 0 check (searches >= 0),
  actual_usd numeric(12, 6),
  -- open: llamada en curso · settled: coste real registrado · released: no se
  -- cobró · uncertain: resultado desconocido, cuenta como gastada.
  status text not null default 'open' check (status in ('open', 'settled', 'released', 'uncertain')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index ai_reservations_open_idx on public.ai_reservations (status) where status in ('open', 'uncertain');
create index ai_reservations_mission_idx on public.ai_reservations (mission_id);
create index ai_reservations_run_idx on public.ai_reservations (run_id);
alter table public.ai_reservations enable row level security;
create policy "admin: leer reservas" on public.ai_reservations for select to authenticated using (public.is_admin());
revoke all on public.ai_reservations from anon;
revoke insert, update, delete, truncate, references, trigger on public.ai_reservations from authenticated;
grant select on public.ai_reservations to authenticated;
alter publication supabase_realtime add table public.ai_reservations;

-- ═══════════════════════ 3. Gasto ═══════════════════════
create function public.mission_of(p_task_id uuid)
returns uuid language sql stable set search_path = '' as $$
  select coalesce(t.parent_task_id, t.id) from public.tasks t where t.id = p_task_id;
$$;

-- Lo gastado (real) + lo comprometido (reservas abiertas o inciertas).
create function public.committed_usd(p_scope text, p_id uuid)
returns numeric language sql stable set search_path = '' as $$
  select
    coalesce((select sum(u.cost_usd) from public.ai_usage u
               where case p_scope
                       when 'month' then u.created_at >= date_trunc('month', now())
                       when 'task' then u.task_id = p_id
                       when 'mission' then u.task_id in (select x.id from public.tasks x where x.id = p_id or x.parent_task_id = p_id)
                     end), 0)
  + coalesce((select sum(r.estimate_usd) from public.ai_reservations r
               where r.status in ('open', 'uncertain')
                 and case p_scope
                       when 'month' then r.created_at >= date_trunc('month', now())
                       when 'task' then r.task_id = p_id
                       when 'mission' then r.mission_id = p_id
                     end), 0);
$$;

create or replace function public.ai_budget_status()
returns table (month_spent_usd numeric, monthly_limit_usd numeric, task_limit_usd numeric, exceeded boolean)
language sql stable set search_path = '' as $$
  with lim as (
    select nullif(value ->> 'monthly_ai_budget_usd', '')::numeric as monthly,
           nullif(value ->> 'task_ai_budget_usd', '')::numeric as per_task
      from public.settings where key = 'limits'
  ), spent as (
    select coalesce((select sum(u.cost_usd) from public.ai_usage u
                      where u.created_at >= date_trunc('month', now())), 0)
         + coalesce((select sum(r.estimate_usd) from public.ai_reservations r
                      where r.status in ('open', 'uncertain') and r.created_at >= date_trunc('month', now())), 0) as total
  )
  select spent.total, lim.monthly, lim.per_task,
         coalesce(spent.total >= lim.monthly, false)
    from spent left join lim on true;
$$;

-- ═══════════════════════ 4. Reserva ═══════════════════════
-- Antes de cada llamada. Renueva el lease. Si la ejecución tiene una reserva
-- abierta (el proceso se cortó en mitad de una llamada), esa llamada pasa a
-- «incierta» y NO se permite repetirla automáticamente.
create function public.reserve_budget(
  p_run_id uuid, p_worker text, p_model text, p_estimate_usd numeric, p_searches integer default 0,
  p_lease_seconds integer default 240
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
  v_granted integer;
  v_id uuid;
begin
  if p_estimate_usd is null or p_estimate_usd <= 0 or p_searches < 0 then
    raise exception 'Reserva no válida.';
  end if;
  if p_lease_seconds not between 30 and 290 then
    raise exception 'El lease debe estar entre 30 y 290 segundos.';
  end if;
  t := public.assert_lease(p_run_id, p_worker);
  -- Serializa TODAS las reservas: nadie más comprueba el saldo a la vez.
  select value into v_limits from public.settings where key = 'limits' for update;
  select value into v_pilot from public.settings where key = 'pilot';
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

  if v_monthly is not null and public.committed_usd('month', null) + p_estimate_usd > v_monthly then
    return jsonb_build_object('ok', false, 'reason', 'monthly_budget');
  end if;
  if v_mission_limit is not null and public.committed_usd('mission', v_mission) + p_estimate_usd > v_mission_limit then
    return jsonb_build_object('ok', false, 'reason', 'mission_budget');
  end if;
  if v_task_limit is not null and public.committed_usd('task', t.id) + p_estimate_usd > v_task_limit then
    return jsonb_build_object('ok', false, 'reason', 'task_budget');
  end if;

  v_searches_max := coalesce((v_pilot ->> 'max_searches')::integer, 15);
  select coalesce(sum(u.server_tool_requests), 0) into v_searches_used from public.ai_usage u
   where u.task_id in (select x.id from public.tasks x where x.id = v_mission or x.parent_task_id = v_mission);
  v_searches_used := v_searches_used + coalesce((select sum(r.searches) from public.ai_reservations r
                                                  where r.mission_id = v_mission and r.status in ('open', 'uncertain')), 0);
  v_granted := greatest(0, least(p_searches, v_searches_max - v_searches_used));

  insert into public.ai_reservations (run_id, task_id, mission_id, agent_id, model, estimate_usd, searches)
  values (p_run_id, t.id, v_mission, t.agent_id, p_model, p_estimate_usd, v_granted)
  returning id into v_id;
  update public.tasks set locked_until = now() + make_interval(secs => p_lease_seconds), heartbeat_at = now()
   where id = t.id;
  update public.agent_runs set heartbeat_at = now() where id = p_run_id;
  return jsonb_build_object('ok', true, 'reservation_id', v_id, 'searches', v_granted);
end;
$$;

-- ═══════════════════════ 5. Liquidación ═══════════════════════
-- Registra el coste real de una llamada. El gasto se guarda SIEMPRE (aunque el
-- lease se haya perdido o la misión se haya detenido); el estado de la
-- conversación solo si este trabajador sigue teniendo la tarea.
create function public.record_call(
  p_run_id uuid, p_worker text, p_reservation_id uuid, p_state jsonb, p_model text,
  p_input_tokens bigint, p_output_tokens bigint, p_cache_read_tokens bigint, p_cache_write_tokens bigint,
  p_server_tool_requests integer, p_claude_cost_usd numeric, p_search_cost_usd numeric,
  p_agent_status public.agent_status default 'working'
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
begin
  if p_claude_cost_usd < 0 or p_search_cost_usd < 0 or p_input_tokens < 0 or p_output_tokens < 0 then
    raise exception 'Consumo no válido.';
  end if;
  select * into r from public.ai_reservations where id = p_reservation_id and run_id = p_run_id for update;
  if r.id is null then
    raise exception 'Reserva desconocida para esta ejecución.';
  end if;
  if r.status not in ('open', 'uncertain') then
    raise exception 'La reserva ya está cerrada.';
  end if;

  insert into public.ai_usage (agent_id, task_id, run_id, model, input_tokens, output_tokens, cache_read_tokens,
                               cache_write_tokens, server_tool_requests, cost_usd, claude_cost_usd, search_cost_usd, reservation_id)
  values (r.agent_id, r.task_id, p_run_id, p_model, p_input_tokens, p_output_tokens, p_cache_read_tokens,
          p_cache_write_tokens, p_server_tool_requests, v_cost, p_claude_cost_usd, p_search_cost_usd, r.id);
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

-- Cierra una reserva sin coste registrado: «released» si la API respondió con
-- un error que no se cobra; «uncertain» si no se sabe (cuenta como gastada).
create function public.close_reservation(p_run_id uuid, p_reservation_id uuid, p_uncertain boolean)
returns void language plpgsql set search_path = '' as $$
begin
  update public.ai_reservations
     set status = case when p_uncertain then 'uncertain' else 'released' end, closed_at = now()
   where id = p_reservation_id and run_id = p_run_id and status = 'open';
end;
$$;

-- Guarda la conversación sin consumo (después de ejecutar herramientas).
create function public.save_run_state(p_run_id uuid, p_worker text, p_state jsonb, p_release boolean default false)
returns void language plpgsql set search_path = '' as $$
declare
  t public.tasks;
begin
  t := public.assert_lease(p_run_id, p_worker);
  update public.agent_runs set state = p_state, heartbeat_at = now() where id = p_run_id;
  update public.tasks
     set heartbeat_at = now(),
         locked_by = case when p_release then null else locked_by end,
         locked_until = case when p_release then null else locked_until end
   where id = t.id;
end;
$$;

-- Error transitorio de la API (sin cobro): misma ejecución y misma
-- conversación, se retoma más tarde. Máximo de esperas lo controla el motor.
create function public.defer_run(p_run_id uuid, p_worker text, p_state jsonb, p_seconds integer, p_reason text)
returns void language plpgsql set search_path = '' as $$
declare
  t public.tasks;
begin
  t := public.assert_lease(p_run_id, p_worker);
  update public.agent_runs set state = p_state, heartbeat_at = now() where id = p_run_id;
  update public.tasks
     set locked_by = null, locked_until = null, heartbeat_at = now(),
         run_after = now() + make_interval(secs => least(greatest(p_seconds, 5), 600))
   where id = t.id;
  insert into public.task_events (task_id, agent_id, type, from_status, to_status, message)
  values (t.id, t.agent_id, 'retry_scheduled', 'in_progress', 'in_progress', left(p_reason, 500));
  perform public.set_agent_state(t.agent_id, 'available', null, null);
end;
$$;

-- ═══════════════════════ 6. Topes de misión ═══════════════════════
create function public.companies_mission_quota()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_mission uuid;
  v_max integer;
  v_count integer;
begin
  if new.created_in_task is null then
    return new;
  end if;
  v_mission := public.mission_of(new.created_in_task);
  -- Serializa las altas de una misma misión.
  perform 1 from public.tasks where id = v_mission for update;
  select coalesce((value ->> 'max_companies')::integer, 5) into v_max from public.settings where key = 'pilot';
  select count(*) into v_count from public.companies c
   where c.created_in_task in (select x.id from public.tasks x where x.id = v_mission or x.parent_task_id = v_mission);
  if v_count >= v_max then
    raise exception 'Se alcanzó el máximo de % empresas investigadas en esta misión.', v_max;
  end if;
  return new;
end;
$$;
create trigger companies_mission_quota before insert on public.companies
  for each row execute function public.companies_mission_quota();

-- ═══════════════════════ 7. Detener una misión ═══════════════════════
-- Las llamadas en curso quedan «inciertas» (cuentan como gastadas) y su
-- coste real se registrará igualmente si llega.
create function public.cancel_mission(p_mission_id uuid, p_reason text)
returns integer language plpgsql set search_path = '' as $$
declare
  v_n integer;
begin
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

-- ═══════════════════════ 8. Reparto serializado ═══════════════════════
-- Igual que en 0006, con un bloqueo de transacción al principio: el límite de
-- tareas simultáneas se cumple exactamente aunque lleguen varias pasadas.
create or replace function public.claim_next_task(p_worker text, p_lease_seconds integer default 240, p_max_running integer default 2)
returns table (task_id uuid, run_id uuid, agent_id text, attempt integer, resumed boolean)
language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_run public.agent_runs;
  v_resumed boolean := false;
  v_abandoned boolean := false;
begin
  if p_lease_seconds not between 30 and 290 then
    raise exception 'El lease debe estar entre 30 y 290 segundos (límite de 300 s de Vercel Hobby).';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.claim_next_task'));
  if (select b.exceeded from public.ai_budget_status() b) then
    return;
  end if;
  if (select count(*) from public.tasks x where x.locked_until > now()) >= p_max_running then
    return;
  end if;

  select x.* into t
    from public.tasks x
   where x.agent_id is not null
     and x.run_after <= now()
     and (x.started_at is null or x.started_at + make_interval(secs => x.timeout_seconds) > now())
     and (
       (x.status = 'assigned' and x.attempts < x.max_attempts)
       or (x.status = 'in_progress' and (x.locked_until is null or x.locked_until < now()))
     )
     and not exists (
       select 1 from public.task_dependencies d join public.tasks dt on dt.id = d.depends_on
        where d.task_id = x.id and dt.status not in ('completed', 'failed')
     )
     and not exists (
       select 1 from public.tasks y
        where y.agent_id = x.agent_id and y.id <> x.id and y.locked_until > now()
     )
   order by x.priority desc, x.created_at
   limit 1
   for update skip locked;

  if t.id is null then
    return;
  end if;

  if t.status = 'in_progress' then
    v_resumed := true;
    v_abandoned := t.locked_by is not null;
    select ar.* into v_run from public.agent_runs ar
     where ar.task_id = t.id and ar.status in ('running', 'waiting_approval');
    if v_run.id is not null then
      update public.agent_runs ar
         set status = 'running', worker_id = p_worker, heartbeat_at = now(),
             recoveries = ar.recoveries + (case when v_abandoned then 1 else 0 end)
       where ar.id = v_run.id
      returning * into v_run;
      if v_run.recoveries > 2 then
        update public.agent_runs set status = 'failed', finished_at = now(),
               error = 'Ejecución interrumpida demasiadas veces.' where id = v_run.id;
        update public.tasks set status = 'failed', locked_by = null, locked_until = null,
               error = 'Ejecución interrumpida demasiadas veces.' where id = t.id;
        insert into public.task_events (task_id, agent_id, type, from_status, to_status, message)
        values (t.id, t.agent_id, 'failed', 'in_progress', 'failed', 'Ejecución interrumpida demasiadas veces.');
        perform public.set_agent_state(t.agent_id, 'error', null, 'Una tarea ha fallado');
        return;
      end if;
    end if;
  end if;

  if v_run.id is null then
    insert into public.agent_runs (task_id, agent_id, attempt, worker_id)
    values (t.id, t.agent_id,
            (select coalesce(max(ar.attempt), 0) + 1 from public.agent_runs ar where ar.task_id = t.id),
            p_worker)
    returning * into v_run;
    update public.tasks x set attempts = x.attempts + 1, started_at = coalesce(x.started_at, now())
     where x.id = t.id;
  end if;

  update public.tasks x
     set status = 'in_progress', locked_by = p_worker,
         locked_until = now() + make_interval(secs => p_lease_seconds), heartbeat_at = now()
   where x.id = t.id;

  insert into public.task_events (task_id, agent_id, type, from_status, to_status, message, data)
  values (t.id, t.agent_id,
          case when v_abandoned then 'recovered' when v_resumed then 'resumed' else 'run_started' end,
          t.status, 'in_progress', null, jsonb_build_object('run_id', v_run.id, 'worker', p_worker));
  perform public.set_agent_state(t.agent_id, 'working', t.id, null);

  return query select t.id, v_run.id, t.agent_id, v_run.attempt, v_resumed;
exception
  when unique_violation then
    return;
end;
$$;

-- ═══════════════════════ Permisos ═══════════════════════
do $$
declare f text;
begin
  foreach f in array array[
    'public.mission_of(uuid)',
    'public.committed_usd(text, uuid)',
    'public.reserve_budget(uuid, text, text, numeric, integer, integer)',
    'public.record_call(uuid, text, uuid, jsonb, text, bigint, bigint, bigint, bigint, integer, numeric, numeric, public.agent_status)',
    'public.close_reservation(uuid, uuid, boolean)',
    'public.save_run_state(uuid, text, jsonb, boolean)',
    'public.defer_run(uuid, text, jsonb, integer, text)',
    'public.companies_mission_quota()',
    'public.cancel_mission(uuid, text)',
    'public.claim_next_task(text, integer, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
-- ai_budget_status sigue siendo legible por el administrador (panel de gasto).
revoke all on function public.ai_budget_status() from public, anon;
grant execute on function public.ai_budget_status() to authenticated, service_role;
