// Ejecuta la migración y el seed reales en un PostgreSQL embebido (PGlite)
// con un esquema `auth` mínimo que imita a Supabase, y comprueba RLS.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSeedSql } from "@/lib/db/seed";
import { AGENTS } from "@/lib/agents/registry";
import { GLOBAL_MEMORY } from "@/lib/agents/company-memory";
import { ADMIN, INTRUDER, createTestDb, type TestDb } from "./helpers/db";

const ALLOWLISTED = "33333333-3333-3333-3333-333333333333";

let t: TestDb;
let db: TestDb["db"];
const as: TestDb["as"] = (u, fn) => t.as(u, fn);

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
});

afterAll(async () => {
  await t?.close();
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

describe("alta del administrador", () => {
  it("solo el email de la lista se convierte en administrador al crear la cuenta", async () => {
    await db.exec(`insert into private.admin_allowlist (email) values ('jefe@hesignal.test')`);
    await db.exec(`insert into auth.users values ('${ALLOWLISTED}', 'Jefe@HESignal.test')`);
    const { rows } = await db.query<{ email: string }>(
      `select email from public.admins where user_id = '${ALLOWLISTED}'`,
    );
    expect(rows).toEqual([{ email: "jefe@hesignal.test" }]);
    const intruder = await db.query(`select 1 from public.admins where user_id = '${INTRUDER}'`);
    expect(intruder.rows).toHaveLength(0);
  });

  it("los usuarios con sesión no pueden leer la lista de administradores permitidos", async () => {
    await expect(as(ADMIN, () => db.query("select * from private.admin_allowlist"))).rejects.toThrow(
      /permission denied/,
    );
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

  it("el administrador no puede crear ni modificar aprobaciones directamente", async () => {
    await expect(
      as(ADMIN, () =>
        db.exec(`insert into public.approvals (agent_id, tool_id, risk, summary)
                 values ('marcus', 'email.send', 'external_action', 'x')`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
