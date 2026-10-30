import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ENGINE } from "./config";
import { ModelError, type ContentBlock, type ModelClient, type ModelRequest, type ModelResponse, type StopReason } from "./types";

// Cliente real de Claude (Messages API, SDK oficial).
//
// - Petición sin streaming (max_tokens de ENGINE): cabe en un paso del motor.
// - Sin respaldo automático ante rechazos (ENGINE.refusalFallback = null): por
//   decisión del administrador nunca se cambia de modelo sin su permiso.
// - Caché de prompt automática: instrucciones y herramientas son estables.
// - Pensamiento adaptativo (por defecto en estos modelos); la profundidad se
//   controla con `effort`. Los bloques se devuelven tal cual para reenviarlos.

const KNOWN_STOPS: readonly string[] = ["end_turn", "tool_use", "max_tokens", "refusal", "pause_turn", "stop_sequence"];

export function buildRequest(req: ModelRequest): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  const clientTools = req.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Beta.Messages.BetaTool.InputSchema,
  }));
  const serverTools = (req.serverTools ?? []) as unknown as Anthropic.Beta.Messages.BetaToolUnion[];
  return {
    model: req.model,
    max_tokens: req.maxTokens ?? ENGINE.maxTokens,
    system: req.system,
    messages: req.messages as unknown as Anthropic.Beta.Messages.BetaMessageParam[],
    tools: [...clientTools, ...serverTools],
    output_config: { effort: req.effort },
    cache_control: { type: "ephemeral" },
  };
}

export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic({ maxRetries: ENGINE.sdkMaxRetries, timeout: ENGINE.requestTimeoutMs });
  }

  /** Contador oficial (gratuito). Sin herramientas de servidor: no las admite. */
  async countTokens(req: ModelRequest): Promise<number> {
    const r = await this.client.beta.messages.countTokens({
      model: req.model,
      system: req.system,
      messages: req.messages as unknown as Anthropic.Beta.Messages.BetaMessageParam[],
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Beta.Messages.BetaTool.InputSchema,
      })),
    });
    return r.input_tokens;
  }

  async create(req: ModelRequest): Promise<ModelResponse> {
    let msg: Anthropic.Beta.Messages.BetaMessage;
    try {
      msg = await this.client.beta.messages.create(buildRequest(req), req.timeoutMs ? { timeout: req.timeoutMs } : undefined);
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

/**
 * Errores reintentables: límite de uso, sobrecarga y algunos 5xx. Si no se
 * recibió respuesta (red, tiempo agotado) o el servidor falló a medias (500),
 * el cobro es desconocido: la llamada no se repetirá automáticamente.
 */
export function toModelError(error: unknown): ModelError {
  if (error instanceof Anthropic.APIConnectionError) {
    return new ModelError("Sin respuesta de Claude (conexión o tiempo agotado). Puede que la llamada se haya procesado.", true, "unknown");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ModelError("Claude ha limitado las peticiones (429).", true, "none");
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ModelError("La clave de la API de Anthropic no es válida o no tiene permisos.", false, "none");
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new ModelError(`Petición rechazada por la API: ${error.message}`, false, "none");
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    const rejected = status === 529 || status === 503 || status === 408 || status === 409;
    return new ModelError(`Error de la API de Claude (${status}).`, status >= 500 || rejected, rejected ? "none" : "unknown");
  }
  return new ModelError((error as Error)?.message ?? "Error desconocido.", true, "unknown");
}
