// Bucle manual de herramientas en dos fases que se guardan por separado:
//
//   callModel()    una petición a Claude. El ejecutor guarda la respuesta y su
//                  coste ANTES de ejecutar ninguna herramienta.
//   resolveLocal() ejecuta las herramientas que pidió Claude (idempotentes por
//                  tool_use_id), resuelve aprobaciones y decide si hace falta
//                  otra llamada, si ha terminado o si espera.
//
// Si el proceso se corta entre ambas, al recuperar se ejecutan las
// herramientas de la respuesta ya guardada; nunca se repite la llamada. Así una ejecución larga se reparte en varias invocaciones cortas
// (límite de 300 s de Vercel Hobby) y puede pausarse durante horas
// esperando una aprobación sin ocupar ningún proceso.
//
//   1. Petición al modelo           5. Ejecución controlada (ToolGateway)
//   2. Herramientas solicitadas     6. Resultados devueltos a Claude
//   3. Evaluación de permisos       7. Continuación en el siguiente paso
//   4. Aprobación si corresponde    8. Registro (record_step / complete_run…)

import { MODELS, type AgentDefinition, type ModelId } from "../agents/registry";
import { composeSystemPrompt } from "../agents/prompts";
import { TOOLS, type ToolId } from "../agents/tools";
import { EMPTY_USAGE, addUsage, costParts, type Usage } from "./cost";
import { toolIdFromName, toolNameFor, type EnginePort, type ToolGateway } from "./gateway";
import {
  ModelError,
  type ServerToolSpec,
  type ContentBlock,
  type Message,
  type ModelRequest,
  type ModelClient,
  type ToolResultBlock,
  type ToolSpec,
  type ToolUseBlock,
} from "./types";

export interface PendingCall {
  toolUseId: string;
  toolId: string;
  args: Record<string, unknown>;
  approvalId: string;
}

export interface RunState {
  messages: Message[];
  /** Llamadas que esperan tu decisión. */
  pending: PendingCall[];
  /** Resultados del mismo turno ya calculados (se envían todos juntos). */
  partialResults: ToolResultBlock[];
  steps: number;
  /**
   * Qué falta tras la última respuesta guardada: ejecutar sus herramientas,
   * continuar (pause_turn), nada (terminada) o un fallo definitivo.
   */
  awaiting?: "tools" | "continue" | "done" | { failed: string } | null;
  /** Errores transitorios seguidos en esta ejecución. */
  transientRetries?: number;
}

export function initialState(taskPrompt: string): RunState {
  return { messages: [{ role: "user", content: taskPrompt }], pending: [], partialResults: [], steps: 0, awaiting: null };
}

interface StepMeta {
  usage: Usage;
  costUsd: number;
  /** Modelo facturado en este paso (null si no hubo llamada). */
  model?: string | null;
  /** El modelo usó herramientas de servidor (búsqueda/lectura web) en este paso. */
  researched?: boolean;
}

export type StepOutcome =
  | ({ kind: "continue"; state: RunState } & StepMeta)
  | ({ kind: "waiting_approval"; state: RunState } & StepMeta)
  | ({ kind: "completed"; state: RunState; result: string } & StepMeta)
  | ({ kind: "failed"; state: RunState; error: string; retryable: boolean } & StepMeta);

