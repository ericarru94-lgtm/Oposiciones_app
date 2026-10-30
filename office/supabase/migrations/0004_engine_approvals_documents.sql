-- HE SIGNAL AI OFFICE · 0004 · Auditoría de la fase 1
--
-- 1. Endurece lo que el navegador del administrador puede escribir: los
--    estados, el historial, el consumo y las aprobaciones solo los escribe el
--    servidor (service role) o funciones controladas.
-- 2. Aprobaciones con huella SHA-256 de los argumentos, caducidad y un solo uso.
-- 3. Motor de ejecución: leases con heartbeat, recuperación de tareas
--    abandonadas, reintentos con espera, idempotencia, dependencias,
--    límite de concurrencia, tiempo máximo y presupuesto.
-- 4. agent_runs: una fila por ejecución.
-- 5. Documentos y entregables con almacenamiento privado.
-- 6. Memoria versionada y memoria por tarea (sin mezclar clientes).
-- 7. Vistas de costes.
--
-- Convención: las funciones del motor son SECURITY INVOKER y solo las puede
-- ejecutar service_role. Solo hay tres funciones SECURITY DEFINER:
-- is_admin(), decide_approval() y los triggers de versionado/alta de admin.

-- ═══════════════════════ 1. Permisos de escritura ═══════════════════════

-- Tablas que el administrador solo lee: las escribe el servidor. Se retiran
-- los permisos de escritura (sin borrar políticas, así la migración no
-- contiene operaciones destructivas).
revoke insert, update, delete, truncate on public.task_events, public.approvals, public.ai_usage
  from anon, authenticated;

-- El administrador solo puede registrar actividad a su propio nombre
-- (política restrictiva que se suma a la existente).
create policy "actividad: autor = usuario" on public.activity_log as restrictive
  for insert to authenticated
  with check (actor_type = 'admin' and actor_id = (select auth.uid())::text);

-- Agentes: el estado en tiempo real lo escribe el motor. Desde el navegador
-- solo se puede cambiar el modelo, el esfuerzo y si está activo.
revoke insert, update, delete on public.agents from anon, authenticated;
grant update (model, effort, active) on public.agents to authenticated;

-- ═══════════════════════════ 2. Motor: tareas ═══════════════════════════

alter table public.tasks
  add column idempotency_key text,
  add column run_after timestamptz not null default now(),
  add column locked_by text,
  add column locked_until timestamptz,
  add column heartbeat_at timestamptz,
  add column timeout_seconds integer not null default 1800 check (timeout_seconds between 60 and 86400),
  add constraint tasks_lock_consistent check ((locked_by is null) = (locked_until is null));

-- Evita tareas duplicadas (doble clic, reintentos de red, Alex delegando dos veces).
create unique index tasks_idempotency_key on public.tasks (idempotency_key) where idempotency_key is not null;
create index tasks_claim_idx on public.tasks (status, run_after) where status in ('assigned', 'in_progress');

-- Desde el navegador: crear tareas pendientes/asignadas y editar solo su
-- contenido. Los cambios de estado los hace el motor.
revoke update on public.tasks from anon, authenticated;
grant update (title, description, priority, due_at, client_id, project_id, requires_review) on public.tasks to authenticated;
create policy "tareas: alta controlada" on public.tasks as restrictive
  for insert to authenticated
  with check (
    status in ('pending', 'assigned') and attempts = 0 and locked_by is null
    and result is null and review_approved = false and started_at is null and completed_at is null
  );

create table public.task_dependencies (
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on uuid not null references public.tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on),
  check (task_id <> depends_on)
);
create index task_dependencies_depends_on_idx on public.task_dependencies (depends_on);
alter table public.task_dependencies enable row level security;
create policy "admin: acceso completo" on public.task_dependencies for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create function public.task_dependencies_no_cycle() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    with recursive chain(id) as (
      select d.depends_on from public.task_dependencies d where d.task_id = new.depends_on
      union
      select d.depends_on from public.task_dependencies d join chain c on d.task_id = c.id
    )
    select 1 from chain where id = new.task_id
  ) or new.depends_on = new.task_id then
    raise exception 'La dependencia crearía un ciclo entre tareas.';
  end if;
  return new;
end;
$$;
create trigger task_dependencies_no_cycle before insert or update on public.task_dependencies
  for each row execute function public.task_dependencies_no_cycle();

