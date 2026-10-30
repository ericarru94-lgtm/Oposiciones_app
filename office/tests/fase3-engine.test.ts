// Fase 3 · Correcciones del motor A–F y migración 0008 (entregas, procedencia,
// permisos, Realtime). PostgreSQL (PGlite) con las migraciones reales y
// modelos simulados: ninguna llamada a Claude.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { coherenceCheck, parseDeclaredOutcome, subtaskOutcome } from "@/lib/engine/coordination";
import { SqlEngineStore, type Query } from "@/lib/engine/store-sql";
import { runTick } from "@/lib/engine/worker";
import { ModelError, type ModelClient, type ModelRequest, type ModelResponse } from "@/lib/engine/types";
import { ADMIN, INTRUDER, createTestDb, type TestDb } from "./helpers/db";

let t: TestDb;
const raw = async <T,>(sql: string, params: unknown[] = []) => (await t.db.query<T>(sql, params)).rows;
const query: Query = (sql, params) => t.asService(() => raw(sql, params ?? [])) as never;
const store = () => new SqlEngineStore(query);

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.db.exec(`delete from public.task_deliveries; delete from public.company_facts; delete from public.documents;
    delete from public.ai_reservations; delete from public.companies where created_by <> 'admin';
    delete from public.tasks; delete from public.ai_usage;
    update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 1, "mission_ai_budget_usd": 1}' where key = 'limits';
    update public.agents set status = 'available', current_task_id = null;`);
});

const usage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 };
const who = (r: ModelRequest) => /Eres (\w+),/.exec(r.system)?.[1] ?? "?";
const turn = (r: ModelRequest) => (r.messages.length + 1) / 2;
const first = (r: ModelRequest) => String(r.messages[0].content);
const say = (text: string, r: ModelRequest): ModelResponse => ({ content: [{ type: "text", text }], stopReason: "end_turn", usage, model: r.model });
const use = (calls: { id: string; name: string; input: Record<string, unknown> }[], r: ModelRequest): ModelResponse => ({
  content: calls.map((c) => ({ type: "tool_use", ...c })), stopReason: "tool_use", usage, model: r.model,
});
const lastUser = (r: ModelRequest) => r.messages.at(-1)?.content as { type: string; text?: string; content?: string }[];
const block = (o: unknown) => `\n\`\`\`resultado\n${JSON.stringify(o)}\n\`\`\``;

async function mission(input: Record<string, unknown> = {}) {
  const [m] = await raw<{ id: string }>(
    `insert into public.tasks (title, description, agent_id, status, input, created_by, timeout_seconds)
     values ('Estudio gimnasios', 'Estudio comercial en borrador, sin contactar a nadie', 'alex', 'assigned', $1, 'admin', 86400) returning id`,
    [JSON.stringify({ kind: "mission", round: 1, phase: "planning", ...input })],
  );
  return m.id;
}
const taskOf = async (agent: string) =>
  (await raw<{ id: string; status: string; result_data: Record<string, unknown> | null }>(
    `select id, status::text as status, result_data from public.tasks where agent_id = $1 and parent_task_id is not null`, [agent]))[0];

/** Alex: delega SIN depends_on (el motor impone el orden) y luego sintetiza con el texto indicado. */
function alex(order: ("marcus" | "sofia")[], synthesis = "# Informe final\nControl de coherencia: correcto.") {
  return (r: ModelRequest): ModelResponse => {
    if (first(r).includes("ENTREGAS DEL EQUIPO")) return say(synthesis, r);
    const n = turn(r);
    if (n <= order.length) {
      const a = order[n - 1];
      return use([{ id: `d-${a}`, name: "tasks__delegate", input: { agent: a, title: a === "marcus" ? "Investigar gimnasios" : "Estrategia", instructions: "Instrucciones claras de la subtarea." } }], r);
    }
    return say("Plan delegado.", r);
  };
}

async function previousFichas(n = 2) {
  const old = await mission();
  await raw(`update public.tasks set status = 'completed' where id = $1`, [old]);
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const [r] = await t.asService(() => raw<{ id: string }>(
      `insert into public.companies (name, city, website, need_detected, notes, source, created_by, created_in_task, stage)
       values ($1, 'Barcelona', $2, 'VERIFICADO: reserva online.', 'VERIFICADO: web. PENDIENTE: WhatsApp e Instagram.', $2, 'marcus', $3, 'researched') returning id`,
      [`Estudio ${i}`, `https://estudio${i}.example/`, old]));
    ids.push(r.id);
  }
  return ids;
}

