-- HE SIGNAL AI OFFICE · 0011 · activity_log: acciones cerradas e historial de solo añadir
--
-- Fase 5.1.2. Se aplica en UNA transacción. No toca datos, no cambia las
-- políticas existentes (solo añade una) y no crea funciones SECURITY DEFINER.
--
-- 1. Acciones cerradas: una política RESTRICTIVE limita lo que «authenticated»
--    puede insertar a las cuatro acciones que escribe la interfaz. Se combina
--    con las dos de antes (PERMISSIVE «admin: añadir actividad» y RESTRICTIVE
--    «actividad: autor = usuario»): para insertar hay que ser administrador,
--    escribir actor_type = 'admin' con el propio auth.uid() Y usar una de estas
--    acciones. Así no se pueden imitar agent.* (trigger de 0010) ni approval.*.
--    Las escrituras legítimas no pasan por esta política:
--      - decide_approval es SECURITY DEFINER (se ejecuta como su dueño);
--      - consume_approval y el trigger de 0010 se ejecutan como service_role
--        (BYPASSRLS) o como postgres.
--
-- 2. Solo añadir: nadie de la API puede modificar, borrar ni vaciar el
--    historial (se retira también a service_role, que ningún código usa para
--    eso), y unos triggers lo impiden incluso al dueño de la tabla. Para una
--    operación excepcional, una migración tendría que desactivar el trigger de
--    forma explícita (queda en el historial de migraciones).
--
-- Marcha atrás: supabase/checks/0011_rollback.sql (no borra ninguna fila).

-- ═══════════════════════ 1. Acciones que puede escribir la interfaz ═══════════════════════
create policy "actividad: acciones de la interfaz" on public.activity_log
  as restrictive for insert to authenticated
  with check (action in ('auth.login', 'mission.created', 'mission.cancelled', 'settings.limits_updated'));

-- ═══════════════════════ 2. Historial de solo añadir ═══════════════════════
revoke update, delete, truncate on public.activity_log from anon, authenticated, service_role;

create function public.activity_log_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'activity_log es un historial de solo añadir: % no está permitido.', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.activity_log_append_only() from public, anon, authenticated, service_role;

create trigger activity_log_append_only
  before update or delete on public.activity_log
  for each row execute function public.activity_log_append_only();

create trigger activity_log_no_truncate
  before truncate on public.activity_log
  for each statement execute function public.activity_log_append_only();
