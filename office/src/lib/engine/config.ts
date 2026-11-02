// Configuración central del motor. Ningún otro archivo debe fijar modelos,
// límites de pasos o versiones de herramientas.

import { isActiveAgent, type AgentDefinition, type ModelId } from "../agents/registry";
import type { ToolId } from "../agents/tools";

export const ENGINE = {
  /** Tokens máximos de salida por llamada (cabe en un paso y acota la reserva). */
  maxTokens: 8_000,
  /** Tiempo máximo de una llamada. Sin reintentos del SDK: los gestiona el motor. */
  requestTimeoutMs: 150_000,
  sdkMaxRetries: 0,
  /** Duración de una invocación (Vercel Hobby corta a los 300 s). */
  tickBudgetMs: 280_000,
  /** No se empieza un paso si quedan menos de esto (una llamada + margen). */
  stepReserveMs: 170_000,
  leaseSeconds: 240,
  maxParallelRuns: 2,
  maxStepsPerRun: 30,
  /** Errores transitorios sin cobro (429, 529…) reintentados en la misma ejecución. */
  maxTransientRetries: 3,
  /**
   * Política ante un rechazo de seguridad del modelo: NINGÚN respaldo
   * automático (ni a un modelo más caro ni a otro). La tarea falla, queda
   * registrada y tú decides. Para activarlo habría que cambiarlo aquí.
   */
  refusalFallback: null as ModelId | null,
} as const;

/**
 * Límites por llamada según el agente. Sofia (Haiku, esfuerzo alto) necesita
 * más salida porque el pensamiento cuenta como salida: 32.000 tokens. Para
 * que una respuesta larga no se trate como «incierta» por tiempo agotado, su
 * llamada tiene 240 s y su lease 285 s (por debajo de los 300 s de Vercel).
 * El paso solo empieza si queda tiempo para la llamada completa + 20 s.
 */
export interface CallLimits {
  maxTokens: number;
  timeoutMs: number;
  leaseSeconds: number;
}
const DEFAULT_CALL: CallLimits = { maxTokens: ENGINE.maxTokens, timeoutMs: ENGINE.requestTimeoutMs, leaseSeconds: ENGINE.leaseSeconds };
export const CALL_LIMITS: Record<string, CallLimits> = {
  sofia: { maxTokens: 32_000, timeoutMs: 240_000, leaseSeconds: 285 },
};
export function callLimits(agentId: string): CallLimits {
  return CALL_LIMITS[agentId] ?? DEFAULT_CALL;
}

/**
 * Herramientas de servidor de Anthropic (solo lectura). Versiones BÁSICAS, sin
 * filtrado dinámico: el filtrado ejecuta código en iteraciones internas que
 * max_uses no limita, y cada iteración vuelve a cobrar el contexto.
 * Marcus recibe SIEMPRE las dos (1 búsqueda + 1 lectura por llamada, hasta
 * 3 pasadas): la lista de herramientas no puede cambiar entre llamadas de una
 * misma ejecución porque Sonnet 5.5 ata su razonamiento a ella (error 400).
 */
export const SERVER_TOOLS = {
  "web.search": { type: "web_search_20250305", name: "web_search", max_uses: 1 },
  "web.fetch": { type: "web_fetch_20250910", name: "web_fetch", max_uses: 1, max_content_tokens: 8_000 },
} as const;
/** Supuesto de tamaño de los resultados de UNA búsqueda (la API no permite limitarlo). */
export const SEARCH_RESULT_TOKENS_ASSUMED = 15_000;
/** Tokens de las definiciones de herramientas de servidor que el contador no puede medir. */
export const SERVER_TOOL_OVERHEAD_TOKENS = 2_000;
export type ServerToolId = keyof typeof SERVER_TOOLS;

/**
 * Lista blanca de herramientas de los nueve agentes (fase 5.1).
 *
 * - `enabled`: lo ÚNICO que el motor entrega a la ToolGateway (intersección con
 *   los permisos del registro). La web solo la usa Marcus: Sofia trabaja con sus
 *   resultados.
 * - `planned`: documentación de lo previsto para fases posteriores. No da acceso.
 *
 * Los agentes inactivos tienen `enabled` vacío y, además, `scopeTools` devuelve
 * una lista vacía para cualquier agente que no esté en ACTIVE_AGENT_IDS, aunque
 * alguien rellenara `enabled` por error.
 */
export interface AgentToolPolicy {
  enabled: readonly ToolId[];
  planned: readonly ToolId[];
}
export const AGENT_TOOLS: Readonly<Record<string, AgentToolPolicy>> = {
  alex: { enabled: ["memory.read", "crm.read", "content.draft", "tasks.delegate"], planned: [] },
  marcus: { enabled: ["memory.read", "crm.read", "crm.write", "content.draft", "web.search", "web.fetch"], planned: [] },
  sofia: { enabled: ["memory.read", "crm.read", "content.draft"], planned: [] },
  daniel: { enabled: [], planned: ["memory.read", "crm.read", "content.draft", "web.search"] },
  lucia: { enabled: [], planned: ["memory.read", "content.draft", "web.fetch"] },
  david: { enabled: [], planned: ["memory.read", "content.draft", "web.fetch", "n8n.read", "n8n.test"] },
  emma: { enabled: [], planned: ["memory.read", "crm.read", "crm.write", "content.draft"] },
  oscar: { enabled: [], planned: ["memory.read", "crm.read", "content.draft", "costs.read"] },
  victoria: { enabled: [], planned: ["memory.read", "crm.read", "content.draft", "quality.review", "web.fetch"] },
};

/**
 * Herramientas que NO se pueden habilitar a ningún agente en esta fase
 * (acciones externas, gasto, producción, borrado, y las aún no construidas).
 * Una prueba falla si alguna aparece en `enabled`.
 */
export const BLOCKED_TOOLS_PHASE_5_1: readonly ToolId[] = [
  "email.send", "outreach.contact", "social.publish", "ads.launch", "media.generate", "n8n.production", "data.delete",
  "quality.review", "costs.read", "n8n.read", "n8n.test",
];

/** @deprecated Compatibilidad: derivado de AGENT_TOOLS (no es una lista independiente). */
export const PILOT_TOOLS: Readonly<Record<string, readonly ToolId[]>> = Object.fromEntries(
  Object.entries(AGENT_TOOLS).map(([id, p]) => [id, p.enabled]),
);

/**
 * Orden entre subtareas impuesto por el motor: la clave espera a los agentes
 * de la lista (si uno falla, la dependencia se da por resuelta).
 */
export const PILOT_DEPENDENCIES: Record<string, readonly string[]> = {
  sofia: ["marcus"],
};

/** Herramientas efectivas de un agente: vacías si no está activo; si no, permisos del registro ∩ `enabled`. */
export function scopeTools(agent: AgentDefinition): readonly ToolId[] {
  if (!isActiveAgent(agent.id)) return [];
  const allowed = AGENT_TOOLS[agent.id]?.enabled ?? [];
  return agent.tools.filter((t) => allowed.includes(t));
}

export function pilotScope(agent: AgentDefinition): AgentDefinition {
  return { ...agent, tools: scopeTools(agent) };
}
