// EngineStore sobre SQL directo (rol service_role). Se usa en las pruebas
// contra PostgreSQL con las migraciones reales; las consultas son las mismas
// que hace la implementación de Supabase.

import type { AgentStatus } from "../domain/status";
import type { EnginePort } from "./gateway";
import { parseBegin, type ClaimedRun, type CompanyRow, type DocumentSummary, type EngineStore, type RelatedTask, type BudgetSnapshot, type CallRecord, type CompanyPatch, type MissionCompany, type Reservation, type TaskRow } from "./store";

export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

const RELATED = "id, title, agent_id, status::text as status, result, error";
const COMPANY = "id, name, city, website, instagram, stage::text as stage, need_detected, recommended_service, source, is_demo";

export class SqlEngineStore implements EngineStore {
  constructor(private readonly q: Query) {}

  async recoverStale() {
    await this.q(`select public.recover_stale()`);
  }
  async claim(worker: string, lease: number, max: number): Promise<ClaimedRun | null> {
    const [r] = await this.q<{ task_id: string; run_id: string; agent_id: string; attempt: number; resumed: boolean }>(
      `select * from public.claim_next_task($1, $2, $3)`, [worker, lease, max]);
    return r ? { taskId: r.task_id, runId: r.run_id, agentId: r.agent_id, attempt: r.attempt, resumed: r.resumed } : null;
  }
  async loadRunState(runId: string) {
    const [r] = await this.q<{ state: unknown }>(`select state from public.agent_runs where id = $1`, [runId]);
    return r?.state ?? {};
  }
  async getTask(id: string): Promise<TaskRow> {
    const [r] = await this.q<TaskRow>(
      `select id, title, description, agent_id, status::text as status, parent_task_id, client_id, input, result from public.tasks where id = $1`, [id]);
    return r;
  }
  children(id: string) {
    return this.q<RelatedTask>(`select ${RELATED} from public.tasks where parent_task_id = $1 order by created_at`, [id]);
  }
  dependencies(id: string) {
    return this.q<RelatedTask>(
      `select ${RELATED} from public.tasks where id in (select depends_on from public.task_dependencies where task_id = $1) order by created_at`, [id]);
  }
  documentsForTask(id: string) {
    return this.q<DocumentSummary>(`select id, title, kind, agent_id, task_id, content from public.documents_for_task($1)`, [id]);
  }
  documentsOfTasks(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.q<DocumentSummary>(
      `select id, title, kind, agent_id, task_id, content from public.documents where task_id = any($1::uuid[]) order by created_at`, [ids]);
  }
  memoryForTask(id: string) {
    return this.q<{ scope: string; category: string; title: string; content: string; source: string }>(
      `select scope::text as scope, category, title, content, source from public.memory_for_task($1)`, [id]);
  }
  companies(limit: number) {
    return this.q<CompanyRow>(`select ${COMPANY} from public.companies order by created_at desc limit $1`, [limit]);
  }
  companiesCreatedBy(agentId: string, since: string) {
    return this.q<CompanyRow>(`select ${COMPANY} from public.companies where created_by = $1 and created_at >= $2 order by created_at`, [agentId, since]);
  }
  async findCompany(name: string, city: string | null) {
    const [r] = await this.q<CompanyRow>(
      `select ${COMPANY} from public.companies where lower(name) = lower($1) and lower(coalesce(city, '')) = lower(coalesce($2, ''))`, [name, city]);
    return r ?? null;
  }
  async insertCompany(row: Parameters<EngineStore["insertCompany"]>[0]) {
    const [r] = await this.q<{ id: string }>(
      `insert into public.companies (name, city, website, instagram, phone, need_detected, recommended_service, notes, source, created_by, created_in_task, stage)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'researched') returning id`,
      [row.name, row.city, row.website, row.instagram, row.phone, row.need_detected, row.recommended_service, row.notes, row.source, row.created_by, row.created_in_task]);
    return r.id;
  }
  async updateCompany(id: string, p: CompanyPatch) {
    await this.q(
      `update public.companies set
         website = coalesce($2, website), instagram = coalesce($3, instagram), phone = coalesce($4, phone),
         need_detected = coalesce($5, need_detected), recommended_service = coalesce($6, recommended_service),
         notes = coalesce($7, notes),
         source = (select string_agg(distinct s, ' | ') from unnest(string_to_array(source, ' | ') || $8::text[]) s)
       where id = $1`,
      [id, p.website ?? null, p.instagram ?? null, p.phone ?? null, p.need_detected ?? null, p.recommended_service ?? null, p.notes ?? null, p.addSources]);
  }
  missionCompanies(missionId: string, reuseIds: string[]) {
    return this.q<MissionCompany>(
      `select id, name, city, website, instagram, phone, need_detected, recommended_service, notes, source, created_by, created_in_task
         from public.companies
        where created_in_task in (select id from public.tasks where id = $1 or parent_task_id = $1) or id = any($2::uuid[])
        order by created_at`, [missionId, reuseIds]);
  }
  async pilotSettings() {
    const [r] = await this.q<{ value: Record<string, unknown> }>(`select value from public.settings where key = 'pilot'`);
    return r?.value ?? {};
  }
  async budgetSnapshot(missionId: string, taskId: string): Promise<BudgetSnapshot> {
    const [r] = await this.q<{ s: BudgetSnapshot }>(
      `with lim as (select value v from public.settings where key = 'limits'),
            pil as (select value v from public.settings where key = 'pilot'),
            mt as (select id from public.tasks where id = $1 or parent_task_id = $1),
            u as (select cost_usd, task_id, created_at from public.ai_usage),
            rs as (select estimate_usd, task_id, mission_id, status, created_at from public.ai_reservations)
       select jsonb_build_object(
         'limits', jsonb_build_object(
            'monthly', (select nullif(v ->> 'monthly_ai_budget_usd', '')::numeric from lim),
            'task', (select nullif(v ->> 'task_ai_budget_usd', '')::numeric from lim),
            'mission', (select nullif(v ->> 'mission_ai_budget_usd', '')::numeric from lim),
            'synthesisReserve', coalesce((select (v ->> 'synthesis_reserve_usd')::numeric from pil), 0)),
         'real', jsonb_build_object(
            'month', (select coalesce(sum(cost_usd), 0) from u where created_at >= date_trunc('month', now())),
            'mission', (select coalesce(sum(cost_usd), 0) from u where task_id in (select id from mt)),
            'task', (select coalesce(sum(cost_usd), 0) from u where task_id = $2)),
         'open', jsonb_build_object(
            'month', (select coalesce(sum(estimate_usd), 0) from rs where status = 'open' and created_at >= date_trunc('month', now())),
            'mission', (select coalesce(sum(estimate_usd), 0) from rs where status = 'open' and mission_id = $1),
            'task', (select coalesce(sum(estimate_usd), 0) from rs where status = 'open' and task_id = $2)),
         'uncertain', jsonb_build_object(
            'month', (select coalesce(sum(estimate_usd), 0) from rs where status = 'uncertain' and created_at >= date_trunc('month', now())),
            'mission', (select coalesce(sum(estimate_usd), 0) from rs where status = 'uncertain' and mission_id = $1),
            'task', (select coalesce(sum(estimate_usd), 0) from rs where status = 'uncertain' and task_id = $2))
       ) as s`, [missionId, taskId]);
    return numbers(r.s);
  }
  async createDocument(row: Parameters<EngineStore["createDocument"]>[0]) {
    const [r] = await this.q<{ id: string }>(
      `insert into public.documents (title, kind, content, task_id, run_id, agent_id, client_id, source, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [row.title, row.kind, row.content, row.task_id, row.run_id, row.agent_id, row.client_id, row.source, row.created_by]);
    return r.id;
  }
  async activity(runId: string, worker: string, status: AgentStatus, event: string, detail?: string) {
    await this.q(`select public.set_run_activity($1, $2, $3::agent_status, $4, $5)`, [runId, worker, status, event, detail ?? null]);
  }
  async reserve(runId: string, worker: string, model: string, estimateUsd: number, searches: number, leaseSeconds: number): Promise<Reservation> {
    const [r] = await this.q<{ r: Reservation }>(`select public.reserve_budget($1, $2, $3, $4, $5, $6) as r`, [runId, worker, model, estimateUsd, searches, leaseSeconds]);
    return r.r;
  }
  async recordCall(i: Parameters<EngineStore["recordCall"]>[0]): Promise<CallRecord> {
    const [r] = await this.q<{ r: CallRecord }>(
      `select public.record_call($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::agent_status) as r`,
      [i.runId, i.worker, i.reservationId, JSON.stringify(i.state), i.model, i.inputTokens, i.outputTokens, i.cacheReadTokens,
        i.cacheWriteTokens, i.serverToolRequests, i.claudeUsd, i.searchUsd, i.agentStatus]);
    return r.r;
  }
  async closeReservation(runId: string, reservationId: string, uncertain: boolean) {
    await this.q(`select public.close_reservation($1, $2, $3)`, [runId, reservationId, uncertain]);
  }
  async saveRunState(runId: string, worker: string, state: unknown, release: boolean) {
    await this.q(`select public.save_run_state($1, $2, $3, $4)`, [runId, worker, JSON.stringify(state), release]);
  }
  async deferRun(runId: string, worker: string, state: unknown, seconds: number, reason: string) {
    await this.q(`select public.defer_run($1, $2, $3, $4, $5)`, [runId, worker, JSON.stringify(state), seconds, reason]);
  }
  async pauseForApproval(runId: string, worker: string, state: unknown) {
    await this.q(`select public.pause_for_approval($1, $2, $3)`, [runId, worker, JSON.stringify(state)]);
  }
  async completeRun(runId: string, worker: string, result: string) {
    const [r] = await this.q<{ s: string }>(`select public.complete_run($1, $2, $3) as s`, [runId, worker, result]);
    return r.s;
  }
  async failRun(runId: string, worker: string, error: string, retryable: boolean) {
    const [r] = await this.q<{ s: string }>(`select public.fail_run($1, $2, $3, $4) as s`, [runId, worker, error, retryable]);
    return r.s;
  }
  async awaitSubtasks(runId: string, worker: string, summary: string) {
    await this.q(`select public.await_subtasks($1, $2, $3)`, [runId, worker, summary]);
  }
  async delegate(runId: string, worker: string, toolUseId: string, agent: string, title: string, description: string, dependsOn: string[]) {
    const [r] = await this.q<{ r: { task_id: string; duplicate: boolean } }>(
      `select public.delegate_task($1, $2, $3, $4, $5, $6, $7::uuid[]) as r`, [runId, worker, toolUseId, agent, title, description, dependsOn]);
    return r.r;
  }
  enginePort(runId: string, worker: string): EnginePort {
    const q = this.q;
    return {
      async requestApproval(i) {
        const [r] = await q<{ id: string }>(
          `select public.request_approval($1, $2, $3, $4, $5, $6, $7, $8) as id`,
          [runId, worker, i.toolUseId, i.toolId, i.risk, i.action, JSON.stringify(i.args), i.summary]);
        return r.id;
      },
      async approvalState(id) {
        const [r] = await q<{ status: string; decision_note: string | null }>(`select status::text as status, decision_note from public.approvals where id = $1`, [id]);
        return { state: (r?.status ?? "expired") as "pending" | "approved" | "rejected" | "expired", note: r?.decision_note ?? null };
      },
      async beginExecution(i) {
        const [r] = await q<{ r: Record<string, unknown> }>(
          `select public.begin_tool_execution($1, $2, $3, $4, $5, $6, $7) as r`,
          [runId, worker, i.toolUseId, i.toolId, i.action, JSON.stringify(i.args), i.approvalId ?? null]);
        return parseBegin(r.r);
      },
      async finishExecution(id, ok, result, providerRef) {
        await q(`select public.finish_tool_execution($1, $2, $3, $4, $5)`, [id, worker, ok, result, providerRef ?? null]);
      },
    };
  }
}

/** Los numeric de PostgreSQL llegan como texto: se convierten a número. */
export function numbers(s: BudgetSnapshot): BudgetSnapshot {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const scope = (o: Record<string, unknown>) => ({ month: Number(o.month ?? 0), mission: Number(o.mission ?? 0), task: Number(o.task ?? 0) });
  return {
    limits: { monthly: n(s.limits.monthly), task: n(s.limits.task), mission: n(s.limits.mission), synthesisReserve: Number(s.limits.synthesisReserve ?? 0) },
    real: scope(s.real as unknown as Record<string, unknown>),
    open: scope(s.open as unknown as Record<string, unknown>),
    uncertain: scope(s.uncertain as unknown as Record<string, unknown>),
  };
}
