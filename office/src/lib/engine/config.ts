// Configuración central del motor. Ningún otro archivo debe fijar modelos,
// límites de pasos o versiones de herramientas.

import type { AgentDefinition, ModelId } from "../agents/registry";
import type { ToolId } from "../agents/tools";

export const ENGINE = {
  /** Tokens máximos de salida por llamada (sin streaming cabe en un paso). */
  maxTokens: 16_000,
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
  /**
   * Política ante un rechazo de seguridad del modelo: NINGÚN respaldo
   * automático (ni a un modelo más caro ni a otro). La tarea falla, queda
   * registrada y tú decides. Para activarlo habría que cambiarlo aquí.
   */
  refusalFallback: null as ModelId | null,
} as const;

/** Herramientas de servidor de Anthropic (se ejecutan en Anthropic, solo lectura). */
export const SERVER_TOOLS = {
  "web.search": { type: "web_search_20260209", name: "web_search", max_uses: 5 },
  "web.fetch": { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5, max_content_tokens: 20_000 },
} as const;
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
