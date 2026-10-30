-- Alta automática del administrador.
-- Cuando se crea un usuario en Supabase Auth cuyo email está en
-- private.admin_allowlist, se añade a public.admins. Nadie más puede
-- convertirse en administrador. La lista se rellena desde el SQL Editor:
--   insert into private.admin_allowlist (email) values ('tu@email.com');

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.admin_allowlist (
  email text primary key check (email = lower(email))
);

create function private.link_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.admin_allowlist where email = lower(new.email)) then
    insert into public.admins (user_id, email)
    values (new.id, lower(new.email))
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.link_admin() from public, anon, authenticated;

create trigger on_auth_user_created_link_admin
  after insert on auth.users
  for each row execute function private.link_admin();
