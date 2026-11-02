// Fase 5.1 · catálogo único de agentes, lista única de activos, modelos y
// listas blancas de herramientas. Y la barrera de aplicación: aunque la base de
// datos dejara pasar una tarea de un agente inactivo, el worker no llama a
// Claude ni gasta nada.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateToolUse } from "@/lib/agents/permissions";
import { ACTIVE_AGENT_IDS, AGENTS, MODELS, PILOT_AGENT_IDS, getAgent, isActiveAgent } from "@/lib/agents/registry";
import { TOOLS, type ToolId } from "@/lib/agents/tools";
import { AGENT_TOOLS, BLOCKED_TOOLS_PHASE_5_1, PILOT_TOOLS, pilotScope, scopeTools } from "@/lib/engine/config";
import { SqlEngineStore, type Query } from "@/lib/engine/store-sql";
import type { ModelClient, ModelRequest, ModelResponse } from "@/lib/engine/types";
import { runTick } from "@/lib/engine/worker";
import { isPilotAgent } from "@/lib/office/scene";
import { buildSeedSql } from "@/lib/db/seed";
import { createTestDb, type TestDb } from "./helpers/db";

const INACTIVE = ["daniel", "lucia", "david", "emma", "oscar", "victoria"];

// Distribución aprobada en la fase 5.1 (identificadores técnicos de la API).
const MODEL_PLAN: Record<string, string> = {
  alex: "claude-sonnet-5-5",
  marcus: "claude-sonnet-5-5",
  sofia: "claude-haiku-5-5",
  daniel: "claude-haiku-5-5",
  lucia: "claude-sonnet-5-5",
  david: "claude-sonnet-5-5",
  emma: "claude-haiku-5-5",
  oscar: "claude-haiku-5-5",
  victoria: "claude-sonnet-5-5",
};

// Herramientas de los tres activos ANTES de la fase 5.1 (no pueden cambiar).
const PILOT_BEFORE: Record<string, readonly ToolId[]> = {
  alex: ["memory.read", "crm.read", "content.draft", "tasks.delegate"],
  marcus: ["memory.read", "crm.read", "crm.write", "content.draft", "web.search", "web.fetch"],
  sofia: ["memory.read", "crm.read", "content.draft"],
};

describe("catálogo único de agentes", () => {
  it("nueve agentes con el modelo aprobado, todos con precio conocido, y sin Opus", () => {
    expect(AGENTS.map((a) => a.id).sort()).toEqual(Object.keys(MODEL_PLAN).sort());
    for (const a of AGENTS) {
      expect({ id: a.id, model: a.model }).toEqual({ id: a.id, model: MODEL_PLAN[a.id] });
      expect(Object.hasOwn(MODELS, a.model)).toBe(true);
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.role.length).toBeGreaterThan(0);
      expect(a.responsibilities.length).toBeGreaterThan(0);
    }
  });

  it("una sola lista de activos (Alex, Marcus y Sofia) y todo lo demás deriva de ella", () => {
    expect([...ACTIVE_AGENT_IDS]).toEqual(["alex", "marcus", "sofia"]);
    expect(PILOT_AGENT_IDS).toBe(ACTIVE_AGENT_IDS); // misma lista, no una copia
    for (const a of AGENTS) {
      const active = (ACTIVE_AGENT_IDS as readonly string[]).includes(a.id);
      expect(isActiveAgent(a.id)).toBe(active);
      expect(isPilotAgent(a.id)).toBe(active); // la oficina 3D usa la misma lista
    }
    expect(AGENTS.filter((a) => a.isCoordinator).map((a) => a.id)).toEqual(["alex"]);
  });

  it("el seed sincroniza agents.active con la lista única", () => {
    const sql = buildSeedSql();
    expect(sql).toContain("active = excluded.active");
    for (const a of AGENTS) {
      // Cada fila ocupa varias líneas (las instrucciones llevan saltos): se toma hasta la siguiente fila.
      const row = sql.split("\n  (").find((l) => l.startsWith(`'${a.id}',`))!;
      expect(row).toBeDefined();
      // …, is_coordinator, active, avatar, desk
      expect(row).toMatch(new RegExp(`, (true|false), ${isActiveAgent(a.id)}, '\\{`));
    }
  });
});

