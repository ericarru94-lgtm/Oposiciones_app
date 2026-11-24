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
  // 0014 (PI-16) depende de 0013: tampoco se aplica en esta base.
  cpSync("supabase/migrations", dir, { recursive: true, filter: (f) => !f.endsWith("0013_mission_plans.sql") && !f.endsWith("0014_web_limits_audit.sql") });
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
  // PI-16: sin 0013 ni 0014, Marcus (herramientas web protegidas) se detiene ANTES
  // de empezar con un error controlado; Alex y Sofia siguen por el camino antiguo.
  expect(report.runs.map((r) => `${r.agentId}:${r.outcome}`)).toEqual(["alex:waiting_agents", "marcus:web_schema_missing", "sofia:completed", "alex:completed"]);
  const alexTools = claude.calls.filter((c) => who(c) === "Alex")[0].tools.map((x) => x.name).sort();
  expect(alexTools).toEqual(["content__draft", "crm__read", "memory__read", "tasks__delegate"]);
  expect((await raw<{ status: string }>(`select status::text status from public.tasks where id = $1`, [m.id]))[0].status).toBe("completed");
  // Marcus: ninguna llamada a Claude (luego ninguna búsqueda ni lectura web), ninguna reserva, ningún consumo.
  expect(claude.calls.filter((c) => who(c) === "Marcus")).toHaveLength(0);
  expect(claude.calls.some((c) => c.messages.some((x) => Array.isArray(x.content) && x.content.some((b) => b.type === "server_tool_use")))).toBe(false);
  expect(await raw(`select 1 from public.ai_reservations where agent_id = 'marcus'`)).toHaveLength(0);
  expect(await raw(`select 1 from public.ai_usage where agent_id = 'marcus'`)).toHaveLength(0);
  // Sin ejecución comercial en curso ni a medias: la ejecución termina y la tarea falla con un error controlado.
  const runs = await raw<{ status: string; steps: number }>(
    `select ar.status, ar.steps from public.agent_runs ar join public.tasks x on x.id = ar.task_id where x.agent_id = 'marcus'`);
  expect(runs).toHaveLength(1);
  expect(runs[0].steps).toBe(0);
  expect(["running", "waiting_approval"]).not.toContain(runs[0].status);
  const [mt] = await raw<{ status: string; error: string }>(`select status::text status, error from public.tasks where agent_id = 'marcus'`);
  expect(mt.status).toBe("failed");
  expect(mt.error).toMatch(/fallo cerrado\): la base de datos no tiene las migraciones .* Falta: 0013, 0014\./);
  // Alex y Sofia: llamadas y consumo normales.
  expect(claude.calls.filter((c) => who(c) === "Sofia").length).toBeGreaterThan(0);
  expect(await raw(`select 1 from public.ai_usage where agent_id in ('alex', 'sofia')`)).not.toHaveLength(0);
});