export interface StepInput {
  agent: AgentDefinition;
  runId: string;
  taskId: string;
  state: RunState;
  client: ModelClient;
  gateway: ToolGateway;
  engine: EnginePort;
  /** Esquemas de entrada de cada herramienta conectada. */
  toolSchemas: Partial<Record<ToolId, Record<string, unknown>>>;
  /** Herramientas de servidor ya autorizadas para este agente. */
  serverTools?: ServerToolSpec[];
  /** Instrucciones de sistema completas (por defecto, reglas comunes + agente). */
  system?: string;
  /** Salida máxima y tiempo máximo por llamada para este agente. */
  maxTokens?: number;
  timeoutMs?: number;
  /** Texto del sistema que se añade tras cada ronda de herramientas (p. ej. continuidad de Marcus). */
  progressNote?: string;
  maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 25;

export function toolSpecsFor(agent: AgentDefinition, gateway: ToolGateway, schemas: StepInput["toolSchemas"]): ToolSpec[] {
  return agent.tools
    .filter((id) => gateway.connected.has(id))
    .map((id) => ({
      name: toolNameFor(id),
      description: TOOLS[id].description,
      input_schema: schemas[id] ?? { type: "object", properties: {}, additionalProperties: true },
    }));
}

function textOf(content: ContentBlock[] | string): string {
  if (typeof content === "string") return content.trim();
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

function result(toolUseId: string, content: string, isError = false): ToolResultBlock {
  return { type: "tool_result", tool_use_id: toolUseId, content, ...(isError ? { is_error: true } : {}) };
}

// ─────────────────────────── Fase local ───────────────────────────

export type LocalOutcome =
  | { kind: "needs_model"; state: RunState; changed: boolean }
  | { kind: "waiting_approval"; state: RunState }
  | { kind: "completed"; state: RunState; result: string }
  | { kind: "failed"; state: RunState; error: string };

export async function resolveLocal(input: StepInput): Promise<LocalOutcome> {
  const { agent, gateway, engine } = input;
  const ctx = { runId: input.runId, taskId: input.taskId, agentId: agent.id };
  const state: RunState = structuredClone(input.state);
  let changed = false;

  // Reanudación: llamadas que esperaban aprobación.
  if (state.pending.length > 0) {
    const decisions = await Promise.all(state.pending.map((p) => engine.approvalState(p.approvalId)));
    if (decisions.some((d) => d.state === "pending")) return { kind: "waiting_approval", state };
    for (const [i, call] of state.pending.entries()) {
      const d = decisions[i];
      if (d.state === "approved") {
        const r = await gateway.execute({ agent, toolUseId: call.toolUseId, toolId: call.toolId, args: call.args, approvalId: call.approvalId }, ctx);
        state.partialResults.push(
          r.kind === "result"
            ? result(call.toolUseId, r.output.content, r.output.isError)
            : result(call.toolUseId, "No se pudo verificar la aprobación.", true),
        );
      } else {
        const why = d.state === "expired" ? "la aprobación caducó" : `el administrador la ha rechazado${d.note ? `: ${d.note}` : ""}`;
        state.partialResults.push(
          result(call.toolUseId, `Acción no ejecutada porque ${why}. No la intentes por otra vía; explica qué harías en su lugar.`, true),
        );
      }
    }
    state.messages.push({ role: "user", content: state.partialResults });
    state.pending = [];
    state.partialResults = [];
    state.awaiting = null;
    changed = true;
  }

  const last = state.messages.at(-1);
  const awaiting = state.awaiting ?? null;
  if (last?.role === "assistant" && awaiting !== null) {
    if (typeof awaiting === "object") return { kind: "failed", state, error: awaiting.failed };
    if (awaiting === "done") return { kind: "completed", state, result: textOf(last.content) };
    if (awaiting === "tools") {
      // Herramientas de la respuesta ya guardada (idempotentes por tool_use_id).
      const blocks = Array.isArray(last.content) ? last.content : [];
      const calls = blocks.filter((b): b is ToolUseBlock => b.type === "tool_use");
      const done = new Set(state.partialResults.map((r) => r.tool_use_id));
      for (const call of calls) {
        if (done.has(call.id)) continue;
        const toolId = toolIdFromName(call.name);
        const r = await gateway.execute({ agent, toolUseId: call.id, toolId, args: call.input ?? {} }, ctx);
        if (r.kind === "approval_required") {
          state.pending.push({ toolUseId: call.id, toolId, args: call.input ?? {}, approvalId: r.approvalId });
        } else {
          state.partialResults.push(result(call.id, r.output.content, r.output.isError));
        }
      }
      if (state.pending.length > 0) return { kind: "waiting_approval", state };
      // Nota opcional del sistema al final de los resultados (añadida, nunca editada).
      state.messages.push({ role: "user", content: input.progressNote ? [...state.partialResults, { type: "text", text: input.progressNote }] : state.partialResults });
      state.partialResults = [];
      state.awaiting = null;
      changed = true;
    }
    // «continue» (pause_turn): se vuelve a llamar con la respuesta parcial tal cual.
  }

  if (state.steps >= (input.maxSteps ?? DEFAULT_MAX_STEPS)) {
    return { kind: "failed", state, error: "Se alcanzó el número máximo de pasos." };
  }
  return { kind: "needs_model", state, changed };
}

// ─────────────────────────── Llamada al modelo ───────────────────────────

export function buildModelRequest(input: StepInput): ModelRequest {
  return {
    model: input.agent.model,
    effort: input.agent.effort,
    system: input.system ?? composeSystemPrompt(input.agent.instructions),
    messages: input.state.messages,
    tools: toolSpecsFor(input.agent, input.gateway, input.toolSchemas),
    serverTools: input.serverTools,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
  };
}

export type CallOutcome =
  | ({ kind: "response"; state: RunState; claudeUsd: number; searchUsd: number; failure?: { error: string; retryable: boolean } } & StepMeta & { model: ModelId })
  | { kind: "error"; error: string; retryable: boolean; billing: "none" | "unknown" };

export async function callModel(input: StepInput, request: ModelRequest = buildModelRequest(input)): Promise<CallOutcome> {
  let response;
  try {
    response = await input.client.create(request);
  } catch (error) {
    const e = error instanceof ModelError ? error : new ModelError((error as Error).message, true, "unknown");
    return { kind: "error", error: e.message, retryable: e.retryable, billing: e.billing };
  }
  const state: RunState = structuredClone(input.state);
  state.steps += 1;
  const usage = addUsage(EMPTY_USAGE, response.usage);
  // Se factura con el modelo que respondió.
  const model = response.model && Object.hasOwn(MODELS, response.model) ? (response.model as ModelId) : input.agent.model;
  const parts = costParts(model, response.usage);
  // Se guarda la respuesta completa, sin tocar los bloques de pensamiento.
  state.messages.push({ role: "assistant", content: response.content });
  state.partialResults = [];
  let failure: { error: string; retryable: boolean } | undefined;
  switch (response.stopReason) {
    case "tool_use":
      state.awaiting = "tools";
      break;
    case "pause_turn":
      state.awaiting = "continue";
      break;
    case "end_turn":
    case "stop_sequence":
      state.awaiting = "done";
      break;
    case "refusal":
      failure = { error: "Claude ha rechazado la tarea por sus reglas de seguridad.", retryable: false };
      break;
    case "max_tokens":
      failure = { error: "La respuesta se cortó por longitud.", retryable: true };
      break;
    case "other":
      failure = { error: "Claude terminó por un motivo no previsto.", retryable: false };
      break;
  }
  if (failure) state.awaiting = { failed: failure.error };
  return {
    kind: "response", state, usage, model, claudeUsd: parts.claude, searchUsd: parts.search,
    costUsd: parts.claude + parts.search, researched: response.content.some((b) => b.type === "server_tool_use"), failure,
  };
}

// ─────────────────── Paso completo (local + llamada + local) ───────────────────

export async function runStep(input: StepInput): Promise<StepOutcome> {
  const none = { usage: EMPTY_USAGE, costUsd: 0 };
  const first = await resolveLocal(input);
  if (first.kind === "waiting_approval") return { kind: "waiting_approval", state: first.state, ...none };
  if (first.kind === "completed") return { kind: "completed", state: first.state, result: first.result, ...none };
  if (first.kind === "failed") return { kind: "failed", state: first.state, error: first.error, retryable: false, ...none };

  const call = await callModel({ ...input, state: first.state });
  if (call.kind === "error") return { kind: "failed", state: first.state, error: call.error, retryable: call.retryable, ...none };
  const meta = { usage: call.usage, costUsd: call.costUsd, model: call.model, researched: call.researched };
  if (call.failure) return { kind: "failed", state: call.state, error: call.failure.error, retryable: call.failure.retryable, ...meta };

  const next = await resolveLocal({ ...input, state: call.state });
  switch (next.kind) {
    case "needs_model":
      return { kind: "continue", state: next.state, ...meta };
    case "waiting_approval":
      return { kind: "waiting_approval", state: next.state, ...meta };
    case "completed":
      return { kind: "completed", state: next.state, result: next.result, ...meta };
    case "failed":
      return { kind: "failed", state: next.state, error: next.error, retryable: false, ...meta };
  }
}
