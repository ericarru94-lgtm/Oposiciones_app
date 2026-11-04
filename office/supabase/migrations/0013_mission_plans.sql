-- HE SIGNAL AI OFFICE · 0013 · Plan de misión aprobado por el administrador
--
-- Fase 5.2.1. Se aplica en UNA transacción. REQUIERE 0012 (lo comprueba).
-- No cambia ningún dato existente: las misiones anteriores quedan con
-- plan_required = false y siguen el camino antiguo (delegate_task).
--
-- Flujo de una misión nueva (plan_required = true):
--   1. Alex (planificación) propone un plan con submit_mission_plan: pasos
--      con agente, instrucciones, dependencias, herramientas, presupuesto,
--      llamadas y búsquedas máximas. Se valida TODO y queda «pendiente».
--   2. Al terminar su turno, await_plan_approval deja la misión en
--      needs_approval (fase plan_review). Nadie ejecuta nada.
--   3. El administrador decide (funciones SECURITY DEFINER con is_admin):
--      - approve_mission_plan: revalida y crea las subtareas de los pasos;
--      - reject_mission_plan 'changes': vuelve a Alex con el motivo;
--      - reject_mission_plan 'reject': cancela la misión.
--      Máximo 3 versiones por misión. Las decisiones exigen versión y huella
--      (sha256) exactas: se aprueba exactamente lo que se ha visto.
--   4. En la síntesis Alex puede proponer UNA ampliación por ronda (hasta
--      pilot.max_rounds): solo pasos nuevos; los aprobados se copian tal
--      cual. Necesita una nueva aprobación expresa.
--   5. reserve_budget aplica el presupuesto, las llamadas y las búsquedas de
--      cada paso. delegate_task se niega en las misiones con plan.
--   6. Las subtareas de una misión con plan SOLO las crea approve_mission_plan.
--   7. Lo aprobado queda comprometido en el saldo mensual (envelope_usd) hasta
--      que la misión termina: varias misiones aprobadas nunca superan el mes.
--
-- Marcha atrás: supabase/checks/0013_rollback.sql.

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'settings_ceilings') then
    raise exception '0013 necesita 0012 (settings_ceilings) aplicada antes.';
  end if;
end $$;

-- ═══════════════════════ 1. Columnas nuevas en tasks ═══════════════════════
-- Las filas existentes quedan con plan_required = false (camino antiguo).
-- Después el valor por defecto pasa a true: toda misión nueva necesita plan.
alter table public.tasks
  add column plan_required boolean not null default false,
  add column plan_id uuid,
  add column plan_step_key text,
  add column budget_usd numeric(10, 4) check (budget_usd is null or budget_usd > 0),
  add column max_calls integer check (max_calls is null or max_calls between 1 and 30),
  add column max_searches integer check (max_searches is null or max_searches >= 0);
alter table public.tasks alter column plan_required set default true;

-- ═══════════════════════ 2. Planes y pasos ═══════════════════════
-- «if not exists»: tras la marcha atrás las tablas quedan como archivo y,
-- si se vuelve a aplicar 0013, se reutilizan (no se pierde ningún plan).
create table if not exists public.mission_plans (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.tasks (id) on delete restrict,
  version integer not null check (version between 1 and 3),
  kind text not null check (kind in ('initial', 'amendment')),
  base_plan_id uuid references public.mission_plans (id) on delete restrict,
  plan jsonb not null,
  plan_hash text not null,
  estimate_usd numeric(10, 4) not null check (estimate_usd >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'changes_requested', 'superseded', 'expired')),
  proposed_by text not null references public.agents (id),
  proposed_run_id uuid references public.agent_runs (id) on delete restrict,
  expires_at timestamptz not null,
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 2000),
  -- Dinero que la aprobación deja comprometido para la misión (lo ya
  -- comprometido + los pasos nuevos + la reserva del informe). Lo fija
  -- approve_mission_plan y cuenta en el saldo mensual mientras la misión siga abierta.
  envelope_usd numeric(10, 4) check (envelope_usd is null or envelope_usd >= 0),
  created_at timestamptz not null default now(),
  unique (mission_id, version),
  check ((kind = 'amendment') = (base_plan_id is not null))
);
-- Como mucho un plan pendiente y uno aprobado (el vigente) por misión.
create unique index if not exists mission_plans_one_pending on public.mission_plans (mission_id) where status = 'pending';
create unique index if not exists mission_plans_one_approved on public.mission_plans (mission_id) where status = 'approved';
create index if not exists mission_plans_run_idx on public.mission_plans (proposed_run_id);

