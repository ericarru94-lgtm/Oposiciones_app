-- HE SIGNAL AI OFFICE · 0008 · Entregas, procedencia de datos y Realtime
--
-- Aditiva y no destructiva: dos tablas nuevas, una vista, funciones nuevas,
-- una clave nueva en settings (sin pisar las existentes), tablas añadidas a
-- la publicación de Realtime y retirada de permisos de escritura que la
-- interfaz no usa. No modifica datos existentes ni funciones anteriores.
--
-- 1. task_deliveries: qué recibe cada agente (fichas, documentos y versiones),
--    con estados preparado → enviado → recibido.
-- 2. company_facts: un registro inmutable por dato, con fuente, fecha de
--    consulta del sistema, tipo de fuente, estado, confianza y contradicciones.
--    La confianza la calcula la base de datos con una regla configurable.
-- 3. Realtime: fichas, documentos, coste, herramientas, entregas y hechos.
-- 4. Mínimo privilegio: el administrador ya no escribe en documents ni en
--    task_dependencies desde el navegador (la interfaz no lo hace).

-- ═══════════════════════ 1. Regla de confianza (configurable) ═══════════════════════
-- Puntuaciones de CLASIFICACIÓN (no probabilidades). Antigüedad: si se conoce la
-- fecha de la fuente, se resta por tramos. Un agente puede bajar la puntuación
-- con un motivo, nunca subirla.
insert into public.settings (key, value)
values ('confidence_rules', '{
  "base": {
    "official_direct": 95,
    "official_indirect": 90,
    "directory": 80,
    "third_party": 70,
    "self_declared": 60,
    "inference": 40,
    "none": 0
  },
  "age_penalties": [
    {"older_than_days": 365, "penalty": 10},
    {"older_than_days": 730, "penalty": 20}
  ],
  "contradiction_penalty": 0
}'::jsonb)
on conflict (key) do nothing;

