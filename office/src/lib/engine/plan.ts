// 0013 · Plan de misión en el motor: herramientas de cada fase, pasos máximos,
// presupuesto mínimo por paso y orden impuesto entre agentes.
//
// La base de datos valida y decide (submit_mission_plan, approve_mission_plan
// y reserve_budget). Esto solo prepara la ejecución y avisa a Alex antes de
// proponer algo que la base de datos rechazaría o que no podría ejecutarse.

import { getAgent, isActiveAgent, type AgentDefinition } from "../agents/registry";
import type { ToolId } from "../agents/tools";
import { ENGINE, PILOT_DEPENDENCIES, SEARCH_RESULT_TOKENS_ASSUMED, SERVER_TOOLS, SERVER_TOOL_OVERHEAD_TOKENS, callLimits, scopeTools } from "./config";
import { reserveUsd } from "./cost";
import type { MissionPlan, PlanStepInput, TaskRow } from "./store";

export const PLAN_LIMITS = {
  /** Versiones propuestas en total por misión (iniciales, reformulaciones y ampliaciones). */
  maxVersions: 3,
  /** Llamadas de Alex en la planificación: leer, proponer, corregir una vez y explicar. */
  planningMaxSteps: 4,
  /** Tokens de entrada mínimos que se suponen para la primera llamada de un paso. */
  minPromptTokens: 6_000,
  /** Caducidad de una propuesta sin decisión. */
  expiresHours: 72,
} as const;

const PLANNING_TOOLS: readonly ToolId[] = ["memory.read", "crm.read", "mission.plan"];
const SYNTHESIS_TOOLS: readonly ToolId[] = ["memory.read", "crm.read", "content.draft"];

/** La misión funciona con plan aprobado (0013). Las antiguas no. */
export function isPlanMission(task: TaskRow): boolean {
  return task.input.kind === "mission" && task.parent_task_id === null && task.plan_required === true;
}

/** Alex puede proponer una ampliación: ronda permitida, versiones libres y ninguna pendiente. */
export function canAmend(task: TaskRow, plans: MissionPlan[], maxRounds: number): boolean {
  const round = Number(task.input.round ?? 1);
  return (
    plans.some((p) => p.status === "approved") &&
    !plans.some((p) => p.status === "pending") &&
    plans.length < PLAN_LIMITS.maxVersions &&
    round <= maxRounds
  );
}

/**
 * Herramientas de una ejecución. Son las mismas en todas sus llamadas (la fase
 * no cambia dentro de una ejecución): Sonnet 5.5 rechaza la conversación si
 * la lista cambia.
 * - Misión antigua: las de siempre, sin «mission.plan».
 * - Misión con plan: planificación = leer + proponer; síntesis = leer +
 *   borrador (+ proponer una ampliación si aún se puede). Nunca «tasks.delegate».
 * - Subtarea de un paso: solo las herramientas aprobadas en el paso.
 */
export function runTools(
  def: AgentDefinition, task: TaskRow, opts: { plans?: MissionPlan[]; stepTools?: readonly string[] | null; maxRounds?: number } = {},
): readonly ToolId[] {
  const scoped = scopeTools(def);
  if (task.input.kind === "mission" && task.parent_task_id === null) {
    if (!isPlanMission(task)) return scoped.filter((t) => t !== "mission.plan");
    if (task.input.phase === "synthesis") {
      const amend = canAmend(task, opts.plans ?? [], opts.maxRounds ?? 2);
      return scoped.filter((t) => SYNTHESIS_TOOLS.includes(t) || (amend && t === "mission.plan"));
    }
    return scoped.filter((t) => PLANNING_TOOLS.includes(t));
  }
  const withoutPlan = scoped.filter((t) => t !== "mission.plan" && t !== "tasks.delegate");
  return opts.stepTools ? withoutPlan.filter((t) => opts.stepTools!.includes(t)) : withoutPlan;
}

