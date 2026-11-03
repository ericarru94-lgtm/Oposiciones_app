import "server-only";
import { AGENTS, getAgent, isActiveAgent, MODELS, type AgentDefinition, type ModelId } from "../agents/registry";
import type { Viewer } from "../auth/session";
import type { AgentStatus, TaskPriority, TaskStatus } from "../domain/status";
import { createSupabaseServerClient } from "../supabase/server";

export interface AgentState {
  status: AgentStatus;
  statusDetail: string | null;
  statusUpdatedAt: string | null;
  model: ModelId;
  currentTask: { id: string; title: string } | null;
  openTasks: number;
  completedTasks: number;
}

export interface AgentWithState extends AgentDefinition {
  state: AgentState;
  /** `agents.active` en la base de datos (en la vista previa local, la lista ACTIVE_AGENT_IDS). */
  active: boolean;
  /** «database» = estado real de Supabase; «registry» = vista previa local sin base de datos. */
  source: "database" | "registry";
}

export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: string;
  completedAt: string | null;
}

export interface TaskEventSummary {
  id: number;
  type: string;
  message: string | null;
  createdAt: string;
}

const OPEN: TaskStatus[] = ["pending", "assigned", "in_progress", "in_review", "needs_approval"];

function idleState(agent: AgentDefinition): AgentState {
  return {
    status: "available",
    statusDetail: null,
    statusUpdatedAt: null,
    model: agent.model,
    currentTask: null,
    openTasks: 0,
    completedTasks: 0,
  };
}

function asModel(value: string, fallback: ModelId): ModelId {
  return Object.hasOwn(MODELS, value) ? (value as ModelId) : fallback;
}

export interface AgentRow {
  id: string;
  status: string;
  status_detail: string | null;
  status_updated_at: string | null;
  model: string;
  current_task_id: string | null;
  active: boolean;
}
export interface AgentTaskRow {
  id: string;
  title: string;
  status: string;
  agent_id: string | null;
}

/**
 * Une el registro con las filas de la base de datos. Devuelve TODOS los agentes
 * que existen en `agents` (activos e inactivos): la oficina muestra a los nueve y
 * marca a los inactivos. Solo lectura; no decide quién trabaja (eso lo hacen el
 * worker y claim_next_task).
 */
export function mergeAgents(rows: AgentRow[], tasks: AgentTaskRow[]): AgentWithState[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return AGENTS.filter((a) => byId.has(a.id)).map((a) => {
    const row = byId.get(a.id)!;
    const mine = tasks.filter((t) => t.agent_id === a.id);
    const current = mine.find((t) => t.id === row.current_task_id);
    return {
      ...a,
      source: "database",
      active: row.active === true,
      state: {
        status: row.status as AgentStatus,
        statusDetail: row.status_detail,
        statusUpdatedAt: row.status_updated_at,
        model: asModel(row.model, a.model),
        currentTask: current ? { id: current.id, title: current.title } : null,
        openTasks: mine.filter((t) => OPEN.includes(t.status as TaskStatus)).length,
        completedTasks: mine.filter((t) => t.status === "completed").length,
      },
    };
  });
}

export async function listAgents(viewer: Viewer): Promise<AgentWithState[]> {
  if (viewer.mode === "local-preview") {
    return AGENTS.map((a) => ({ ...a, state: idleState(a), source: "registry", active: isActiveAgent(a.id) }));
  }
  const supabase = await createSupabaseServerClient();
  const [{ data: rows, error }, { data: tasks, error: taskError }] = await Promise.all([
    supabase
      .from("agents")
      .select("id, status, status_detail, status_updated_at, model, current_task_id, active"),
    supabase.from("tasks").select("id, title, status, agent_id").not("agent_id", "is", null),
  ]);
  if (error) throw new Error(`No se pudieron leer los agentes: ${error.message}`);
  if (taskError) throw new Error(`No se pudieron leer las tareas: ${taskError.message}`);

  return mergeAgents((rows ?? []) as AgentRow[], (tasks ?? []) as AgentTaskRow[]);
}

export interface AgentProfile {
  agent: AgentWithState;
  openTasks: TaskSummary[];
  completedTasks: TaskSummary[];
  history: TaskEventSummary[];
}

export async function getAgentProfile(viewer: Viewer, id: string): Promise<AgentProfile | null> {
  if (!getAgent(id)) return null;
  const agent = (await listAgents(viewer)).find((a) => a.id === id);
  if (!agent) return null;
  if (viewer.mode === "local-preview") {
    return { agent, openTasks: [], completedTasks: [], history: [] };
  }
  const supabase = await createSupabaseServerClient();
  const [{ data: tasks, error }, { data: events, error: eventsError }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, status, priority, created_at, completed_at")
      .eq("agent_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("task_events")
      .select("id, type, message, created_at")
      .eq("agent_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (error) throw new Error(`No se pudieron leer las tareas: ${error.message}`);
  if (eventsError) throw new Error(`No se pudo leer el historial: ${eventsError.message}`);

  const summaries: TaskSummary[] = (tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status as TaskStatus,
    priority: t.priority as TaskPriority,
    createdAt: t.created_at,
    completedAt: t.completed_at,
  }));
  return {
    agent,
    openTasks: summaries.filter((t) => OPEN.includes(t.status)),
    completedTasks: summaries.filter((t) => t.status === "completed"),
    history: (events ?? []).map((e) => ({ id: e.id, type: e.type, message: e.message, createdAt: e.created_at })),
  };
}
