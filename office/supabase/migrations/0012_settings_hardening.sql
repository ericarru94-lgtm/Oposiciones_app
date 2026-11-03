-- HE SIGNAL AI OFFICE · 0012 · settings: límites con techo, piloto y reglas inmutables, auditoría
--
-- Fase 5.1.3. Se aplica en UNA transacción. REQUIERE 0011 (lo comprueba).
-- No cambia ningún valor existente: si un valor guardado no cumpliera las
-- reglas, la migración se cancela sin tocar nada (no se sobrescribe).
-- En producción (02/11/2026): limits = 10 / 1 / 1 y pilot = 2 rondas, 6
-- subtareas, 15 búsquedas, 5 empresas, 0,25 $ de reserva, parada por
-- sobrecoste activada: todos dentro de las reglas.
--
-- 1. Techos aprobados en UNA función (settings_ceilings): la usan el
--    validador, la acción del servidor y el formulario.
-- 2. Validación (todos los roles, también service_role y postgres):
--    - limits: los tres importes obligatorios, numéricos, >= 0, dentro del
--      techo, y tarea y misión <= mensual. Nunca NULL («sin límite»).
--    - pilot: claves completas, valores dentro de los límites actuales,
--      parada por sobrecoste siempre activada y reserva de síntesis 0–0,25 $.
--    - notifications: solo interruptores booleanos.
--    - limits, pilot y confidence_rules no se pueden borrar ni renombrar, y
--      la tabla no se puede vaciar.
-- 3. Permisos de authenticated: sin INSERT ni DELETE; UPDATE solo de la
--    columna value y solo en limits y notifications (política RESTRICTIVE).
--    pilot y confidence_rules quedan solo para migraciones y el servidor.
-- 4. Auditoría: cada cambio real escribe settings.changed en activity_log.
--    La función es SECURITY DEFINER (la única nueva): tiene que escribir
--    cuando el cambio lo hace el administrador, y con 0011 él no puede usar
--    esa acción; así nadie desde el navegador puede falsificarla. No se
--    puede llamar directamente (sin EXECUTE para ningún rol de la API).
--
-- Marcha atrás: supabase/checks/0012_rollback.sql.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'activity_log'
                  and policyname = 'actividad: acciones de la interfaz') then
    raise exception '0012 necesita 0011 (acciones cerradas de activity_log) aplicada antes.';
  end if;
end $$;

-- ═══════════════════════ 1. Techos aprobados ═══════════════════════
create function public.settings_ceilings() returns jsonb
language sql immutable set search_path = '' as $$
  select '{
    "limits": {"monthly_ai_budget_usd": 10, "mission_ai_budget_usd": 1, "task_ai_budget_usd": 1},
    "pilot": {"max_rounds": 2, "max_subtasks": 6, "max_searches": 15, "max_companies": 5, "synthesis_reserve_usd": 0.25},
    "agents": ["alex", "marcus", "sofia"]
  }'::jsonb
$$;
revoke all on function public.settings_ceilings() from public, anon;
grant execute on function public.settings_ceilings() to authenticated, service_role;

