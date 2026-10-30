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
 * Herramientas de servidor de Anthropic (solo lectura). Versiones BÁSICAS, sin
 * filtrado dinámico: el filtrado ejecuta código en iteraciones internas que
 * max_uses no limita, y cada iteración vuelve a cobrar el contexto. Con 1
 * búsqueda + 1 lectura por llamada, una llamada tiene como máximo 3 pasadas
 * del modelo, y la reserva puede acotarse.
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

export function pilotScope(agent: AgentDefinition): AgentDefinition {
  const allowed = PILOT_TOOLS[agent.id] ?? [];
  return { ...agent, tools: agent.tools.filter((t) => allowed.includes(t)) };
}
