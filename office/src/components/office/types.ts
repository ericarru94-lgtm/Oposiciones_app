import type { AvatarSpec, DepartmentId } from "@/lib/agents/catalog";
import type { AgentStatus } from "@/lib/domain/status";
import type { SceneLook } from "@/lib/office/scene";

/** Lo que la oficina necesita de cada agente (serializable, sin instrucciones ni permisos). */
export interface OfficeAgentData {
  id: string;
  name: string;
  role: string;
  department: DepartmentId;
  avatar: AvatarSpec;
  desk: { x: number; z: number; rotation: number };
  status: AgentStatus;
  statusDetail: string | null;
  statusUpdatedAt: string | null;
  model: string;
  currentTask: { id: string; title: string } | null;
  openTasks: number;
  completedTasks: number;
  pilot: boolean;
  /** Del registro (sin las instrucciones internas del agente). */
  specialty: string;
  description: string;
  responsibilities: string[];
}

/** Detalle bajo demanda para la ficha: tareas y actividad reales (solo lectura). */
export interface AgentDetail {
  openTasks: { id: string; title: string; status: string; createdAt: string }[];
  completedCount: number;
  recent: { id: number; type: string; message: string | null; createdAt: string }[];
}

export interface OfficeAgent extends OfficeAgentData {
  look: SceneLook;
}

export interface OfficeSnapshot {
  agents: OfficeAgentData[];
  pendingApprovals: number;
  syncedAt: string;
}
