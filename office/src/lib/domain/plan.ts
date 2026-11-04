// 0013 · Plan de misión en la interfaz (apto para el navegador): etiquetas,
// totales y qué decisiones se pueden tomar. La base de datos vuelve a
// comprobarlo todo (approve_mission_plan / reject_mission_plan).

export const MAX_PLAN_VERSIONS = 3;

export type PlanStatus = "pending" | "approved" | "rejected" | "changes_requested" | "superseded" | "expired";

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  pending: "Pendiente de tu decisión",
  approved: "Aprobado",
  rejected: "Rechazado",
  changes_requested: "Cambios pedidos",
  superseded: "Sustituido",
  expired: "Caducado",
};

export interface PlanStepView {
  key: string;
  agent: string;
  title: string;
  instructions: string;
  dependsOn: string[];
  tools: string[];
  budgetUsd: number;
  maxCalls: number;
  maxSearches: number;
  carried: boolean;
  taskId: string | null;
}

export interface PlanView {
  id: string;
  version: number;
  kind: "initial" | "amendment";
  summary: string;
  hash: string;
  estimateUsd: number;
  status: PlanStatus;
  expiresAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  steps: PlanStepView[];
}

/** Totales de los pasos que se ejecutarán si se aprueba (los copiados ya se ejecutaron). */
export function planTotals(plan: Pick<PlanView, "steps">) {
  const fresh = plan.steps.filter((s) => !s.carried);
  return {
    steps: fresh.length,
    budgetUsd: Math.round(fresh.reduce((a, s) => a + s.budgetUsd, 0) * 10_000) / 10_000,
    calls: fresh.reduce((a, s) => a + s.maxCalls, 0),
    searches: fresh.reduce((a, s) => a + s.maxSearches, 0),
  };
}

/** Qué puede decidir el administrador sobre esta versión. */
export function planDecisions(plan: Pick<PlanView, "status" | "version" | "expiresAt">, now = new Date()) {
  const open = plan.status === "pending" && Date.parse(plan.expiresAt) > now.getTime();
  return { approve: open, requestChanges: open && plan.version < MAX_PLAN_VERSIONS, reject: open };
}

export const PLAN_HASH = /^[0-9a-f]{64}$/;
