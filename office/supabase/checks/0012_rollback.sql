-- HE SIGNAL AI OFFICE · Marcha atrás de 0012 (settings)
--
-- Deja permisos, políticas y triggers de settings como tras 0011.
-- Una sola transacción. Solo con autorización expresa.
--
-- NO se revierte:
--   - Los valores de settings no se tocan (tampoco la fila «limits» que 0012
--     crea solo en una base nueva que no la tuviera; en producción ya existía).
--   - Las filas settings.changed de activity_log se conservan (historial).
--   - El código que lee settings_ceilings() (formulario y acción de límites)
--     deja de poder leer los máximos: la marcha atrás del código va aparte.

begin;

drop trigger if exists settings_audit on public.settings;
drop trigger if exists settings_no_truncate on public.settings;
drop trigger if exists settings_guard on public.settings;
drop function if exists public.log_settings_change();
drop function if exists public.settings_guard();
drop function if exists public.settings_value_error(text, jsonb);
drop function if exists public.settings_ceilings();

drop policy if exists "ajustes: solo límites y notificaciones" on public.settings;

-- Permisos de antes: authenticated tenía INSERT, UPDATE y DELETE (con RLS
-- «admin: acceso completo»); anon no tenía ninguno.
revoke update (value) on public.settings from authenticated;
grant insert, update, delete on public.settings to authenticated;

commit;
