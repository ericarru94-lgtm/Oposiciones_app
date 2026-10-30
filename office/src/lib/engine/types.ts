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

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn" | "stop_sequence";

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelRequest {
  model: ModelId;
  effort: AgentDefinition["effort"];
  system: string;
  messages: Message[];
  tools: ToolSpec[];
}

export interface ModelResponse {
  content: ContentBlock[];
  stopReason: StopReason;
  usage: Usage;
}

export interface ModelClient {
  create(request: ModelRequest): Promise<ModelResponse>;
}

export class ModelError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