-- ═══════════════════════════ 3. agent_runs ═══════════════════════════

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  agent_id text not null references public.agents (id),
  attempt integer not null check (attempt >= 1),
  status text not null default 'running'
    check (status in ('running', 'waiting_approval', 'succeeded', 'failed', 'timed_out', 'cancelled')),
  worker_id text,
  steps integer not null default 0,
  recoveries integer not null default 0,
  model text,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  server_tool_requests integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  -- Conversación completa con Claude (incluidos los bloques de pensamiento)
  -- para reanudar exactamente donde se quedó.
  state jsonb not null default '{}',
  pending_approval_id uuid,
  error text,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (task_id, attempt)
);
-- Una sola ejecución viva por tarea.
create unique index agent_runs_one_active_per_task on public.agent_runs (task_id)
  where status in ('running', 'waiting_approval');
create index agent_runs_agent_idx on public.agent_runs (agent_id, started_at desc);

alter table public.agent_runs enable row level security;
create policy "admin: solo lectura" on public.agent_runs
  for select to authenticated using ((select public.is_admin()));

alter table public.ai_usage add column run_id uuid references public.agent_runs (id) on delete set null;
create index ai_usage_run_idx on public.ai_usage (run_id);

-- ════════════════════════════ 4. Aprobaciones ════════════════════════════

-- «payload» (fase 1, sin uso) queda obsoleta; los argumentos van en «arguments».
alter table public.approvals
  add column arguments jsonb not null default '{}',
  add column run_id uuid references public.agent_runs (id) on delete cascade,
  add column tool_use_id text,
  add column action text not null default 'execute',
  add column args_hash text,
  add column expires_at timestamptz not null default now() + interval '72 hours',
  add column consumed_at timestamptz,
  -- Idempotencia: Claude no puede generar dos aprobaciones para la misma llamada.
  add constraint approvals_tool_use_unique unique (run_id, tool_use_id);

alter table public.agent_runs
  add constraint agent_runs_pending_approval_fk
  foreign key (pending_approval_id) references public.approvals (id) on delete set null;

-- La huella se calcula en la base de datos sobre jsonb (orden de claves y
-- espacios normalizados), así el mismo contenido siempre da la misma huella.
create function public.args_fingerprint(p_arguments jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_arguments::text, 'UTF8')), 'hex');
$$;

create function public.approvals_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Toda aprobación nace pendiente y sin decidir, la cree quien la cree.
    new.args_hash := public.args_fingerprint(new.arguments);
    new.status := 'pending';
    new.decided_by := null;
    new.decided_at := null;
    new.decision_note := null;
    new.consumed_at := null;
    if new.expires_at <= now() then
      raise exception 'La aprobación debe caducar en el futuro.';
    end if;
    return new;
  end if;

  if new.arguments is distinct from old.arguments
     or new.args_hash is distinct from old.args_hash
     or new.tool_id is distinct from old.tool_id
     or new.action is distinct from old.action
     or new.agent_id is distinct from old.agent_id
     or new.task_id is distinct from old.task_id
     or new.run_id is distinct from old.run_id
     or new.tool_use_id is distinct from old.tool_use_id
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Una aprobación no se puede modificar. Si el contenido cambia, hay que pedir otra.';
  end if;
  if old.consumed_at is not null then
    raise exception 'Esta aprobación ya se utilizó.';
  end if;
  if old.status <> 'pending' and new.status <> old.status and new.consumed_at is null then
    raise exception 'Una aprobación decidida no puede cambiar de estado.';
  end if;
  return new;
end;
$$;
create trigger approvals_guard before insert or update on public.approvals
  for each row execute function public.approvals_guard();

-- Decisión del administrador. Única vía para aprobar o rechazar.
create function public.decide_approval(p_approval_id uuid, p_approve boolean, p_note text default null)
returns public.approvals
language plpgsql security definer set search_path = '' as $$
declare
  r public.approvals;
