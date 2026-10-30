// Ejecuta la migración y el seed reales en un PostgreSQL embebido (PGlite)
// con un esquema `auth` mínimo que imita a Supabase, y comprueba RLS.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSeedSql } from "@/lib/db/seed";
import { AGENTS } from "@/lib/agents/registry";
import { GLOBAL_MEMORY } from "@/lib/agents/company-memory";

const ADMIN = "11111111-1111-1111-1111-111111111111";
const INTRUDER = "22222222-2222-2222-2222-222222222222";

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create publication supabase_realtime;
`;

const GRANTS = `
  grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to authenticated, service_role;
  grant all on all sequences in schema public to authenticated, service_role;
  revoke update, delete, truncate on public.activity_log from authenticated, anon;
`;

let db: PGlite;

async function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(readFileSync("supabase/migrations/0001_init.sql", "utf8"));
  await db.exec(GRANTS);
  await db.exec(buildSeedSql());
  await db.exec(`
    insert into auth.users values ('${ADMIN}', 'admin@hesignal.test'), ('${INTRUDER}', 'otro@test.dev');
    insert into public.admins (user_id, email) values ('${ADMIN}', 'admin@hesignal.test');
  `);
});

afterAll(async () => {
  await db?.close();
});

describe("migración y seed", () => {
  it("crea los nueve agentes con estado inicial «available»", async () => {
    const { rows } = await db.query<{ id: string; status: string }>("select id, status from public.agents order by id");
    expect(rows.map((r) => r.id).sort()).toEqual(AGENTS.map((a) => a.id).sort());
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(["available"]));
  });

  it("el seed es idempotente y no pisa el estado ni el modelo elegido", async () => {
    await db.exec(`update public.agents set status = 'working', model = 'claude-haiku-5-5' where id = 'marcus'`);
    await db.exec(buildSeedSql());
    const { rows } = await db.query<{ status: string; model: string }>(
      "select status, model from public.agents where id = 'marcus'",
    );
    expect(rows[0]).toEqual({ status: "working", model: "claude-haiku-5-5" });
    const mem = await db.query<{ n: number }>("select count(*)::int as n from public.memory_items");
    expect(mem.rows[0].n).toBe(GLOBAL_MEMORY.length);
    await db.exec(`update public.agents set status = 'available', model = 'claude-opus-5-5' where id = 'marcus'`);
  });

  it("toda la memoria tiene origen y no se puede duplicar dentro de un ámbito", async () => {
    await expect(
      db.exec(`insert into public.memory_items (scope, category, title, content, source)
               values ('global', 'brand', 'IDENTIDAD DE MARCA', 'x', 'test')`),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      db.exec(`insert into public.memory_items (scope, agent_id, category, title, content, source)
               values ('global', 'alex', 'other', 't', 'x', 'test')`),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("Row Level Security", () => {
  it("el administrador ve los agentes", async () => {
    const rows = await as(ADMIN, () => db.query("select id from public.agents"));
    expect(rows.rows).toHaveLength(AGENTS.length);
  });

  it("otro usuario autenticado no ve nada ni puede escribir", async () => {
    const agents = await as(INTRUDER, () => db.query("select id from public.agents"));
    expect(agents.rows).toHaveLength(0);
    const memory = await as(INTRUDER, () => db.query("select id from public.memory_items"));
    expect(memory.rows).toHaveLength(0);
    await expect(
      as(INTRUDER, () => db.exec(`insert into public.tasks (title) values ('colarse')`)),
    ).rejects.toThrow(/row-level security/);
  });

  it("un usuario no puede darse de alta como administrador", async () => {
    await expect(
      as(INTRUDER, () => db.exec(`insert into public.admins (user_id, email) values ('${INTRUDER}', 'otro@test.dev')`)),
    ).rejects.toThrow(/row-level security/);
  });

  it("el registro de actividad no se puede editar ni borrar", async () => {
    await as(ADMIN, () =>
      db.exec(`insert into public.activity_log (actor_type, actor_id, action) values ('admin', '${ADMIN}', 'login')`),
    );
    await expect(as(ADMIN, () => db.exec(`delete from public.activity_log`))).rejects.toThrow(/permission denied/);
    await expect(
      as(ADMIN, () => db.exec(`update public.activity_log set action = 'x'`)),
    ).rejects.toThrow(/permission denied/);
    // Un administrador tampoco puede hacerse pasar por un agente en el registro.
    await expect(
      as(ADMIN, () => db.exec(`insert into public.activity_log (actor_type, action) values ('agent', 'fake')`)),
    ).rejects.toThrow(/row-level security/);
  });

  it("las aprobaciones decididas deben llevar fecha", async () => {
    await expect(
      as(ADMIN, () =>
        db.exec(`insert into public.approvals (agent_id, tool_id, risk, summary, status)
                 values ('marcus', 'email.send', 'external_action', 'x', 'approved')`),
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
