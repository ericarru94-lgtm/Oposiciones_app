import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentStatus } from "../domain/status";
import { createSupabaseServiceClient } from "../supabase/server";
import type { EnginePort } from "./gateway";
import { parseBegin, type ClaimedRun, type CompanyRow, type DocumentSummary, type EngineStore, type RelatedTask, type BudgetSnapshot, type CallRecord, type CompanyPatch, type MissionCompany, type Reservation, type TaskRow } from "./store";

// EngineStore de producción: mismas operaciones que SqlEngineStore, a través
// de la API de Supabase con la clave secreta (solo servidor).

const RELATED = "id, title, agent_id, status, result, error";
const COMPANY = "id, name, city, website, instagram, stage, need_detected, recommended_service, source, is_demo";

function must(res: { data: unknown; error: { message: string } | null }, what: string): unknown {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export class SupabaseEngineStore implements EngineStore {
  constructor(private readonly db: SupabaseClient = createSupabaseServiceClient()) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    return must(await this.db.rpc(fn, args), fn) as T;
  }

  async recoverStale() {
    await this.rpc("recover_stale", {});
  }
  async claim(worker: string, lease: number, max: number): Promise<ClaimedRun | null> {
    const rows = await this.rpc<{ task_id: string; run_id: string; agent_id: string; attempt: number; resumed: boolean }[]>(
      "claim_next_task", { p_worker: worker, p_lease_seconds: lease, p_max_running: max });
    const r = rows?.[0];
    return r ? { taskId: r.task_id, runId: r.run_id, agentId: r.agent_id, attempt: r.attempt, resumed: r.resumed } : null;
  }
  async loadRunState(runId: string) {
    const r = must(await this.db.from("agent_runs").select("state").eq("id", runId).single(), "agent_runs");
    return (r as { state: unknown }).state ?? {};
  }
  async getTask(id: string) {
    return must(
      await this.db.from("tasks").select("id, title, description, agent_id, status, parent_task_id, client_id, input, result").eq("id", id).single(),
      "tasks",
    ) as TaskRow;
  }
  async children(id: string) {
    return must(await this.db.from("tasks").select(RELATED).eq("parent_task_id", id).order("created_at"), "tasks") as RelatedTask[];
  }
  async dependencies(id: string) {
    const deps = must(await this.db.from("task_dependencies").select("depends_on").eq("task_id", id), "task_dependencies") as { depends_on: string }[];
    if (deps.length === 0) return [];
    return must(await this.db.from("tasks").select(RELATED).in("id", deps.map((d) => d.depends_on)).order("created_at"), "tasks") as RelatedTask[];
  }
  async documentsForTask(id: string) {
    return (await this.rpc<DocumentSummary[]>("documents_for_task", { p_task_id: id })).map(({ id, title, kind, agent_id, task_id, content }) => ({
      id, title, kind, agent_id, task_id, content,
    }));
  }
  async documentsOfTasks(ids: string[]) {
    if (ids.length === 0) return [];
    return must(await this.db.from("documents").select("id, title, kind, agent_id, task_id, content").in("task_id", ids).order("created_at"), "documents") as DocumentSummary[];
  }
  async memoryForTask(id: string) {
    return this.rpc<{ scope: string; category: string; title: string; content: string; source: string }[]>("memory_for_task", { p_task_id: id });
  }
  async companies(limit: number) {
    return must(await this.db.from("companies").select(COMPANY).order("created_at", { ascending: false }).limit(limit), "companies") as CompanyRow[];
  }
  async companiesCreatedBy(agentId: string, since: string) {
    return must(await this.db.from("companies").select(COMPANY).eq("created_by", agentId).gte("created_at", since).order("created_at"), "companies") as CompanyRow[];
  }
  async findCompany(name: string, city: string | null) {
    const rows = must(await this.db.from("companies").select(COMPANY).ilike("name", name.replace(/[%_\\]/g, "\\$&")), "companies") as CompanyRow[];
    return rows.find((r) => (r.city ?? "").toLowerCase() === (city ?? "").toLowerCase()) ?? null;
  }
  async insertCompany(row: Parameters<EngineStore["insertCompany"]>[0]) {
    const r = must(await this.db.from("companies").insert({ ...row, stage: "researched" }).select("id").single(), "companies");
    return (r as { id: string }).id;
  }
  async updateCompany(id: string, p: CompanyPatch) {
    const current = must(await this.db.from("companies").select("source").eq("id", id).single(), "companies") as { source: string };
    const sources = [...new Set([...current.source.split(" | "), ...p.addSources].map((x) => x.trim()).filter(Boolean))];
    const patch: Record<string, unknown> = { source: sources.join(" | ") };
    for (const k of ["website", "instagram", "phone", "need_detected", "recommended_service", "notes"] as const) {
      if (p[k] !== undefined) patch[k] = p[k];
    }
    must(await this.db.from("companies").update(patch).eq("id", id).select("id").single(), "companies");
  }
  async missionCompanies(missionId: string, reuseIds: string[]) {
    const ids = await this.missionTaskIds(missionId);
    const cols = "id, name, city, website, instagram, phone, need_detected, recommended_service, notes, source, created_by, created_in_task, created_at";
    const created = must(await this.db.from("companies").select(cols).in("created_in_task", ids), "companies") as (MissionCompany & { created_at: string })[];
    const reused = reuseIds.length
      ? (must(await this.db.from("companies").select(cols).in("id", reuseIds), "companies") as (MissionCompany & { created_at: string })[])
      : [];
    const byId = new Map([...reused, ...created].map((c) => [c.id, c]));
    return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(({ created_at: _, ...c }) => c);
  }
  async pilotSettings() {
    const r = must(await this.db.from("settings").select("value").eq("key", "pilot").maybeSingle(), "settings") as { value: Record<string, unknown> } | null;
    return r?.value ?? {};
  }
  async budgetSnapshot(missionId: string, taskId: string): Promise<BudgetSnapshot> {
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const ids = await this.missionTaskIds(missionId);
    // Dos consultas simples (sin filtro «or» con fechas, que PostgREST exige entrecomillar).
    const [settings, usageMonth, usageMission, resv] = await Promise.all([
      this.db.from("settings").select("key, value").in("key", ["limits", "pilot"]),
      this.db.from("ai_usage").select("id, cost_usd, task_id, created_at").gte("created_at", monthStart),
      this.db.from("ai_usage").select("id, cost_usd, task_id, created_at").in("task_id", ids),
      this.db.from("ai_reservations").select("estimate_usd, task_id, mission_id, status, created_at").in("status", ["open", "uncertain"]),
    ]);
    const set = (k: string) => ((must(settings, "settings") as { key: string; value: Record<string, unknown> }[]).find((x) => x.key === k)?.value ?? {});
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    type UsageRow = { id: number; cost_usd: number; task_id: string; created_at: string };
    const rows = [...new Map(
      [...(must(usageMonth, "ai_usage") as UsageRow[]), ...(must(usageMission, "ai_usage") as UsageRow[])].map((r) => [r.id, r]),
    ).values()];
    const rs = must(resv, "ai_reservations") as { estimate_usd: number; task_id: string; mission_id: string; status: string; created_at: string }[];
    const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
    const scope = (status: string) => {
      const of = rs.filter((r) => r.status === status);
      return {
        month: sum(of.filter((r) => r.created_at >= monthStart), (r) => Number(r.estimate_usd)),
        mission: sum(of.filter((r) => r.mission_id === missionId), (r) => Number(r.estimate_usd)),
        task: sum(of.filter((r) => r.task_id === taskId), (r) => Number(r.estimate_usd)),
      };
    };
    return {
      limits: {
        monthly: num(set("limits").monthly_ai_budget_usd), task: num(set("limits").task_ai_budget_usd),
        mission: num(set("limits").mission_ai_budget_usd), synthesisReserve: Number(set("pilot").synthesis_reserve_usd ?? 0),
      },
      real: {
        month: sum(rows.filter((r) => r.created_at >= monthStart), (r) => Number(r.cost_usd)),
        mission: sum(rows.filter((r) => ids.includes(r.task_id)), (r) => Number(r.cost_usd)),
        task: sum(rows.filter((r) => r.task_id === taskId), (r) => Number(r.cost_usd)),
      },
      open: scope("open"),
      uncertain: scope("uncertain"),
    };
  }
  private async missionTaskIds(missionId: string) {
    const kids = must(await this.db.from("tasks").select("id").eq("parent_task_id", missionId), "tasks") as { id: string }[];
    return [missionId, ...kids.map((k) => k.id)];
  }
  async createDocument(row: Parameters<EngineStore["createDocument"]>[0]) {
    const r = must(await this.db.from("documents").insert(row).select("id").single(), "documents");
    return (r as { id: string }).id;
  }
  async activity(runId: string, worker: string, status: AgentStatus, event: string, detail?: string) {
    await this.rpc("set_run_activity", { p_run_id: runId, p_worker: worker, p_status: status, p_event: event, p_detail: detail ?? null });
  }
  async reserve(runId: string, worker: string, model: string, estimateUsd: number, searches: number, leaseSeconds: number) {
    return this.rpc<Reservation>("reserve_budget", {
      p_run_id: runId, p_worker: worker, p_model: model, p_estimate_usd: estimateUsd, p_searches: searches, p_lease_seconds: leaseSeconds,
    });
  }
  async recordCall(i: Parameters<EngineStore["recordCall"]>[0]) {
    return this.rpc<CallRecord>("record_call", {
      p_run_id: i.runId, p_worker: i.worker, p_reservation_id: i.reservationId, p_state: i.state, p_model: i.model,
      p_input_tokens: i.inputTokens, p_output_tokens: i.outputTokens, p_cache_read_tokens: i.cacheReadTokens,
      p_cache_write_tokens: i.cacheWriteTokens, p_server_tool_requests: i.serverToolRequests,
      p_claude_cost_usd: i.claudeUsd, p_search_cost_usd: i.searchUsd, p_agent_status: i.agentStatus,
    });
  }
  async closeReservation(runId: string, reservationId: string, uncertain: boolean) {
    await this.rpc("close_reservation", { p_run_id: runId, p_reservation_id: reservationId, p_uncertain: uncertain });
  }
  async saveRunState(runId: string, worker: string, state: unknown, release: boolean) {
    await this.rpc("save_run_state", { p_run_id: runId, p_worker: worker, p_state: state, p_release: release });
  }
  async deferRun(runId: string, worker: string, state: unknown, seconds: number, reason: string) {
    await this.rpc("defer_run", { p_run_id: runId, p_worker: worker, p_state: state, p_seconds: seconds, p_reason: reason });
  }
  async pauseForApproval(runId: string, worker: string, state: unknown) {
    await this.rpc("pause_for_approval", { p_run_id: runId, p_worker: worker, p_state: state });
  }
  async completeRun(runId: string, worker: string, result: string) {
    return this.rpc<string>("complete_run", { p_run_id: runId, p_worker: worker, p_result: result, p_result_data: null });
  }
  async failRun(runId: string, worker: string, error: string, retryable: boolean) {
    return this.rpc<string>("fail_run", { p_run_id: runId, p_worker: worker, p_error: error, p_retryable: retryable });
  }
  async awaitSubtasks(runId: string, worker: string, summary: string) {
    await this.rpc("await_subtasks", { p_run_id: runId, p_worker: worker, p_summary: summary });
  }
  async delegate(runId: string, worker: string, toolUseId: string, agent: string, title: string, description: string, dependsOn: string[]) {
    return this.rpc<{ task_id: string; duplicate: boolean }>("delegate_task", {
      p_run_id: runId, p_worker: worker, p_tool_use_id: toolUseId, p_agent: agent, p_title: title,
      p_description: description, p_depends_on: dependsOn,
    });
  }
  enginePort(runId: string, worker: string): EnginePort {
    const rpc = this.rpc.bind(this);
    const db = this.db;
    return {
      requestApproval: (i) =>
        rpc<string>("request_approval", {
          p_run_id: runId, p_worker: worker, p_tool_use_id: i.toolUseId, p_tool_id: i.toolId, p_risk: i.risk,
          p_action: i.action, p_arguments: i.args, p_summary: i.summary, p_ttl_hours: 72,
        }),
      async approvalState(id) {
        const r = must(await db.from("approvals").select("status, decision_note").eq("id", id).single(), "approvals") as {
          status: "pending" | "approved" | "rejected" | "expired"; decision_note: string | null;
        };
        return { state: r.status, note: r.decision_note };
      },
      async beginExecution(i) {
        return parseBegin(await rpc<Record<string, unknown>>("begin_tool_execution", {
          p_run_id: runId, p_worker: worker, p_tool_use_id: i.toolUseId, p_tool_id: i.toolId, p_action: i.action,
          p_arguments: i.args, p_approval_id: i.approvalId ?? null,
        }));
      },
      async finishExecution(id, ok, result, providerRef) {
        await rpc("finish_tool_execution", { p_execution_id: id, p_worker: worker, p_succeeded: ok, p_result: result, p_provider_ref: providerRef ?? null });
      },
    };
  }
}
