// Contrato de eventos entre el motor y la interfaz.
//
// La fuente de verdad es la base de datos: el motor escribe task_events y
// agents.status mediante sus funciones; la oficina (lista o 3D) solo los lee
// y escucha Supabase Realtime. Ninguna animación ni estado local decide nada.

export const OFFICE_EVENTS = [
  "task_assigned",
  "run_started",
  "thinking",
  "researching",
  "tool_executing",
  "waiting_for_agent",
  "waiting_approval",
  "in_review",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
] as const;
export type OfficeEvent = (typeof OFFICE_EVENTS)[number];

/** Tipo de task_events (tal como lo escriben las funciones SQL) → evento del contrato. */
const DB_EVENT_MAP: Record<string, OfficeEvent> = {
  task_assigned: "task_assigned",
  run_started: "run_started",
  claimed: "run_started",
  resumed: "run_started",
  recovered: "run_started",
  thinking: "thinking",
  researching: "researching",
  tool_executing: "tool_executing",
  waiting_for_agent: "waiting_for_agent",
  approval_requested: "waiting_approval",
  approval_decided: "run_started",
  run_succeeded: "completed",
  review_approved: "completed",
  review_returned: "task_assigned",
  retry_scheduled: "failed",
  failed: "failed",
  timed_out: "timed_out",
  cancelled: "cancelled",
};

export function toOfficeEvent(dbType: string, toStatus?: string | null): OfficeEvent | null {
  if (dbType === "run_succeeded" && toStatus === "in_review") return "in_review";
  return DB_EVENT_MAP[dbType] ?? null;
}

export const OFFICE_EVENT_LABEL: Record<OfficeEvent, string> = {
  task_assigned: "Tarea asignada",
  run_started: "Empieza a trabajar",
  thinking: "Pensando",
  researching: "Investigando en la web",
  tool_executing: "Usando una herramienta",
  waiting_for_agent: "Esperando a su equipo",
  waiting_approval: "Esperando tu aprobación",
  in_review: "En revisión",
  completed: "Completado",
  failed: "Error",
  timed_out: "Tiempo agotado",
  cancelled: "Cancelado",
};
