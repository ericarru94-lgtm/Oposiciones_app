// Acceso a datos del motor. Todas las operaciones de estado pasan por las
// funciones SQL del motor (leases, aprobaciones, idempotencia, presupuesto).
// Hay dos implementaciones: Supabase (producción, solo servidor) y SQL directo
// sobre PostgreSQL (pruebas con las migraciones reales).

import type { AgentStatus } from "../domain/status";
import type { BeginOutcome, EnginePort } from "./gateway";

export interface ClaimedRun {
  taskId: string;
  runId: string;
  agentId: string;
  attempt: number;
  resumed: boolean;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  agent_id: string | null;
  status: string;
  parent_task_id: string | null;
  client_id: string | null;
  input: { kind?: "mission" | "subtask"; phase?: "planning" | "synthesis"; round?: number } & Record<string, unknown>;
  result: string | null;
}

export interface RelatedTask {
  id: string;
  title: string;
  agent_id: string | null;
  status: string;
  result: string | null;
  error: string | null;
}

export interface DocumentSummary {
  id: string;
  title: string;
  kind: string;
  agent_id: string | null;
  task_id: string | null;
  content: string | null;
}

export interface CompanyRow {
  id: string;
  name: string;
  city: string | null;
  website: string | null;
  instagram: string | null;
  stage: string;
  need_detected: string | null;
  recommended_service: string | null;
  source: string;
  is_demo: boolean;
}

export interface StepRecord {
  continue: boolean;
  reason?: "monthly_budget" | "task_budget";
  budget_warning?: boolean;
}

export interface EngineStore {
  recoverStale(): Promise<void>;
  claim(worker: string, leaseSeconds: number, maxRunning: number): Promise<ClaimedRun | null>;
  loadRunState(runId: string): Promise<unknown>;
  getTask(taskId: string): Promise<TaskRow>;
  children(taskId: string): Promise<RelatedTask[]>;
  dependencies(taskId: string): Promise<RelatedTask[]>;
  documentsForTask(taskId: string): Promise<DocumentSummary[]>;
  documentsOfTasks(taskIds: string[]): Promise<DocumentSummary[]>;
  memoryForTask(taskId: string): Promise<{ scope: string; category: string; title: string; content: string; source: string }[]>;
  companies(limit: number): Promise<CompanyRow[]>;
  companiesCreatedBy(agentId: string, since: string): Promise<CompanyRow[]>;
  findCompany(name: string, city: string | null): Promise<CompanyRow | null>;
  insertCompany(row: Omit<CompanyRow, "id" | "stage" | "is_demo"> & { notes: string | null; phone: string | null; created_by: string }): Promise<string>;
  createDocument(row: {
    title: string; kind: string; content: string; task_id: string; run_id: string; agent_id: string;
    client_id: string | null; source: string; created_by: string;
  }): Promise<string>;

  activity(runId: string, worker: string, status: AgentStatus, event: "thinking" | "tool_executing" | "researching", detail?: string): Promise<void>;
  heartbeat(runId: string, worker: string): Promise<void>;
  recordStep(input: {
    runId: string; worker: string; state: unknown; model: string; inputTokens: number; outputTokens: number;
    cacheReadTokens: number; cacheWriteTokens: number; serverToolRequests: number; costUsd: number;
    agentStatus: AgentStatus; release: boolean;
  }): Promise<StepRecord>;
  pauseForApproval(runId: string, worker: string, state: unknown): Promise<void>;
  completeRun(runId: string, worker: string, result: string): Promise<string>;
  failRun(runId: string, worker: string, error: string, retryable: boolean): Promise<string>;
  awaitSubtasks(runId: string, worker: string, summary: string): Promise<void>;
  delegate(runId: string, worker: string, toolUseId: string, agent: string, title: string, description: string, dependsOn: string[]): Promise<{ task_id: string; duplicate: boolean }>;

  /** Puerto de aprobaciones/ejecuciones para la ToolGateway de una ejecución concreta. */
  enginePort(runId: string, worker: string): EnginePort;
}

export function parseBegin(raw: Record<string, unknown>): BeginOutcome {
  switch (raw.outcome) {
    case "started":
      return { outcome: "started", executionId: String(raw.execution_id) };
    case "replay":
      return { outcome: "replay", status: raw.status === "failed" ? "failed" : "succeeded", result: (raw.result as string) ?? null };
    case "uncertain":
      return { outcome: "uncertain" };
    default:
      return { outcome: "denied" };
  }
}
