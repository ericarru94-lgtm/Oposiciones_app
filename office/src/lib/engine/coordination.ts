// Coordinación entre agentes: resultado declarado de cada tarea, entregas
// (qué recibe cada agente) y control de coherencia del informe de Alex.
// Todo es determinista: no hay llamadas al modelo aquí.

import { z } from "zod";
import type { DocumentSummary, MissionCompany, RelatedTask } from "./store";

// ─────────────────────────── D · Resultado de una tarea ───────────────────────────

export const OUTCOMES = ["completed", "completed_with_warnings", "partially_completed", "failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  completed: "COMPLETADA",
  completed_with_warnings: "COMPLETADA CON AVISOS",
  partially_completed: "PARCIALMENTE COMPLETADA",
  failed: "FALLIDA",
};

const Declared = z.object({
  resultado: z.enum(["completed", "completed_with_warnings", "partially_completed"]),
  objetivos_completados: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  objetivos_pendientes: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  avisos: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
});

export interface ResultData {
  outcome: Outcome;
  declared: boolean;
  objectives_completed: string[];
  objectives_pending: string[];
  warnings: string[];
  /** Solo en el informe de Alex: comprobaciones automáticas realizadas. */
  coherence_checks?: string[];
}

/** El agente cierra su respuesta con un bloque ```resultado {json}```. */
export function parseDeclaredOutcome(text: string): z.infer<typeof Declared> | null {
  const m = /```resultado\s*\n([\s\S]*?)```/i.exec(text);
  if (!m) return null;
  try {
    const parsed = Declared.safeParse(JSON.parse(m[1]));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Resultado de una subtarea terminada. Una ejecución terminada no implica
 * objetivos completados: sin declaración válida queda «con avisos».
 */
export function subtaskOutcome(text: string): ResultData {
  const d = parseDeclaredOutcome(text);
  if (!d) {
    return {
      outcome: "completed_with_warnings",
      declared: false,
      objectives_completed: [],
      objectives_pending: [],
      warnings: ["El agente terminó sin declarar qué objetivos completó (bloque «resultado» ausente o no válido)."],
    };
  }
  let outcome: Outcome = d.resultado;
  if (d.objetivos_pendientes.length > 0) outcome = "partially_completed";
  else if (d.avisos.length > 0 && outcome === "completed") outcome = "completed_with_warnings";
  return {
    outcome, declared: true,
    objectives_completed: d.objetivos_completados, objectives_pending: d.objetivos_pendientes, warnings: d.avisos,
  };
}

export function outcomeOf(task: Pick<RelatedTask, "status" | "result_data">): Outcome | null {
  if (task.status === "failed") return "failed";
  if (task.status !== "completed") return null;
  const o = (task.result_data as Partial<ResultData> | null)?.outcome;
  return o && (OUTCOMES as readonly string[]).includes(o) ? o : "completed";
}

// ─────────────────────────── A · Objetivos pendientes de una ficha ───────────────────────────

/** Lo que la ficha marca como pendiente (texto tras «PENDIENTE» o «Pendiente de verificar»). */
export function pendingOf(c: Pick<MissionCompany, "need_detected" | "notes">): string | null {
  const text = `${c.need_detected ?? ""}\n${c.notes ?? ""}`;
  const parts = [...text.matchAll(/PENDIENTE(?: DE VERIFICAR)?\s*(?:\([^)]*\))?\s*:\s*([^\n]+)/gi)].map((m) => m[1].trim());
  return parts.length ? [...new Set(parts)].join(" · ").slice(0, 600) : null;
}

// ─────────────────────────── C · Entregas ───────────────────────────

export interface DeliveryRow {
  from_agent: string;
  to_agent: string;
  company_ids: string[];
  company_versions: Record<string, string | null>;
  document_ids: string[];
  document_versions: Record<string, { version: number | null; updated_at: string | null; chars: number; truncated: boolean }>;
  omitted: { kind: "document" | "company"; id: string; reason: string }[];
}

/**
 * Qué recibe un agente en su mensaje inicial, agrupado por emisor: las fichas
 * de la misión (emisor: quien la creó) y los documentos del equipo (emisor:
 * su autor). Los documentos recortados constan como omisión parcial.
 */
export function buildDeliveries(
  toAgent: string,
  companies: MissionCompany[],
  documents: DocumentSummary[],
  docChars: number,
): DeliveryRow[] {
  const rows = new Map<string, DeliveryRow>();
  const row = (from: string) => {
    if (!rows.has(from)) {
      rows.set(from, { from_agent: from, to_agent: toAgent, company_ids: [], company_versions: {}, document_ids: [], document_versions: {}, omitted: [] });
    }
    return rows.get(from)!;
  };
  for (const c of companies) {
    const r = row(c.created_by || "crm");
    r.company_ids.push(c.id);
    r.company_versions[c.id] = c.updated_at ?? null;
  }
  for (const d of documents) {
    const r = row(d.agent_id ?? "sistema");
    const chars = (d.content ?? "").length;
    const truncated = chars > docChars;
    r.document_ids.push(d.id);
    r.document_versions[d.id] = { version: d.version ?? null, updated_at: d.updated_at ?? null, chars, truncated };
    if (truncated) r.omitted.push({ kind: "document", id: d.id, reason: `recortado a ${docChars} de ${chars} caracteres` });
  }
  return [...rows.values()];
}

export interface DeliveryRecord extends DeliveryRow {
  id: string;
  task_id: string;
  status: "prepared" | "sent" | "received";
  prepared_at: string;
  sent_at: string | null;
  received_at: string | null;
}

/** Inventario exacto para Alex: quién recibió qué y en qué estado. */
export function inventorySection(deliveries: DeliveryRecord[], tasks: RelatedTask[]): string {
  if (deliveries.length === 0) return "INVENTARIO DE ENTREGAS: no hay entregas registradas.";
  const label = { prepared: "preparada (no enviada)", sent: "enviada (sin respuesta confirmada)", received: "recibida" } as const;
  const lines = deliveries.map((d) => {
    const task = tasks.find((t) => t.id === d.task_id);
    const docs = d.document_ids.map((id) => {
      const v = d.document_versions[id];
      return `${id}${v?.version ? ` v${v.version}` : ""}${v?.truncated ? " (RECORTADO)" : ""}`;
    });
    return [
      `- ${d.from_agent} → ${d.to_agent}${task ? ` (tarea «${task.title}»)` : ""} · ${label[d.status]}`,
      `  Fichas (${d.company_ids.length}): ${d.company_ids.join(", ") || "ninguna"}`,
      `  Documentos (${d.document_ids.length}): ${docs.join(", ") || "ninguno"}`,
      d.omitted.length ? `  Omitido: ${d.omitted.map((o) => `${o.kind} ${o.id}: ${o.reason}`).join("; ")}` : "",
    ].filter(Boolean).join("\n");
  });
  return `INVENTARIO DE ENTREGAS (registro del sistema; no lo deduzcas de los documentos):\n${lines.join("\n")}`;
}

// ─────────────────────────── F · Control de coherencia ───────────────────────────

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const DENIES_COMPANIES = /\b(no hay|no existen|no se han identificado|no tenemos|sin)\s+(ninguna\s+)?(empresas?|fichas?|gimnasios?)\s+(identificad|registrad|verificad|en el crm)|ninguna empresa identificada|0 empresas/i;

export interface CoherenceInput {
  report: string;
  companies: MissionCompany[];
  documents: DocumentSummary[];
  tasks: RelatedTask[];
  knownIds: string[];
}

/** Comprobaciones deterministas del informe de Alex contra lo que existe de verdad. */
export function coherenceCheck(c: CoherenceInput): { checks: string[]; warnings: string[] } {
  const checks: string[] = [];
  const warnings: string[] = [];
  checks.push(`Fichas de la misión en el CRM: ${c.companies.length}`);
  if (c.companies.length > 0 && DENIES_COMPANIES.test(c.report)) {
    warnings.push(`El informe dice que no hay empresas, pero la misión tiene ${c.companies.length} fichas en el CRM.`);
  }
  const known = new Set([...c.knownIds, ...c.companies.map((x) => x.id), ...c.documents.map((d) => d.id), ...c.tasks.map((t) => t.id)].map((x) => x.toLowerCase()));
  const unknown = [...new Set((c.report.match(UUID) ?? []).map((x) => x.toLowerCase()))].filter((x) => !known.has(x));
  checks.push("Identificadores citados contrastados con el CRM, los documentos y las tareas");
  if (unknown.length) warnings.push(`El informe cita identificadores que no existen en la misión: ${unknown.join(", ")}.`);
  for (const t of c.tasks) {
    if (t.status === "failed" && t.agent_id && !new RegExp(`${t.agent_id}[\\s\\S]{0,400}fall|fall[\\s\\S]{0,400}${t.agent_id}`, "i").test(c.report)) {
      warnings.push(`La subtarea de ${t.agent_id} falló y el informe no lo indica claramente.`);
    }
  }
  checks.push(`Estado de las subtareas: ${c.tasks.map((t) => `${t.agent_id}=${outcomeOf(t) ?? t.status}`).join(", ") || "sin subtareas"}`);
  return { checks, warnings };
}