create table if not exists public.mission_plan_steps (
  plan_id uuid not null references public.mission_plans (id) on delete restrict,
  step_key text not null check (step_key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  position integer not null check (position >= 1),
  agent_id text not null references public.agents (id),
  title text not null check (length(title) between 3 and 300),
  instructions text not null check (length(instructions) between 10 and 8000),
  depends_on text[] not null default '{}',
  tools text[] not null default '{}',
  budget_usd numeric(10, 4) not null check (budget_usd > 0),
  max_calls integer not null check (max_calls between 1 and 30),
  max_searches integer not null check (max_searches >= 0),
  -- Paso aprobado en una versión anterior (ampliación): se copia tal cual.
  carried boolean not null default false,
  task_id uuid references public.tasks (id) on delete restrict,
  primary key (plan_id, step_key),
  unique (plan_id, position)
);

alter table public.tasks
  add constraint tasks_plan_fk foreign key (plan_id) references public.mission_plans (id) on delete restrict;

-- ═══════════════════════ 3. Reglas inmutables ═══════════════════════
-- tasks: plan_required y los límites de un paso no se pueden cambiar; el
-- navegador no puede crear misiones sin plan ni tareas con límites propios.
create function public.tasks_plan_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') then
      new.plan_id := null; new.plan_step_key := null;
      new.budget_usd := null; new.max_calls := null; new.max_searches := null;
      if new.parent_task_id is null and coalesce(new.input ->> 'kind', '') = 'mission' then
        new.plan_required := true;
        new.input := coalesce(new.input, '{}'::jsonb) || '{"phase": "planning", "round": 1}'::jsonb;
      end if;
    end if;
    -- Solo una misión principal puede necesitar plan.
    if new.parent_task_id is not null or coalesce(new.input ->> 'kind', '') <> 'mission' then
      new.plan_required := false;
    end if;
    -- La ÚNICA vía para crear una subtarea de una misión con plan es
    -- approve_mission_plan (se ejecuta como su dueño, no como un rol de la API),
    -- y siempre desde un paso del plan.
    if new.parent_task_id is not null
       and exists (select 1 from public.tasks x where x.id = new.parent_task_id and x.plan_required) then
      if current_user in ('anon', 'authenticated', 'service_role') or new.plan_id is null then
        raise exception 'Las subtareas de una misión con plan solo se crean al aprobar el plan.' using errcode = 'insufficient_privilege';
      end if;
    end if;
    return new;
  end if;
  -- Nadie mueve una tarea a una misión con plan (ni la saca), ni cambia el
  -- agente o las instrucciones aprobadas de un paso.
  if new.parent_task_id is distinct from old.parent_task_id
     and exists (select 1 from public.tasks x where x.id in (new.parent_task_id, old.parent_task_id) and x.plan_required) then
    raise exception 'Una tarea no se puede mover a una misión con plan ni sacarse de ella.' using errcode = 'insufficient_privilege';
  end if;
  if old.plan_id is not null
     and (new.agent_id, new.title, new.description) is distinct from (old.agent_id, old.title, old.description) then
    raise exception 'El agente y las instrucciones de un paso aprobado no se pueden modificar.' using errcode = 'insufficient_privilege';
  end if;
  if new.plan_required is distinct from old.plan_required
     or new.plan_id is distinct from old.plan_id
     or new.plan_step_key is distinct from old.plan_step_key
     or new.budget_usd is distinct from old.budget_usd
     or new.max_calls is distinct from old.max_calls
     or new.max_searches is distinct from old.max_searches then
    raise exception 'El plan y los límites de una tarea no se pueden modificar.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.tasks_plan_guard() from public, anon, authenticated, service_role;
create trigger tasks_plan_guard before insert or update on public.tasks
  for each row execute function public.tasks_plan_guard();

-- mission_plans: solo cambia el estado (y la decisión), con transiciones
-- fijas. Aprobar, rechazar, pedir cambios y caducar solo lo hacen las
-- funciones del administrador (se ejecutan como su dueño, no como un rol de
-- la API). El servidor solo puede sustituir un plan pendiente por uno nuevo.
create or replace function public.mission_plans_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  api boolean := current_user in ('anon', 'authenticated', 'service_role');
begin
  if tg_op = 'TRUNCATE' or tg_op = 'DELETE' then
    raise exception 'Los planes de misión no se pueden borrar.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.decided_by is not null or new.decided_at is not null or new.decision_note is not null then
      raise exception 'Un plan nuevo siempre empieza pendiente.' using errcode = 'insufficient_privilege';
    end if;
    -- La huella la calcula la base de datos (nadie la elige).
    new.plan_hash := encode(sha256(convert_to(new.plan::text, 'UTF8')), 'hex');
    return new;
  end if;
  if (new.id, new.mission_id, new.version, new.kind, new.base_plan_id, new.plan, new.plan_hash, new.estimate_usd,
      new.proposed_by, new.proposed_run_id, new.expires_at, new.created_at)
     is distinct from
     (old.id, old.mission_id, old.version, old.kind, old.base_plan_id, old.plan, old.plan_hash, old.estimate_usd,
      old.proposed_by, old.proposed_run_id, old.expires_at, old.created_at) then
    raise exception 'Un plan de misión no se puede modificar.' using errcode = 'insufficient_privilege';
  end if;
  if new.status = old.status then
    if (new.decided_by, new.decided_at, new.decision_note, new.envelope_usd) is distinct from (old.decided_by, old.decided_at, old.decision_note, old.envelope_usd) then
      raise exception 'La decisión de un plan no se puede modificar.' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if old.status = 'pending' and new.status = 'superseded' then
    null; -- el servidor puede sustituir una propuesta pendiente por otra
  elsif api then
    raise exception 'Solo el administrador decide sobre un plan.' using errcode = 'insufficient_privilege';
  elsif not ((old.status = 'pending' and new.status in ('approved', 'rejected', 'changes_requested', 'expired'))
             or (old.status = 'approved' and new.status = 'superseded')) then
    raise exception 'Cambio de estado del plan no permitido (% → %).', old.status, new.status using errcode = 'insufficient_privilege';
  end if;
  if new.status = 'approved' and (new.decided_by is null or new.envelope_usd is null) then
    raise exception 'Un plan aprobado necesita al administrador que lo aprueba y su dinero comprometido.' using errcode = 'insufficient_privilege';
  end if;
  if new.status <> 'approved' and new.envelope_usd is distinct from old.envelope_usd then
    raise exception 'Solo la aprobación fija el dinero comprometido.' using errcode = 'insufficient_privilege';
  end if;
  if old.status <> 'pending' and (new.decided_by, new.decided_at, new.decision_note, new.envelope_usd) is distinct from (old.decided_by, old.decided_at, old.decision_note, old.envelope_usd) then
    raise exception 'La decisión de un plan no se puede modificar.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.mission_plans_guard() from public, anon, authenticated, service_role;
drop trigger if exists mission_plans_guard on public.mission_plans;
create trigger mission_plans_guard before insert or update or delete on public.mission_plans
  for each row execute function public.mission_plans_guard();
drop trigger if exists mission_plans_no_truncate on public.mission_plans;
create trigger mission_plans_no_truncate before truncate on public.mission_plans
  for each statement execute function public.mission_plans_guard();

-- mission_plan_steps: inmutables. Solo se anota una vez la subtarea creada
-- al aprobar (y solo lo hace la función del administrador).
create or replace function public.mission_plan_steps_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op in ('TRUNCATE', 'DELETE') then
    raise exception 'Los pasos de un plan no se pueden borrar.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if new.task_id is not null and not new.carried then
      raise exception 'Un paso nuevo no puede nacer con subtarea.' using errcode = 'insufficient_privilege';
    end if;
    if (select p.status from public.mission_plans p where p.id = new.plan_id) is distinct from 'pending' then
      raise exception 'Solo se pueden añadir pasos a un plan pendiente.' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if (new.plan_id, new.step_key, new.position, new.agent_id, new.title, new.instructions, new.depends_on, new.tools,
      new.budget_usd, new.max_calls, new.max_searches, new.carried)
     is distinct from
     (old.plan_id, old.step_key, old.position, old.agent_id, old.title, old.instructions, old.depends_on, old.tools,
      old.budget_usd, old.max_calls, old.max_searches, old.carried)
     or old.task_id is not null
     or current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'Los pasos de un plan no se pueden modificar.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.mission_plan_steps_guard() from public, anon, authenticated, service_role;
drop trigger if exists mission_plan_steps_guard on public.mission_plan_steps;
create trigger mission_plan_steps_guard before insert or update or delete on public.mission_plan_steps
  for each row execute function public.mission_plan_steps_guard();
drop trigger if exists mission_plan_steps_no_truncate on public.mission_plan_steps;
create trigger mission_plan_steps_no_truncate before truncate on public.mission_plan_steps
  for each statement execute function public.mission_plan_steps_guard();

-- ═══════════════════════ 4. Validación de un plan ═══════════════════════
-- Herramientas que puede recibir cada agente en un paso (las habilitadas en
-- AGENT_TOOLS de config.ts, sin delegar ni proponer planes). Lista cerrada:
-- ampliarla exige una migración. Una prueba comprueba que coincide con el código.
create function public.plan_step_tools() returns jsonb
language sql immutable set search_path = '' as $$
  select '{
    "marcus": ["memory.read", "crm.read", "crm.write", "content.draft", "web.search", "web.fetch"],
    "sofia": ["memory.read", "crm.read", "content.draft"]
  }'::jsonb
