-- HE SIGNAL AI OFFICE · 0010 · Endurecimiento de la configuración de agentes
--
-- Fase 5.1.1. Se aplica en UNA transacción. No toca datos de agentes, tareas,
-- presupuestos, RLS ni políticas, y no añade funciones SECURITY DEFINER.
--
-- 1. Permiso: retira a «authenticated» el UPDATE directo de model, effort y
--    active sobre public.agents (concedido en 0004, líneas 35-36). Ninguna
--    pantalla ni acción del código lo usa. service_role y postgres no cambian.
--
-- 2. Activación: restricción CHECK con la lista aprobada (alex, marcus,
--    sofia). Es la ÚNICA autoridad en la base de datos para poder tener
--    active = true. Afecta a todos los roles, incluidos service_role y
--    postgres, y solo se cambia con otra migración. No se usa
--    settings.pilot.agents porque el administrador puede editar settings desde
--    el navegador (INSERT/UPDATE/DELETE): sería una protección falsa.
--    La lista coincide con ACTIVE_AGENT_IDS (src/lib/agents/catalog.ts); una
--    prueba impide que diverjan y el seed falla si alguien activa a otro
--    agente solo en el código.
--
-- 3. Auditoría: un trigger escribe en activity_log una única fila por
--    operación que cambie de verdad active, model o effort (o al crear un
--    agente). El actor solo se identifica cuando es fiable (JWT de usuario
--    validado por la API); en otro caso se registra como «desconocido» con
--    actor_type = 'system'. authenticated no puede crear filas 'system'
--    (políticas de 0001/0004), así que no puede falsificar estos registros.
--
-- Marcha atrás: supabase/checks/0010_rollback.sql.

-- ═══════════════════════ 1. Sin UPDATE directo desde el navegador ═══════════════════════
revoke update (model, effort, active) on public.agents from authenticated;

-- ═══════════════════════ 2. Solo los agentes aprobados pueden estar activos ═══════════════════════
alter table public.agents
  add constraint agents_active_aprobados
  check (not active or id in ('alex', 'marcus', 'sofia'));

-- ═══════════════════════ 3. Auditoría de active, model y effort ═══════════════════════
create function public.log_agent_config_change() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_claims jsonb;
  v_role text;
  v_uid uuid;
  v_actor_type text := 'system';
  v_actor_id text;
  v_origin text;
begin
  if tg_op = 'INSERT' then
    v_changes := jsonb_build_object(
      'active', jsonb_build_object('antes', null, 'despues', new.active),
      'model', jsonb_build_object('antes', null, 'despues', new.model),
      'effort', jsonb_build_object('antes', null, 'despues', new.effort));
  else
    if old.active is distinct from new.active then
      v_changes := v_changes || jsonb_build_object('active', jsonb_build_object('antes', old.active, 'despues', new.active));
    end if;
    if old.model is distinct from new.model then
      v_changes := v_changes || jsonb_build_object('model', jsonb_build_object('antes', old.model, 'despues', new.model));
    end if;
    if old.effort is distinct from new.effort then
      v_changes := v_changes || jsonb_build_object('effort', jsonb_build_object('antes', old.effort, 'despues', new.effort));
    end if;
    if v_changes = '{}'::jsonb then
      return null; -- sin cambios reales: no se registra nada
    end if;
  end if;

  -- Contexto de la petición (lo fija la API de Supabase a partir de un JWT validado).
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null; -- un valor ilegible no se interpreta
  end;
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), v_claims ->> 'role');
  begin
    v_uid := coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), v_claims ->> 'sub')::uuid;
  exception when others then
    v_uid := null;
  end;

  if v_role = 'authenticated' and v_uid is not null then
    v_actor_type := 'admin';
    v_actor_id := v_uid::text;
    v_origin := 'api (usuario autenticado)';
  elsif v_role = 'service_role' then
    v_origin := 'api (service_role: servidor de la oficina)';
  elsif v_role is null and current_user in ('postgres', 'supabase_admin') then
    v_origin := 'sql directo (migración, seed o editor SQL)';
  else
    v_origin := 'desconocido';
  end if;

  insert into public.activity_log (actor_type, actor_id, action, entity_type, entity_id, details)
  values (
    v_actor_type, v_actor_id,
    case when tg_op = 'INSERT' then 'agent.created' else 'agent.config_changed' end,
    'agent', new.id,
    jsonb_build_object(
      'cambios', v_changes,
      'actor', case when v_actor_id is null then 'desconocido' else v_actor_id end,
      'origen', v_origin,
      'rol_bd', current_user,
      'rol_jwt', v_role,
      'registrado_por', 'trigger agents_config_audit (0010)'));
  return null;
end;
$$;

revoke all on function public.log_agent_config_change() from public, anon, authenticated;

create trigger agents_config_audit
  after update of active, model, effort on public.agents
  for each row
  when (old.active is distinct from new.active or old.model is distinct from new.model or old.effort is distinct from new.effort)
  execute function public.log_agent_config_change();

create trigger agents_config_audit_insert
  after insert on public.agents
  for each row execute function public.log_agent_config_change();
