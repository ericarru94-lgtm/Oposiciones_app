import "server-only";
import type { Viewer } from "../auth/session";
import { OUTCOME_LABEL, outcomeOf, type Outcome } from "../engine/coordination";
import type { TaskStatus } from "../domain/status";
import { createSupabaseServerClient } from "../supabase/server";

// Centro de mando: solo lectura con la sesión del administrador (RLS). No usa
// las tablas de la migración 0008, así funciona antes y después de aplicarla.

export interface DashboardData {
  missions: { id: string; title: string; status: TaskStatus; outcome: Outcome | null; outcomeLabel: string | null; warnings: number; createdAt: string; costUsd: number }[];
  running: number;
  failed30d: number;
  approvals: { id: string; taskId: string | null; agentId: string; summary: string; risk: string; createdAt: string }[];
  events: { id: number; taskId: string; agentId: string | null; type: string; message: string | null; createdAt: string }[];
  companies: number;
  documents: number;
}

export async function getDashboard(viewer: Viewer): Promise<DashboardData | null> {
  if (viewer.mode !== "admin") return null;
  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [missions, approvals, events, companies, documents] = await Promise.all([
    supabase.from("tasks").select("id, title, status, result_data, created_at, completed_at")
      .is("parent_task_id", null).eq("input->>kind", "mission").order("created_at", { ascending: false }).limit(20),
    supabase.from("approvals").select("id, task_id, agent_id, summary, risk, created_at").eq("status", "pending").order("created_at"),
    supabase.from("task_events").select("id, task_id, agent_id, type, message, created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("companies").select("id", { count: "exact", head: true }),
    supabase.from("documents").select("id", { count: "exact", head: true }),
  ]);
  for (const r of [missions, approvals, events, companies, documents]) {
    if (r.error) throw new Error(`No se pudo leer el centro de mando: ${r.error.message}`);
  }
  const rows = missions.data ?? [];
  const ids = rows.map((m) => m.id);
  const costs = ids.length
    ? (await supabase.from("task_costs").select("task_id, cost_usd").in("task_id", ids)).data ?? []
    : [];
  return {
    missions: rows.map((m) => {
      const outcome = outcomeOf({ status: m.status, result_data: m.result_data });
      return {
        id: m.id,
        title: m.title,
        status: m.status as TaskStatus,
        outcome,
        outcomeLabel: outcome ? OUTCOME_LABEL[outcome] : null,
        warnings: ((m.result_data as { warnings?: unknown[] } | null)?.warnings ?? []).length,
        createdAt: m.created_at,
        costUsd: Number(costs.find((c) => c.task_id === m.id)?.cost_usd ?? 0),
      };
    }),
    running: rows.filter((m) => ["pending", "assigned", "in_progress", "in_review", "needs_approval"].includes(m.status)).length,
    failed30d: rows.filter((m) => m.status === "failed" && m.created_at >= since).length,
    approvals: (approvals.data ?? []).map((a) => ({ id: a.id, taskId: a.task_id, agentId: a.agent_id, summary: a.summary, risk: a.risk, createdAt: a.created_at })),
    events: (events.data ?? []).map((e) => ({ id: e.id, taskId: e.task_id, agentId: e.agent_id, type: e.type, message: e.message, createdAt: e.created_at })),
    companies: companies.count ?? 0,
    documents: documents.count ?? 0,
  };
}
