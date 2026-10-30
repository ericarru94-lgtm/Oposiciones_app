// Estados del sistema. Son los mismos valores que los enums de PostgreSQL
// (supabase/migrations/0001_init.sql). La oficina 3D y la vista en lista solo
// muestran lo que hay en la base de datos: nunca se generan estados al azar.

export const AGENT_STATUSES = [
  "available",
  "receiving",
  "working",
  "thinking",
  "researching",
  "executing_tool",
  "waiting_agent",
  "waiting_approval",
  "reviewing",
  "completed",
  "error",
  "blocked", // heredado de la fase 1; el motor ya no lo usa
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  available: "Disponible",
  receiving: "Recibiendo tarea",
  working: "Trabajando",
  thinking: "Pensando",
  researching: "Investigando",
  executing_tool: "Ejecutando herramienta",
  waiting_agent: "Esperando a otro agente",
  waiting_approval: "Esperando tu aprobación",
  reviewing: "En revisión",
  completed: "Completado",
  error: "Error",
  blocked: "Bloqueado",
};

export const TASK_STATUSES = [
  "pending",
  "assigned",
  "in_progress",
  "in_review",
  "needs_approval",
  "completed",
  "failed",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pendiente",
  assigned: "Asignada",
  in_progress: "En proceso",
  in_review: "En revisión",
  needs_approval: "Requiere aprobación",
  completed: "Completada",
  failed: "Fallida",
};

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["assigned", "failed"],
  assigned: ["in_progress", "pending", "failed"],
  in_progress: ["in_review", "needs_approval", "completed", "failed"],
  in_review: ["in_progress", "needs_approval", "completed", "failed"],
  needs_approval: ["in_progress", "completed", "failed"],
  failed: ["pending"], // reintento controlado
  completed: [],
};

export interface TaskTransitionContext {
  /** La tarea debe pasar por Victoria (control de calidad) antes de cerrarse. */
  requiresReview: boolean;
  /** Ya existe una revisión aprobada por control de calidad. */
  reviewApproved: boolean;
  attempts: number;
  maxAttempts: number;
}

export type TransitionResult = { ok: true } | { ok: false; reason: string };

export function canTransitionTask(
  from: TaskStatus,
  to: TaskStatus,
  ctx: TaskTransitionContext,
): TransitionResult {
  if (!TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      reason: `No se puede pasar de «${TASK_STATUS_LABEL[from]}» a «${TASK_STATUS_LABEL[to]}».`,
    };
  }
  if (to === "completed" && ctx.requiresReview && !ctx.reviewApproved) {
    return {
      ok: false,
      reason: "Esta tarea necesita pasar el control de calidad antes de completarse.",
    };
  }
  if (from === "failed" && to === "pending" && ctx.attempts >= ctx.maxAttempts) {
    return {
      ok: false,
      reason: `Se ha alcanzado el máximo de ${ctx.maxAttempts} intentos.`,
    };
  }
  return { ok: true };
}

/** Estado que debe mostrar un agente según la tarea que tiene en curso. */
export function agentStatusForTask(status: TaskStatus | null): AgentStatus {
  switch (status) {
    case null:
    case "pending":
    case "assigned":
      return "available";
    case "in_progress":
      return "working";
    case "in_review":
      return "reviewing";
    case "needs_approval":
      return "waiting_approval";
    case "failed":
      return "error";
    case "completed":
      return "completed";
  }
}
