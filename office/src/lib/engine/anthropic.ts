import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ModelId } from "../agents/registry";
import { ModelError, type ContentBlock, type ModelClient, type ModelRequest, type ModelResponse, type StopReason } from "./types";

// Cliente real de Claude (Messages API, SDK oficial).
//
// - Petición sin streaming con max_tokens 16.000: cabe en un paso del motor
//   (lease de 240 s) y el SDK no exige streaming a ese tamaño.
// - Opus 5.5 y Sonnet 5.5: respaldo del servidor ante rechazos de seguridad
//   (`fallbacks: "default"`). Haiku 5.5 no lo admite.
// - Caché de prompt automática: instrucciones y herramientas son estables.
// - Pensamiento: siempre activo en estos modelos; la profundidad se controla
//   con `effort`. Los bloques se devuelven tal cual para reenviarlos.

const MAX_TOKENS = 16_000;
const REQUEST_TIMEOUT_MS = 180_000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MODELS_WITH_FALLBACK: readonly ModelId[] = ["claude-opus-5-5", "claude-sonnet-5-5"];

const KNOWN_STOPS: readonly string[] = ["end_turn", "tool_use", "max_tokens", "refusal", "pause_turn", "stop_sequence"];

export function buildRequest(req: ModelRequest): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  const withFallback = MODELS_WITH_FALLBACK.includes(req.model);
  return {
    model: req.model,
    max_tokens: MAX_TOKENS,
    system: req.system,
    messages: req.messages as unknown as Anthropic.Beta.Messages.BetaMessageParam[],
    tools: req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Beta.Messages.BetaTool.InputSchema,
    })),
    output_config: { effort: req.effort },
    cache_control: { type: "ephemeral" },
    ...(withFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
}

export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic({ maxRetries: 2, timeout: REQUEST_TIMEOUT_MS });
  }

  async create(req: ModelRequest): Promise<ModelResponse> {
    let msg: Anthropic.Beta.Messages.BetaMessage;
    try {
      msg = await this.client.beta.messages.create(buildRequest(req));
    } catch (error) {
      throw toModelError(error);
    }
    const stop = msg.stop_reason ?? "other";
    return {
      content: msg.content as unknown as ContentBlock[],
      stopReason: (KNOWN_STOPS.includes(stop) ? stop : "other") as StopReason,
      model: msg.model,
      usage: {
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
        webSearchRequests: msg.usage.server_tool_use?.web_search_requests ?? 0,
      },
    };
  }
}

/** Errores reintentables: límite de uso, sobrecarga, 5xx, red y tiempo agotado. */
export function toModelError(error: unknown): ModelError {
  if (error instanceof Anthropic.APIConnectionError) {
    return new ModelError("No se pudo conectar con Claude.", true); // incluye tiempo agotado
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ModelError("Claude ha limitado las peticiones (429).", true);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ModelError("La clave de la API de Anthropic no es válida o no tiene permisos.", false);
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new ModelError(`Petición rechazada por la API: ${error.message}`, false);
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    return new ModelError(`Error de la API de Claude (${status}).`, status >= 500 || status === 408 || status === 409);
  }
  return new ModelError((error as Error)?.message ?? "Error desconocido.", true);
}
