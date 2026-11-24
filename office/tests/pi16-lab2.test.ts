// PI-16 · Segunda iteración de laboratorio: comprobación de esquema (0013 + 0014),
// clave HMAC obligatoria y regresión comercial simulada de Marcus. Sin red:
// PGlite con las migraciones reales y Claude simulado.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SqlEngineStore, type Query } from "@/lib/engine/store-sql";
import { SupabaseEngineStore } from "@/lib/engine/store-supabase";
import { parseSchemaStatus } from "@/lib/engine/store";
import { runTick } from "@/lib/engine/worker";
import { auditKeyStatus } from "@/lib/engine/web-audit";
import type { ContentBlock, ModelClient, ModelRequest, ModelResponse } from "@/lib/engine/types";
import { createTestDb, type TestDb } from "./helpers/db";
import { AGENTS, getAgent } from "@/lib/agents/registry";
import { pilotSystemPrompt } from "@/lib/engine/pilot-prompts";
import { buildSeedSql } from "@/lib/db/seed";
import { scopeTools } from "@/lib/engine/config";

const CANARY = "CANARIO7731";
const usage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 };
const who = (r: ModelRequest) => /Eres (\w+),/.exec(r.system)?.[1] ?? "?";
const turn = (r: ModelRequest) => (r.messages.length + 1) / 2;
const first = (r: ModelRequest) => String(r.messages[0].content);
const block = (o: unknown) => `\n\`\`\`resultado\n${JSON.stringify(o)}\n\`\`\``;
const text = (t: string, r: ModelRequest): ModelResponse => ({ content: [{ type: "text", text: t }], stopReason: "end_turn", usage, model: r.model });

async function dbWithout(...exclude: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "pi16-"));
  cpSync("supabase/migrations", dir, { recursive: true, filter: (f) => !exclude.some((e) => f.endsWith(e)) });
  process.env.MIGRATIONS_DIR = dir;
  try {
    return { db: await createTestDb(), dir };
  } finally {
    delete process.env.MIGRATIONS_DIR;
  }
}
const sqlStore = (t: TestDb) => {
  const q: Query = (sql, params) => t.asService(async () => (await t.db.query(sql, params ?? [])).rows) as never;
  return new SqlEngineStore(q);
};

/** Alex delega en Marcus y Sofia; Marcus usa la web (búsqueda + lectura de un resultado). */
function team(): ModelClient & { calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  return {
    calls,
    async create(r) {
      calls.push(structuredClone(r));
      if (who(r) === "Alex") {
        if (first(r).includes("ENTREGAS DEL EQUIPO")) return text("# Informe final\nControl de coherencia: correcto.", r);
        if (turn(r) === 1) return { content: [{ type: "tool_use", id: "d1", name: "tasks__delegate", input: { agent: "marcus", title: "Investigar clínicas", instructions: "Fichas con fuentes." } }], stopReason: "tool_use", usage, model: r.model };
        if (turn(r) === 2) return { content: [{ type: "tool_use", id: "d2", name: "tasks__delegate", input: { agent: "sofia", title: "Estrategia", instructions: "Estrategia a partir de las fichas." } }], stopReason: "tool_use", usage, model: r.model };
        return text("Plan: Marcus investiga y Sofia prepara la estrategia.", r);
      }
      if (who(r) === "Marcus") {
        return {
          content: [
            { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "clinicas fisioterapia barcelona" } },
            { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://clinica.example/", title: "t", encrypted_content: "x" }] },
            { type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: "https://clinica.example/" } },
            { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: "https://clinica.example/", content: { type: "document" } } },
            { type: "text", text: `Hecho.${block({ resultado: "completed", objetivos_completados: ["investigar"] })}` },
          ],
          stopReason: "end_turn", usage: { ...usage, webSearchRequests: 1 }, model: r.model,
        };
      }
      return text(`Estrategia.${block({ resultado: "completed", objetivos_completados: ["estrategia"] })}`, r);
    },
  };
}
async function mission(t: TestDb, planRequired: boolean | null) {
  const cols = planRequired === null ? "" : ", plan_required";
  const vals = planRequired === null ? "" : ", false";
  const [m] = (await t.db.query<{ id: string }>(
    `insert into public.tasks (title, description, agent_id, status, input, created_by${cols})
     values ('Estudio clínicas', 'Estudio comercial en borrador, sin contactar a nadie', 'alex', 'assigned', '{"kind": "mission", "round": 1, "phase": "planning"}', 'admin'${vals}) returning id`)).rows;
  return m.id;
}

