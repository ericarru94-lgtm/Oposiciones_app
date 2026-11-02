-- HE SIGNAL AI OFFICE · Marcha atrás de 0010 (endurecimiento de agentes)
--
-- Deja la base exactamente como tras 0009 en permisos, triggers y restricciones.
-- Una sola transacción. Solo con autorización expresa.
--
-- NO se revierte (a propósito o porque no es posible):
--   - Las filas de activity_log escritas por el trigger se CONSERVAN (historial
--     de auditoría). Si hiciera falta localizarlas:
--     action in ('agent.config_changed', 'agent.created') and actor_type = 'system'.
--   - Los cambios de active/model/effort hechos mientras 0010 estuvo aplicada
--     no se deshacen; quedan descritos en esas filas.
--   - Si una migración posterior cambia la lista aprobada, esta marcha atrás
--     sigue siendo válida (borra la restricción por nombre), pero esa migración
--     debe revisarse antes.

begin;

drop trigger if exists agents_config_audit_insert on public.agents;
drop trigger if exists agents_config_audit on public.agents;
drop function if exists public.log_agent_config_change();

alter table public.agents drop constraint if exists agents_active_aprobados;

-- Permiso de 0004 (líneas 35-36), tal y como estaba.
grant update (model, effort, active) on public.agents to authenticated;

commit;
