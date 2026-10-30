-- HE SIGNAL AI OFFICE · 0006 · Motor del piloto (Alex, Marcus, Sofia)
--
-- Sin operaciones destructivas: valores nuevos de enum, funciones nuevas y
-- CREATE OR REPLACE de dos funciones del motor (mismas firmas y permisos).
--
-- 1. Estados finos de los agentes para la oficina (contrato de eventos).
-- 2. Delegación de Alex con límites: solo el coordinador, solo desde el
--    encargo raíz, máx. 6 subtareas, máx. 2 rondas, sin profundidad extra.
-- 3. Espera a las subtareas sin ocupar procesos (dependencias + fase).
-- 4. Límite por tarea acumulado entre todos sus intentos (los reintentos no
--    pueden gastar sin límite) y aviso al 80 % del presupuesto mensual.
-- 5. Números de intento por ejecución independientes de los reintentos.

-- ═══════════════════════ 1. Estados ═══════════════════════
alter type public.agent_status add value if not exists 'receiving';
alter type public.agent_status add value if not exists 'researching';
alter type public.agent_status add value if not exists 'executing_tool';
alter type public.agent_status add value if not exists 'waiting_agent';
alter type public.agent_status add value if not exists 'waiting_approval';
alter type public.agent_status add value if not exists 'error';

-- Agentes que pueden recibir tareas delegadas en el piloto.
insert into public.settings (key, value)
values ('pilot', '{"agents": ["alex", "marcus", "sofia"], "max_subtasks": 6, "max_rounds": 2}'::jsonb)
on conflict (key) do nothing;

-- ═══════════════════════ 2. Actividad visible ═══════════════════════
-- Cambia el estado que ve la oficina y deja constancia en el historial.
create function public.set_run_activity(
  p_run_id uuid, p_worker text, p_status public.agent_status, p_event text, p_detail text default null
) returns void
language plpgsql set search_path = '' as $$
declare
  t public.tasks;
begin
  if p_event not in ('thinking', 'tool_executing', 'researching') then
    raise exception 'Evento de actividad no válido: %', p_event;
  end if;
  t := public.assert_lease(p_run_id, p_worker);
  perform public.set_agent_state(t.agent_id, p_status, t.id, left(p_detail, 200));
  insert into public.task_events (task_id, agent_id, type, message, data)
  values (t.id, t.agent_id, p_event, left(p_detail, 500), jsonb_build_object('run_id', p_run_id));
end;
$$;