$$;

-- p_steps: plan completo (pasos ya aprobados + nuevos), normalizado.
-- p_new_keys: los pasos que se van a ejecutar. Devuelve su presupuesto total.
-- La usan la propuesta (servidor) y la aprobación (que revalida con el saldo
-- de ese momento). Cualquier incumplimiento cancela la operación.
create function public.validate_mission_plan(p_mission_id uuid, p_steps jsonb, p_new_keys text[])
returns numeric language plpgsql stable set search_path = '' as $$
declare
  m public.tasks;
  c jsonb := public.settings_ceilings();
  v_limits jsonb;
  v_pilot jsonb;
  s jsonb;
  v_keys text[] := '{}';
  v_done text[] := '{}';
  v_key text;
  v_agent text;
  v_total integer;
  v_progress boolean;
  v_budget numeric;
  v_calls integer;
  v_searches integer;
  v_new_usd numeric := 0;
  v_new_searches integer := 0;
  v_task_limit numeric;
  v_mission_limit numeric;
  v_monthly numeric;
  v_reserve numeric;
  v_committed numeric;
  v_used integer;
  v_max_subtasks integer;
  v_max_searches integer;
begin
  select x.* into m from public.tasks x where x.id = p_mission_id;
  select value into v_limits from public.settings where key = 'limits';
  select value into v_pilot from public.settings where key = 'pilot';
  if m.id is null or not m.plan_required then
    raise exception 'La misión no existe o no funciona con plan.';
  end if;
  if jsonb_typeof(p_steps) is distinct from 'array' then
    raise exception 'El plan debe tener una lista de pasos.';
  end if;
  v_total := jsonb_array_length(p_steps);
  v_max_subtasks := least((v_pilot ->> 'max_subtasks')::integer, (c -> 'pilot' ->> 'max_subtasks')::integer);
  v_max_searches := least((v_pilot ->> 'max_searches')::integer, (c -> 'pilot' ->> 'max_searches')::integer);
  if v_total < 1 or v_total > v_max_subtasks then
    raise exception 'El plan debe tener entre 1 y % pasos en total (tiene %).', v_max_subtasks, v_total;
  end if;
  if coalesce(cardinality(p_new_keys), 0) < 1 then
    raise exception 'El plan no añade ningún paso nuevo.';
  end if;

  v_task_limit := least((v_limits ->> 'task_ai_budget_usd')::numeric, (c -> 'limits' ->> 'task_ai_budget_usd')::numeric);
  v_mission_limit := least((v_limits ->> 'mission_ai_budget_usd')::numeric, (c -> 'limits' ->> 'mission_ai_budget_usd')::numeric);
  v_monthly := least((v_limits ->> 'monthly_ai_budget_usd')::numeric, (c -> 'limits' ->> 'monthly_ai_budget_usd')::numeric);
  v_reserve := coalesce((v_pilot ->> 'synthesis_reserve_usd')::numeric, 0);
  if v_task_limit is null or v_mission_limit is null or v_monthly is null then
    raise exception 'Faltan los límites económicos: no se puede validar el plan.';
  end if;

  -- Claves únicas.
  for s in select e from jsonb_array_elements(p_steps) e loop
    v_key := s ->> 'key';
    if v_key is null or v_key !~ '^[a-z0-9][a-z0-9_-]{0,39}$' then
      raise exception 'Clave de paso no válida: «%» (minúsculas, cifras, - y _; hasta 40).', coalesce(v_key, '');
    end if;
    if v_key = any (v_keys) then
      raise exception 'La clave de paso «%» está repetida.', v_key;
    end if;
    v_keys := v_keys || v_key;
  end loop;
  if exists (select 1 from unnest(p_new_keys) k where not (k = any (v_keys))) then
    raise exception 'Un paso nuevo no está en el plan.';
  end if;

  for s in select e from jsonb_array_elements(p_steps) e loop
    v_key := s ->> 'key';
    -- Dependencias: existen, no son el propio paso, y un paso ya aprobado
    -- nunca depende de uno nuevo.
    if jsonb_typeof(s -> 'depends_on') is distinct from 'array'
       or exists (select 1 from jsonb_array_elements(s -> 'depends_on') d where jsonb_typeof(d) <> 'string') then
      raise exception 'Las dependencias del paso «%» deben ser una lista de claves.', v_key;
    end if;
    if exists (select 1 from jsonb_array_elements_text(s -> 'depends_on') d where not (d = any (v_keys)) or d = v_key) then
      raise exception 'El paso «%» depende de un paso que no existe o de sí mismo.', v_key;
    end if;
    if not (v_key = any (p_new_keys)) then
      if exists (select 1 from jsonb_array_elements_text(s -> 'depends_on') d where d = any (p_new_keys)) then
        raise exception 'Un paso ya aprobado («%») no puede depender de uno nuevo.', v_key;
      end if;
      continue;
    end if;

    -- Agente: especialista (no coordinador), aprobado, del piloto y activo.
    v_agent := s ->> 'agent';
    if v_agent is null or v_agent = m.agent_id
       or not ((c -> 'agents') ? v_agent)
       or not (coalesce(v_pilot -> 'agents', '[]'::jsonb) ? v_agent)
       or not exists (select 1 from public.agents a where a.id = v_agent and a.active and not a.is_coordinator) then
      raise exception 'El paso «%» no se puede asignar a «%».', v_key, coalesce(v_agent, '');
    end if;
    if length(coalesce(s ->> 'title', '')) not between 3 and 300 or length(coalesce(s ->> 'instructions', '')) not between 10 and 8000 then
      raise exception 'El paso «%» necesita un título (3–300) y unas instrucciones claras (10–8000).', v_key;
    end if;
    -- Herramientas: las permitidas A ESE AGENTE en el piloto (plan_step_tools,
    -- lista cerrada) Y que tenga en la base de datos. Nunca enviar, contactar,
    -- publicar, gastar, borrar ni delegar. Sofia no recibe web aunque el
    -- registro general la incluya.
    if exists (select 1 from jsonb_array_elements_text(s -> 'tools') e
                where not coalesce((public.plan_step_tools() -> v_agent) ? e, false)) then
      raise exception 'El paso «%» pide una herramienta no permitida para % en el piloto.', v_key, v_agent;
    end if;
    -- Herramientas: solo las que el agente tiene en la base de datos.
    if jsonb_typeof(s -> 'tools') is distinct from 'array'
       or exists (select 1 from jsonb_array_elements(s -> 'tools') e where jsonb_typeof(e) <> 'string')
       or exists (select 1 from jsonb_array_elements_text(s -> 'tools') e
                   where not exists (select 1 from public.agents a where a.id = v_agent and e = any (a.tools))) then
      raise exception 'El paso «%» pide herramientas que % no tiene.', v_key, v_agent;
    end if;
    if jsonb_typeof(s -> 'budget_usd') is distinct from 'number'
       or jsonb_typeof(s -> 'max_calls') is distinct from 'number'
       or jsonb_typeof(s -> 'max_searches') is distinct from 'number' then
      raise exception 'El paso «%» necesita presupuesto, llamadas y búsquedas máximas numéricos.', v_key;
    end if;
    v_budget := (s ->> 'budget_usd')::numeric;
    if v_budget <= 0 or v_budget <> round(v_budget, 4) or v_budget > v_task_limit then
      raise exception 'Presupuesto del paso «%» no válido: % $ (entre 0 y % $, hasta 4 decimales).', v_key, v_budget, v_task_limit;
    end if;
    if (s ->> 'max_calls')::numeric <> trunc((s ->> 'max_calls')::numeric) or (s ->> 'max_calls')::numeric not between 1 and 30 then
      raise exception 'Llamadas máximas del paso «%» no válidas (entero de 1 a 30).', v_key;
    end if;
    if (s ->> 'max_searches')::numeric <> trunc((s ->> 'max_searches')::numeric) or (s ->> 'max_searches')::numeric not between 0 and v_max_searches then
      raise exception 'Búsquedas máximas del paso «%» no válidas (entero de 0 a %).', v_key, v_max_searches;
    end if;
    v_calls := (s ->> 'max_calls')::integer;
    v_searches := (s ->> 'max_searches')::integer;
    if (s -> 'tools') ? 'web.search' and v_searches < 1 then
      raise exception 'El paso «%» usa búsqueda web: necesita al menos 1 búsqueda.', v_key;
    end if;
    if not ((s -> 'tools') ? 'web.search') and v_searches <> 0 then
      raise exception 'El paso «%» no usa búsqueda web: sus búsquedas máximas deben ser 0.', v_key;
    end if;
    v_new_usd := v_new_usd + v_budget;
    v_new_searches := v_new_searches + v_searches;
  end loop;

  -- Sin ciclos (Kahn): se resuelven los pasos cuyas dependencias ya están.
  loop
    v_progress := false;
    for s in select e from jsonb_array_elements(p_steps) e loop
      v_key := s ->> 'key';
      if not (v_key = any (v_done))
         and not exists (select 1 from jsonb_array_elements_text(s -> 'depends_on') d where not (d = any (v_done))) then
        v_done := v_done || v_key;
        v_progress := true;
      end if;
    end loop;
    exit when not v_progress;
  end loop;
  if cardinality(v_done) <> v_total then
    raise exception 'Las dependencias del plan forman un ciclo.';
  end if;

  -- Economía: lo gastado y comprometido de la misión + los pasos nuevos +
  -- la reserva del informe de Alex caben en el límite de la misión (y del mes).
  v_committed := public.committed_usd('mission', m.id);
  if v_committed + v_new_usd + v_reserve > v_mission_limit then
    raise exception 'El plan no cabe en el presupuesto de la misión: % $ ya comprometidos + % $ de los pasos + % $ de reserva para el informe > % $.',
      round(v_committed, 4), v_new_usd, v_reserve, v_mission_limit;
  end if;
  -- Mes: lo gastado y reservado + lo comprometido por los planes aprobados de
  -- OTRAS misiones abiertas + este plan.
  if public.committed_usd('month', null) + public.plan_outstanding_usd(m.id) + v_new_usd + v_reserve > v_monthly then
    raise exception 'El plan no cabe en el presupuesto mensual: % $ gastados o reservados + % $ comprometidos por otros planes aprobados + % $ de este plan > % $.',
      round(public.committed_usd('month', null), 4), round(public.plan_outstanding_usd(m.id), 4), v_new_usd + v_reserve, v_monthly;
  end if;
  select coalesce(sum(u.server_tool_requests), 0) into v_used from public.ai_usage u
   where u.task_id in (select x.id from public.tasks x where x.id = m.id or x.parent_task_id = m.id);
  v_used := v_used + coalesce((select sum(r.searches) from public.ai_reservations r
                                where r.mission_id = m.id and r.status in ('open', 'uncertain')), 0);
  if v_used + v_new_searches > v_max_searches then
    raise exception 'El plan pide % búsquedas y la misión solo tiene % disponibles.', v_new_searches, greatest(0, v_max_searches - v_used);
  end if;
  return v_new_usd;
