-- MARCHA ATRÁS DE EMERGENCIA de 0008_deliveries_facts_realtime.sql.
-- NO es una migración: solo se ejecuta con autorización expresa y si la 0008
-- causa un problema que no se resuelve volviendo a la versión anterior del
-- código (01432bd es compatible con la 0008 aplicada, así que normalmente basta
-- con eso). BORRA los hechos y entregas registrados después de aplicar la 0008;
-- no toca ningún dato anterior. Deja el esquema exactamente como tras la 0007
-- (comprobado en tests/migration-0008.test.ts con la huella del esquema).
begin;

-- Realtime: quitar solo las tablas que añadió la 0008.
do $$
declare t text;
begin
  foreach t in array array['companies', 'documents', 'ai_usage', 'tool_executions', 'task_deliveries', 'company_facts'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

-- Permisos de escritura que la 0008 retiró a authenticated (estado de la 0007).
grant insert, update, delete on public.documents to authenticated;
grant insert, update, delete on public.task_dependencies to authenticated;

drop function if exists public.advance_deliveries(uuid, text, text);
drop function if exists public.record_company_fact(uuid, text, uuid, text, text, text, text, text, date, smallint, text, uuid);
drop function if exists public.fact_confidence(text, date, smallint, text);
drop view if exists public.company_facts_current;
drop table if exists public.task_deliveries;
drop table if exists public.company_facts;
drop function if exists public.company_facts_immutable();
delete from public.settings where key = 'confidence_rules';

commit;
