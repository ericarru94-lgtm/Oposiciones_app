-- HE SIGNAL AI OFFICE · 0005 · Endurecimiento final e idempotencia
--
-- Sin operaciones destructivas: solo REVOKE, columnas/tablas/funciones
-- nuevas, CREATE OR REPLACE y restricciones sobre una columna sin uso.
--
-- 1. Privilegios mínimos: Supabase concede por defecto ALL (incluido
--    TRUNCATE, que ignora RLS) a anon y authenticated. No se puede usar
--    desde la API REST, pero se retira por defensa en profundidad.
-- 2. approvals.payload queda bloqueada (siempre vacía).
-- 3. El alta automática del administrador exige el email confirmado.
-- 4. tool_executions: registro previo a cada acción con efectos para que
--    un reintento nunca la repita (idempotencia).
-- 5. documents_for_task(): documentos aislados por cliente para los agentes.

-- ═══════════════════════ 1. Privilegios mínimos ═══════════════════════

-- anon (visitante sin sesión) no necesita ninguna tabla ni función.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;

-- authenticated: nada de TRUNCATE / REFERENCES / TRIGGER.
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Tablas y vistas de solo lectura para el navegador.
revoke insert, update, delete on public.admins, public.agent_runs, public.memory_item_versions,
  public.ai_cost_monthly, public.agent_run_stats_monthly from authenticated;

-- Funciones internas: solo el servidor.
revoke execute on function public.args_fingerprint(jsonb) from authenticated;
grant execute on function public.args_fingerprint(jsonb) to service_role;

-- Lo mismo para lo que se cree en el futuro.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

-- ═══════════════════════ 2. approvals.payload ═══════════════════════

comment on column public.approvals.payload is 'Obsoleta desde 0004. Usar «arguments». Siempre vacía.';
alter table public.approvals add constraint approvals_payload_unused check (payload = '{}'::jsonb);

-- ═══════════════════════ 3. Alta del administrador ═══════════════════════

create or replace function private.link_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null
     and exists (select 1 from private.admin_allowlist where email = lower(new.email)) then
    insert into public.admins (user_id, email)
    values (new.id, lower(new.email))
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.link_admin() from public, anon, authenticated;

create trigger on_auth_user_confirmed_link_admin
  after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.link_admin();

-- ═══════════════════════ 4. Idempotencia de acciones ═══════════════════════

create table public.tool_executions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  tool_use_id text not null,
  approval_id uuid unique references public.approvals (id) on delete set null,
  tool_id text not null,
  action text not null,
  args_hash text not null,
  -- started: registrada antes de ejecutar. unknown: el proceso se cortó y
  -- no se sabe si el proveedor la completó (requiere verificación humana).
  status text not null default 'started' check (status in ('started', 'succeeded', 'failed', 'unknown')),
  provider_ref text,
  result text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (run_id, tool_use_id)
);
alter table public.tool_executions enable row level security;
create policy "admin: solo lectura" on public.tool_executions
  for select to authenticated using ((select public.is_admin()));
revoke insert, update, delete, truncate, references, trigger on public.tool_executions from anon, authenticated;
revoke select on public.tool_executions from anon;

-- Punto único antes de ejecutar una herramienta con efectos. En una sola
-- transacción: comprueba si esa llamada ya se ejecutó, consume la
-- aprobación (si la requiere) y registra la ejecución como «started».
create function public.begin_tool_execution(
  p_run_id uuid, p_worker text, p_tool_use_id text, p_tool_id text, p_action text,
  p_arguments jsonb, p_approval_id uuid default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  e public.tool_executions;
  v_hash text := public.args_fingerprint(p_arguments);
  v_ok boolean;
begin
  perform public.assert_lease(p_run_id, p_worker);

  select * into e from public.tool_executions
   where run_id = p_run_id and tool_use_id = p_tool_use_id
   for update;
  if e.id is not null then
    if e.status in ('started', 'unknown') then
      update public.tool_executions set status = 'unknown' where id = e.id;
      return jsonb_build_object('outcome', 'uncertain', 'execution_id', e.id);
    end if;
    return jsonb_build_object('outcome', 'replay', 'execution_id', e.id, 'status', e.status, 'result', e.result);
  end if;

  if p_approval_id is not null then
    v_ok := public.consume_approval(p_approval_id, p_run_id, p_tool_id, p_action, p_arguments);
    if not v_ok then
      return jsonb_build_object('outcome', 'denied');
    end if;
  end if;

  insert into public.tool_executions (run_id, tool_use_id, approval_id, tool_id, action, args_hash)
  values (p_run_id, p_tool_use_id, p_approval_id, p_tool_id, p_action, v_hash)
  returning * into e;
  return jsonb_build_object('outcome', 'started', 'execution_id', e.id);
end;
$$;

create function public.finish_tool_execution(
  p_execution_id uuid, p_worker text, p_succeeded boolean, p_result text, p_provider_ref text default null
) returns void
language plpgsql set search_path = '' as $$
declare
  e public.tool_executions;
begin
  select * into e from public.tool_executions where id = p_execution_id for update;
  if e.id is null or e.status <> 'started' then
    raise exception 'La ejecución no existe o ya está cerrada.';
  end if;
  perform public.assert_lease(e.run_id, p_worker);
  update public.tool_executions
     set status = case when p_succeeded then 'succeeded' else 'failed' end,
         result = left(p_result, 20000), provider_ref = p_provider_ref, finished_at = now()
   where id = p_execution_id;
end;
$$;

revoke all on function public.begin_tool_execution(uuid, text, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.finish_tool_execution(uuid, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.begin_tool_execution(uuid, text, text, text, text, jsonb, uuid) to service_role;
grant execute on function public.finish_tool_execution(uuid, text, boolean, text, text) to service_role;

-- ═══════════════════════ 5. Documentos por tarea ═══════════════════════

create function public.documents_for_task(p_task_id uuid)
returns setof public.documents language sql stable set search_path = '' as $$
  select d.* from public.documents d
    join public.tasks t on t.id = p_task_id
   where d.task_id = t.id
      or (d.client_id is null and d.project_id is null and d.task_id is null)
      or (t.client_id is not null and d.client_id = t.client_id)
      or (t.project_id is not null and d.project_id = t.project_id)
   order by d.created_at desc;
$$;
revoke all on function public.documents_for_task(uuid) from public, anon, authenticated;
grant execute on function public.documents_for_task(uuid) to service_role;
