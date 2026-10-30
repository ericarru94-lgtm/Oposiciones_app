// Bucle manual de herramientas: un paso por llamada.
//
// Cada paso hace como mucho una petición a Claude y es seguro de repetir:
// el estado completo (conversación, llamadas pendientes de aprobación y
// resultados ya obtenidos) se guarda en agent_runs.state al terminar el
// paso. Así una ejecución larga se reparte en varias invocaciones cortas
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
import { EMPTY_USAGE, addUsage, costUsd, type Usage } from "./cost";
import { toolIdFromName, toolNameFor, type EnginePort, type ToolGateway } from "./gateway";
import {
  ModelError,
  type ContentBlock,
  type Message,
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
}

export function initialState(taskPrompt: string): RunState {
  return { messages: [{ role: "user", content: taskPrompt }], pending: [], partialResults: [], steps: 0 };
}

export type StepOutcome =
  | { kind: "continue"; state: RunState; usage: Usage; costUsd: number }
  | { kind: "waiting_approval"; state: RunState; usage: Usage; costUsd: number }
  | { kind: "completed"; state: RunState; result: string; usage: Usage; costUsd: number }
  | { kind: "failed"; state: RunState; error: string; retryable: boolean; usage: Usage; costUsd: number };

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

function textOf(content: ContentBlock[]): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

function result(toolUseId: string, content: string, isError = false): ToolResultBlock {
  return { type: "tool_result", tool_use_id: toolUseId, content, ...(isError ? { is_error: true } : {}) };
}

export async function runStep(input: StepInput): Promise<StepOutcome> {
  const { agent, gateway, engine } = input;
  const ctx = { runId: input.runId, taskId: input.taskId, agentId: agent.id };
  const state: RunState = structuredClone(input.state);
  let usage = EMPTY_USAGE;
  let cost = 0;

  // ── Reanudación: resolver las llamadas que esperaban aprobación ──
  if (state.pending.length > 0) {
    const decisions = await Promise.all(state.pending.map((p) => engine.approvalState(p.approvalId)));
    if (decisions.some((d) => d.state === "pending")) {
      return { kind: "waiting_approval", state, usage, costUsd: cost };
    }
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
  }

  if (state.steps >= (input.maxSteps ?? DEFAULT_MAX_STEPS)) {
    return { kind: "failed", state, error: "Se alcanzó el número máximo de pasos.", retryable: false, usage, costUsd: cost };
  }

  // ── 1. Petición al modelo ──
  let response;
  try {
    response = await input.client.create({
      model: agent.model,
      effort: agent.effort,
      system: composeSystemPrompt(agent.instructions),
      messages: state.messages,
      tools: toolSpecsFor(agent, gateway, input.toolSchemas),
    });
  } catch (error) {
    const retryable = error instanceof ModelError ? error.retryable : true;
    return { kind: "failed", state, error: (error as Error).message, retryable, usage, costUsd: cost };
  }
  state.steps += 1;
  usage = addUsage(usage, response.usage);
  // Se factura con el modelo que respondió (puede ser el de respaldo).
  const billedModel = response.model && Object.hasOwn(MODELS, response.model) ? (response.model as ModelId) : agent.model;
  cost += costUsd(billedModel, response.usage);
  // Se guarda la respuesta completa, sin tocar los bloques de pensamiento.
  state.messages.push({ role: "assistant", content: response.content });

  switch (response.stopReason) {
    case "refusal":
      return { kind: "failed", state, error: "Claude ha rechazado la tarea por sus reglas de seguridad.", retryable: false, usage, costUsd: cost };
    case "max_tokens":
      return { kind: "failed", state, error: "La respuesta se cortó por longitud.", retryable: true, usage, costUsd: cost };
    case "pause_turn":
      return { kind: "continue", state, usage, costUsd: cost };
    case "end_turn":
    case "stop_sequence":
      return { kind: "completed", state, result: textOf(response.content), usage, costUsd: cost };
    case "other":
      return { kind: "failed", state, error: "Claude terminó por un motivo no previsto.", retryable: false, usage, costUsd: cost };
    case "tool_use":
      break;
  }

  // ── 2-5. Herramientas: permisos, aprobación y ejecución controlada ──
  const calls = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
  for (const call of calls) {
    const toolId = toolIdFromName(call.name);
    const r = await gateway.execute({ agent, toolUseId: call.id, toolId, args: call.input ?? {} }, ctx);
    if (r.kind === "approval_required") {
      state.pending.push({ toolUseId: call.id, toolId, args: call.input ?? {}, approvalId: r.approvalId });
    } else {
      state.partialResults.push(result(call.id, r.output.content, r.output.isError));
    }
  }

  if (state.pending.length > 0) {
    return { kind: "waiting_approval", state, usage, costUsd: cost };
  }

  // ── 6. Todos los resultados del turno en un único mensaje ──
  state.messages.push({ role: "user", content: state.partialResults });
  state.partialResults = [];
  return { kind: "continue", state, usage, costUsd: cost };
}
