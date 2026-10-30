// Puerta única de ejecución de herramientas.
//
// Los manejadores solo existen dentro de una instancia de ToolGateway (campo
// privado) y la única forma de ejecutarlos es execute(), que aplica siempre
// la política de permisos. Una herramienta que requiere aprobación solo se
// ejecuta si la base de datos confirma (begin_tool_execution →
// consume_approval) que hay una aprobación vigente, de un solo uso, para esta
// ejecución, esta herramienta, esta acción y exactamente estos argumentos.
//
// Idempotencia: toda herramienta con efectos (riesgo distinto de «read») se
// registra en tool_executions ANTES de ejecutarse. Si el proceso se corta
// después de que el proveedor complete la acción pero antes de guardar el
// resultado, el reintento encuentra el registro «started» y NO la repite:
// devuelve «resultado incierto» para que el administrador lo verifique.

import type { AgentDefinition } from "../agents/registry";
import { evaluateToolUse } from "../agents/permissions";
import { TOOLS, isToolId, type ToolId } from "../agents/tools";

export interface ToolOutput {
  content: string;
  isError?: boolean;
  /** Identificador del proveedor (id del email, del post…) para verificar. */
  providerRef?: string;
}

export interface ToolContext {
  runId: string;
  taskId: string;
  agentId: string;
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutput>;

export type ApprovalState = "pending" | "approved" | "rejected" | "expired";

export type BeginOutcome =
  | { outcome: "started"; executionId: string }
  | { outcome: "replay"; status: "succeeded" | "failed"; result: string | null }
  | { outcome: "uncertain" }
  | { outcome: "denied" };

/** Implementación real: request_approval, begin/finish_tool_execution de Supabase. */
export interface EnginePort {
  requestApproval(input: {
    toolUseId: string;
    toolId: ToolId;
    risk: string;
    action: string;
    args: Record<string, unknown>;
    summary: string;
  }): Promise<string>;
  approvalState(approvalId: string): Promise<{ state: ApprovalState; note: string | null }>;
  beginExecution(input: {
    toolUseId: string;
    toolId: ToolId;
    action: string;
    args: Record<string, unknown>;
    approvalId?: string;
  }): Promise<BeginOutcome>;
  finishExecution(executionId: string, succeeded: boolean, result: string, providerRef?: string): Promise<void>;
}

export interface ToolCall {
  agent: Pick<AgentDefinition, "id" | "name" | "tools">;
  toolUseId: string;
  toolId: string;
  args: Record<string, unknown>;
  /** Solo al reanudar una llamada que ya tenía aprobación solicitada. */
  approvalId?: string;
}

export type GatewayResult =
  | { kind: "result"; output: ToolOutput }
  | { kind: "approval_required"; approvalId: string };

/** Nombre de la herramienta para Claude (sin puntos: ^[a-zA-Z0-9_-]{1,64}$). */
export function toolNameFor(id: ToolId): string {
  return id.replaceAll(".", "__");
}

export function toolIdFromName(name: string): string {
  return name.replaceAll("__", ".");
}

export function actionOf(args: Record<string, unknown>): string {
  return typeof args.action === "string" && args.action.length > 0 ? args.action : "execute";
}

export class ToolGateway {
  readonly #handlers = new Map<ToolId, ToolHandler>();

  constructor(private readonly engine: EnginePort) {}

  register(toolId: ToolId, handler: ToolHandler): this {
    if (this.#handlers.has(toolId)) throw new Error(`La herramienta ${toolId} ya está registrada.`);
    this.#handlers.set(toolId, handler);
    return this;
  }

  get connected(): ReadonlySet<string> {
    return new Set(this.#handlers.keys());
  }

  async execute(call: ToolCall, ctx: ToolContext): Promise<GatewayResult> {
    const decision = evaluateToolUse(call.agent, call.toolId, this.connected);
    if (decision.decision === "denied" || decision.decision === "unavailable") {
      return { kind: "result", output: { content: decision.reason, isError: true } };
    }
    const toolId = call.toolId as ToolId; // evaluateToolUse ya comprobó que existe
    const action = actionOf(call.args);

    // Lecturas: sin efectos, no necesitan registro.
    if (TOOLS[toolId].risk === "read") {
      return { kind: "result", output: await this.#run(toolId, call.args, ctx) };
    }

    if (decision.decision === "needs_approval" && !call.approvalId) {
      const approvalId = await this.engine.requestApproval({
        toolUseId: call.toolUseId,
        toolId,
        risk: TOOLS[toolId].risk,
        action,
        args: call.args,
        summary: `${call.agent.name} quiere usar «${TOOLS[toolId].name}» (${action}).`,
      });
      return { kind: "approval_required", approvalId };
    }

    const begin = await this.engine.beginExecution({
      toolUseId: call.toolUseId,
      toolId,
      action,
      args: call.args,
      approvalId: decision.decision === "needs_approval" ? call.approvalId : undefined,
    });
    switch (begin.outcome) {
      case "denied":
        return {
          kind: "result",
          output: {
            content:
              "La aprobación no es válida para esta acción (caducada, ya usada, de otra ejecución o con argumentos distintos). No se ha ejecutado nada.",
            isError: true,
          },
        };
      case "replay":
        return {
          kind: "result",
          output: { content: begin.result ?? "Acción ya ejecutada anteriormente.", isError: begin.status === "failed" },
        };
      case "uncertain":
        return {
          kind: "result",
          output: {
            content:
              "Resultado incierto: esta acción se empezó a ejecutar pero el proceso se interrumpió. No se repetirá automáticamente; el administrador debe comprobar si se completó.",
            isError: true,
          },
        };
      case "started": {
        const output = await this.#run(toolId, call.args, ctx);
        await this.engine.finishExecution(begin.executionId, !output.isError, output.content, output.providerRef);
        return { kind: "result", output };
      }
    }
  }

  async #run(toolId: ToolId, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
    const handler = this.#handlers.get(toolId);
    if (!handler || !isToolId(toolId)) return { content: "Herramienta no conectada.", isError: true };
    try {
      return await handler(args, ctx);
    } catch (error) {
      return { content: `Error al ejecutar la herramienta: ${(error as Error).message}`, isError: true };
    }
  }
}