// ───────────────────────── 1. Compatibilidad de esquema ─────────────────────────
describe("1 · comprobación de esquema antes de usar la web", () => {
  it("ninguna migración (sin 0013 ni 0014): Marcus se detiene sin llamar ni reservar; Alex y Sofia siguen", async () => {
    const { db: t, dir } = await dbWithout("0013_mission_plans.sql", "0014_web_limits_audit.sql");
    try {
      expect(await sqlStore(t).webSchemaStatus()).toEqual({ ok: false, missing: ["0013", "0014"] });
      const id = await mission(t, null);
      const c = team();
      const report = await runTick({ store: sqlStore(t), client: c });
      expect(report.runs.map((r) => `${r.agentId}:${r.outcome}`)).toEqual(["alex:waiting_agents", "marcus:web_schema_missing", "sofia:completed", "alex:completed"]);
      expect(c.calls.filter((x) => who(x) === "Marcus")).toHaveLength(0);
      expect((await t.db.query(`select 1 from public.ai_reservations where agent_id = 'marcus'`)).rows).toHaveLength(0);
      const [m] = (await t.db.query<{ status: string; error: string }>(`select status::text, error from public.tasks where agent_id = 'marcus'`)).rows;
      expect(m.status).toBe("failed");
      expect(m.error).toMatch(/0013 y 0014\)\. No se ha llamado a Claude ni se ha reservado presupuesto\. Falta: 0013, 0014\./);
      expect((await t.db.query<{ status: string }>(`select status::text from public.tasks where id = $1`, [id])).rows[0].status).toBe("completed");
    } finally {
      await t.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("solo 0013: falta 0014 y Marcus se detiene igual, sin estado ambiguo", async () => {
    const { db: t, dir } = await dbWithout("0014_web_limits_audit.sql");
    try {
      expect(await sqlStore(t).webSchemaStatus()).toEqual({ ok: false, missing: ["0014"] });
      await mission(t, false);
      const report = await runTick({ store: sqlStore(t), client: team() });
      expect(report.runs.map((r) => `${r.agentId}:${r.outcome}`)).toEqual(["alex:waiting_agents", "marcus:web_schema_missing", "sofia:completed", "alex:completed"]);
      expect((await t.db.query(`select 1 from public.agent_runs ar join public.tasks x on x.id = ar.task_id where x.agent_id = 'marcus' and ar.status in ('running', 'waiting_approval')`)).rows).toHaveLength(0);
    } finally {
      await t.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  let full: TestDb;
  beforeAll(async () => {
    full = await createTestDb();
  });
  afterAll(async () => {
    await full?.close();
  });

  it("0013 y 0014: ok y Marcus usa la web", async () => {
    expect(await sqlStore(full).webSchemaStatus()).toEqual({ ok: true, missing: [] });
    await mission(full, false);
    const c = team();
    const report = await runTick({ store: sqlStore(full), client: c });
    expect(report.runs.map((r) => `${r.agentId}:${r.outcome}`)).toContain("marcus:completed");
    expect(c.calls.filter((x) => who(x) === "Marcus")).toHaveLength(1);
  });

  it("esquema incompatible (0014 incompleta o web_limits no válido) → no listo", async () => {
    const t = await createTestDb();
    try {
      await t.db.exec(`drop trigger settings_web_limits_guard on public.settings; drop trigger settings_guard on public.settings;
        update public.settings set value = '{"max_fetches": 99}' where key = 'web_limits';`);
      expect(await sqlStore(t).webSchemaStatus()).toEqual({ ok: false, missing: ["0014:web_limits"] });
      await t.db.exec(`drop function public.stop_mission_security(uuid, text);`);
      const s = await sqlStore(t).webSchemaStatus();
      expect(s.ok).toBe(false);
      expect(s.missing).toEqual(expect.arrayContaining(["0014:stop_mission_security", "0014:web_limits"]));
    } finally {
      await t.close();
    }
  });

  it("error al leer el esquema → parada controlada antes de llamar o reservar", async () => {
    const t = await createTestDb();
    try {
      const q: Query = (sql, params) => {
        if (/pi16_schema_status|to_regprocedure/.test(sql)) return Promise.reject(new Error("conexión perdida")) as never;
        return t.asService(async () => (await t.db.query(sql, params ?? [])).rows) as never;
      };
      await mission(t, false);
      const c = team();
      const report = await runTick({ store: new SqlEngineStore(q), client: c });
      expect(report.runs.find((r) => r.agentId === "marcus")?.outcome).toBe("web_schema_unknown");
      expect(c.calls.filter((x) => who(x) === "Marcus")).toHaveLength(0);
      expect((await t.db.query(`select 1 from public.ai_reservations where agent_id = 'marcus'`)).rows).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it("parseSchemaStatus solo acepta evidencia positiva", () => {
    expect(parseSchemaStatus({ ok: true, missing: [] })).toEqual({ ok: true, missing: [] });
    for (const x of [null, undefined, "ok", { ok: "true", missing: [] }, { ok: true }, { ok: true, missing: ["x"] }, { ok: false, missing: [] }, []]) {
      expect(parseSchemaStatus(x).ok, JSON.stringify(x)).toBe(false);
    }
  });

  it("Supabase: sin la función (PGRST202) informa qué falta; otro error → excepción (fallo cerrado)", async () => {
    const fake = (rpcError: { code: string } | null, plansOk: boolean) => ({
      rpc: async () => (rpcError ? { data: null, error: rpcError } : { data: { ok: true, missing: [] }, error: null }),
      from: () => ({ select: () => ({ limit: async () => (plansOk
        ? { data: [], error: null, status: 200, count: 0 }
        : { data: null, error: { message: "no existe" }, status: 404, count: null }) }) }),
    });
    expect(await new SupabaseEngineStore(fake(null, true) as never).webSchemaStatus()).toEqual({ ok: true, missing: [] });
    expect(await new SupabaseEngineStore(fake({ code: "PGRST202" }, true) as never).webSchemaStatus()).toEqual({ ok: false, missing: ["0014"] });
    expect(await new SupabaseEngineStore(fake({ code: "PGRST202" }, false) as never).webSchemaStatus()).toEqual({ ok: false, missing: ["0013", "0014"] });
    await expect(new SupabaseEngineStore(fake({ code: "57014" }, true) as never).webSchemaStatus()).rejects.toThrow(/No se pudo comprobar el esquema/);
  });
});

// ───────────────────────── 2. Clave HMAC ─────────────────────────
describe("2 · clave HMAC obligatoria", () => {
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  const good = "k".repeat(16) + "-0123456789abcdef";

  it("valida formato de clave e identificador sin revelar valores", () => {
    expect(auditKeyStatus(env({}))).toEqual({ ok: false, reason: "missing" });
    expect(auditKeyStatus(env({ WEB_AUDIT_HMAC_KEY: "" }))).toEqual({ ok: false, reason: "missing" });
    for (const bad of ["corta", "x".repeat(257), "con espacios ".repeat(4), "ñ".repeat(40), `${"a".repeat(31)}\n`]) {
      expect(auditKeyStatus(env({ WEB_AUDIT_HMAC_KEY: bad })), JSON.stringify(bad.slice(0, 8))).toEqual({ ok: false, reason: "malformed" });
    }
    expect(auditKeyStatus(env({ WEB_AUDIT_HMAC_KEY: good, WEB_AUDIT_HMAC_KEY_ID: "id con espacio" }))).toEqual({ ok: false, reason: "malformed" });
    expect(auditKeyStatus(env({ WEB_AUDIT_HMAC_KEY: good, WEB_AUDIT_HMAC_KEY_ID: "2026-11" }))).toEqual({ ok: true, key: { id: "2026-11", secret: good } });
    expect(auditKeyStatus(env({ WEB_AUDIT_HMAC_KEY: good })).ok && "k1").toBe("k1");
  });

  it("clave mal formada en el entorno: Marcus no busca ni lee y el error no contiene la clave", async () => {
    const t = await createTestDb();
    const saved = { k: process.env.WEB_AUDIT_HMAC_KEY, i: process.env.WEB_AUDIT_HMAC_KEY_ID };
    try {
      process.env.WEB_AUDIT_HMAC_KEY = `SECRETO-${CANARY}`; // 19 caracteres: mal formada
      await mission(t, false);
      const c = team();
      const report = await runTick({ store: sqlStore(t), client: c });
      expect(report.runs.find((r) => r.agentId === "marcus")?.outcome).toBe("web_audit_key_malformed");
      expect(c.calls.filter((x) => who(x) === "Marcus")).toHaveLength(0);
      const [m] = (await t.db.query<{ error: string }>(`select error from public.tasks where agent_id = 'marcus'`)).rows;
      expect(m.error).toMatch(/no tiene el formato exigido/);
      expect(m.error).not.toContain(CANARY);
      const runs = (await t.db.query<{ s: string }>(`select coalesce(string_agg(coalesce(error, ''), ' '), '') s from public.agent_runs`)).rows[0].s;
      const logs = (await t.db.query<{ s: string }>(`select coalesce(string_agg(details::text, ' '), '') s from public.activity_log`)).rows[0].s;
      expect(runs + logs).not.toContain(CANARY);
    } finally {
      process.env.WEB_AUDIT_HMAC_KEY = saved.k;
      process.env.WEB_AUDIT_HMAC_KEY_ID = saved.i;
      await t.close();
    }
  });
});

// ───────────────────────── 4. Regresión comercial de Marcus (simulada) ─────────────────────────
// Comportamiento PROPUESTO (instrucciones no aplicadas): busca primero y lee solo
// URLs de los resultados. Se compara con el comportamiento antiguo (leer la web
// guardada en el CRM), que con PI-16 detiene la misión.
describe("4 · regresión comercial de Marcus (simulada, instrucciones NO aplicadas)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t?.close();
  });

  const marcusRun = (marcus: (r: ModelRequest) => ModelResponse): ModelClient & { calls: ModelRequest[] } => {
    const base = team();
    return { calls: base.calls, async create(r) { if (who(r) === "Marcus") { base.calls.push(structuredClone(r)); return marcus(r); } return base.create(r); } };
  };
  const stored = `https://clinica-guardada.example/?ref=${CANARY}`;

  it("comportamiento antiguo: leer la URL guardada en el CRM → url_not_in_prior_context → parada de la misión", async () => {
    await t.db.exec(`delete from public.tasks;`);
    const id = await mission(t, false);
    const c = marcusRun((r) => ({
      content: [
        { type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: stored } },
        { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_tool_result_error", error_code: "url_not_in_prior_context" } },
        { type: "text", text: "No pude leer la web guardada." },
      ], stopReason: "end_turn", usage, model: r.model,
    }));
    const report = await runTick({ store: sqlStore(t), client: c });
    expect(report.runs.find((r) => r.agentId === "marcus")?.outcome).toBe("security_stop");
    expect((await t.db.query<{ status: string }>(`select status::text from public.tasks where id = $1`, [id])).rows[0].status).toBe("failed");
  });

  it("comportamiento propuesto: busca la empresa del CRM por nombre, lee el resultado y completa la ficha", async () => {
    await t.db.exec(`delete from public.tasks;`);
    const id = await mission(t, false);
    const c = marcusRun((r) => ({
      content: [
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Clínica Guardada Barcelona web oficial" } },
        { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://clinica-guardada.example/", title: "t", encrypted_content: "x" }] },
        { type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: "https://clinica-guardada.example/" } },
        { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: "https://clinica-guardada.example/", content: { type: "document" } } },
        { type: "text", text: `Ficha completada con la URL de la búsqueda (la guardada era un dato, no una fuente de lectura).${block({ resultado: "completed", objetivos_completados: ["ficha"] })}` },
      ] as ContentBlock[], stopReason: "end_turn", usage: { ...usage, webSearchRequests: 1 }, model: r.model,
    }));
    const report = await runTick({ store: sqlStore(t), client: c });
    expect(report.runs.map((r) => `${r.agentId}:${r.outcome}`)).toContain("marcus:completed");
    expect((await t.db.query<{ status: string }>(`select status::text from public.tasks where id = $1`, [id])).rows[0].status).toBe("completed");
    const ev = (await t.db.query<{ tool: string; severity: string }>(`select tool, severity from public.web_tool_events where mission_id = $1 order by id`, [id])).rows;
    expect(ev).toEqual([{ tool: "search", severity: "info" }, { tool: "fetch", severity: "info" }]);
  });

  it("investigar empresas nuevas y competidores sigue funcionando (búsqueda abierta, varios resultados)", async () => {
    await t.db.exec(`delete from public.tasks;`);
    const id = await mission(t, false);
    const urls = ["https://competidor-a.example/precios", "https://competidor-b.example/", "https://directorio.example/fisioterapia/barcelona"];
    const c = marcusRun((r) => ({
      content: [
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "centros de estética Barcelona chatbot reservas" } },
        { type: "web_search_tool_result", tool_use_id: "s1", content: urls.map((url) => ({ type: "web_search_result", url, title: "t", encrypted_content: "x" })) },
        { type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: urls[0] } },
        { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: urls[0], content: { type: "document" } } },
        { type: "text", text: `Competencia analizada.${block({ resultado: "completed", objetivos_completados: ["competencia"] })}` },
      ] as ContentBlock[], stopReason: "end_turn", usage: { ...usage, webSearchRequests: 1 }, model: r.model,
    }));
    await runTick({ store: sqlStore(t), client: c });
    expect((await t.db.query<{ status: string }>(`select status::text from public.tasks where id = $1`, [id])).rows[0].status).toBe("completed");
  });
});