describe("A · Marcus continúa mientras haya trabajo útil", () => {
  it("recibe los objetivos pendientes, una nota de continuidad tras cada ronda y puede hacer varias llamadas", async () => {
    const reuse = await previousFichas(2);
    await mission({ reuse_company_ids: reuse });
    const calls: ModelRequest[] = [];
    const client: ModelClient = {
      async create(r) {
        calls.push(structuredClone(r));
        if (who(r) === "Alex") return alex(["marcus", "sofia"])(r);
        if (who(r) === "Marcus") {
          if (turn(r) <= 3) return use([{ id: `m${turn(r)}`, name: "memory__read", input: {} }], r);
          return say(`Hecho.${block({ resultado: "completed", objetivos_completados: ["Estudio 1", "Estudio 2"], objetivos_pendientes: [], avisos: [] })}`, r);
        }
        return say(`Estrategia.${block({ resultado: "completed", objetivos_completados: ["estrategia"] })}`, r);
      },
    };
    await runTick({ store: store(), client });
    const marcus = calls.filter((c) => who(c) === "Marcus");
    expect(marcus).toHaveLength(4); // el motor no corta tras la primera ronda
    expect(first(marcus[0])).toMatch(/OBJETIVOS PENDIENTES \(según las fichas\):\n- Estudio 1 \(id [^)]+\): WhatsApp e Instagram/);
    const note = lastUser(marcus[1]).find((b) => b.type === "text")?.text ?? "";
    expect(note).toMatch(/límite de 1 búsqueda y 1 lectura web es POR LLAMADA/);
    // Solo para agentes con herramientas web.
    const alexSecond = calls.filter((c) => who(c) === "Alex")[1];
    expect(lastUser(alexSecond).some((b) => b.type === "text")).toBe(false);
    expect((await taskOf("marcus")).result_data).toMatchObject({ outcome: "completed", declared: true });
  });
});

describe("B · Sofia depende siempre de Marcus, sin bloqueo si Marcus falla", () => {
  it("el motor añade la dependencia aunque Alex no la pida y aunque delegue primero a Sofia", async () => {
    for (const order of [["marcus", "sofia"], ["sofia", "marcus"]] as const) {
      await t.db.exec(`delete from public.task_deliveries; delete from public.ai_reservations; delete from public.tasks; delete from public.ai_usage; update public.agents set status = 'available', current_task_id = null;`);
      await mission();
      const seq: string[] = [];
      const client: ModelClient = {
        async create(r) {
          seq.push(who(r));
          if (who(r) === "Alex") return alex([...order])(r);
          return say(`Hecho.${block({ resultado: "completed" })}`, r);
        },
      };
      await runTick({ store: store(), client });
      const deps = await raw<{ a: string; b: string }>(
        `select t1.agent_id as a, t2.agent_id as b from public.task_dependencies d join public.tasks t1 on t1.id = d.task_id join public.tasks t2 on t2.id = d.depends_on where t1.parent_task_id is not null`);
      expect({ order, deps }).toEqual({ order, deps: [{ a: "sofia", b: "marcus" }] });
      expect(seq.indexOf("Marcus")).toBeLessThan(seq.indexOf("Sofia"));
    }
  });

  it("mientras Marcus sigue en marcha (reintento programado) Sofia no empieza", async () => {
    await mission();
    const calls: string[] = [];
    let marcusCalls = 0;
    const client: ModelClient = {
      async create(r) {
        calls.push(who(r));
        if (who(r) === "Alex") return alex(["marcus", "sofia"])(r);
        if (who(r) === "Marcus") { marcusCalls++; throw new ModelError("Claude ha limitado las peticiones (429).", true, "none"); }
        return say("Estrategia.", r);
      },
    };
    await runTick({ store: store(), client });
    expect(marcusCalls).toBe(1);
    expect(calls).not.toContain("Sofia");
    expect((await taskOf("sofia")).status).toBe("assigned");
  });

  it("si Marcus falla, Sofia se ejecuta después con las fichas y el estado de fallo", async () => {
    const reuse = await previousFichas(2);
    await mission({ reuse_company_ids: reuse });
    const sofia: ModelRequest[] = [];
    const client: ModelClient = {
      async create(r) {
        if (who(r) === "Alex") return alex(["marcus", "sofia"])(r);
        if (who(r) === "Marcus") throw new ModelError("Petición rechazada por la API: prueba.", false, "none");
        sofia.push(structuredClone(r));
        return say(`Estrategia.${block({ resultado: "completed" })}`, r);
      },
    };
    await runTick({ store: store(), client });
    expect(sofia).toHaveLength(1);
    expect(first(sofia[0])).toMatch(/ESTADO: FALLIDA[\s\S]*FICHAS DEL CRM DE LA MISIÓN \(2\)/);
  });
});

