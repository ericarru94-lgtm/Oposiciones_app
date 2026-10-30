// EngineStore sobre SQL directo (rol service_role). Se usa en las pruebas
// contra PostgreSQL con las migraciones reales; las consultas son las mismas
// que hace la implementación de Supabase.

import type { AgentStatus } from "../domain/status";
import type { EnginePort } from "./gateway";
import { parseBegin, type ClaimedRun, type CompanyRow, type DocumentSummary, type EngineStore, type RelatedTask, type StepRecord, type TaskRow } from "./store";

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
      `insert into public.companies (name, city, website, instagram, phone, need_detected, recommended_service, notes, source, created_by, stage)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'researched') returning id`,
      [row.name, row.city, row.website, row.instagram, row.phone, row.need_detected, row.recommended_service, row.notes, row.source, row.created_by]);
    return r.id;
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
  async heartbeat(runId: string, worker: string) {
    await this.q(`select public.heartbeat_run($1, $2, 240)`, [runId, worker]);
  }
  async recordStep(i: Parameters<EngineStore["recordStep"]>[0]): Promise<StepRecord> {
    const [r] = await this.q<{ r: StepRecord }>(
      `select public.record_step($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::agent_status, $12) as r`,
      [i.runId, i.worker, JSON.stringify(i.state), i.model, i.inputTokens, i.outputTokens, i.cacheReadTokens,
        i.cacheWriteTokens, i.serverToolRequests, i.costUsd, i.agentStatus, i.release]);
    return r.r;
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