// ───────────────────────── 3 · Instrucciones de Marcus (aplicadas en laboratorio) ─────────────────────────
describe("3 · instrucciones de Marcus: buscar antes de leer", () => {
  it("el prompt real de Marcus incluye las reglas de uso de la web y la coordinación con Alex", () => {
    const p = pilotSystemPrompt(getAgent("marcus")!);
    expect(p).toContain("Uso de la web (obligatorio):");
    expect(p).toMatch(/búscala antes con la búsqueda web y lee solo URLs que aparezcan en esos resultados/);
    expect(p).toMatch(/URLs del CRM, de las fichas, del encargo o de la tarea de Alex son datos guardados, no direcciones que puedas leer/);
    expect(p).toMatch(/No construyas, modifiques ni completes URLs/);
    expect(p).toMatch(/anótalo como NO ENCONTRADO/);
    expect(p).toMatch(/15 búsquedas y las 10 lecturas son límites globales de toda la misión/);
    expect(p).toMatch(/nunca una autorización de lectura/);
    expect(p).toMatch(/Busca antes de leer: solo puedes leer URLs que hayan salido en tus resultados de búsqueda/);
  });
  it("no cambian identidad, modelo, esfuerzo, herramientas ni permisos de Marcus", () => {
    const m = getAgent("marcus")!;
    expect([m.role, m.model, m.effort, m.isCoordinator]).toEqual(["Director Comercial B2B e Inteligencia de Mercado", "claude-sonnet-5-5", "high", false]);
    expect(m.tools).toEqual(["memory.read", "memory.write", "tasks.report", "tasks.request_review", "content.draft", "web.search", "web.fetch", "crm.read", "crm.write", "outreach.contact", "email.send"]);
    expect([...scopeTools(m)].sort()).toEqual(["content.draft", "crm.read", "crm.write", "memory.read", "web.fetch", "web.search"]);
  });
  it("los demás agentes (incluidos Alex y Sofia) quedan idénticos a 8c21b00", async () => {
    // Base con el seed ACTUAL; se aplica encima el seed de 8c21b00 (upsert) y las
    // filas de los otros 8 agentes no deben cambiar en ninguna columna.
    const t = await createTestDb();
    try {
      const snap = async () => (await t.db.query<{ j: string }>(
        `select string_agg(row_to_json(a)::text, E'\\n' order by id) j from (select id, name, role, department, specialty, description, personality,
           instructions, tools, model, effort, is_coordinator, active, avatar, desk from public.agents where id <> 'marcus') a`)).rows[0].j;
      const before = await snap();
      await t.db.exec(execFileSync("git", ["show", "8c21b00:office/supabase/seed.sql"], { encoding: "utf8" }));
      expect(await snap()).toBe(before);
      expect(before.split("\n")).toHaveLength(AGENTS.length - 1);
    } finally {
      await t.close();
    }
  });
});

