// Tipos del bucle de agentes. Siguen la forma de la API de Mensajes de
// Anthropic; en la fase 3 el cliente real (@anthropic-ai/sdk) se adapta a
// ModelClient. Los bloques se guardan tal cual (incluidos los de
// pensamiento) porque Claude Opus 5.5 / Sonnet 5.5 exigen devolverlos sin
// cambios en la siguiente petición.
import type { AgentDefinition, ModelId } from "../agents/registry";
import type { Usage } from "./cost";

export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface ToolUseBlock extends ContentBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock extends ContentBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn" | "stop_sequence" | "other";

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ServerToolSpec {
  type: string;
  name: string;
  [key: string]: unknown;
}

export interface ModelRequest {
  model: ModelId;
  effort: AgentDefinition["effort"];
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  /** Herramientas de servidor (búsqueda/lectura web) ya filtradas por permisos. */
  serverTools?: ServerToolSpec[];
  /** Salida máxima y tiempo máximo de esta llamada (por defecto, los de ENGINE). */
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ModelResponse {
  content: ContentBlock[];
  stopReason: StopReason;
  usage: Usage;
  /** Modelo que respondió de verdad (puede ser el de respaldo tras un rechazo). */
  model?: string;
}

export interface ModelClient {
  create(request: ModelRequest): Promise<ModelResponse>;
  /**
   * Tokens de entrada exactos de la petición SIN herramientas de servidor
   * (el contador gratuito de Anthropic no las admite). Opcional.
   */
  countTokens?(request: ModelRequest): Promise<number>;
}

/**
 * billing: «none» = la API rechazó la petición sin procesarla (no se cobra);
 * «unknown» = no se sabe si Claude llegó a procesarla (p. ej. respuesta
 * perdida): se trata como gastada y no se repite automáticamente.
 */
export class ModelError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly billing: "none" | "unknown" = "unknown",
  ) {
    super(message);
  }
}
