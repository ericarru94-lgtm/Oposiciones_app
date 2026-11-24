-- Marcha atrás de 0014 (PI-16 · EXPERIMENTAL). Una sola transacción.
-- ANTES: exportar web_tool_events y los contadores web (ai_usage.web_fetch_attempts,
-- ai_usage.web_tool_errors, ai_reservations.fetches): esta marcha atrás los borra.
-- Deja reserve_budget y reject_mission_plan EXACTAMENTE como en 0013, record_call y
-- cancel_mission como en 0007 y recover_stale como en 0004.
begin;

drop function public.pi16_schema_status();
drop function public.stop_mission_security(uuid, text);
drop function public.record_web_events(uuid, text, jsonb);
drop table public.web_tool_events;            -- elimina también sus triggers
drop function public.web_tool_events_append_only();

drop function public.record_call(uuid, text, uuid, jsonb, text, bigint, bigint, bigint, bigint, integer, numeric, numeric, public.agent_status, integer, integer);
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

  -- Política del piloto: un sobrecoste detiene TODA la misión (decisión del
  -- administrador). El gasto ya está registrado; no se hace ninguna llamada más.
  if v_cost > r.estimate_usd
     and coalesce((select (value ->> 'stop_on_cost_overrun')::boolean from public.settings where key = 'pilot'), true) then
    perform public.cancel_mission(r.mission_id,
      'Detenida automáticamente por sobrecoste: una llamada costó ' || round(v_cost, 4) || ' $ y la reserva era de '
      || round(r.estimate_usd, 4) || ' $.');
    return jsonb_build_object('continue', false, 'reason', 'cost_overrun');
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

drop function public.reserve_budget(uuid, text, text, numeric, integer, integer, integer);
create or replace function public.reserve_budget(
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
  v_task_searches integer;
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

  insert into public.ai_reservations (run_id, task_id, mission_id, agent_id, model, estimate_usd, searches)
  values (p_run_id, t.id, v_mission, t.agent_id, p_model, p_estimate_usd, v_granted)
  returning id into v_id;
  update public.tasks set locked_until = now() + make_interval(secs => p_lease_seconds), heartbeat_at = now()
   where id = t.id;
  update public.agent_runs set heartbeat_at = now() where id = p_run_id;
  return jsonb_build_object('ok', true, 'reservation_id', v_id, 'searches', v_granted);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.reserve_budget(uuid, text, text, numeric, integer, integer)',
    'public.record_call(uuid, text, uuid, jsonb, text, bigint, bigint, bigint, bigint, integer, numeric, numeric, public.agent_status)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- cancel_mission vuelve EXACTAMENTE a 0007.
create or replace function public.cancel_mission(p_mission_id uuid, p_reason text)
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

-- recover_stale vuelve EXACTAMENTE a 0004 y reject_mission_plan a 0013 (iteración 4).
create or replace function public.recover_stale()
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_expired integer;
  v_timed_out integer;
begin
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

drop trigger settings_web_limits_guard on public.settings;
delete from public.settings where key = 'web_limits';
drop function public.web_limits_guard();
drop function public.web_limits_error(jsonb);
drop function public.web_limits_ceilings();

alter table public.ai_usage drop column web_tool_errors, drop column web_fetch_attempts;
alter table public.ai_reservations drop column fetches;

commit;
