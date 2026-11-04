-- Marcha atrás de 0013 (plan de misión). Se aplica en UNA transacción.
--
-- - delegate_task y reserve_budget vuelven EXACTAMENTE a 0006 y 0007.
-- - Se quitan las funciones del plan, el trigger y las columnas nuevas de tasks.
-- - Los planes y sus pasos NO se borran: quedan como archivo de solo lectura
--   (sin escritura para ningún rol de la API, con sus triggers de inmutabilidad).
-- - Las misiones que estuvieran esperando un plan (needs_approval) quedan
--   paradas: el administrador puede detenerlas desde la oficina.
-- No borra ninguna fila.

-- ── Funciones del plan
drop function public.approve_mission_plan(uuid, integer, text, text);
drop function public.reject_mission_plan(uuid, integer, text, text, text);
drop function public.expire_mission_plan(public.mission_plans);
drop function public.lock_plan_for_decision(uuid, integer, text);
drop function public.await_plan_approval(uuid, text, text);
drop function public.submit_mission_plan(uuid, text, text, jsonb);
drop function public.validate_mission_plan(uuid, jsonb, text[]);
drop function public.mission_plan_steps_json(uuid);
drop function public.plan_outstanding_usd(uuid);
drop function public.plan_step_tools();

-- ── tasks: trigger y columnas
drop trigger tasks_plan_guard on public.tasks;
drop function public.tasks_plan_guard();
alter table public.tasks drop constraint tasks_plan_fk;
alter table public.tasks
  drop column plan_required,
  drop column plan_id,
  drop column plan_step_key,
  drop column budget_usd,
  drop column max_calls,
  drop column max_searches;

-- ── Planes: archivo de solo lectura
revoke insert, update, delete, truncate on public.mission_plans, public.mission_plan_steps from anon, authenticated, service_role;

-- ── delegate_task (0006) y reserve_budget (0007), sin cambios
create or replace function public.delegate_task(
  p_run_id uuid, p_worker text, p_tool_use_id text, p_agent text, p_title text,
  p_description text, p_depends_on uuid[] default '{}'
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_pilot jsonb;
  v_round integer;
  v_children integer;
  v_id uuid;
  v_dep uuid;
begin
  t := public.assert_lease(p_run_id, p_worker);
  select value into v_pilot from public.settings where key = 'pilot';

  if not exists (select 1 from public.agents a where a.id = t.agent_id and a.is_coordinator) then
    raise exception 'Solo el coordinador puede delegar tareas.';
  end if;
  if coalesce(t.input ->> 'kind', '') <> 'mission' then
    raise exception 'Solo se puede delegar desde un encargo principal (sin subdelegación).';
  end if;
  v_round := coalesce((t.input ->> 'round')::integer, 1);
  if v_round > coalesce((v_pilot ->> 'max_rounds')::integer, 2) then
    raise exception 'Se alcanzó el número máximo de rondas de delegación.';
  end if;
  if p_agent = t.agent_id or not (coalesce(v_pilot -> 'agents', '[]'::jsonb) ? p_agent)
     or not exists (select 1 from public.agents a where a.id = p_agent and a.active) then
    raise exception 'No se puede delegar en «%».', p_agent;
  end if;
  if length(coalesce(p_title, '')) not between 3 and 300 or length(coalesce(p_description, '')) < 10 then
    raise exception 'La subtarea necesita un título y unas instrucciones claras.';
  end if;

  -- Idempotencia: la misma llamada de Claude nunca crea dos subtareas.
  select x.id into v_id from public.tasks x where x.idempotency_key = p_run_id::text || ':' || p_tool_use_id;
  if v_id is not null then
    return jsonb_build_object('task_id', v_id, 'agent', p_agent, 'duplicate', true);
  end if;

  select count(*) into v_children from public.tasks x where x.parent_task_id = t.id;
  if v_children >= coalesce((v_pilot ->> 'max_subtasks')::integer, 6) then
    raise exception 'Se alcanzó el máximo de subtareas para este encargo.';
  end if;

  insert into public.tasks (title, description, status, priority, agent_id, created_by, parent_task_id,
                            client_id, project_id, idempotency_key, input, timeout_seconds)
  values (p_title, p_description, 'assigned', t.priority, p_agent, t.agent_id, t.id,
          t.client_id, t.project_id, p_run_id::text || ':' || p_tool_use_id,
          jsonb_build_object('kind', 'subtask', 'round', v_round), 1800)
  returning id into v_id;

  foreach v_dep in array coalesce(p_depends_on, '{}') loop
    if not exists (select 1 from public.tasks x where x.id = v_dep and x.parent_task_id = t.id) then
      raise exception 'La dependencia % no es una subtarea de este encargo.', v_dep;
    end if;
    insert into public.task_dependencies (task_id, depends_on) values (v_id, v_dep) on conflict do nothing;
  end loop;

  insert into public.task_events (task_id, agent_id, type, to_status, message, data)
  values (v_id, p_agent, 'task_assigned', 'assigned', left(p_title, 300),
          jsonb_build_object('parent_task_id', t.id, 'by', t.agent_id));
  perform public.set_agent_state(p_agent, 'receiving', v_id, left(p_title, 120))
    where (select a.current_task_id from public.agents a where a.id = p_agent) is null;
  return jsonb_build_object('task_id', v_id, 'agent', p_agent, 'duplicate', false);
end;
$$;

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