-- ═══════════════════════ 2. Validación ═══════════════════════
-- Devuelve NULL si el valor es válido o el motivo (en español) si no lo es.
create function public.settings_value_error(p_key text, p_value jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  c jsonb := public.settings_ceilings();
  k text;
  v jsonb;
  n numeric;
  names text[];
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    return 'el valor debe ser un objeto JSON';
  end if;

  if p_key = 'limits' then
    names := array['monthly_ai_budget_usd', 'mission_ai_budget_usd', 'task_ai_budget_usd'];
    if (select array_agg(x order by x) from jsonb_object_keys(p_value) x) is distinct from (select array_agg(x order by x) from unnest(names) x) then
      return 'los límites deben ser exactamente mensual, por misión y por tarea';
    end if;
    foreach k in array names loop
      v := p_value -> k;
      if jsonb_typeof(v) <> 'number' then
        return format('el límite %s es obligatorio y debe ser un número (no se admite «sin límite»)', k);
      end if;
      n := v::numeric;
      if n < 0 then return format('el límite %s no puede ser negativo', k); end if;
      if n > (c -> 'limits' ->> k)::numeric then
        return format('el límite %s supera el máximo aprobado (%s $)', k, c -> 'limits' ->> k);
      end if;
    end loop;
    if (p_value ->> 'task_ai_budget_usd')::numeric > (p_value ->> 'monthly_ai_budget_usd')::numeric then
      return 'el límite por tarea no puede superar el mensual';
    end if;
    if (p_value ->> 'mission_ai_budget_usd')::numeric > (p_value ->> 'monthly_ai_budget_usd')::numeric then
      return 'el límite por misión no puede superar el mensual';
    end if;
    return null;
  end if;

  if p_key = 'pilot' then
    names := array['agents', 'max_companies', 'max_rounds', 'max_searches', 'max_subtasks', 'stop_on_cost_overrun', 'synthesis_reserve_usd'];
    if (select array_agg(x order by x) from jsonb_object_keys(p_value) x) is distinct from (select array_agg(x order by x) from unnest(names) x) then
      return 'la configuración del piloto no tiene exactamente las claves previstas';
    end if;
    if jsonb_typeof(p_value -> 'agents') <> 'array'
       or exists (select 1 from jsonb_array_elements(p_value -> 'agents') e
                   where jsonb_typeof(e) <> 'string' or not ((c -> 'agents') ? (e #>> '{}'))) then
      return 'pilot.agents solo puede contener agentes aprobados';
    end if;
    foreach k in array array['max_rounds', 'max_subtasks', 'max_searches', 'max_companies'] loop
      v := p_value -> k;
      if jsonb_typeof(v) <> 'number' or v::numeric <> trunc(v::numeric) or v::numeric < 0
         or v::numeric > (c -> 'pilot' ->> k)::numeric then
        return format('pilot.%s debe ser un entero entre 0 y %s', k, c -> 'pilot' ->> k);
      end if;
    end loop;
    if (p_value ->> 'max_rounds')::numeric < 1 or (p_value ->> 'max_subtasks')::numeric < 1 then
      return 'pilot.max_rounds y pilot.max_subtasks deben ser al menos 1';
    end if;
    v := p_value -> 'synthesis_reserve_usd';
    if jsonb_typeof(v) <> 'number' or v::numeric < 0 or v::numeric > (c -> 'pilot' ->> 'synthesis_reserve_usd')::numeric then
      return format('pilot.synthesis_reserve_usd debe estar entre 0 y %s $', c -> 'pilot' ->> 'synthesis_reserve_usd');
    end if;
    if (p_value -> 'stop_on_cost_overrun') is distinct from 'true'::jsonb then
      return 'la parada por sobrecoste (pilot.stop_on_cost_overrun) no se puede desactivar';
    end if;
    return null;
  end if;

  if p_key = 'notifications' then
    if exists (select 1 from jsonb_each(p_value) e where jsonb_typeof(e.value) <> 'boolean') then
      return 'las notificaciones solo admiten valores sí/no';
    end if;
    return null;
  end if;

  return null; -- confidence_rules y otras claves internas: solo migraciones y servidor
end;
$$;
-- Función pura (sin efectos): el trigger de validación la llama con el rol de quien
-- modifica settings, así que authenticated y service_role necesitan ejecutarla.
revoke all on function public.settings_value_error(text, jsonb) from public, anon;
grant execute on function public.settings_value_error(text, jsonb) to authenticated, service_role;

-- Los valores actuales tienen que cumplir las reglas: si no, se cancela todo (no se sobrescribe nada).
do $$
declare r record;
begin
  for r in select key, value, public.settings_value_error(key, value) as err from public.settings loop
    if r.err is not null then
      raise exception 'settings.% no cumple las reglas de 0012: %. Revisar antes de aplicar.', r.key, r.err;
    end if;
  end loop;
end $$;

-- Base nueva (sin la fila de límites): se crea con los valores aprobados actuales.
-- En producción ya existe y no se toca.
insert into public.settings (key, value)
values ('limits', '{"monthly_ai_budget_usd": 10, "mission_ai_budget_usd": 1, "task_ai_budget_usd": 1}'::jsonb)
on conflict (key) do nothing;

create function public.settings_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  err text;
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'La tabla settings no se puede vaciar.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.key in ('limits', 'pilot', 'confidence_rules')
     and (tg_op = 'DELETE' or new.key is distinct from old.key) then
    raise exception 'La clave «%» no se puede borrar ni renombrar.', old.key using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  err := public.settings_value_error(new.key, new.value);
  if err is not null then
    raise exception 'Ajuste no válido: %.', err using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.settings_guard() from public, anon, authenticated, service_role;

create trigger settings_guard
  before insert or update or delete on public.settings
  for each row execute function public.settings_guard();
create trigger settings_no_truncate
  before truncate on public.settings
  for each statement execute function public.settings_guard();

-- ═══════════════════════ 3. Permisos mínimos para el navegador ═══════════════════════
revoke insert, update, delete, truncate on public.settings from anon, authenticated;
grant update (value) on public.settings to authenticated;

create policy "ajustes: solo límites y notificaciones" on public.settings
  as restrictive for update to authenticated
  using (key in ('limits', 'notifications'))
  with check (key in ('limits', 'notifications'));

-- ═══════════════════════ 4. Auditoría ═══════════════════════
create function public.log_settings_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_claims jsonb;
  v_role text;
  v_uid uuid;
  v_actor_type text := 'system';
  v_actor_id text;
  v_origin text;
  v_key text := coalesce(new.key, old.key);
begin
  if tg_op = 'UPDATE' and new.value is not distinct from old.value and new.key = old.key then
    return null; -- sin cambios reales
  end if;
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), v_claims ->> 'role');
  begin
    v_uid := coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), v_claims ->> 'sub')::uuid;
  exception when others then
    v_uid := null;
  end;
  if v_role = 'authenticated' and v_uid is not null then
    v_actor_type := 'admin'; v_actor_id := v_uid::text; v_origin := 'api (usuario autenticado)';
  elsif v_role = 'service_role' then
    v_origin := 'api (service_role: servidor de la oficina)';
  elsif v_role is null and session_user in ('postgres', 'supabase_admin') then
    v_origin := 'sql directo (migración o editor SQL)';
  else
    v_origin := 'desconocido';
  end if;

  insert into public.activity_log (actor_type, actor_id, action, entity_type, entity_id, details)
  values (v_actor_type, v_actor_id, 'settings.changed', 'settings', v_key,
    jsonb_build_object(
      'operacion', lower(tg_op),
      'antes', case when tg_op = 'INSERT' then null else old.value end,
      'despues', case when tg_op = 'DELETE' then null else new.value end,
      'actor', coalesce(v_actor_id, 'desconocido'),
      'origen', v_origin,
      'rol_jwt', v_role,
      'registrado_por', 'trigger settings_audit (0012)'));
  return null;
end;
$$;
revoke all on function public.log_settings_change() from public, anon, authenticated, service_role;

create trigger settings_audit
  after insert or update or delete on public.settings
  for each row execute function public.log_settings_change();
