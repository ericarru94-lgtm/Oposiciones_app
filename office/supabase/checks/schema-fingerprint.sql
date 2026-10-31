-- Huella del esquema public (solo lectura). Se usa para comparar producción con las
-- migraciones locales y para comprobar que una migración es aditiva.
-- Excluye las restricciones NOT NULL (contype 'n'), que PostgreSQL 18 guarda en
-- pg_constraint y PostgreSQL 17 (producción) no.
with
cols as (select 'col' k, table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') v from information_schema.columns where table_schema='public'),
cons as (select 'con' k, conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid) v from pg_constraint where connamespace='public'::regnamespace and contype <> 'n'),
idx as (select 'idx' k, indexname||':'||indexdef v from pg_indexes where schemaname='public'),
pol as (select 'pol' k, tablename||':'||policyname||':'||cmd||':'||array_to_string(roles,',')||':'||coalesce(qual,'')||':'||coalesce(with_check,'') v from pg_policies where schemaname='public'),
rls as (select 'rls' k, relname||':'||relrowsecurity v from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v')),
fn as (select 'fn' k, p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||p.prosecdef||':'||md5(p.prosrc)||':'||coalesce(array_to_string(p.proconfig,','),'') v from pg_proc p where p.pronamespace='public'::regnamespace),
fexec as (select 'fexec' k, p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||r||':'||has_function_privilege(r, p.oid, 'execute') v from pg_proc p, unnest(array['anon','authenticated','service_role']) r where p.pronamespace='public'::regnamespace),
tg as (select 'grant' k, table_name||':'||grantee||':'||string_agg(privilege_type, ',' order by privilege_type) v from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role') group by table_name, grantee),
trg as (select 'trg' k, event_object_table||':'||trigger_name||':'||event_manipulation||':'||action_timing v from information_schema.triggers where trigger_schema='public'),
pub as (select 'pub' k, tablename v from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'),
typ as (select 'enum' k, t.typname||':'||string_agg(e.enumlabel, ',' order by e.enumsortorder) v from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by t.typname),
viewdef as (select 'view' k, viewname||':'||md5(definition) v from pg_views where schemaname='public'),
settings as (select 'setting' k, key v from public.settings),
allr as (select * from cols union all select * from cons union all select * from idx union all select * from pol union all select * from rls union all select * from fn union all select * from fexec union all select * from tg union all select * from trg union all select * from pub union all select * from typ union all select * from viewdef union all select * from settings)
select k, v from allr order by k, v
