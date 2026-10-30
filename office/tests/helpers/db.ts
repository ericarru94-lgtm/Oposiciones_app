// PostgreSQL embebido (PGlite) con un esquema mínimo que imita a Supabase:
// roles, auth.uid(), Storage, la publicación de Realtime y los privilegios
// por defecto que Supabase concede a anon/authenticated/service_role.
// Sobre él se ejecutan las migraciones y el seed reales.
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { buildSeedSql } from "@/lib/db/seed";

export const ADMIN = "11111111-1111-1111-1111-111111111111";
export const SUPABASE_STUB_SQL = () => SUPABASE_STUB;
export const INTRUDER = "22222222-2222-2222-2222-222222222222";

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
    name text not null, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.objects to anon, authenticated, service_role;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export interface TestDb {
  db: PGlite;
  as<T>(userId: string, fn: () => Promise<T>): Promise<T>;
  asService<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = process.env.MIGRATIONS_DIR ?? "supabase/migrations";
  for (const file of readdirSync(dir).sort()) {
    await db.exec(readFileSync(`${dir}/${file}`, "utf8"));
  }
  await db.exec(buildSeedSql());
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@hesignal.test'), ('${INTRUDER}', 'otro@test.dev');
    insert into public.admins (user_id, email) values ('${ADMIN}', 'admin@hesignal.test');
  `);

  async function withRole<T>(role: string, userId: string, fn: () => Promise<T>): Promise<T> {
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId}', false);`);
    try {
      return await fn();
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    }
  }

  return {
    db,
    as: (userId, fn) => withRole("authenticated", userId, fn),
    asService: (fn) => withRole("service_role", "", fn),
    close: () => db.close(),
  };
}
