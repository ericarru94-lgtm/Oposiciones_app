// Herramientas reales del piloto (Alex, Marcus y Sofia). Todas trabajan solo
// dentro de la oficina: leer memoria y CRM, guardar borradores y fichas del
// CRM con sus fuentes, y delegar (solo Alex). Ninguna contacta, envía,
// publica ni gasta: esas herramientas no tienen manejador y la ToolGateway
// las rechaza.

import { z } from "zod";
import type { ToolId } from "../agents/tools";
import { ToolGateway, type ToolOutput } from "./gateway";
import { PILOT_DEPENDENCIES } from "./config";
import type { EngineStore } from "./store";

const url = z.string().trim().url().refine((u) => /^https?:\/\//i.test(u), "La fuente debe ser una URL http(s).");

// Teléfono público de empresa: hasta 100 caracteres, solo cifras y separadores
// habituales, entre 6 y 30 cifras (permite dos números o una extensión).
const phone = z
  .string()
  .trim()
  .max(100)
  .regex(/^[0-9+()\s./,;-]+$/, "Solo cifras y separadores (+ ( ) - . / , ;).")
  .refine((v) => {
    const digits = v.replace(/\D/g, "").length;
    return digits >= 6 && digits <= 30;
  }, "Debe tener entre 6 y 30 cifras.");

// Un dato de una ficha con su procedencia. La fecha de consulta la pone el
// sistema; la confianza la calcula la base de datos con una regla fija (el
// agente solo puede rebajarla, con motivo).
const Fact = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,49}$/, "Clave en minúsculas y guiones bajos (p. ej. telefono, instagram, sedes, precio_prueba).")
      .describe("Qué dato es: telefono, instagram, whatsapp, sedes, direccion, precio_prueba, reserva_online, resenas_google…"),
    value: z.string().trim().min(1).max(2000),
    source_url: url.optional().describe("URL exacta donde se ha visto el dato (obligatoria salvo inferencia o sin fuente)."),
    source_type: z.enum(["official_direct", "official_indirect", "directory", "third_party", "self_declared", "inference", "none"])
      .describe("official_direct = web oficial con el dato a la vista; official_indirect = canal oficial de otra forma (p. ej. su ficha de Google); directory = directorio especializado; third_party = noticia o web ajena; self_declared = cifra que la propia empresa dice de sí misma; inference = deducción tuya; none = sin fuente."),
    verification_status: z.enum(["verified", "estimated", "pending"]),
    source_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      // Fecha real (no 2026-13-40) y no futura: una fuente no puede estar fechada después de hoy.
      .refine((d) => { const t = Date.parse(`${d}T00:00:00Z`); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d && t <= Date.now(); }, "Fecha no válida o futura.")
      .optional()
      .describe("Fecha de publicación o actualización QUE MUESTRA la fuente (AAAA-MM-DD). Omítela si la fuente no la muestra."),
    lower_score_to: z.number().int().min(0).max(100).optional().describe("Solo para REBAJAR la confianza de la regla, con motivo."),
    score_reason: z.string().trim().max(500).optional(),
    supersedes_fact_id: z.string().uuid().optional().describe("Hecho anterior que este sustituye (no se borra: queda en el histórico)."),
  })
  .superRefine((f, ctx) => {
    if (!f.source_url && f.source_type !== "inference" && f.source_type !== "none") {
      ctx.addIssue({ code: "custom", path: ["source_url"], message: "Indica la URL de la fuente." });
    }
    if (f.lower_score_to !== undefined && !f.score_reason) {
      ctx.addIssue({ code: "custom", path: ["score_reason"], message: "Explica por qué rebajas la confianza." });
    }
  });

