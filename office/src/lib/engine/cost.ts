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
