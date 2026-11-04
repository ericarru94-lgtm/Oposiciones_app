// Fase 5.2.1 · Compatibilidad: el código nuevo funciona sobre una base de datos
// SIN 0013 (la de producción hasta que se aplique): las misiones siguen el
// camino antiguo (delegación) y nada intenta leer las tablas del plan.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { SqlEngineStore, type Query } from "@/lib/engine/store-sql";
import { runTick } from "@/lib/engine/worker";
import { ScriptedClaude, who } from "./helpers/scripted-claude";
import { createTestDb, type TestDb } from "./helpers/db";

let t: TestDb;
let dir: string;
const raw = async <T,>(sql: string, params: unknown[] = []) => (await t.db.query<T>(sql, params)).rows;
const query: Query = (sql, params) => t.asService(() => raw(sql, params ?? [])) as never;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "sin0013-"));
  cpSync("supabase/migrations", dir, { recursive: true, filter: (f) => !f.endsWith("0013_mission_plans.sql") });
  process.env.MIGRATIONS_DIR = dir;
  try {
    t = await createTestDb();
  } finally {
    delete process.env.MIGRATIONS_DIR;
  }
});
afterAll(async () => {
  await t?.close();
  rmSync(dir, { recursive: true, force: true });
});

it("sin 0013: no hay columnas ni tablas del plan y una misión completa sigue el camino antiguo", async () => {
  expect(await raw(`select 1 from information_schema.columns where table_name = 'tasks' and column_name = 'plan_required'`)).toHaveLength(0);
  expect(await raw(`select 1 from information_schema.tables where table_name = 'mission_plans'`)).toHaveLength(0);
  const [m] = await raw<{ id: string }>(
    `insert into public.tasks (title, description, agent_id, status, input, created_by)
     values ('Estudio gimnasios Barcelona', 'Estudio comercial en borrador, sin contactar.', 'alex', 'assigned', '{"kind": "mission", "round": 1, "phase": "planning"}', 'admin') returning id`);
  const claude = new ScriptedClaude();
  const report = await runTick({ store: new SqlEngineStore(query), client: claude });
  expect(report.runs.map((r) => `${r.agentId}:${r.outcome}`)).toEqual(["alex:waiting_agents", "marcus:completed", "sofia:completed", "alex:completed"]);
  const alexTools = claude.calls.filter((c) => who(c) === "Alex")[0].tools.map((x) => x.name).sort();
  expect(alexTools).toEqual(["content__draft", "crm__read", "memory__read", "tasks__delegate"]);
  expect((await raw<{ status: string }>(`select status::text status from public.tasks where id = $1`, [m.id]))[0].status).toBe("completed");
});