// Crear una ficha nueva o, con company_id, COMPLETAR una ficha existente de
// esta misión (sin duplicarla). Las fuentes nuevas se añaden a las anteriores.
const CrmWrite = z
  .object({
    company_id: z.string().uuid().optional().describe("Para completar una ficha ya existente de la misión. Sin él se crea una nueva."),
    name: z.string().trim().min(2).max(200).optional().describe("Nombre comercial real (obligatorio al crear)."),
    city: z.string().trim().min(2).max(100).optional().describe("Ciudad (obligatoria al crear)."),
    website: url.optional().describe("Web oficial, solo si la has comprobado."),
    instagram: z.string().trim().max(200).optional().describe("Usuario o URL de Instagram, solo si lo has comprobado."),
    phone: phone.optional().describe("Teléfono público de la empresa (nunca de una persona)."),
    need_detected: z.string().trim().min(10).max(2000).optional().describe("Oportunidad detectada (obligatoria al crear), separando VERIFICADO / ESTIMADO / PENDIENTE."),
    recommended_service: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(4000).optional().describe("Versión COMPLETA y actualizada: VERIFICADO, ESTIMADO, PENDIENTE y contradicciones."),
    sources: z.array(url).min(1).max(10).describe("URL de cada fuente consultada para estos datos."),
    facts: z.array(Fact).max(30).optional().describe(
      "Datos con procedencia (uno por dato). La fecha de consulta y la confianza las pone el sistema; no las inventes.",
    ),
  })
  .superRefine((d, ctx) => {
    if (d.company_id) return;
    for (const k of ["name", "city", "need_detected"] as const) {
      if (!d[k]) ctx.addIssue({ code: "custom", path: [k], message: "Obligatorio al crear una ficha nueva." });
    }
  });

const DOC_KINDS = ["report", "strategy", "proposal", "script", "creative", "client_file", "technical", "other"] as const;
const Draft = z.object({
  title: z.string().trim().min(3).max(300),
  kind: z.enum(DOC_KINDS).describe("report = informe, strategy = estrategia, proposal = propuesta, client_file = ficha comercial."),
  content: z.string().trim().min(50).max(60_000).describe("Contenido en Markdown. Siempre es un borrador."),
});

const Delegate = z.object({
  agent: z.enum(["marcus", "sofia"]).describe("marcus = comercial e investigación; sofia = marketing y estrategia."),
  title: z.string().trim().min(3).max(300),
  instructions: z.string().trim().min(10).max(8000).describe("Qué debe entregar, con qué criterios y qué no debe hacer."),
  depends_on: z.array(z.string().uuid()).max(5).optional().describe("task_id de subtareas que deben terminar antes (devueltos por esta herramienta)."),
});

const MemoryRead = z.object({ query: z.string().trim().max(200).optional().describe("Palabra clave para filtrar; vacío = todo.") });
const CrmRead = z.object({ query: z.string().trim().max(200).optional() });

/** Esquemas de entrada (los usan las pruebas para fijar el comportamiento de validación). */
export const PILOT_INPUTS = { MemoryRead, CrmRead, CrmWrite, Draft, Delegate } as const;

export const PILOT_SCHEMAS: Partial<Record<ToolId, Record<string, unknown>>> = {
  "memory.read": z.toJSONSchema(MemoryRead),
  "crm.read": z.toJSONSchema(CrmRead),
  "crm.write": z.toJSONSchema(CrmWrite),
  "content.draft": z.toJSONSchema(Draft),
  "tasks.delegate": z.toJSONSchema(Delegate),
};