// ───────────────────────── 4b · cancel_mission (0007 revisada en 0014) ─────────────────────────
describe("4b · parada por sobrecoste y cancel_mission", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t?.close();
  });
  const svc = async <T,>(sql: string, p: unknown[] = []) => t.asService(async () => (await t.db.query<T>(sql, p)).rows);
  async function running(n: number) {
    await t.db.exec(`delete from public.ai_reservations; delete from public.ai_usage; delete from public.agent_runs; delete from public.tasks;`);
    const [m] = (await t.db.query<{ id: string }>(`insert into public.tasks (title, description, agent_id, status, input, created_by, plan_required)
      values ('Misión', 'Prueba de sobrecoste', 'alex', 'in_progress', '{"kind": "mission"}', 'admin', false) returning id`)).rows;
    const runs: { run: string; worker: string }[] = [];
    for (let i = 0; i < n; i++) {
      const [x] = (await t.db.query<{ id: string }>(`insert into public.tasks (title, description, agent_id, status, input, parent_task_id, plan_required, locked_by, locked_until)
        values ('Sub', 'Subtarea de prueba', 'marcus', 'in_progress', '{}', $1, false, $2, now() + interval '1 hour') returning id`, [m.id, `w${i}`])).rows;
      const [r] = (await t.db.query<{ id: string }>(`insert into public.agent_runs (task_id, agent_id, attempt, status, worker_id) values ($1, 'marcus', 1, $2, $3) returning id`, [x.id, i === 0 ? "running" : "waiting_approval", `w${i}`])).rows;
      runs.push({ run: r.id, worker: `w${i}` });
    }
    return { mission: m.id, runs };
  }
  it("sobrecoste: misión detenida, reservas abiertas → inciertas, ejecuciones en espera canceladas, consumo registrado", async () => {
    const { mission, runs } = await running(2);
    const [a] = await svc<{ r: { reservation_id: string } }>(`select public.reserve_budget($1, $2, 'claude-sonnet-5-5', 0.01, 0, 240, 0) as r`, [runs[0].run, runs[0].worker]);
    await t.db.query(`insert into public.ai_reservations (run_id, task_id, mission_id, agent_id, model, estimate_usd) select $1, task_id, $2, 'marcus', 'claude-sonnet-5-5', 0.02 from public.agent_runs where id = $1`, [runs[1].run, mission]);
    const [r] = await svc<{ r: { continue: boolean; reason: string } }>(
      `select public.record_call($1, $2, $3, '{}'::jsonb, 'claude-sonnet-5-5', 10, 10, 0, 0, 0, 0.05, 0, 'working'::agent_status) as r`, [runs[0].run, runs[0].worker, a.r.reservation_id]);
    expect(r.r).toEqual({ continue: false, reason: "cost_overrun" });
    const res = (await t.db.query<{ status: string }>(`select status from public.ai_reservations order by created_at`)).rows.map((x) => x.status);
    expect(res).toEqual(["settled", "uncertain"]);
    expect((await t.db.query(`select 1 from public.agent_runs where status in ('running', 'waiting_approval')`)).rows).toHaveLength(0);
    expect((await t.db.query(`select 1 from public.ai_usage`)).rows).toHaveLength(1);
    expect((await t.db.query<{ s: string }>(`select status::text s from public.tasks where id = $1`, [mission])).rows[0].s).toBe("failed");
  });
  it("cancel_mission es idempotente: repetirla no duplica eventos ni reabre nada", async () => {
    const { mission } = await running(2);
    await svc(`select public.cancel_mission($1, 'primera')`, [mission]);
    const n1 = (await t.db.query(`select 1 from public.task_events where type = 'cancelled'`)).rows.length;
    const [again] = await svc<{ n: number }>(`select public.cancel_mission($1, 'segunda') as n`, [mission]);
    expect(again.n).toBe(0);
    expect((await t.db.query(`select 1 from public.task_events where type = 'cancelled'`)).rows).toHaveLength(n1);
  });
  it("cancel_mission toma primero el bloqueo global (orden limits → tareas → reservas → ejecuciones)", async () => {
    const [d] = (await t.db.query<{ def: string }>(`select pg_get_functiondef('public.cancel_mission(uuid, text)'::regprocedure) def`)).rows;
    const iLimits = d.def.indexOf("where key = 'limits' for update");
    const iTasks = d.def.indexOf("order by id for update");
    const iRes = d.def.indexOf("update public.ai_reservations");
    expect(iLimits).toBeGreaterThan(0);
    expect(iLimits).toBeLessThan(iTasks);
    expect(iTasks).toBeLessThan(iRes);
    const [rc] = (await t.db.query<{ def: string }>(`select pg_get_functiondef(p.oid) def from pg_proc p where p.proname = 'record_call'`)).rows;
    expect(rc.def.indexOf("where key = 'limits' for update")).toBeLessThan(rc.def.indexOf("from public.ai_reservations where id = p_reservation_id"));
  });
});