describe("listas blancas de herramientas", () => {
  it("los tres activos conservan exactamente sus herramientas", () => {
    for (const [id, tools] of Object.entries(PILOT_BEFORE)) {
      expect([...AGENT_TOOLS[id].enabled]).toEqual([...tools]);
      expect([...scopeTools(getAgent(id)!)].sort()).toEqual([...tools].sort());
      expect(PILOT_TOOLS[id]).toBe(AGENT_TOOLS[id].enabled); // derivado, no duplicado
    }
  });

  it("los seis inactivos: herramientas futuras documentadas, ninguna operativa", () => {
    for (const id of INACTIVE) {
      const policy = AGENT_TOOLS[id];
      expect(policy.enabled).toEqual([]);
      expect(policy.planned.length).toBeGreaterThan(0);
      const def = getAgent(id)!;
      for (const t of policy.planned) expect(def.tools).toContain(t); // nada que no permita el registro
      expect(scopeTools(def)).toEqual([]);
      expect(pilotScope(def).tools).toEqual([]);
    }
  });

  it("un agente inactivo no recibe herramientas aunque alguien rellenara su lista por error", () => {
    const daniel = getAgent("daniel")!;
    const forced = { ...daniel, tools: Object.keys(TOOLS) as ToolId[] };
    expect(scopeTools(forced)).toEqual([]);
  });

  it("ninguna herramienta bloqueada en la fase 5.1 está habilitada para nadie", () => {
    for (const [id, policy] of Object.entries(AGENT_TOOLS)) {
      for (const t of BLOCKED_TOOLS_PHASE_5_1) expect({ id, enabled: policy.enabled.includes(t) }).toEqual({ id, enabled: false });
    }
    expect(BLOCKED_TOOLS_PHASE_5_1).toEqual(expect.arrayContaining([
      "email.send", "outreach.contact", "social.publish", "ads.launch", "media.generate", "n8n.production", "data.delete",
      "quality.review", "costs.read", "n8n.read",
    ]));
  });

  it("la ToolGateway sigue siendo la autoridad: con el alcance efectivo, todo lo demás se deniega", () => {
    const connected = new Set(Object.keys(TOOLS));
    for (const a of AGENTS) {
      const scoped = pilotScope(a);
      for (const t of Object.keys(TOOLS)) {
        const d = evaluateToolUse(scoped, t, connected);
        if (!scoped.tools.includes(t as ToolId)) expect({ a: a.id, t, d: d.decision }).toEqual({ a: a.id, t, d: "denied" });
      }
    }
    // Ejemplos concretos: Marcus no puede enviar emails; Daniel no puede ni leer memoria.
    expect(evaluateToolUse(pilotScope(getAgent("marcus")!), "email.send", connected).decision).toBe("denied");
    expect(evaluateToolUse(pilotScope(getAgent("daniel")!), "memory.read", connected).decision).toBe("denied");
  });
});

describe("barrera de aplicación (worker)", () => {
  let t: TestDb;
  const raw = async <T,>(sql: string, params: unknown[] = []) => (await t.db.query<T>(sql, params)).rows;
  const query: Query = (sql, params) => t.asService(() => raw(sql, params ?? [])) as never;

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t?.close();
  });

  it("aunque la base de datos dejara pasar la tarea de un inactivo, no se llama a Claude ni se gasta nada", async () => {
    // Se simula un fallo de las barreras de la base de datos: Daniel activo SOLO en ella
    // (para eso hay que retirar en ESTA base la restricción de agentes aprobados de 0010).
    await t.db.exec(`alter table public.agents drop constraint agents_active_aprobados;
      update public.agents set active = true where id = 'daniel';
      update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 1, "mission_ai_budget_usd": 1}' where key = 'limits';`);
    const [task] = await raw<{ id: string }>(`insert into public.tasks (title, agent_id, status) values ('Texto', 'daniel', 'assigned') returning id`);
    const calls: ModelRequest[] = [];
    const client: ModelClient = {
      async create(req): Promise<ModelResponse> {
        calls.push(req);
        throw new Error("No debería llamarse a Claude para un agente inactivo.");
      },
    };
    const report = await runTick({ store: new SqlEngineStore(query), client });
    expect(report.runs.map((r) => [r.agentId, r.outcome])).toEqual([["daniel", "failed"]]);
    expect(calls).toHaveLength(0);
    const [row] = await raw<{ status: string; error: string }>(`select status::text as status, error from public.tasks where id = $1`, [task.id]);
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/no participa/);
    expect((await raw<{ n: number }>(`select count(*)::int n from public.ai_usage`))[0].n).toBe(0);
    expect((await raw<{ n: number }>(`select count(*)::int n from public.ai_reservations`))[0].n).toBe(0);
  });

  it("con la base de datos sincronizada, la tarea de un inactivo ni siquiera se reclama", async () => {
    await t.db.exec(`delete from public.tasks; update public.agents set active = false where id = 'daniel';`);
    await raw(`insert into public.tasks (title, agent_id, status) values ('Texto', 'emma', 'assigned')`);
    const client: ModelClient = { async create() { throw new Error("no"); } };
    const report = await runTick({ store: new SqlEngineStore(query), client });
    expect(report.runs).toEqual([]);
    expect((await raw<{ status: string }>(`select status::text as status from public.tasks`))[0].status).toBe("assigned");
  });
});