begin
  if not public.is_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  update public.approvals
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.approval_status,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = left(p_note, 2000)
   where id = p_approval_id and status = 'pending' and expires_at > now()
  returning * into r;

  if r.id is null then
    raise exception 'La aprobación no existe, ya se decidió o ha caducado.';
  end if;

  insert into public.activity_log (actor_type, actor_id, action, entity_type, entity_id, details)
  values ('admin', auth.uid()::text,
          case when p_approve then 'approval.approved' else 'approval.rejected' end,
          'approval', r.id::text,
          jsonb_build_object('tool_id', r.tool_id, 'action', r.action, 'args_hash', r.args_hash, 'agent_id', r.agent_id));

  -- Si ya no quedan aprobaciones pendientes en la ejecución, el motor la retoma.
  if r.run_id is not null and not exists (
    select 1 from public.approvals a where a.run_id = r.run_id and a.status = 'pending'
  ) then
    update public.tasks t
       set status = 'in_progress'
      from public.agent_runs ar
     where ar.id = r.run_id and t.id = ar.task_id and t.status = 'needs_approval';
    insert into public.task_events (task_id, agent_id, type, from_status, to_status, message)
    select ar.task_id, ar.agent_id, 'approval_decided', 'needs_approval', 'in_progress',
           case when p_approve then 'Aprobada por el administrador' else 'Rechazada por el administrador' end
      from public.agent_runs ar where ar.id = r.run_id;
  end if;

  return r;
end;
$$;

-- Uso de una aprobación por el motor: comprueba herramienta, acción, ejecución
-- y huella exacta de los argumentos, y la marca como usada (un solo uso).
create function public.consume_approval(
  p_approval_id uuid, p_run_id uuid, p_tool_id text, p_action text, p_arguments jsonb
) returns boolean
language plpgsql set search_path = '' as $$
declare
  n integer;
begin
  update public.approvals
     set consumed_at = now()
   where id = p_approval_id
     and status = 'approved'
     and consumed_at is null
     and expires_at > now()
     and run_id = p_run_id
     and tool_id = p_tool_id
     and action = p_action
     and args_hash = public.args_fingerprint(p_arguments);
  get diagnostics n = row_count;

  insert into public.activity_log (actor_type, actor_id, action, entity_type, entity_id, details)
  values ('system', 'engine',
          case when n = 1 then 'approval.consumed' else 'approval.use_denied' end,
          'approval', p_approval_id::text,
          jsonb_build_object('run_id', p_run_id, 'tool_id', p_tool_id, 'action', p_action,
                             'args_hash', public.args_fingerprint(p_arguments)));
  return n = 1;
end;
$$;

-- ═══════════════════════ 5. Presupuesto y estados ═══════════════════════

create function public.ai_budget_status()
returns table (month_spent_usd numeric, monthly_limit_usd numeric, task_limit_usd numeric, exceeded boolean)
language sql stable set search_path = '' as $$
  with lim as (
    select nullif(value ->> 'monthly_ai_budget_usd', '')::numeric as monthly,
           nullif(value ->> 'task_ai_budget_usd', '')::numeric as per_task
      from public.settings where key = 'limits'
  ), spent as (
    select coalesce(sum(cost_usd), 0) as total
      from public.ai_usage where created_at >= date_trunc('month', now())
  )
  select spent.total, lim.monthly, lim.per_task,
         coalesce(spent.total >= lim.monthly, false)
    from spent left join lim on true;
$$;

create function public.set_agent_state(p_agent text, p_status public.agent_status, p_task uuid, p_detail text)
returns void language sql set search_path = '' as $$
  update public.agents
     set status = p_status, current_task_id = p_task, status_detail = p_detail, status_updated_at = now()
   where id = p_agent;
$$;

-- ═══════════════════════ 6. Ciclo de vida de la ejecución ═══════════════════════

-- Adquiere la siguiente tarea disponible con FOR UPDATE SKIP LOCKED.
-- Respeta presupuesto, concurrencia global, una tarea por agente,
-- dependencias, esperas de reintento, tiempo máximo e intentos.
create function public.claim_next_task(p_worker text, p_lease_seconds integer default 240, p_max_running integer default 2)
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
        where d.task_id = x.id and dt.status <> 'completed'
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
    v_abandoned := t.locked_by is not null; -- el lease caducó sin liberarse
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
        perform public.set_agent_state(t.agent_id, 'blocked', null, 'Una tarea ha fallado');
        return;
      end if;
    end if;
  end if;

  if v_run.id is null then
    insert into public.agent_runs (task_id, agent_id, attempt, worker_id)
    values (t.id, t.agent_id, t.attempts + 1, p_worker)
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
          case when v_abandoned then 'recovered' when v_resumed then 'resumed' else 'claimed' end,
          t.status, 'in_progress', null, jsonb_build_object('run_id', v_run.id, 'worker', p_worker));
  perform public.set_agent_state(t.agent_id, 'working', t.id, null);

  return query select t.id, v_run.id, t.agent_id, v_run.attempt, v_resumed;
exception
  when unique_violation then
    return; -- otro trabajador ganó la carrera
end;
$$;

