// Configuración central del motor. Ningún otro archivo debe fijar modelos,
// límites de pasos o versiones de herramientas.

import type { AgentDefinition, ModelId } from "../agents/registry";
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
 * Herramientas activas en el piloto por agente (intersección con los permisos
 * del registro). La web solo la usa Marcus: Sofia trabaja con sus resultados.
 */
export const PILOT_TOOLS: Record<string, readonly ToolId[]> = {
  alex: ["memory.read", "crm.read", "content.draft", "tasks.delegate"],
  marcus: ["memory.read", "crm.read", "crm.write", "content.draft", "web.search", "web.fetch"],
  sofia: ["memory.read", "crm.read", "content.draft"],
};

/**
 * Orden entre subtareas impuesto por el motor: la clave espera a los agentes
 * de la lista (si uno falla, la dependencia se da por resuelta).
 */
export const PILOT_DEPENDENCIES: Record<string, readonly string[]> = {
  sofia: ["marcus"],
};

export function pilotScope(agent: AgentDefinition): AgentDefinition {
  const allowed = PILOT_TOOLS[agent.id] ?? [];
  return { ...agent, tools: agent.tools.filter((t) => allowed.includes(t)) };
}
