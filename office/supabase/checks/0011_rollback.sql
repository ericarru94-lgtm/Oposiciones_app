-- HE SIGNAL AI OFFICE · Marcha atrás de 0011 (activity_log)
--
-- Deja permisos, políticas y triggers de activity_log como tras 0010.
-- Una sola transacción. Solo con autorización expresa.
--
-- NO se revierte: ninguna fila se borra ni se modifica (el historial escrito
-- mientras 0011 estuvo aplicada se conserva tal cual).

begin;

drop trigger if exists activity_log_no_truncate on public.activity_log;
drop trigger if exists activity_log_append_only on public.activity_log;
drop function if exists public.activity_log_append_only();

drop policy if exists "actividad: acciones de la interfaz" on public.activity_log;

-- Permisos de antes: service_role tenía UPDATE, DELETE y TRUNCATE (privilegios
-- por defecto de Supabase); anon y authenticated ya no los tenían (0001).
grant update, delete, truncate on public.activity_log to service_role;

commit;