-- Comprueba que este trabajador sigue siendo el dueño del lease.
create function public.assert_lease(p_run_id uuid, p_worker text)
returns public.tasks language plpgsql set search_path = '' as $$
declare
  t public.tasks;
begin
  select x.* into t from public.tasks x join public.agent_runs ar on ar.task_id = x.id
   where ar.id = p_run_id and ar.status = 'running'
   for update of x;
  if t.id is null or t.locked_by is distinct from p_worker or t.locked_until < now() then
    raise exception 'Este trabajador ya no tiene el control de la tarea (lease perdido).' using errcode = 'P0001';
  end if;
  return t;
end;
$$;

create function public.heartbeat_run(p_run_id uuid, p_worker text, p_lease_seconds integer default 240)
returns boolean language plpgsql set search_path = '' as $$
declare
  t public.tasks;
begin
  t := public.assert_lease(p_run_id, p_worker);
  update public.tasks set locked_until = now() + make_interval(secs => least(p_lease_seconds, 290)), heartbeat_at = now()
   where id = t.id;
  update public.agent_runs set heartbeat_at = now() where id = p_run_id;
  return true;
end;
$$;

-- Guarda un paso: consumo, coste, estado de la conversación. Devuelve si se
-- puede continuar (presupuesto mensual y por tarea).
create function public.record_step(
  p_run_id uuid, p_worker text, p_state jsonb, p_model text,
  p_input_tokens bigint, p_output_tokens bigint, p_cache_read_tokens bigint, p_cache_write_tokens bigint,
  p_server_tool_requests integer, p_cost_usd numeric,
  p_agent_status public.agent_status default 'working', p_release boolean default false
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_run public.agent_runs;
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

  select * into b from public.ai_budget_status();
  if b.exceeded then
    return jsonb_build_object('continue', false, 'reason', 'monthly_budget', 'run_cost_usd', v_run.cost_usd);
  end if;
  if b.task_limit_usd is not null and v_run.cost_usd >= b.task_limit_usd then
    return jsonb_build_object('continue', false, 'reason', 'task_budget', 'run_cost_usd', v_run.cost_usd);
  end if;
  return jsonb_build_object('continue', true, 'run_cost_usd', v_run.cost_usd);
end;
$$;

-- Crea una solicitud de aprobación (idempotente por tool_use_id) y pausa la ejecución.
create function public.request_approval(
  p_run_id uuid, p_worker text, p_tool_use_id text, p_tool_id text, p_risk text,
  p_action text, p_arguments jsonb, p_summary text, p_ttl_hours integer default 72
) returns uuid
language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_id uuid;
begin
  t := public.assert_lease(p_run_id, p_worker);
  insert into public.approvals (task_id, agent_id, run_id, tool_use_id, tool_id, risk, action, arguments, summary, expires_at)
  values (t.id, t.agent_id, p_run_id, p_tool_use_id, p_tool_id, p_risk, p_action, p_arguments, left(p_summary, 2000),
          now() + make_interval(hours => least(greatest(p_ttl_hours, 1), 168)))
  on conflict (run_id, tool_use_id) do nothing
  returning id into v_id;
  if v_id is null then
    select a.id into v_id from public.approvals a where a.run_id = p_run_id and a.tool_use_id = p_tool_use_id;
  end if;
  return v_id;
end;
$$;

create function public.pause_for_approval(p_run_id uuid, p_worker text, p_state jsonb)
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
  perform public.set_agent_state(t.agent_id, 'blocked', t.id, 'Esperando tu aprobación');
end;
$$;

create function public.complete_run(p_run_id uuid, p_worker text, p_result text, p_result_data jsonb default null)
returns public.task_status language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_status public.task_status;
begin
  t := public.assert_lease(p_run_id, p_worker);
  v_status := case when t.requires_review and not t.review_approved then 'in_review' else 'completed' end;
  update public.agent_runs set status = 'succeeded', finished_at = now(), pending_approval_id = null where id = p_run_id;
  update public.tasks
     set status = v_status, result = p_result, result_data = p_result_data, error = null,
         locked_by = null, locked_until = null,
         completed_at = case when v_status = 'completed' then now() else null end
   where id = t.id;
  insert into public.task_events (task_id, agent_id, type, from_status, to_status, message)
  values (t.id, t.agent_id, 'run_succeeded', 'in_progress', v_status,
          case when v_status = 'in_review' then 'Entregado a control de calidad' else 'Tarea completada' end);
  perform public.set_agent_state(t.agent_id, 'completed', null, left(t.title, 120));
  return v_status;
end;
$$;

-- Fallo de una ejecución. Si es reintentable y quedan intentos, se reprograma
-- con espera exponencial (30 s, 60 s, 120 s…).
create function public.fail_run(p_run_id uuid, p_worker text, p_error text, p_retryable boolean default true)
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
    perform public.set_agent_state(t.agent_id, 'blocked', null, 'Una tarea ha fallado');
  else
    perform public.set_agent_state(t.agent_id, 'available', null, null);
  end if;
  return v_status;
end;
$$;

-- Revisión de control de calidad sobre una tarea en revisión.
create function public.record_review(p_task_id uuid, p_reviewer text, p_approved boolean, p_notes text)
returns public.task_status language plpgsql set search_path = '' as $$
declare
  v_status public.task_status;
begin
  update public.tasks
     set review_approved = p_approved,
         reviewer_agent_id = p_reviewer,
         status = case when p_approved then 'completed'::public.task_status else 'assigned'::public.task_status end,
         completed_at = case when p_approved then now() else null end,
         attempts = case when p_approved then attempts else 0 end
   where id = p_task_id and status = 'in_review'
  returning status into v_status;
  if v_status is null then
    raise exception 'La tarea no está en revisión.';
  end if;
  insert into public.task_events (task_id, agent_id, type, from_status, to_status, message)
  values (p_task_id, p_reviewer, case when p_approved then 'review_approved' else 'review_returned' end,
          'in_review', v_status, left(p_notes, 2000));
  return v_status;
end;
$$;

-- Mantenimiento periódico: caduca aprobaciones y corta tareas que superan su
-- tiempo máximo. Las tareas con lease caducado las retoma claim_next_task.
create function public.recover_stale()
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

-- Solo el servidor (service_role) ejecuta el motor.
do $$
declare f text;
begin
  foreach f in array array[
    'public.consume_approval(uuid, uuid, text, text, jsonb)',
    'public.claim_next_task(text, integer, integer)',
    'public.assert_lease(uuid, text)',
    'public.heartbeat_run(uuid, text, integer)',
    'public.record_step(uuid, text, jsonb, text, bigint, bigint, bigint, bigint, integer, numeric, public.agent_status, boolean)',
    'public.request_approval(uuid, text, text, text, text, text, jsonb, text, integer)',
    'public.pause_for_approval(uuid, text, jsonb)',
    'public.complete_run(uuid, text, text, jsonb)',
    'public.fail_run(uuid, text, text, boolean)',
    'public.record_review(uuid, text, boolean, text)',
    'public.recover_stale()',
    'public.set_agent_state(text, public.agent_status, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
revoke all on function public.decide_approval(uuid, boolean, text) from public, anon;
grant execute on function public.decide_approval(uuid, boolean, text) to authenticated;
revoke all on function public.ai_budget_status() from public, anon;
grant execute on function public.ai_budget_status() to authenticated, service_role;
revoke all on function public.args_fingerprint(jsonb) from anon;

-- ═══════════════════════ 7. Documentos y entregables ═══════════════════════

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 300),
  kind text not null check (kind in (
    'report', 'strategy', 'proposal', 'pdf', 'presentation', 'script',
    'creative', 'client_file', 'technical', 'other')),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'archived')),
  task_id uuid references public.tasks (id) on delete set null,
  run_id uuid references public.agent_runs (id) on delete set null,
  agent_id text references public.agents (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  client_id uuid references public.companies (id) on delete set null,
  -- Texto (Markdown) o archivo en el bucket privado «documents».
  content text,
  storage_path text unique,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes between 0 and 52428800),
  sha256 text,
  version integer not null default 1 check (version >= 1),
  previous_version_id uuid references public.documents (id) on delete set null,
  source text not null,
  is_demo boolean not null default false,
  created_by text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (content is not null or storage_path is not null),
  check (storage_path is null or storage_path ~ '^[a-z0-9-]+/[A-Za-z0-9._/-]+$')
);
create index documents_task_idx on public.documents (task_id);
create index documents_client_idx on public.documents (client_id);
create index documents_project_idx on public.documents (project_id);
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