describe("C · Entregas registradas (preparada → enviada → recibida)", () => {
  it("Sofia recibe fichas y documentos de Marcus con versiones; Alex recibe el inventario exacto", async () => {
    const reuse = await previousFichas(2);
    await mission({ reuse_company_ids: reuse });
    const calls: ModelRequest[] = [];
    const client: ModelClient = {
      async create(r) {
        calls.push(structuredClone(r));
        if (who(r) === "Alex") return alex(["marcus", "sofia"])(r);
        if (who(r) === "Marcus" && turn(r) === 1)
          return use([{ id: "doc", name: "content__draft", input: { title: "Informe de Marcus", kind: "report", content: "Informe con las fichas completadas y lo pendiente. ".repeat(3) } }], r);
        return say(`Hecho.${block({ resultado: "completed" })}`, r);
      },
    };
    await runTick({ store: store(), client });
    const rows = await raw<{ from_agent: string; to_agent: string; status: string; company_ids: string[]; document_ids: string[]; document_versions: Record<string, { version: number }> }>(
      `select from_agent, to_agent, status, company_ids::text[] as company_ids, document_ids::text[] as document_ids, document_versions from public.task_deliveries order by prepared_at, to_agent, from_agent`);
    const toSofia = rows.filter((r) => r.to_agent === "sofia");
    expect(toSofia).toHaveLength(1);
    expect(toSofia[0]).toMatchObject({ from_agent: "marcus", status: "received" });
    expect(toSofia[0].company_ids.sort()).toEqual([...reuse].sort());
    expect(toSofia[0].document_ids).toHaveLength(1);
    expect(Object.values(toSofia[0].document_versions)[0]).toMatchObject({ version: 1, truncated: false });
    expect(rows.every((r) => r.status === "received")).toBe(true);
    const synth = calls.filter((c) => who(c) === "Alex").at(-1)!;
    expect(first(synth)).toMatch(/INVENTARIO DE ENTREGAS \(registro del sistema[\s\S]*- marcus → sofia \(tarea «Estrategia»\) · recibida\n  Fichas \(2\)[\s\S]*Documentos \(1\): [0-9a-f-]{36} v1/);
  });

  it("no se registra como recibida una entrega cuya llamada no se envió o falló", async () => {
    // Sin presupuesto: la entrega se prepara, pero no hay llamada.
    await t.db.exec(`update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 0.001, "mission_ai_budget_usd": 1}' where key = 'limits'`);
    await mission();
    await runTick({ store: store(), client: { async create() { throw new Error("no debe llamar"); } } });
    expect((await raw<{ status: string }>(`select status from public.task_deliveries`)).map((r) => r.status)).toEqual([]);
    // (Alex en planificación sin fichas no recibe nada; con fichas reutilizadas sí.)
    await t.db.exec(`delete from public.tasks; delete from public.task_deliveries; delete from public.companies where created_by <> 'admin'; update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 0.001, "mission_ai_budget_usd": 1}' where key = 'limits'`);
    const reuse = await previousFichas(1);
    await mission({ reuse_company_ids: reuse });
    await runTick({ store: store(), client: { async create() { throw new Error("no debe llamar"); } } });
    expect((await raw<{ status: string; sent_at: string | null }>(`select status, sent_at from public.task_deliveries`))).toEqual([{ status: "prepared", sent_at: null }]);
    // Llamada enviada pero rechazada (400): «enviada», nunca «recibida».
    await t.db.exec(`delete from public.tasks; delete from public.task_deliveries; delete from public.companies where created_by <> 'admin'; update public.settings set value = '{"monthly_ai_budget_usd": 10, "task_ai_budget_usd": 1, "mission_ai_budget_usd": 1}' where key = 'limits'`);
    const reuse2 = await previousFichas(1);
    await mission({ reuse_company_ids: reuse2 });
    await runTick({ store: store(), client: { async create() { throw new ModelError("Petición rechazada por la API: 400.", false, "none"); } } });
    expect((await raw<{ status: string; received: boolean }>(`select status, received_at is not null as received from public.task_deliveries`))).toEqual([{ status: "sent", received: false }]);
  });
});

describe("D · Estados de resultado", () => {
  it("declaración leída del bloque «resultado»; sin declaración no cuenta como completada sin más", () => {
    expect(subtaskOutcome(`ok${block({ resultado: "completed", objetivos_pendientes: ["Vita"] })}`)).toMatchObject({ outcome: "partially_completed", objectives_pending: ["Vita"] });
    expect(subtaskOutcome(`ok${block({ resultado: "completed", avisos: ["dato antiguo"] })}`).outcome).toBe("completed_with_warnings");
    expect(subtaskOutcome(`ok${block({ resultado: "completed" })}`)).toMatchObject({ outcome: "completed", declared: true });
    expect(subtaskOutcome("sin bloque")).toMatchObject({ outcome: "completed_with_warnings", declared: false });
    expect(parseDeclaredOutcome("```resultado\n{no es json}\n```")).toBeNull();
  });

  it("Alex ve PARCIALMENTE COMPLETADA con los objetivos pendientes y la subtarea sin declaración CON AVISOS", async () => {
    await mission();
    const calls: ModelRequest[] = [];
    const client: ModelClient = {
      async create(r) {
        calls.push(structuredClone(r));
        if (who(r) === "Alex") return alex(["marcus", "sofia"])(r);
        if (who(r) === "Marcus") return say(`Fichas.${block({ resultado: "partially_completed", objetivos_completados: ["Serotonin"], objetivos_pendientes: ["Vita: leer la web"] })}`, r);
        return say("Estrategia sin bloque.", r);
      },
    };
    await runTick({ store: store(), client });
    expect((await taskOf("marcus")).result_data).toMatchObject({ outcome: "partially_completed" });
    expect((await taskOf("sofia")).result_data).toMatchObject({ outcome: "completed_with_warnings", declared: false });
    const synth = first(calls.filter((c) => who(c) === "Alex").at(-1)!);
    expect(synth).toMatch(/ESTADO: PARCIALMENTE COMPLETADA[\s\S]*Objetivos PENDIENTES: Vita: leer la web/);
    expect(synth).toMatch(/ESTADO: COMPLETADA CON AVISOS[\s\S]*sin declarar qué objetivos completó/);
  });
});

describe("E · Datos de las fichas con procedencia", () => {
  async function runWithFacts(facts: Record<string, unknown>[], companyId: string, missionId: string) {
    // Ejecuta crm.write de Marcus directamente por la ToolGateway (con lease real).
    const { pilotGateway } = await import("@/lib/engine/pilot-tools");
    await raw(`insert into public.tasks (title, description, agent_id, status, parent_task_id, input) values ('Completar', 'Completar fichas pendientes', 'marcus', 'assigned', $1, '{"kind":"subtask"}')`, [missionId]);
    await raw(`update public.tasks set status = 'completed' where id = $1`, [missionId]);
    // Cada llamada simula una subtarea nueva: libera las anteriores.
    await raw(`update public.tasks set status = 'completed', locked_by = null, locked_until = null where status = 'in_progress'`);
    await raw(`update public.agents set status = 'available', current_task_id = null`);
    const [c] = await t.asService(() => raw<{ run_id: string; task_id: string }>(`select * from public.claim_next_task('w', 240, 5)`));
    const gw = pilotGateway({ store: store(), runId: c.run_id, taskId: c.task_id, worker: "w", clientId: null, missionId, reuseIds: [companyId] });
    return gw.execute(
      { agent: { id: "marcus", name: "Marcus", tools: ["crm.write"] }, toolUseId: `f-${Math.random()}`, toolId: "crm.write", args: { company_id: companyId, sources: ["https://estudio1.example/"], facts } },
      { runId: c.run_id, taskId: c.task_id, agentId: "marcus" },
    );
  }

  it("confianza por regla, antigüedad, rebaja con motivo, sin subida arbitraria, fecha de consulta del sistema y contradicciones", async () => {
    const [company] = await previousFichas(1);
    const m = await mission({ reuse_company_ids: [company] });
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const r = await runWithFacts([
      { key: "telefono", value: "+34 600 000 001", source_url: "https://estudio1.example/contacto", source_type: "official_direct", verification_status: "verified" },
      { key: "precio_prueba", value: "20 €", source_url: "https://directorio.example/estudio1", source_type: "directory", verification_status: "verified", source_date: old },
      { key: "clases_semana", value: "100", source_url: "https://estudio1.example/", source_type: "self_declared", verification_status: "verified", lower_score_to: 50, score_reason: "Cifra de marketing sin desglose" },
      { key: "sedes", value: "2", source_url: "https://estudio1.example/", source_type: "inference", verification_status: "estimated", lower_score_to: 99, score_reason: "intento de subir" },
      { key: "telefono", value: "+34 600 000 002", source_url: "https://facebook.example/estudio1", source_type: "third_party", verification_status: "verified" },
    ], company, m);
    expect(r.kind === "result" && !r.output.isError).toBe(true);
    expect(r.kind === "result" && r.output.content).toMatch(/telefono: confianza 70 · CONTRADICE a/);
    const facts = await raw<{ fact_key: string; fact_value: string; confidence_score: number; confidence_reason: string; in_contradiction: boolean; recent: boolean }>(
      `select fact_key, fact_value, confidence_score, confidence_reason, in_contradiction, observed_at > now() - interval '1 minute' as recent
         from public.company_facts_current order by fact_key, fact_value`);
    const by = (k: string, v?: string) => facts.find((f) => f.fact_key === k && (!v || f.fact_value === v))!;
    expect(by("telefono", "+34 600 000 001")).toMatchObject({ confidence_score: 95, in_contradiction: true });
    expect(by("telefono", "+34 600 000 002")).toMatchObject({ confidence_score: 70, in_contradiction: true });
    expect(by("precio_prueba")).toMatchObject({ confidence_score: 70 }); // 80 − 10 por más de 365 días
    expect(by("precio_prueba").confidence_reason).toMatch(/fuente de hace 400 días: −10/);
    expect(by("clases_semana")).toMatchObject({ confidence_score: 50 });
    expect(by("clases_semana").confidence_reason).toMatch(/rebajada por el agente a 50: Cifra de marketing/);
    expect(by("sedes")).toMatchObject({ confidence_score: 40 }); // no puede subir de la regla
    expect(facts.every((f) => f.recent)).toBe(true);
    // Histórico inmutable.
    await expect(t.asService(() => raw(`update public.company_facts set fact_value = 'x'`))).rejects.toThrow(/no se modifican/);
  });

  it("sustituir un hecho conserva el histórico; la regla es configurable; sin URL se rechaza", async () => {
    const [company] = await previousFichas(1);
    const m = await mission({ reuse_company_ids: [company] });
    await runWithFacts([{ key: "instagram", value: "@estudio_viejo", source_url: "https://estudio1.example/", source_type: "official_direct", verification_status: "verified" }], company, m);
    const [oldFact] = await raw<{ id: string }>(`select id from public.company_facts where fact_key = 'instagram'`);
    await t.db.exec(`update public.settings set value = jsonb_set(value, '{base,official_direct}', '93') where key = 'confidence_rules'`);
    const m2 = await mission({ reuse_company_ids: [company] });
    const r = await runWithFacts([
      { key: "instagram", value: "@estudio1", source_url: "https://instagram.example/estudio1", source_type: "official_direct", verification_status: "verified", supersedes_fact_id: oldFact.id },
      { key: "whatsapp", value: "sí", source_type: "official_direct", verification_status: "verified" },
    ], company, m2);
    expect(r.kind === "result" && r.output.content).toMatch(/Datos no válidos[\s\S]*source_url: Indica la URL/);
    await runWithFacts([{ key: "instagram", value: "@estudio1", source_url: "https://instagram.example/estudio1", source_type: "official_direct", verification_status: "verified", supersedes_fact_id: oldFact.id }], company, m2);
    expect((await raw(`select 1 from public.company_facts where fact_key = 'instagram'`)).length).toBe(2);
    const current = await raw<{ fact_value: string; confidence_score: number; in_contradiction: boolean }>(`select fact_value, confidence_score, in_contradiction from public.company_facts_current where fact_key = 'instagram'`);
    expect(current).toEqual([{ fact_value: "@estudio1", confidence_score: 93, in_contradiction: false }]);
    await t.db.exec(`update public.settings set value = jsonb_set(value, '{base,official_direct}', '95') where key = 'confidence_rules'`);
  });
});

describe("F · Control de coherencia del informe de Alex", () => {
  it("detecta que niega empresas existentes, cita IDs inexistentes y omite un fallo", () => {
    const companies = [{ id: "11111111-1111-4111-8111-111111111111", name: "Gym", city: null, website: null, instagram: null, phone: null, need_detected: null, recommended_service: null, notes: null, source: "x", created_by: "marcus", created_in_task: null }];
    const tasks = [{ id: "22222222-2222-4222-8222-222222222222", title: "Investigar", agent_id: "marcus", status: "failed", result: null, error: "x", result_data: null }];
    const bad = coherenceCheck({ report: "No hay empresas identificadas. Ver 33333333-3333-4333-8333-333333333333.", companies, documents: [], tasks, knownIds: [] });
    expect(bad.warnings).toHaveLength(3);
    const good = coherenceCheck({ report: "Gym (id 11111111-1111-4111-8111-111111111111). La subtarea de marcus falló.", companies, documents: [], tasks, knownIds: [] });
    expect(good.warnings).toEqual([]);
  });

  it("el informe final queda «con avisos» y el documento incluye el control automático", async () => {
    const reuse = await previousFichas(2);
    const id = await mission({ reuse_company_ids: reuse });
    const client: ModelClient = {
      async create(r) {
        if (who(r) === "Alex") return alex(["marcus", "sofia"], "# Informe\nNo hay empresas identificadas en el CRM.")(r);
        return say(`Hecho.${block({ resultado: "completed" })}`, r);
      },
    };
    await runTick({ store: store(), client });
    const [m] = await raw<{ result_data: { outcome: string; warnings: string[] } }>(`select result_data from public.tasks where id = $1`, [id]);
    expect(m.result_data.outcome).toBe("completed_with_warnings");
    expect(m.result_data.warnings[0]).toMatch(/dice que no hay empresas, pero la misión tiene 2 fichas/);
    const [doc] = await raw<{ content: string }>(`select content from public.documents where task_id = $1`, [id]);
    expect(doc.content).toMatch(/## Control automático de coherencia \(sistema\)[\s\S]*⚠ El informe dice que no hay empresas/);
  });
});

describe("Migración 0008 · permisos, RLS y Realtime", () => {
  it("el administrador lee entregas y hechos; no puede escribirlos ni escribir documentos o dependencias; otro usuario no ve nada", async () => {
    const reuse = await previousFichas(1);
    await mission({ reuse_company_ids: reuse });
    await runTick({ store: store(), client: { async create(r) { return say(`Plan.${block({ resultado: "completed" })}`, r); } } });
    expect((await t.as(ADMIN, () => raw(`select * from public.task_deliveries`))).length).toBeGreaterThan(0);
    expect(await t.as(INTRUDER, () => raw(`select * from public.task_deliveries`))).toHaveLength(0);
    expect(await t.as(INTRUDER, () => raw(`select * from public.company_facts_current`))).toHaveLength(0);
    for (const sql of [
      `insert into public.task_deliveries (mission_id, task_id, from_agent, to_agent) select id, id, 'x', 'y' from public.tasks limit 1`,
      `insert into public.company_facts (company_id, fact_key, fact_value, source_type, verification_status, confidence_score, confidence_reason) select id, 'k', 'v', 'none', 'pending', 0, 'r' from public.companies limit 1`,
      `insert into public.documents (title, kind, content, source) values ('x', 'report', 'x', 'x')`,
      `insert into public.task_dependencies (task_id, depends_on) select a.id, b.id from public.tasks a, public.tasks b where a.id <> b.id limit 1`,
    ]) {
      await expect(t.as(ADMIN, () => raw(sql))).rejects.toThrow(/permission denied/);
    }
    // Sigue pudiendo lo que la interfaz usa: crear encargos y guardar límites.
    await t.as(ADMIN, () => raw(`insert into public.tasks (title, description, agent_id, status, input) values ('Encargo', 'Desde la interfaz', 'alex', 'assigned', '{"kind":"mission"}')`));
    await t.as(ADMIN, () => raw(`update public.settings set value = value where key = 'limits'`));
  });

  it("Realtime publica las tablas nuevas y las que necesita la oficina", async () => {
    const rows = await raw<{ tablename: string }>(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`);
    for (const tname of ["agents", "tasks", "task_events", "agent_runs", "approvals", "ai_reservations", "companies", "documents", "ai_usage", "tool_executions", "task_deliveries", "company_facts"]) {
      expect(rows.map((r) => r.tablename)).toContain(tname);
    }
  });
});
