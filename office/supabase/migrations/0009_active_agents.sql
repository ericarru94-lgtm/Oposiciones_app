-- HE SIGNAL AI OFFICE · 0009 · Agentes activos: segunda barrera en PostgreSQL
--
-- Fase 5.1. Se aplica en UNA transacción (como las anteriores). No crea tablas,
-- no toca tareas, presupuestos, permisos, RLS ni políticas, y no añade funciones
-- SECURITY DEFINER.
--
-- 1. Datos: marca como inactivos a los seis agentes que todavía no participan
--    (daniel, lucia, david, emma, oscar, victoria). En producción los nueve
--    estaban con active = true (comprobado con una consulta de solo lectura el
--    02/11/2026), así que sin este paso la barrera no protegería nada. Es la
--    misma lista que ACTIVE_AGENT_IDS (src/lib/agents/catalog.ts); el seed la
--    sincroniza también. Alex, Marcus y Sofia no se tocan.
--
-- 2. claim_next_task: misma función que en 0007 (bloqueo, presupuesto,
--    concurrencia, dependencias, leases, recuperación, FOR UPDATE SKIP LOCKED)
--    con UNA condición más: el agente de la tarea debe tener active = true. Las
--    tareas de un agente inactivo se quedan en cola sin bloquear a las demás.
--    CREATE OR REPLACE conserva los permisos de ejecución existentes.
--
-- Marcha atrás: supabase/checks/0009_rollback.sql.

-- ═══════════════════════ 1. Agentes fuera del piloto ═══════════════════════
update public.agents
   set active = false
 where id in ('daniel', 'lucia', 'david', 'emma', 'oscar', 'victoria')
   and active;

-- ═══════════════════════ 2. claim_next_task con agentes activos ═══════════════════════
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
     -- 0009 · Segunda barrera: solo agentes activos (la primera está en worker.ts).
     and exists (select 1 from public.agents ag where ag.id = x.agent_id and ag.active)
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
