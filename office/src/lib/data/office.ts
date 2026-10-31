import "server-only";
import type { OfficeAgentData, OfficeSnapshot } from "@/components/office/types";
import { isPilotAgent } from "../office/scene";
import type { Viewer } from "../auth/session";
import { createSupabaseServerClient } from "../supabase/server";
import { listAgents, type AgentWithState } from "./agents";

export function toOfficeAgent(a: AgentWithState): OfficeAgentData {
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    department: a.department,
    avatar: a.avatar,
    desk: a.desk,
    status: a.state.status,
    statusDetail: a.state.statusDetail,
    statusUpdatedAt: a.state.statusUpdatedAt,
    model: a.state.model,
    currentTask: a.state.currentTask,
    openTasks: a.state.openTasks,
    completedTasks: a.state.completedTasks,
    pilot: isPilotAgent(a.id),
  };
}

/** Estado de la oficina leído con la sesión del usuario (RLS). Solo lectura. */
export async function getOfficeSnapshot(viewer: Viewer): Promise<OfficeSnapshot> {
  const agents = (await listAgents(viewer)).map(toOfficeAgent);
  let pendingApprovals = 0;
  if (viewer.mode === "admin") {
    const supabase = await createSupabaseServerClient();
    const { count, error } = await supabase.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending");
    if (error) throw new Error(`No se pudieron leer las aprobaciones: ${error.message}`);
    pendingApprovals = count ?? 0;
  }
  return { agents, pendingApprovals, syncedAt: new Date().toISOString() };
}
