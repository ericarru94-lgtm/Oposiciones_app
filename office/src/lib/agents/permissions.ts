// Política de permisos. Se aplica en el servidor antes de ejecutar cualquier
// herramienta, nunca en el navegador.

import { TOOLS, type ToolDefinition, type ToolId, type ToolRisk } from "./tools";

/** Riesgos que SIEMPRE requieren aprobación humana. */
export const APPROVAL_REQUIRED_RISKS: readonly ToolRisk[] = [
  "external_action",
  "spend",
  "production_change",
  "destructive",
];

export function riskRequiresApproval(risk: ToolRisk): boolean {
  return APPROVAL_REQUIRED_RISKS.includes(risk);
}

export const RISK_LABEL: Record<ToolRisk, string> = {
  read: "Lectura",
  internal_write: "Trabajo interno",
  external_action: "Acción externa",
  spend: "Gasto",
  production_change: "Producción",
  destructive: "Irreversible",
};

export type ToolDecision =
  | { decision: "allow" }
  | { decision: "needs_approval"; reason: string }
  | { decision: "denied"; reason: string }
  | { decision: "unavailable"; reason: string };

export interface AgentToolScope {
  id: string;
  name: string;
  tools: readonly ToolId[];
}

/**
 * Decide qué pasa cuando un agente quiere usar una herramienta.
 * El orden importa: primero permisos del agente, luego disponibilidad y
 * por último si la acción necesita aprobación.
 *
 * `connected` es el conjunto de herramientas que el motor tiene realmente
 * conectadas (con un manejador registrado). Si no se indica, se usa la
 * disponibilidad declarada en el catálogo.
 */
export function evaluateToolUse(
  agent: AgentToolScope,
  toolId: string,
  connected?: ReadonlySet<string>,
): ToolDecision {
  const tool: ToolDefinition | undefined = (TOOLS as Record<string, ToolDefinition>)[toolId];
  if (!tool) {
    return { decision: "denied", reason: `La herramienta «${toolId}» no existe.` };
  }
  if (!agent.tools.includes(tool.id as ToolId)) {
    return {
      decision: "denied",
      reason: `${agent.name} no tiene permiso para usar «${tool.name}».`,
    };
  }
  const isConnected = connected ? connected.has(tool.id) : tool.availability.state === "available";
  if (!isConnected) {
    return {
      decision: "unavailable",
      reason:
        tool.availability.state === "planned"
          ? `«${tool.name}» todavía no está activa (fase ${tool.availability.phase}).`
          : tool.availability.state === "needs_integration"
            ? `«${tool.name}» necesita conectar ${tool.availability.integration}.`
            : `«${tool.name}» no está conectada en este momento.`,
    };
  }
  if (riskRequiresApproval(tool.risk)) {
    return {
      decision: "needs_approval",
      reason: `«${tool.name}» es una ${RISK_LABEL[tool.risk].toLowerCase()} y requiere tu aprobación.`,
    };
  }
  return { decision: "allow" };
}
