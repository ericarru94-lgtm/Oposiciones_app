-- Correcciones del asesor de seguridad de Supabase.
-- 1) search_path fijo en la función de los triggers.
alter function public.set_updated_at() set search_path = '';
-- 2) is_admin() solo la necesitan los usuarios con sesión (para RLS);
--    los visitantes anónimos no pueden llamarla.
revoke execute on function public.is_admin() from anon;
