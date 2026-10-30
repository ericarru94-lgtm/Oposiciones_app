// Coste real de una llamada a Claude a partir del `usage` que devuelve la API.
import { MODELS, type ModelId } from "../agents/registry";

export interface Usage {
  /** Tokens de entrada no cacheados (`usage.input_tokens`). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Búsquedas web (`usage.server_tool_use.web_search_requests`). */
  webSearchRequests: number;
}

export const CACHE_WRITE_MULTIPLIER = 1.25; // TTL de 5 minutos
export const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearchRequests: 0,
};

export function promptTokens(u: Usage): number {
  return u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
}

export function costUsd(model: ModelId, u: Usage): number {
  const m = MODELS[model];
  const long = m.longContext && promptTokens(u) > m.longContext.thresholdTokens ? m.longContext : null;
  const input = long?.inputUsdPerMTok ?? m.inputUsdPerMTok;
  const output = long?.outputUsdPerMTok ?? m.outputUsdPerMTok;
  const cacheRead = long ? input * (m.cacheReadUsdPerMTok / m.inputUsdPerMTok) : m.cacheReadUsdPerMTok;
  const tokens =
    u.inputTokens * input +
    u.outputTokens * output +
    u.cacheReadTokens * cacheRead +
    u.cacheWriteTokens * input * CACHE_WRITE_MULTIPLIER;
  return tokens / 1_000_000 + u.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    webSearchRequests: a.webSearchRequests + b.webSearchRequests,
  };
}

/** Coste separado: tokens de Claude y búsquedas web. */
export function costParts(model: ModelId, u: Usage): { claude: number; search: number } {
  const search = u.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST;
  return { claude: costUsd(model, u) - search, search };
}

/** Estimación prudente de tokens: 3 caracteres por token (el español suele dar ~4). */
export function estimateTokens(payload: unknown): number {
  return Math.ceil(JSON.stringify(payload).length / 3);
}

export interface ReserveBounds {
  /** Máximo de tokens de salida de la llamada (max_tokens). */
  maxOutputTokens: number;
  /** Búsquedas web permitidas en la llamada (cada una 0,01 $). */
  searches: number;
  /** Lecturas web permitidas y tokens máximos por lectura. */
  fetches: number;
  fetchTokens: number;
  /** Tokens que se suponen por cada resultado de búsqueda. */
  searchResultTokens?: number;
}

/**
 * Reserva conservadora ANTES de llamar: todo el prompt y el contenido web como
 * escritura de caché (1,25×), una relectura del contexto por cada iteración
 * de herramienta de servidor (a precio de lectura de caché), toda la salida
 * permitida y todas las búsquedas permitidas. Se ajusta luego al coste real.
 */
export function reserveUsd(model: ModelId, promptTokens: number, b: ReserveBounds): number {
  const m = MODELS[model];
  const content = b.fetches * b.fetchTokens + b.searches * (b.searchResultTokens ?? 4_000);
  const context = promptTokens + content;
  const long = m.longContext && context > m.longContext.thresholdTokens ? m.longContext : null;
  const input = long?.inputUsdPerMTok ?? m.inputUsdPerMTok;
  const output = long?.outputUsdPerMTok ?? m.outputUsdPerMTok;
  const cacheRead = long ? input * (m.cacheReadUsdPerMTok / m.inputUsdPerMTok) : m.cacheReadUsdPerMTok;
  const iterations = b.searches + b.fetches;
  const usd =
    (context * input * CACHE_WRITE_MULTIPLIER + iterations * context * cacheRead + b.maxOutputTokens * output) / 1_000_000 +
    b.searches * WEB_SEARCH_USD_PER_REQUEST;
  return Math.max(0.001, Math.ceil(usd * 1_000_000) / 1_000_000);
}