function invalid(error: z.ZodError): ToolOutput {
  const issues = error.issues.map((i) => `${i.path.join(".") || "entrada"}: ${i.message}`).join("; ");
  return { content: `Datos no válidos, no se ha guardado nada. ${issues}`, isError: true };
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export interface PilotContext {
  store: EngineStore;
  runId: string;
  taskId: string;
  worker: string;
  clientId: string | null;
  /** Misión y fichas reutilizadas: definen qué fichas se pueden completar y el tope de empresas. */
  missionId?: string;
  reuseIds?: string[];
}

export function pilotGateway(c: PilotContext): ToolGateway {
  const { store } = c;
  const busy = (tool: string) => store.activity(c.runId, c.worker, "executing_tool", "tool_executing", tool);
  const gateway = new ToolGateway(store.enginePort(c.runId, c.worker));

  gateway.register("memory.read", async (raw) => {
    const a = MemoryRead.safeParse(raw);
    if (!a.success) return invalid(a.error);
    await busy("Leer memoria");
    const q = a.data.query?.toLowerCase();
    const items = (await store.memoryForTask(c.taskId)).filter(
      (m) => !q || `${m.title} ${m.content} ${m.category}`.toLowerCase().includes(q),
    );
    if (items.length === 0) return { content: "No hay entradas de memoria que coincidan." };
    return { content: items.map((m) => `## ${m.title} (${m.scope}/${m.category})\n${m.content}\nOrigen: ${m.source}`).join("\n\n") };
  });

  gateway.register("crm.read", async (raw) => {
    const a = CrmRead.safeParse(raw);
    if (!a.success) return invalid(a.error);
    await busy("Consultar CRM");
    const q = a.data.query?.toLowerCase();
    const rows = (await store.companies(100)).filter((r) => !q || `${r.name} ${r.city ?? ""} ${r.need_detected ?? ""}`.toLowerCase().includes(q));
    if (rows.length === 0) return { content: "El CRM no tiene empresas que coincidan." };
    return {
      content: rows
        .map((r) => `- ${r.name} (${r.city ?? "sin ciudad"}) · etapa ${r.stage}${r.is_demo ? " · DEMO" : ""} · web ${r.website ?? "—"} · IG ${r.instagram ?? "—"}\n  Necesidad: ${r.need_detected ?? "—"}\n  Fuente: ${r.source}`)
        .join("\n"),
    };
  });

  /** Registra los hechos (histórico inmutable) y resume confianza y contradicciones. */
  async function recordFacts(companyId: string, facts: z.infer<typeof Fact>[] | undefined): Promise<string> {
    if (!facts?.length) return "";
    const lines: string[] = [];
    for (const f of facts) {
      try {
        const r = await store.recordFact(c.runId, c.worker, companyId, {
          key: f.key, value: f.value, source_url: f.source_url ?? null, source_type: f.source_type,
          verification_status: f.verification_status, source_date: f.source_date ?? null,
          lower_score_to: f.lower_score_to ?? null, score_reason: f.score_reason ?? null, supersedes_fact_id: f.supersedes_fact_id ?? null,
        });
        lines.push(`${f.key}: confianza ${r.confidence_score}${r.contradicts.length ? ` · CONTRADICE a ${r.contradicts.join(", ")} (quedan ambos registrados)` : ""}`);
      } catch (error) {
        lines.push(`${f.key}: no registrado (${(error as Error).message})`);
      }
    }
    return `\nHechos: ${lines.join("; ")}.`;
  }

  gateway.register("crm.write", async (raw, ctx) => {
    const a = CrmWrite.safeParse(raw);
    if (!a.success) return invalid(a.error);
    const d = a.data;
    // Solo fichas de empresa: nada de contactos personales.
    if ([d.name, d.phone, d.notes, d.need_detected].some((v) => v && EMAIL.test(v))) {
      return { content: "No guardes direcciones de email ni contactos personales en el CRM durante el piloto.", isError: true };
    }
    await busy("Actualizar CRM");
    const missionId = c.missionId ?? c.taskId;
    const scope = await store.missionCompanies(missionId, c.reuseIds ?? []);

    if (d.company_id) {
      const target = scope.find((x) => x.id === d.company_id);
      if (!target) {
        return { content: `La ficha ${d.company_id} no pertenece a esta misión: solo se pueden completar las fichas de la misión.`, isError: true };
      }
      await store.updateCompany(target.id, {
        website: d.website, instagram: d.instagram, phone: d.phone, need_detected: d.need_detected,
        recommended_service: d.recommended_service, notes: d.notes, addSources: d.sources,
      });
      const facts = await recordFacts(target.id, d.facts);
      return { content: `Ficha «${target.name}» completada (id ${target.id}); fuentes añadidas a las anteriores.${facts}`, providerRef: target.id };
    }

    const existing = await store.findCompany(d.name!, d.city!);
    if (existing) {
      const inScope = scope.some((x) => x.id === existing.id);
      return {
        content: `«${existing.name}» ya está en el CRM (id ${existing.id}); no se ha duplicado.${inScope ? " Para añadir datos, usa company_id." : ""} Fuente original: ${existing.source}`,
      };
    }
    // Tope de empresas de la misión, contando las fichas reutilizadas.
    const max = Number((await store.pilotSettings()).max_companies ?? 5);
    if (scope.length >= max) {
      return { content: `Se alcanzó el máximo de ${max} empresas en esta misión (incluidas las reutilizadas). Completa las existentes en lugar de crear nuevas.`, isError: true };
    }
    const id = await store.insertCompany({
      name: d.name!,
      city: d.city!,
      website: d.website ?? null,
      instagram: d.instagram ?? null,
      phone: d.phone ?? null,
      need_detected: d.need_detected!,
      recommended_service: d.recommended_service ?? null,
      notes: d.notes ?? null,
      source: d.sources.join(" | "),
      created_by: ctx.agentId,
      created_in_task: c.taskId,
    });
    const facts = await recordFacts(id, d.facts);
    return { content: `Ficha creada en el CRM (id ${id}, etapa «investigada»).${facts}`, providerRef: id };
  });

  gateway.register("content.draft", async (raw, ctx) => {
    const a = Draft.safeParse(raw);
    if (!a.success) return invalid(a.error);
    await busy("Crear borrador");
    const id = await store.createDocument({
      title: a.data.title,
      kind: a.data.kind,
      content: a.data.content,
      task_id: c.taskId,
      run_id: c.runId,
      agent_id: ctx.agentId,
      client_id: c.clientId,
      source: `agente:${ctx.agentId}`,
      created_by: ctx.agentId,
    });
    return { content: `Borrador guardado (documento ${id}).`, providerRef: id };
  });

  /**
   * Orden impuesto por el motor (PILOT_DEPENDENCIES): Sofia espera a Marcus
   * aunque Alex no lo indique. Si Marcus falla, la dependencia se da por
   * resuelta y Sofia se ejecuta igualmente (claim_next_task).
   */
  async function applyDependencyRules(newTaskId: string, agent: string): Promise<string> {
    const siblings = (await store.children(c.missionId ?? c.taskId)).filter((s) => s.id !== newTaskId);
    const notes: string[] = [];
    for (const s of siblings) {
      if (s.agent_id && (PILOT_DEPENDENCIES[agent] ?? []).includes(s.agent_id)) {
        await store.addDependency(newTaskId, s.id);
        notes.push(`${agent} esperará a ${s.agent_id}`);
      }
      // Una subtarea ya creada que debe esperar a la nueva (solo si aún no ha empezado).
      if (s.agent_id && (PILOT_DEPENDENCIES[s.agent_id] ?? []).includes(agent) && s.status === "assigned") {
        await store.addDependency(s.id, newTaskId);
        notes.push(`${s.agent_id} esperará a ${agent}`);
      }
    }
    return notes.length ? ` Orden aplicado por el sistema: ${[...new Set(notes)].join("; ")} (si falla, se ejecuta igualmente).` : "";
  }

  gateway.register("tasks.delegate", async (raw, ctx) => {
    const a = Delegate.safeParse(raw);
    if (!a.success) return invalid(a.error);
    if (!ctx.toolUseId) return { content: "Falta el identificador de la llamada.", isError: true };
    await busy(`Delegar en ${a.data.agent}`);
    try {
      const r = await store.delegate(c.runId, c.worker, ctx.toolUseId, a.data.agent, a.data.title, a.data.instructions, a.data.depends_on ?? []);
      const applied = await applyDependencyRules(r.task_id, a.data.agent);
      return {
        content: `${r.duplicate ? "Subtarea ya creada" : "Subtarea creada"}: task_id ${r.task_id} → ${a.data.agent}.${applied} Cuando termines de delegar, explica el plan y finaliza tu turno; te avisaré con los resultados.`,
        providerRef: r.task_id,
      };
    } catch (error) {
      return { content: `No se ha podido delegar: ${(error as Error).message}`, isError: true };
    }
  });

  return gateway;
}
