import "server-only";
import type { Viewer } from "../auth/session";
import type { TaskStatus } from "../domain/status";
import { createSupabaseServerClient } from "../supabase/server";

// Lectura de encargos con la sesión del administrador (RLS). Todo lo que se
// muestra sale de la base de datos: tareas, eventos, documentos y costes.

export interface MissionRow {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  costUsd: number;
}

export interface MissionTask {
  id: string;
  title: string;
  description: string;
  agentId: string | null;
  status: TaskStatus;
  result: string | null;
  error: string | null;
  phase: string | null;
  createdAt: string;
  costUsd: number;
  modelCalls: number;
  searches: number;
  lockedUntil: string | null;
  runAfter: string | null;
  heartbeatAt: string | null;
}

export interface MissionDetail {
  mission: MissionTask;
  children: MissionTask[];
  events: { id: number; taskId: string; agentId: string | null; type: string; toStatus: string | null; message: string | null; createdAt: string }[];
  documents: { id: string; title: string; kind: string; agentId: string | null; taskId: string | null; content: string | null; createdAt: string }[];
  companies: { id: string; name: string; city: string | null; website: string | null; instagram: string | null; needDetected: string | null; source: string; createdAt: string }[];
  totals: { costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; searches: number; calls: number };
  budget: { claudeUsd: number; searchUsd: number; reservedUsd: number; uncertainUsd: number; limitUsd: number | null; synthesisReserveUsd: number; maxCompanies: number; maxSearches: number };
}

const TASK_COLS = "id, title, description, agent_id, status, result, error, input, created_at, parent_task_id, locked_until, run_after, heartbeat_at";
type CostRow = { task_id: string; model_calls: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; server_tool_requests: number; cost_usd: number };

export async function listMissions(viewer: Viewer): Promise<MissionRow[]> {
  if (viewer.mode !== "admin") return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, created_at")
    .is("parent_task_id", null)
    .eq("agent_id", "alex")
    .eq("input->>kind", "mission")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`No se pudieron leer los encargos: ${error.message}`);
  const missions = data ?? [];
  const ids = missions.map((m) => m.id as string);
  const costs = await costsByMission(supabase, ids);
  return missions.map((m) => ({ id: m.id, title: m.title, status: m.status, createdAt: m.created_at, costUsd: costs.get(m.id) ?? 0 }));
}

async function costsByMission(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, ids: string[]) {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const { data: kids } = await supabase.from("tasks").select("id, parent_task_id").in("parent_task_id", ids);
  const owner = new Map<string, string>(ids.map((id) => [id, id]));
  for (const k of kids ?? []) owner.set(k.id as string, k.parent_task_id as string);
  const { data } = await supabase.from("task_costs").select("task_id, cost_usd").in("task_id", [...owner.keys()]);
  for (const c of data ?? []) {
    const m = owner.get(c.task_id as string)!;
    out.set(m, (out.get(m) ?? 0) + Number(c.cost_usd));
  }
  return out;
}

export async function getMission(viewer: Viewer, id: string): Promise<MissionDetail | null> {
  if (viewer.mode !== "admin") return null;
  const supabase = await createSupabaseServerClient();
  const { data: m } = await supabase.from("tasks").select(TASK_COLS).eq("id", id).maybeSingle();
  if (!m || m.parent_task_id) return null;
  const { data: kids } = await supabase.from("tasks").select(TASK_COLS).eq("parent_task_id", id).order("created_at");
  const all = [m, ...(kids ?? [])];
  const ids = all.map((t) => t.id as string);

  const [events, docs, costs, usage, reservations, settings] = await Promise.all([
    supabase.from("task_events").select("id, task_id, agent_id, type, to_status, message, created_at").in("task_id", ids).order("created_at", { ascending: false }).limit(200),
    supabase.from("documents").select("id, title, kind, agent_id, task_id, content, created_at").in("task_id", ids).order("created_at"),
    supabase.from("task_costs").select("*").in("task_id", ids),
    supabase.from("ai_usage").select("claude_cost_usd, search_cost_usd").in("task_id", ids),
    supabase.from("ai_reservations").select("status, estimate_usd").eq("mission_id", id).in("status", ["open", "uncertain"]),
    supabase.from("settings").select("key, value").in("key", ["limits", "pilot"]),
  ]);
  const setting = (k: string) => (settings.data ?? []).find((x) => x.key === k)?.value as Record<string, unknown> | undefined;
  const numOr = (v: unknown, d: number | null) => (v === null || v === undefined || v === "" ? d : Number(v));
  const sumOf = <T,>(rows: T[] | null, f: (r: T) => unknown) => (rows ?? []).reduce((acc, r) => acc + Number(f(r) ?? 0), 0);
  const resv = (reservations.data ?? []) as { status: string; estimate_usd: number }[];
  const cost = new Map<string, CostRow>((costs.data as CostRow[] | null ?? []).map((c) => [c.task_id, c]));
  const toTask = (t: typeof m): MissionTask => {
    const c = cost.get(t.id);
    return {
      id: t.id, title: t.title, description: t.description, agentId: t.agent_id, status: t.status,
      result: t.result, error: t.error, phase: (t.input as { phase?: string } | null)?.phase ?? null, createdAt: t.created_at,
      costUsd: Number(c?.cost_usd ?? 0), modelCalls: Number(c?.model_calls ?? 0), searches: Number(c?.server_tool_requests ?? 0),
      lockedUntil: t.locked_until, runAfter: t.run_after, heartbeatAt: t.heartbeat_at,
    };
  };
  const rows = [...cost.values()];
  const sum = (k: keyof CostRow) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);

  // Fichas creadas dentro de esta misión.
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, city, website, instagram, need_detected, source, created_at")
    .in("created_in_task", ids)
    .order("created_at");

  return {
    mission: toTask(m),
    children: (kids ?? []).map(toTask),
    events: (events.data ?? []).map((e) => ({ id: e.id, taskId: e.task_id, agentId: e.agent_id, type: e.type, toStatus: e.to_status, message: e.message, createdAt: e.created_at })),
    documents: (docs.data ?? []).map((d) => ({ id: d.id, title: d.title, kind: d.kind, agentId: d.agent_id, taskId: d.task_id, content: d.content, createdAt: d.created_at })),
    companies: (companies ?? []).map((c) => ({ id: c.id, name: c.name, city: c.city, website: c.website, instagram: c.instagram, needDetected: c.need_detected, source: c.source, createdAt: c.created_at })),
    totals: {
      costUsd: sum("cost_usd"), inputTokens: sum("input_tokens"), outputTokens: sum("output_tokens"),
      cacheReadTokens: sum("cache_read_tokens"), cacheWriteTokens: sum("cache_write_tokens"), searches: sum("server_tool_requests"), calls: sum("model_calls"),
    },
    budget: {
      claudeUsd: sumOf(usage.data, (r) => r.claude_cost_usd),
      searchUsd: sumOf(usage.data, (r) => r.search_cost_usd),
      reservedUsd: sumOf(resv.filter((r) => r.status === "open"), (r) => r.estimate_usd),
      uncertainUsd: sumOf(resv.filter((r) => r.status === "uncertain"), (r) => r.estimate_usd),
      limitUsd: numOr(setting("limits")?.mission_ai_budget_usd, null),
      synthesisReserveUsd: numOr(setting("pilot")?.synthesis_reserve_usd, 0)!,
      maxCompanies: numOr(setting("pilot")?.max_companies, 5)!,
      maxSearches: numOr(setting("pilot")?.max_searches, 15)!,
    },
  };
}
