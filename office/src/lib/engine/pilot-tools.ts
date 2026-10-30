// Herramientas reales del piloto (Alex, Marcus y Sofia). Todas trabajan solo
// dentro de la oficina: leer memoria y CRM, guardar borradores y fichas del
// CRM con sus fuentes, y delegar (solo Alex). Ninguna contacta, envía,
// publica ni gasta: esas herramientas no tienen manejador y la ToolGateway
// las rechaza.

import { z } from "zod";
import type { ToolId } from "../agents/tools";
import { ToolGateway, type ToolOutput } from "./gateway";
import type { EngineStore } from "./store";

const url = z.string().trim().url().refine((u) => /^https?:\/\//i.test(u), "La fuente debe ser una URL http(s).");

const CrmWrite = z.object({
  name: z.string().trim().min(2).max(200).describe("Nombre comercial real de la empresa, tal como aparece en su fuente."),
  city: z.string().trim().min(2).max(100).describe("Ciudad (por ejemplo, Barcelona)."),
  website: url.optional().describe("Web oficial, solo si la has comprobado."),
  instagram: z.string().trim().max(200).optional().describe("Usuario o URL de Instagram, solo si lo has comprobado."),
  phone: z.string().trim().max(40).optional().describe("Teléfono público de la empresa (nunca de una persona)."),
  need_detected: z.string().trim().min(10).max(2000).describe("Oportunidad de mejora detectada, separando lo verificado de lo estimado."),
  recommended_service: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(4000).optional().describe("Datos verificados, estimados y no encontrados; contradicciones entre fuentes."),
  sources: z.array(url).min(1).max(10).describe("URL de cada fuente consultada para esta ficha."),
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

  gateway.register("crm.write", async (raw, ctx) => {
    const a = CrmWrite.safeParse(raw);
    if (!a.success) return invalid(a.error);
    const d = a.data;
    // Solo fichas de empresa: nada de contactos personales.
    if ([d.name, d.phone, d.notes, d.need_detected].some((v) => v && EMAIL.test(v))) {
      return { content: "No guardes direcciones de email ni contactos personales en el CRM durante el piloto.", isError: true };
    }
    await busy("Actualizar CRM");
    const existing = await store.findCompany(d.name, d.city);
    if (existing) {
      return { content: `«${existing.name}» ya está en el CRM (id ${existing.id}); no se ha duplicado. Fuente original: ${existing.source}` };
    }
    const id = await store.insertCompany({
      name: d.name,
      city: d.city,
      website: d.website ?? null,
      instagram: d.instagram ?? null,
      phone: d.phone ?? null,
      need_detected: d.need_detected,
      recommended_service: d.recommended_service ?? null,
      notes: d.notes ?? null,
      source: d.sources.join(" | "),
      created_by: ctx.agentId,
    });
    return { content: `Ficha creada en el CRM (id ${id}, etapa «investigada»).`, providerRef: id };
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

  gateway.register("tasks.delegate", async (raw, ctx) => {
    const a = Delegate.safeParse(raw);
    if (!a.success) return invalid(a.error);
    if (!ctx.toolUseId) return { content: "Falta el identificador de la llamada.", isError: true };
    await busy(`Delegar en ${a.data.agent}`);
    try {
      const r = await store.delegate(c.runId, c.worker, ctx.toolUseId, a.data.agent, a.data.title, a.data.instructions, a.data.depends_on ?? []);
      return {
        content: `${r.duplicate ? "Subtarea ya creada" : "Subtarea creada"}: task_id ${r.task_id} → ${a.data.agent}. Cuando termines de delegar, explica el plan y finaliza tu turno; te avisaré con los resultados.`,
        providerRef: r.task_id,
      };
    } catch (error) {
      return { content: `No se ha podido delegar: ${(error as Error).message}`, isError: true };
    }
  });

  return gateway;
}