alter table public.documents enable row level security;
create policy "admin: acceso completo" on public.documents for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Bucket privado (máx. 50 MB por archivo, el límite del plan Free).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 52428800, array[
  'application/pdf', 'text/markdown', 'text/plain', 'text/csv', 'application/json',
  'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'video/mp4',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
])
on conflict (id) do nothing;

create policy "documents: solo administrador" on storage.objects for all to authenticated
  using (bucket_id = 'documents' and (select public.is_admin()))
  with check (bucket_id = 'documents' and (select public.is_admin()));

-- ═══════════════════════ 8. Memoria y CRM ═══════════════════════

alter table public.memory_items add column version integer not null default 1;

create table public.memory_item_versions (
  id bigint generated always as identity primary key,
  memory_item_id uuid not null references public.memory_items (id) on delete cascade,
  version integer not null,
  category text not null,
  title text not null,
  content text not null,
  source text not null,
  source_ref text,
  changed_by text,
  archived_at timestamptz not null default now(),
  unique (memory_item_id, version)
);
alter table public.memory_item_versions enable row level security;
create policy "admin: solo lectura" on public.memory_item_versions
  for select to authenticated using ((select public.is_admin()));

-- Antes de cambiar una memoria se guarda la versión anterior. SECURITY
-- DEFINER para que nadie pueda escribir versiones a mano.
create function public.memory_items_versioning() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.content is distinct from old.content or new.title is distinct from old.title
     or new.category is distinct from old.category or new.source is distinct from old.source
     or new.source_ref is distinct from old.source_ref then
    insert into public.memory_item_versions
      (memory_item_id, version, category, title, content, source, source_ref, changed_by)
    values (old.id, old.version, old.category, old.title, old.content, old.source, old.source_ref,
            coalesce(auth.uid()::text, 'system'));
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;
revoke all on function public.memory_items_versioning() from public, anon, authenticated;
create trigger memory_items_versioning before update on public.memory_items
  for each row execute function public.memory_items_versioning();

