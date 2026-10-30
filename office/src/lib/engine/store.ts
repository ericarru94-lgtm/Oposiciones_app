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
  /** Resultado declarado (outcome, objetivos completados y pendientes, avisos). */
  result_data?: Record<string, unknown> | null;
}

export interface DocumentSummary {
  id: string;
  title: string;
  kind: string;
  agent_id: string | null;
  task_id: string | null;
  content: string | null;
  version?: number | null;
  updated_at?: string | null;
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

/** Ficha del CRM tal como la reciben Alex y Sofia (sin recortar lo verificado ni lo pendiente). */
export interface MissionCompany {
  id: string;
  name: string;
  city: string | null;
  website: string | null;
  instagram: string | null;
  phone: string | null;
  need_detected: string | null;
  recommended_service: string | null;
  notes: string | null;
  source: string;
  created_by: string;
  created_in_task: string | null;
  updated_at?: string | null;
}

/** Dato de una ficha con su procedencia (vista company_facts_current). */
export interface CompanyFact {
  id: string;
  company_id: string;
  fact_key: string;
  fact_value: string;
  source_url: string | null;
  source_type: string;
  source_date: string | null;
  observed_at: string;
  verification_status: string;
  confidence_score: number;
  confidence_reason: string;
  in_contradiction: boolean;
}

export interface FactInput {
  key: string;
  value: string;
  source_url: string | null;
  source_type: string;
  verification_status: string;
  source_date: string | null;
  lower_score_to: number | null;
  score_reason: string | null;
  supersedes_fact_id: string | null;
}

export interface CompanyPatch {
  website?: string;
  instagram?: string;
  phone?: string;
  need_detected?: string;
  recommended_service?: string;
  notes?: string;
  /** Fuentes nuevas: se AÑADEN a las existentes, nunca se sustituyen. */
  addSources: string[];
}

/** Situación del presupuesto para explicar una parada con cifras. */
export interface BudgetSnapshot {
  limits: { monthly: number | null; task: number | null; mission: number | null; synthesisReserve: number };
  real: { month: number; mission: number; task: number };
  open: { month: number; mission: number; task: number };
  uncertain: { month: number; mission: number; task: number };
}

export type Reservation =
  | { ok: true; reservation_id: string; searches: number }
  | { ok: false; reason: "uncertain" | "monthly_budget" | "mission_budget" | "task_budget" };

export interface CallRecord {
  continue: boolean;
  reason?: "lease_lost" | "cost_overrun";
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
  insertCompany(row: Omit<CompanyRow, "id" | "stage" | "is_demo"> & { notes: string | null; phone: string | null; created_by: string; created_in_task: string }): Promise<string>;
  updateCompany(id: string, patch: CompanyPatch): Promise<void>;
  /** Fichas de la misión: creadas en ella (aunque la subtarea fallara) + reutilizadas. */
  missionCompanies(missionId: string, reuseIds: string[]): Promise<MissionCompany[]>;
  /** Ajustes del piloto (tope de empresas…). */
  pilotSettings(): Promise<{ max_companies?: number } & Record<string, unknown>>;
  budgetSnapshot(missionId: string, taskId: string): Promise<BudgetSnapshot>;
  createDocument(row: {
    title: string; kind: string; content: string; task_id: string; run_id: string; agent_id: string;
    client_id: string | null; source: string; created_by: string;
  }): Promise<string>;

  activity(runId: string, worker: string, status: AgentStatus, event: "thinking" | "tool_executing" | "researching", detail?: string): Promise<void>;
  /** Reserva atómica antes de llamar a Claude; renueva el lease. */
  reserve(runId: string, worker: string, model: string, estimateUsd: number, searches: number, leaseSeconds: number): Promise<Reservation>;
  /** Coste real de la llamada (siempre se guarda) y estado (si se conserva el lease). */
  recordCall(input: {
    runId: string; worker: string; reservationId: string; state: unknown; model: string; inputTokens: number;
    outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; serverToolRequests: number;
    claudeUsd: number; searchUsd: number; agentStatus: AgentStatus;
  }): Promise<CallRecord>;
  closeReservation(runId: string, reservationId: string, uncertain: boolean): Promise<void>;
  saveRunState(runId: string, worker: string, state: unknown, release: boolean): Promise<void>;
  deferRun(runId: string, worker: string, state: unknown, seconds: number, reason: string): Promise<void>;
  pauseForApproval(runId: string, worker: string, state: unknown): Promise<void>;
  completeRun(runId: string, worker: string, result: string, resultData?: Record<string, unknown> | null): Promise<string>;
  /** Hechos con procedencia: registro inmutable, confianza calculada por la base de datos. */
  recordFact(runId: string, worker: string, companyId: string, fact: FactInput): Promise<{ fact_id: string; confidence_score: number; contradicts: string[] }>;
  companyFacts(companyIds: string[]): Promise<CompanyFact[]>;
  /** Entregas: preparadas al construir el mensaje, enviadas y recibidas según la llamada. */
  recordDeliveries(missionId: string, taskId: string, runId: string, rows: import("./coordination").DeliveryRow[]): Promise<void>;
  runHasDeliveries(runId: string): Promise<boolean>;
  advanceDeliveries(runId: string, worker: string, status: "sent" | "received"): Promise<void>;
  missionDeliveries(missionId: string): Promise<import("./coordination").DeliveryRecord[]>;
  addDependency(taskId: string, dependsOn: string): Promise<void>;
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