end;
$$;

-- Dinero comprometido por los planes aprobados de las misiones abiertas que
-- aún no se ha gastado ni reservado (sin contar p_exclude). Lo usan la
-- validación del plan y reserve_budget: así varias misiones aprobadas nunca
-- comprometen más que el límite mensual. Ambas bloquean la fila «limits»
-- (FOR UPDATE), así que la comprobación y la reserva son atómicas.
create function public.plan_outstanding_usd(p_exclude uuid) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(greatest(0, p.envelope_usd - public.committed_usd('mission', p.mission_id))), 0)
    from public.mission_plans p join public.tasks m on m.id = p.mission_id
   where p.status = 'approved' and p.envelope_usd is not null
     and m.status not in ('completed', 'failed')
     and p.mission_id is distinct from p_exclude;
$$;

-- Pasos de un plan tal como se guardan (comparación exacta con el JSON).
create function public.mission_plan_steps_json(p_plan_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', s.step_key, 'agent', s.agent_id, 'title', s.title, 'instructions', s.instructions,
           'depends_on', to_jsonb(s.depends_on), 'tools', to_jsonb(s.tools), 'budget_usd', s.budget_usd,
           'max_calls', s.max_calls, 'max_searches', s.max_searches, 'carried', s.carried) order by s.position), '[]'::jsonb)
    from public.mission_plan_steps s where s.plan_id = p_plan_id;