-- ═══════════════════════ 2. Hechos de las fichas ═══════════════════════
create table public.company_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  fact_key text not null check (fact_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  fact_value text not null check (length(fact_value) between 1 and 2000),
  source_url text check (source_url is null or source_url ~* '^https?://'),
  source_type text not null check (source_type in
    ('official_direct', 'official_indirect', 'directory', 'third_party', 'self_declared', 'inference', 'none')),
  -- Fecha de publicación o actualización de la FUENTE, si la fuente la muestra.
  source_date date,
  -- Fecha de consulta: la pone el sistema, nunca el agente.
  observed_at timestamptz not null default now(),
  verification_status text not null check (verification_status in ('verified', 'estimated', 'pending')),
  confidence_score smallint not null check (confidence_score between 0 and 100),
  confidence_reason text not null check (length(confidence_reason) between 1 and 1000),
  -- Hechos activos del mismo dato con otro valor en el momento de registrar este.
  contradicts_fact_ids uuid[] not null default '{}',
  created_by_agent text references public.agents (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  supersedes_fact_id uuid references public.company_facts (id) on delete set null,
  created_at timestamptz not null default now(),
  check (source_type = 'none' or source_type = 'inference' or source_url is not null)
);
create index company_facts_company_idx on public.company_facts (company_id, fact_key);
create index company_facts_task_idx on public.company_facts (task_id);
create index company_facts_supersedes_idx on public.company_facts (supersedes_fact_id);
alter table public.company_facts enable row level security;
create policy "admin: leer hechos" on public.company_facts for select to authenticated using (public.is_admin());
revoke all on public.company_facts from anon;
revoke insert, update, delete, truncate, references, trigger on public.company_facts from authenticated;
grant select on public.company_facts to authenticated;

-- Histórico inmutable: un hecho nunca se modifica; se registra otro que lo sustituye.
create function public.company_facts_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Los hechos de las fichas no se modifican: registra uno nuevo con supersedes_fact_id.';
end;
$$;
create trigger company_facts_no_update before update on public.company_facts
  for each row execute function public.company_facts_immutable();

-- Hechos vigentes (no sustituidos) con su contradicción calculada en ambos sentidos.
create view public.company_facts_current with (security_invoker = true) as
select f.*,
       exists (
         select 1 from public.company_facts o
          where o.company_id = f.company_id and o.fact_key = f.fact_key and o.id <> f.id
            and lower(btrim(o.fact_value)) <> lower(btrim(f.fact_value))
            and not exists (select 1 from public.company_facts s where s.supersedes_fact_id = o.id)
       ) as in_contradiction
  from public.company_facts f
 where not exists (select 1 from public.company_facts s where s.supersedes_fact_id = f.id);
revoke all on public.company_facts_current from anon;
revoke insert, update, delete, truncate, references, trigger on public.company_facts_current from authenticated;
grant select on public.company_facts_current to authenticated;

-- Puntuación según la regla (determinista). Devuelve puntuación y motivo.
create function public.fact_confidence(p_source_type text, p_source_date date, p_lower_to smallint, p_reason text)
returns table (score smallint, reason text)
language plpgsql stable set search_path = '' as $$
declare
  v_rules jsonb;
  v_score integer;
  v_reason text;
  v_age integer;
  v_pen record;
  v_penalty integer := 0;
begin
  select value into v_rules from public.settings where key = 'confidence_rules';
  v_score := coalesce((v_rules -> 'base' ->> p_source_type)::integer, 0);
  v_reason := 'Regla: ' || p_source_type || ' = ' || v_score;
  if p_source_date is not null then
    v_age := current_date - p_source_date;
    for v_pen in select (x ->> 'older_than_days')::integer d, (x ->> 'penalty')::integer p
                   from jsonb_array_elements(coalesce(v_rules -> 'age_penalties', '[]'::jsonb)) x loop
      if v_age > v_pen.d then
        v_penalty := greatest(v_penalty, v_pen.p);
      end if;
    end loop;
    if v_penalty > 0 then
      v_score := greatest(0, v_score - v_penalty);
      v_reason := v_reason || '; fuente de hace ' || v_age || ' días: −' || v_penalty;
    end if;
  elsif p_source_type not in ('none', 'inference') then
    v_reason := v_reason || '; fecha de la fuente desconocida (sin ajuste por antigüedad)';
  end if;
  -- El agente puede bajar la puntuación, nunca subirla.
  if p_lower_to is not null and p_lower_to < v_score then
    v_score := greatest(0, p_lower_to);
    v_reason := v_reason || '; rebajada por el agente a ' || v_score || ': ' || coalesce(nullif(btrim(p_reason), ''), 'sin motivo');
  end if;
  return query select v_score::smallint, left(v_reason, 1000);
end;
$$;

-- Registro de un hecho (solo el servidor, dentro de la ejecución con lease).
create function public.record_company_fact(
  p_run_id uuid, p_worker text, p_company_id uuid, p_fact_key text, p_fact_value text,
  p_source_url text, p_source_type text, p_verification_status text, p_source_date date,
  p_lower_to smallint default null, p_reason text default null, p_supersedes uuid default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  t public.tasks;
  c record;
  v_contra uuid[];
  v_id uuid;
begin
  t := public.assert_lease(p_run_id, p_worker);
  if p_supersedes is not null and not exists (
    select 1 from public.company_facts where id = p_supersedes and company_id = p_company_id and fact_key = p_fact_key
  ) then
    raise exception 'El hecho que se sustituye no corresponde a esta ficha y dato.';
  end if;
  select coalesce(array_agg(o.id), '{}') into v_contra
    from public.company_facts o
   where o.company_id = p_company_id and o.fact_key = p_fact_key
     and o.id is distinct from p_supersedes
     and lower(btrim(o.fact_value)) <> lower(btrim(p_fact_value))
     and not exists (select 1 from public.company_facts s where s.supersedes_fact_id = o.id);
  select * into c from public.fact_confidence(p_source_type, p_source_date, p_lower_to, p_reason);
  insert into public.company_facts (company_id, fact_key, fact_value, source_url, source_type, source_date,
                                    verification_status, confidence_score, confidence_reason, contradicts_fact_ids,
                                    created_by_agent, task_id, supersedes_fact_id)
  values (p_company_id, p_fact_key, p_fact_value, p_source_url, p_source_type, p_source_date,
          p_verification_status, c.score, c.reason, v_contra, t.agent_id, t.id, p_supersedes)
  returning id into v_id;
  return jsonb_build_object('fact_id', v_id, 'confidence_score', c.score, 'confidence_reason', c.reason,
                            'contradicts', to_jsonb(v_contra));
end;
$$;

-- ═══════════════════════ 3. Entregas ═══════════════════════
create table public.task_deliveries (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.tasks (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  run_id uuid references public.agent_runs (id) on delete set null,
  from_agent text not null,
  to_agent text not null,
  company_ids uuid[] not null default '{}',
  -- {company_id: updated_at} en el momento de preparar la entrega.
  company_versions jsonb not null default '{}',
  document_ids uuid[] not null default '{}',
  -- {document_id: {"version": n, "updated_at": …, "chars": n, "truncated": bool}}
  document_versions jsonb not null default '{}',
  -- Elementos que no se pudieron entregar o se recortaron, con motivo.
  omitted jsonb not null default '[]',
  -- prepared: incluida en el mensaje del agente · sent: petición enviada a Claude
  -- · received: Claude respondió a una petición que la contenía.
  status text not null default 'prepared' check (status in ('prepared', 'sent', 'received')),
  prepared_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz
);
create index task_deliveries_mission_idx on public.task_deliveries (mission_id);
create index task_deliveries_run_idx on public.task_deliveries (run_id);
create index task_deliveries_task_idx on public.task_deliveries (task_id);
alter table public.task_deliveries enable row level security;
create policy "admin: leer entregas" on public.task_deliveries for select to authenticated using (public.is_admin());
revoke all on public.task_deliveries from anon;
revoke insert, update, delete, truncate, references, trigger on public.task_deliveries from authenticated;
grant select on public.task_deliveries to authenticated;

-- Estado de las entregas de una ejecución: solo avanza (preparado → enviado → recibido).
create function public.advance_deliveries(p_run_id uuid, p_worker text, p_status text)
returns integer language plpgsql set search_path = '' as $$
declare
  v_n integer;
begin
  perform public.assert_lease(p_run_id, p_worker);
  if p_status not in ('sent', 'received') then
    raise exception 'Estado de entrega no válido.';
  end if;
  update public.task_deliveries
     set status = p_status,
         sent_at = coalesce(sent_at, now()),
         received_at = case when p_status = 'received' then coalesce(received_at, now()) else received_at end
   where run_id = p_run_id
     and (status = 'prepared' or (status = 'sent' and p_status = 'received'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ═══════════════════════ 4. Realtime ═══════════════════════
do $$
declare t text;
begin
  foreach t in array array['companies', 'documents', 'ai_usage', 'tool_executions', 'task_deliveries', 'company_facts'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ═══════════════════════ 5. Mínimo privilegio ═══════════════════════
-- La interfaz solo LEE documentos y nunca toca las dependencias; las escribe el motor.
revoke insert, update, delete on public.documents from authenticated;
revoke insert, update, delete on public.task_dependencies from authenticated;

-- ═══════════════════════ Permisos de funciones ═══════════════════════
do $$
declare f text;
begin
  foreach f in array array[
    'public.company_facts_immutable()',
    'public.fact_confidence(text, date, smallint, text)',
    'public.record_company_fact(uuid, text, uuid, text, text, text, text, text, date, smallint, text, uuid)',
    'public.advance_deliveries(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