-- Memoria que puede leer un agente para una tarea concreta: la global, la
-- suya y solo la del cliente y proyecto de esa tarea. Nunca la de otros clientes.
create function public.memory_for_task(p_task_id uuid)
returns setof public.memory_items language sql stable set search_path = '' as $$
  select m.* from public.memory_items m
    join public.tasks t on t.id = p_task_id
   where m.scope = 'global'
      or (m.scope = 'agent' and m.agent_id = t.agent_id)
      or (m.scope = 'client' and t.client_id is not null and m.client_id = t.client_id)
      or (m.scope = 'project' and t.project_id is not null and m.project_id = t.project_id)
   order by m.scope, m.category, m.title;
$$;
revoke all on function public.memory_for_task(uuid) from public, anon, authenticated;
grant execute on function public.memory_for_task(uuid) to service_role;

-- Contactos sin duplicados por empresa.
create unique index contacts_company_email_key on public.contacts (company_id, lower(email)) where email is not null;

-- ═══════════════════════ 9. Costes y monitorización ═══════════════════════

create view public.ai_cost_monthly with (security_invoker = true) as
select date_trunc('month', u.created_at) as month,
       u.agent_id,
       u.model,
       count(*) as model_calls,
       count(distinct u.run_id) as runs,
       count(distinct u.task_id) as tasks,
       sum(u.input_tokens) as input_tokens,
       sum(u.output_tokens) as output_tokens,
       sum(u.cache_read_tokens) as cache_read_tokens,
       sum(u.cache_write_tokens) as cache_write_tokens,
       sum(u.server_tool_requests) as server_tool_requests,
       sum(u.cost_usd) as cost_usd,
       avg(u.cost_usd) as avg_cost_per_call_usd
  from public.ai_usage u
 group by 1, 2, 3;

create view public.agent_run_stats_monthly with (security_invoker = true) as
select date_trunc('month', r.started_at) as month,
       r.agent_id,
       count(*) as runs,
       count(*) filter (where r.status = 'succeeded') as succeeded,
       count(*) filter (where r.status in ('failed', 'timed_out')) as failed,
       count(*) filter (where r.status = 'waiting_approval') as waiting_approval,
       sum(r.cost_usd) as cost_usd,
       avg(r.cost_usd) filter (where r.status = 'succeeded') as avg_cost_per_success_usd,
       avg(r.input_tokens + r.output_tokens) as avg_tokens_per_run
  from public.agent_runs r
 group by 1, 2;

revoke all on public.ai_cost_monthly, public.agent_run_stats_monthly from anon;
grant select on public.ai_cost_monthly, public.agent_run_stats_monthly to authenticated;

-- ═══════════════════════ 10. Tiempo real ═══════════════════════
alter publication supabase_realtime add table public.agent_runs;