-- ═══════════════════════ 3. Delegación ═══════════════════════
create function public.delegate_task(
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

-- El coordinador espera a sus subtareas: la ejecución termina, el encargo
-- vuelve a la cola con dependencias y pasa a la fase de síntesis.
create function public.await_subtasks(p_run_id uuid, p_worker text, p_summary text)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_pending integer;
  v_round integer;
begin
  t := public.assert_lease(p_run_id, p_worker);
  if coalesce(t.input ->> 'kind', '') <> 'mission' then
    raise exception 'Solo un encargo principal puede esperar subtareas.';
  end if;
  v_round := coalesce((t.input ->> 'round')::integer, 1);

  insert into public.task_dependencies (task_id, depends_on)
  select t.id, x.id from public.tasks x
   where x.parent_task_id = t.id and x.status not in ('completed', 'failed')
  on conflict do nothing;
  get diagnostics v_pending = row_count;
  select count(*) into v_pending from public.tasks x
   where x.parent_task_id = t.id and x.status not in ('completed', 'failed');
  if v_pending = 0 then
    raise exception 'No hay subtareas pendientes que esperar.';
  end if;

  update public.agent_runs set status = 'succeeded', finished_at = now(), pending_approval_id = null
   where id = p_run_id;
  update public.tasks
     set status = 'assigned', attempts = 0, locked_by = null, locked_until = null,
         result = left(p_summary, 20000),
         input = input || jsonb_build_object('phase', 'synthesis', 'round', v_round + 1)
   where id = t.id;
  insert into public.task_events (task_id, agent_id, type, from_status, to_status, message, data)
  values (t.id, t.agent_id, 'waiting_for_agent', 'in_progress', 'assigned',
          'Esperando a ' || v_pending || ' subtarea(s)', jsonb_build_object('round', v_round + 1));
  perform public.set_agent_state(t.agent_id, 'waiting_agent', t.id, 'Esperando a su equipo');
  return jsonb_build_object('pending', v_pending, 'round', v_round + 1);
end;
$$;

-- ═══════════════════════ 4. Motor: cambios en dos funciones ═══════════════════════

-- claim_next_task: una dependencia se da por resuelta si terminó (completada
-- o fallida, para que el coordinador pueda informar del fallo) y el número de
-- intento de la ejecución es independiente del contador de reintentos.
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

-- record_step: el límite por tarea cuenta TODO lo gastado por la tarea (en
-- todos sus intentos), y avisa al pasar del 80 % del presupuesto mensual.
create or replace function public.record_step(
  p_run_id uuid, p_worker text, p_state jsonb, p_model text,
  p_input_tokens bigint, p_output_tokens bigint, p_cache_read_tokens bigint, p_cache_write_tokens bigint,
  p_server_tool_requests integer, p_cost_usd numeric,
  p_agent_status public.agent_status default 'working', p_release boolean default false
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_run public.agent_runs;
  v_task_cost numeric;
  b record;
begin
  if p_cost_usd < 0 or p_input_tokens < 0 or p_output_tokens < 0 then
    raise exception 'Consumo no válido.';
  end if;
  t := public.assert_lease(p_run_id, p_worker);

  insert into public.ai_usage (agent_id, task_id, run_id, model, input_tokens, output_tokens,
                               cache_read_tokens, cache_write_tokens, server_tool_requests, cost_usd)
  values (t.agent_id, t.id, p_run_id, p_model, p_input_tokens, p_output_tokens,
          p_cache_read_tokens, p_cache_write_tokens, p_server_tool_requests, p_cost_usd);

  update public.agent_runs ar
     set steps = ar.steps + 1, model = p_model, state = p_state, heartbeat_at = now(),
         input_tokens = ar.input_tokens + p_input_tokens,
         output_tokens = ar.output_tokens + p_output_tokens,
         cache_read_tokens = ar.cache_read_tokens + p_cache_read_tokens,
         cache_write_tokens = ar.cache_write_tokens + p_cache_write_tokens,
         server_tool_requests = ar.server_tool_requests + p_server_tool_requests,
         cost_usd = ar.cost_usd + p_cost_usd
   where ar.id = p_run_id
  returning * into v_run;

  if p_release then
    update public.tasks set locked_by = null, locked_until = null, heartbeat_at = now() where id = t.id;
  else
    update public.tasks set heartbeat_at = now() where id = t.id;
  end if;
  perform public.set_agent_state(t.agent_id, p_agent_status, t.id, null);

  select coalesce(sum(u.cost_usd), 0) into v_task_cost from public.ai_usage u where u.task_id = t.id;
  select * into b from public.ai_budget_status();
  if b.exceeded then
    return jsonb_build_object('continue', false, 'reason', 'monthly_budget', 'run_cost_usd', v_run.cost_usd, 'task_cost_usd', v_task_cost);
  end if;
  if b.task_limit_usd is not null and v_task_cost >= b.task_limit_usd then
    return jsonb_build_object('continue', false, 'reason', 'task_budget', 'run_cost_usd', v_run.cost_usd, 'task_cost_usd', v_task_cost);
  end if;
  return jsonb_build_object('continue', true, 'run_cost_usd', v_run.cost_usd, 'task_cost_usd', v_task_cost,
    'budget_warning', b.monthly_limit_usd is not null and b.month_spent_usd >= 0.8 * b.monthly_limit_usd);
end;
$$;

-- Estados más precisos para la oficina (antes ambos eran «blocked»).
create or replace function public.pause_for_approval(p_run_id uuid, p_worker text, p_state jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_pending uuid;
begin
  t := public.assert_lease(p_run_id, p_worker);
  select a.id into v_pending from public.approvals a
   where a.run_id = p_run_id and a.status = 'pending' order by a.created_at limit 1;
  if v_pending is null then
    raise exception 'No hay aprobaciones pendientes para pausar la ejecución.';
  end if;
  update public.agent_runs set status = 'waiting_approval', pending_approval_id = v_pending, state = p_state,
         heartbeat_at = now() where id = p_run_id;
  update public.tasks set status = 'needs_approval', locked_by = null, locked_until = null where id = t.id;
  insert into public.task_events (task_id, agent_id, type, from_status, to_status, message, data)
  values (t.id, t.agent_id, 'approval_requested', 'in_progress', 'needs_approval',
          'Esperando tu aprobación', jsonb_build_object('approval_id', v_pending));
  perform public.set_agent_state(t.agent_id, 'waiting_approval', t.id, 'Esperando tu aprobación');
end;
$$;

create or replace function public.fail_run(p_run_id uuid, p_worker text, p_error text, p_retryable boolean default true)
returns public.task_status language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_status public.task_status;
begin
  t := public.assert_lease(p_run_id, p_worker);
  v_status := case when p_retryable and t.attempts < t.max_attempts then 'assigned' else 'failed' end;
  update public.agent_runs set status = 'failed', finished_at = now(), error = left(p_error, 4000) where id = p_run_id;
  update public.tasks
     set status = v_status, error = left(p_error, 4000), locked_by = null, locked_until = null,
         run_after = case when v_status = 'assigned'
                          then now() + make_interval(secs => 30 * power(2, greatest(t.attempts - 1, 0))::integer)
                          else run_after end
   where id = t.id;
  insert into public.task_events (task_id, agent_id, type, from_status, to_status, message)
  values (t.id, t.agent_id, case when v_status = 'assigned' then 'retry_scheduled' else 'failed' end,
          'in_progress', v_status, left(p_error, 500));
  if v_status = 'failed' then
    perform public.set_agent_state(t.agent_id, 'error', null, 'Una tarea ha fallado');
  else
    perform public.set_agent_state(t.agent_id, 'available', null, null);
  end if;
  return v_status;
end;
$$;

-- ═══════════════════════ 5. Coste por tarea ═══════════════════════
create view public.task_costs with (security_invoker = true) as
select u.task_id,
       count(*) as model_calls,
       sum(u.input_tokens) as input_tokens,
       sum(u.output_tokens) as output_tokens,
       sum(u.cache_read_tokens) as cache_read_tokens,
       sum(u.cache_write_tokens) as cache_write_tokens,
       sum(u.server_tool_requests) as server_tool_requests,
       sum(u.cost_usd) as cost_usd
  from public.ai_usage u
 where u.task_id is not null
 group by u.task_id;
revoke all on public.task_costs from anon;
revoke insert, update, delete, truncate, references, trigger on public.task_costs from authenticated;
grant select on public.task_costs to authenticated;

-- ═══════════════════════ Permisos ═══════════════════════
do $$
declare f text;
begin
  foreach f in array array[
    'public.set_run_activity(uuid, text, public.agent_status, text, text)',
    'public.delegate_task(uuid, text, text, text, text, text, uuid[])',
    'public.await_subtasks(uuid, text, text)',
    'public.claim_next_task(text, integer, integer)',
    'public.record_step(uuid, text, jsonb, text, bigint, bigint, bigint, bigint, integer, numeric, public.agent_status, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