/** Llamadas máximas de una ejecución. */
export function runMaxSteps(task: TaskRow): number {
  if (isPlanMission(task) && (task.input.phase ?? "planning") === "planning") return PLAN_LIMITS.planningMaxSteps;
  if (task.max_calls) return Math.min(ENGINE.maxStepsPerRun, task.max_calls);
  return ENGINE.maxStepsPerRun;
}

/**
 * Presupuesto mínimo de un paso: la reserva de UNA llamada de ese agente con
 * esas herramientas y un mensaje inicial pequeño. Con menos, el paso se
 * detendría antes de su primera llamada.
 */
export function minStepBudgetUsd(agentId: string, tools: readonly string[]): number {
  const def = getAgent(agentId);
  if (!def) return Infinity;
  const web = tools.includes("web.search") || tools.includes("web.fetch");
  const limits = callLimits(agentId);
  const usd = reserveUsd(def.model, PLAN_LIMITS.minPromptTokens + (web ? SERVER_TOOL_OVERHEAD_TOKENS : 0), {
    maxOutputTokens: limits.maxTokens,
    searches: tools.includes("web.search") ? SERVER_TOOLS["web.search"].max_uses : 0,
    fetches: tools.includes("web.fetch") ? SERVER_TOOLS["web.fetch"].max_uses : 0,
    fetchTokens: SERVER_TOOLS["web.fetch"].max_content_tokens,
    searchResultTokens: SEARCH_RESULT_TOKENS_ASSUMED,
  });
  return Math.ceil(usd * 10_000) / 10_000;
}

/** Comprobaciones previas de un paso (la base de datos vuelve a validarlo todo). */
export function stepProblems(step: PlanStepInput): string[] {
  const out: string[] = [];
  const def = getAgent(step.agent);
  if (!def || !isActiveAgent(step.agent) || def.isCoordinator) {
    out.push(`«${step.key}»: ${step.agent} no puede recibir pasos.`);
    return out;
  }
  const allowed: readonly ToolId[] = scopeTools(def).filter((t) => t !== "mission.plan" && t !== "tasks.delegate");
  const extra = step.tools.filter((t) => !allowed.includes(t as ToolId));
  if (extra.length) out.push(`«${step.key}»: ${step.agent} no tiene ${extra.join(", ")} (puede usar ${allowed.join(", ")}).`);
  const web = step.tools.includes("web.search");
  if (web && step.max_searches < 1) out.push(`«${step.key}»: con búsqueda web necesita al menos 1 búsqueda.`);
  if (!web && step.max_searches !== 0) out.push(`«${step.key}»: sin búsqueda web, sus búsquedas máximas deben ser 0.`);
  const min = minStepBudgetUsd(step.agent, step.tools);
  if (step.budget_usd < min) {
    out.push(`«${step.key}»: ${step.budget_usd} $ no alcanza ni para una llamada de ${step.agent} con esas herramientas (mínimo ${min} $).`);
  }
  return out;
}

/**
 * Orden impuesto por el motor (PILOT_DEPENDENCIES): un paso de Sofia espera a
 * los pasos nuevos de Marcus del mismo plan. Se añade ANTES de proponer, así
 * que el administrador lo ve en el plan que aprueba.
 */
export function applyPlanDependencyRules(steps: PlanStepInput[]): { steps: PlanStepInput[]; notes: string[] } {
  const notes: string[] = [];
  const out = steps.map((s) => {
    const waitFor = steps.filter((o) => o.key !== s.key && (PILOT_DEPENDENCIES[s.agent] ?? []).includes(o.agent)).map((o) => o.key);
    const missing = waitFor.filter((k) => !s.depends_on.includes(k));
    if (missing.length) notes.push(`«${s.key}» (${s.agent}) esperará a ${missing.map((k) => `«${k}»`).join(", ")}`);
    return missing.length ? { ...s, depends_on: [...s.depends_on, ...missing] } : s;
  });
  return { steps: out, notes };
}