$$;

-- ═══════════════════════ 5. Propuesta (servidor, con lease) ═══════════════════════
-- p_steps: los pasos NUEVOS. En una ampliación, los aprobados se copian tal
-- cual delante (no se pueden cambiar). Idempotente por ejecución: repetir la
-- misma propuesta devuelve la existente; una distinta en la misma ejecución
-- se rechaza.
create function public.submit_mission_plan(p_run_id uuid, p_worker text, p_summary text, p_steps jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_pilot jsonb;
  v_phase text;
  v_kind text;
  v_base public.mission_plans;
  v_prev public.mission_plans;
  v_new jsonb := '[]'::jsonb;
  v_full jsonb;
  v_new_keys text[];
  v_estimate numeric;
  v_version integer;
  v_plan jsonb;
  v_id uuid;
  v_round integer;
  s jsonb;
begin
  t := public.assert_lease(p_run_id, p_worker);
  select value into v_pilot from public.settings where key = 'pilot';
  if t.parent_task_id is not null or coalesce(t.input ->> 'kind', '') <> 'mission' or not t.plan_required then
    raise exception 'Solo una misión con plan puede proponer un plan.';
  end if;
  if not exists (select 1 from public.agents a where a.id = t.agent_id and a.is_coordinator and a.active) then
    raise exception 'Solo el coordinador puede proponer un plan.';
  end if;
  if length(btrim(coalesce(p_summary, ''))) not between 10 and 4000 then
    raise exception 'El plan necesita un resumen (10–4000 caracteres).';
  end if;
  if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_array_length(p_steps) < 1 then
    raise exception 'El plan necesita al menos un paso nuevo.';
  end if;

  v_phase := coalesce(t.input ->> 'phase', 'planning');
  v_round := coalesce((t.input ->> 'round')::integer, 1);
  select p.* into v_base from public.mission_plans p where p.mission_id = t.id and p.status = 'approved';
  if v_phase = 'planning' then
    if v_base.id is not null then
      raise exception 'La misión ya tiene un plan aprobado.';
    end if;
    v_kind := 'initial';
  elsif v_phase = 'synthesis' then
    if v_base.id is null then
      raise exception 'Solo se puede ampliar un plan aprobado.';
    end if;
    if v_round > least((v_pilot ->> 'max_rounds')::integer, (public.settings_ceilings() -> 'pilot' ->> 'max_rounds')::integer) then
      raise exception 'Se alcanzó el número máximo de rondas: no se puede ampliar más el plan.';
    end if;
    v_kind := 'amendment';
  else
    raise exception 'La misión no está en una fase en la que se pueda proponer un plan.';
  end if;

  -- Normalización: solo los campos previstos, textos sin espacios sobrantes.
  for s in select e from jsonb_array_elements(p_steps) e loop
    if jsonb_typeof(s) is distinct from 'object' then
      raise exception 'Cada paso del plan debe ser un objeto.';
    end if;
    v_new := v_new || jsonb_build_array(jsonb_build_object(
      'key', s -> 'key', 'agent', s -> 'agent',
      'title', to_jsonb(btrim(coalesce(s ->> 'title', ''))), 'instructions', to_jsonb(btrim(coalesce(s ->> 'instructions', ''))),
      'depends_on', coalesce(s -> 'depends_on', '[]'::jsonb), 'tools', coalesce(s -> 'tools', '[]'::jsonb),
      'budget_usd', s -> 'budget_usd', 'max_calls', s -> 'max_calls', 'max_searches', s -> 'max_searches',
      'carried', false));
  end loop;
  if exists (select 1 from jsonb_array_elements(v_new) e
              where jsonb_typeof(e -> 'key') is distinct from 'string' or jsonb_typeof(e -> 'agent') is distinct from 'string') then
    raise exception 'Cada paso necesita una clave y un agente.';
  end if;
  select array_agg(e ->> 'key') into v_new_keys from jsonb_array_elements(v_new) e;
  v_full := case when v_kind = 'amendment'
                 then (select coalesce(jsonb_agg(e || '{"carried": true}'::jsonb), '[]'::jsonb)
                         from jsonb_array_elements(public.mission_plan_steps_json(v_base.id)) e) || v_new
                 else v_new end;

  -- Idempotencia por ejecución.
  select p.* into v_prev from public.mission_plans p where p.proposed_run_id = p_run_id;
  if v_prev.id is not null then
    if v_prev.plan -> 'steps' = v_full and v_prev.plan ->> 'summary' = btrim(p_summary) then
      return jsonb_build_object('plan_id', v_prev.id, 'version', v_prev.version, 'plan_hash', v_prev.plan_hash,
                                'estimate_usd', v_prev.estimate_usd, 'kind', v_prev.kind, 'duplicate', true);
    end if;
    raise exception 'Ya has propuesto un plan en esta ejecución: termina tu turno y espera la decisión del administrador.';
  end if;

  select coalesce(max(p.version), 0) + 1 into v_version from public.mission_plans p where p.mission_id = t.id;
  if v_version > 3 then
    raise exception 'Se alcanzó el máximo de 3 versiones del plan en esta misión.';
  end if;

  v_estimate := public.validate_mission_plan(t.id, v_full, v_new_keys);

  -- Una propuesta pendiente anterior queda sustituida.
  update public.mission_plans set status = 'superseded' where mission_id = t.id and status = 'pending';

  v_plan := jsonb_build_object('mission_id', t.id, 'version', v_version, 'kind', v_kind,
                               'summary', btrim(p_summary), 'round', v_round, 'steps', v_full);
  insert into public.mission_plans (mission_id, version, kind, base_plan_id, plan, plan_hash, estimate_usd,
                                    proposed_by, proposed_run_id, expires_at)
  values (t.id, v_version, v_kind, v_base.id, v_plan, '', v_estimate, t.agent_id, p_run_id, now() + interval '72 hours')
  returning id into v_id;

  insert into public.mission_plan_steps (plan_id, step_key, position, agent_id, title, instructions, depends_on, tools,
                                         budget_usd, max_calls, max_searches, carried, task_id)
  select v_id, e.v ->> 'key', e.n::integer, e.v ->> 'agent', e.v ->> 'title', e.v ->> 'instructions',
         array(select jsonb_array_elements_text(e.v -> 'depends_on')), array(select jsonb_array_elements_text(e.v -> 'tools')),
         (e.v ->> 'budget_usd')::numeric, (e.v ->> 'max_calls')::integer, (e.v ->> 'max_searches')::integer,
         (e.v ->> 'carried')::boolean,
         case when (e.v ->> 'carried')::boolean
              then (select b.task_id from public.mission_plan_steps b where b.plan_id = v_base.id and b.step_key = e.v ->> 'key') end
    from jsonb_array_elements(v_full) with ordinality as e(v, n);

  insert into public.task_events (task_id, agent_id, type, message, data)
  values (t.id, t.agent_id, 'plan_submitted', format('Plan v%s propuesto (%s)', v_version, v_kind),
          jsonb_build_object('plan_id', v_id, 'version', v_version, 'estimate_usd', v_estimate));
  return jsonb_build_object('plan_id', v_id, 'version', v_version,
                            'plan_hash', (select p.plan_hash from public.mission_plans p where p.id = v_id),
                            'estimate_usd', v_estimate, 'kind', v_kind, 'duplicate', false);
end;
$$;

-- Fin del turno de Alex con un plan pendiente: la misión espera la decisión.
-- started_at se vacía para que el tiempo máximo de la misión no corra
-- mientras espera (vuelve a contar al reanudarse).
create function public.await_plan_approval(p_run_id uuid, p_worker text, p_summary text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  v_plan public.mission_plans;
begin
  t := public.assert_lease(p_run_id, p_worker);
  select p.* into v_plan from public.mission_plans p where p.proposed_run_id = p_run_id and p.status = 'pending';
  if v_plan.id is null or v_plan.mission_id <> t.id then
    raise exception 'No hay un plan pendiente de esta ejecución.';
  end if;
  update public.agent_runs set status = 'succeeded', finished_at = now(), pending_approval_id = null where id = p_run_id;
  update public.tasks
     set status = 'needs_approval', attempts = 0, started_at = null, locked_by = null, locked_until = null,
         result = left(p_summary, 20000), input = input || '{"phase": "plan_review"}'::jsonb
   where id = t.id;
  insert into public.task_events (task_id, agent_id, type, from_status, to_status, message, data)
  values (t.id, t.agent_id, 'plan_review', 'in_progress', 'needs_approval',
          format('Plan v%s pendiente de tu aprobación', v_plan.version), jsonb_build_object('plan_id', v_plan.id));
  perform public.set_agent_state(t.agent_id, 'waiting_approval', t.id, 'Esperando tu aprobación del plan');
  return jsonb_build_object('plan_id', v_plan.id, 'version', v_plan.version);
end;
$$;

-- ═══════════════════════ 6. Decisiones del administrador ═══════════════════════
-- Plan y misión bloqueados; versión y huella exactas; caducidad.
create function public.lock_plan_for_decision(p_plan_id uuid, p_version integer, p_hash text)
returns public.mission_plans language plpgsql set search_path = '' as $$
declare
  p public.mission_plans;
  m public.tasks;
begin
  select x.* into p from public.mission_plans x where x.id = p_plan_id for update;
  if p.id is null then
    raise exception 'El plan no existe.';
  end if;
  select x.* into m from public.tasks x where x.id = p.mission_id for update;
  if p.status <> 'pending' then
    raise exception 'Este plan ya no está pendiente (estado: %).', p.status;
  end if;
  if p.version is distinct from p_version or p.plan_hash is distinct from p_hash then
    raise exception 'El plan ha cambiado desde que lo abriste: vuelve a cargar la página.';
  end if;
  if m.status <> 'needs_approval' or coalesce(m.input ->> 'phase', '') <> 'plan_review' or not m.plan_required then
    raise exception 'La misión no está esperando la aprobación de un plan.';
  end if;
  if public.mission_plan_steps_json(p.id) is distinct from p.plan -> 'steps' then
    raise exception 'Los pasos guardados no coinciden con el plan: no se puede decidir.';
  end if;
  return p;
end;
$$;

-- Caducidad (72 h): el plan queda caducado y la misión se detiene.
create function public.expire_mission_plan(p_plan public.mission_plans)
returns jsonb language plpgsql set search_path = '' as $$
begin
  update public.mission_plans set status = 'expired', decided_at = now() where id = p_plan.id;
  perform public.cancel_mission(p_plan.mission_id, 'El plan caducó sin decisión (72 h).');
  insert into public.activity_log (actor_type, actor_id, action, entity_type, entity_id, details)
  values ('system', null, 'plan.expired', 'mission_plan', p_plan.id::text,
          jsonb_build_object('mission_id', p_plan.mission_id, 'version', p_plan.version, 'plan_hash', p_plan.plan_hash));
  return jsonb_build_object('ok', false, 'reason', 'expired');
end;
$$;

create function public.approve_mission_plan(p_plan_id uuid, p_version integer, p_hash text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.mission_plans;
  m public.tasks;
  st public.mission_plan_steps;
  v_new_keys text[];
  v_estimate numeric;
  v_round integer;
  v_id uuid;
  v_dep text;
  v_n integer := 0;
begin
  if not public.is_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  -- Serializa con las reservas: la revalidación ve el saldo real.
  perform 1 from public.settings where key = 'limits' for update;
  p := public.lock_plan_for_decision(p_plan_id, p_version, p_hash);
  if p.expires_at <= now() then
    return public.expire_mission_plan(p);
  end if;
  select x.* into m from public.tasks x where x.id = p.mission_id;
  v_round := coalesce((m.input ->> 'round')::integer, 1);

  -- Ampliación: el plan aprobado de base sigue vigente y sus pasos no han cambiado.
  if p.kind = 'amendment' then
    if not exists (select 1 from public.mission_plans b where b.id = p.base_plan_id and b.status = 'approved')
       or (select coalesce(jsonb_agg(e - 'carried' order by n), '[]'::jsonb)
             from jsonb_array_elements(p.plan -> 'steps') with ordinality as x(e, n) where (e ->> 'carried')::boolean)
          is distinct from
          (select coalesce(jsonb_agg(e - 'carried' order by n), '[]'::jsonb)
             from jsonb_array_elements(public.mission_plan_steps_json(p.base_plan_id)) with ordinality as x(e, n)) then
      raise exception 'El plan aprobado de base ha cambiado: la ampliación no se puede aprobar.';
    end if;
    if v_round > least((select (value ->> 'max_rounds')::integer from public.settings where key = 'pilot'),
                       (public.settings_ceilings() -> 'pilot' ->> 'max_rounds')::integer) then
      raise exception 'Se alcanzó el número máximo de rondas.';
    end if;
  end if;

  select array_agg(s.step_key order by s.position) into v_new_keys
    from public.mission_plan_steps s where s.plan_id = p.id and not s.carried;
  -- Revalidación completa con el estado actual (agentes, herramientas, saldo…).
  v_estimate := public.validate_mission_plan(p.mission_id, p.plan -> 'steps', v_new_keys);

  update public.mission_plans set status = 'superseded' where mission_id = p.mission_id and status = 'approved';
  update public.mission_plans
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = left(nullif(btrim(p_note), ''), 2000),
         envelope_usd = round(public.committed_usd('mission', p.mission_id) + v_estimate
                              + coalesce((select (value ->> 'synthesis_reserve_usd')::numeric from public.settings where key = 'pilot'), 0), 4)
   where id = p.id;

  -- Subtareas de los pasos nuevos (idempotencia por misión y clave de paso).
  for st in select * from public.mission_plan_steps s where s.plan_id = p.id and not s.carried order by s.position loop
    insert into public.tasks (title, description, status, priority, agent_id, created_by, parent_task_id,
                              client_id, project_id, idempotency_key, input, timeout_seconds,
                              plan_required, plan_id, plan_step_key, budget_usd, max_calls, max_searches)
    values (st.title, st.instructions, 'assigned', m.priority, st.agent_id, m.agent_id, m.id,
            m.client_id, m.project_id, 'plan:' || m.id::text || ':' || st.step_key,
            jsonb_build_object('kind', 'subtask', 'round', v_round, 'plan_step', st.step_key), 1800,
            false, p.id, st.step_key, st.budget_usd, st.max_calls, st.max_searches)
    returning id into v_id;
    update public.mission_plan_steps set task_id = v_id where plan_id = p.id and step_key = st.step_key;
    insert into public.task_events (task_id, agent_id, type, to_status, message, data)
    values (v_id, st.agent_id, 'task_assigned', 'assigned', left(st.title, 300),
            jsonb_build_object('parent_task_id', m.id, 'by', 'plan', 'plan_id', p.id, 'step', st.step_key));
    perform public.set_agent_state(st.agent_id, 'receiving', v_id, left(st.title, 120))
      where (select a.current_task_id from public.agents a where a.id = st.agent_id) is null;
    v_n := v_n + 1;
  end loop;
  for st in select * from public.mission_plan_steps s where s.plan_id = p.id and not s.carried loop
    foreach v_dep in array st.depends_on loop
      insert into public.task_dependencies (task_id, depends_on)
      select st_task.task_id, dep.task_id
        from public.mission_plan_steps st_task, public.mission_plan_steps dep
       where st_task.plan_id = p.id and st_task.step_key = st.step_key
         and dep.plan_id = p.id and dep.step_key = v_dep and dep.task_id is not null
      on conflict do nothing;
    end loop;
  end loop;

  -- La misión espera a los pasos nuevos y vuelve a Alex para la síntesis.
  insert into public.task_dependencies (task_id, depends_on)
  select m.id, s.task_id from public.mission_plan_steps s where s.plan_id = p.id and not s.carried
  on conflict do nothing;
  update public.tasks
     set status = 'assigned', attempts = 0, started_at = null, locked_by = null, locked_until = null,
         input = (input - 'plan_feedback' - 'plan_feedback_version') || jsonb_build_object('phase', 'synthesis', 'round', v_round + 1)
   where id = m.id;
  insert into public.task_events (task_id, agent_id, type, from_status, to_status, message, data)
  values (m.id, m.agent_id, 'plan_approved', 'needs_approval', 'assigned',
          format('Plan v%s aprobado por el administrador: %s paso(s)', p.version, v_n),
          jsonb_build_object('plan_id', p.id, 'version', p.version, 'plan_hash', p.plan_hash, 'estimate_usd', v_estimate));
  perform public.set_agent_state(m.agent_id, 'waiting_agent', m.id, 'Esperando a su equipo');
  insert into public.activity_log (actor_type, actor_id, action, entity_type, entity_id, details)
  values ('admin', auth.uid()::text, 'plan.approved', 'mission_plan', p.id::text,
          jsonb_build_object('mission_id', p.mission_id, 'version', p.version, 'kind', p.kind, 'plan_hash', p.plan_hash,
                             'estimate_usd', v_estimate, 'steps', v_n, 'note', left(nullif(btrim(p_note), ''), 2000)));
  return jsonb_build_object('ok', true, 'tasks', v_n, 'estimate_usd', v_estimate);
end;
$$;

-- p_mode = 'changes': vuelve a Alex con el motivo (máximo 3 versiones).
-- p_mode = 'reject': rechazo definitivo; la misión se cancela.
create function public.reject_mission_plan(p_plan_id uuid, p_version integer, p_hash text, p_reason text, p_mode text)
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

-- ═══════════════════════ 7. delegate_task: no en misiones con plan ═══════════════════════
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

  -- 0013 · Una misión con plan solo crea subtareas al aprobar el administrador.
  if t.plan_required then
    raise exception 'Esta misión funciona con un plan aprobado: no se puede delegar directamente.';
  end if;
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

-- ═══════════════════════ 8. reserve_budget: límites del paso ═══════════════════════
-- Igual que en 0007, más los límites de un paso del plan:
--   - presupuesto del paso (budget_usd)   → motivo step_budget
--   - llamadas máximas (max_calls)        → motivo max_calls (cuentan todas las
--     reservas de la tarea salvo las liberadas: también las inciertas)
--   - búsquedas del paso (max_searches)   → se conceden como mucho las que quedan
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

-- ═══════════════════════ 9. Permisos ═══════════════════════
alter table public.mission_plans enable row level security;
alter table public.mission_plan_steps enable row level security;
drop policy if exists "admin: leer planes" on public.mission_plans;
create policy "admin: leer planes" on public.mission_plans for select to authenticated using (public.is_admin());
drop policy if exists "admin: leer pasos de planes" on public.mission_plan_steps;
create policy "admin: leer pasos de planes" on public.mission_plan_steps for select to authenticated using (public.is_admin());
revoke all on public.mission_plans, public.mission_plan_steps from anon;
revoke insert, update, delete, truncate, references, trigger on public.mission_plans, public.mission_plan_steps from authenticated;
grant select on public.mission_plans, public.mission_plan_steps to authenticated;
revoke delete, truncate, references, trigger on public.mission_plans, public.mission_plan_steps from service_role;
grant select, insert, update on public.mission_plans, public.mission_plan_steps to service_role;

do $$
declare f text;
begin
  -- Funciones del motor: solo el servidor.
  foreach f in array array[
    'public.validate_mission_plan(uuid, jsonb, text[])',
    'public.plan_outstanding_usd(uuid)',
    'public.plan_step_tools()',
    'public.mission_plan_steps_json(uuid)',
    'public.submit_mission_plan(uuid, text, text, jsonb)',
    'public.await_plan_approval(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Piezas internas de las decisiones: nadie de la API.
  foreach f in array array[
    'public.lock_plan_for_decision(uuid, integer, text)',
    'public.expire_mission_plan(public.mission_plans)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  -- Decisiones: solo el administrador (is_admin dentro de la función).
  foreach f in array array[
    'public.approve_mission_plan(uuid, integer, text, text)',
    'public.reject_mission_plan(uuid, integer, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
