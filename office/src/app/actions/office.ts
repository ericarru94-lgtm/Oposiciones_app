"use server";

import type { AgentDetail, OfficeSnapshot } from "@/components/office/types";
import { requireViewer } from "@/lib/auth/session";
import { getAgentProfile } from "@/lib/data/agents";
import { getOfficeSnapshot } from "@/lib/data/office";

/** Relectura de la oficina tras un aviso de Realtime o una reconexión. Solo lee. */
export async function refreshOffice(): Promise<OfficeSnapshot> {
  return getOfficeSnapshot(await requireViewer());
}

/** Tareas y actividad recientes de un agente para su ficha. Solo lee (RLS). */
export async function agentDetail(agentId: string): Promise<AgentDetail | null> {
  if (typeof agentId !== "string" || !/^[a-z]{2,20}$/.test(agentId)) return null;
  const profile = await getAgentProfile(await requireViewer(), agentId);
  if (!profile) return null;
  return {
    openTasks: profile.openTasks.slice(0, 5).map((t) => ({ id: t.id, title: t.title, status: t.status, createdAt: t.createdAt })),
    completedCount: profile.completedTasks.length,
    recent: profile.history.slice(0, 6).map((e) => ({ id: e.id, type: e.type, message: e.message, createdAt: e.createdAt })),
  };
}
