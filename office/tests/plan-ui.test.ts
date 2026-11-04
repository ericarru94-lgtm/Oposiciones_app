// Fase 5.2.1 · Reglas del plan en la interfaz (apto para el navegador). La base
// de datos vuelve a comprobarlo todo; aquí solo se decide qué botones se ven.
import { describe, expect, it } from "vitest";
import { missionPhase } from "@/lib/domain/mission-state";
import { MAX_PLAN_VERSIONS, planDecisions, planTotals, type PlanStepView } from "@/lib/domain/plan";

const step = (o: Partial<PlanStepView>): PlanStepView => ({
  key: "k", agent: "marcus", title: "t", instructions: "i", dependsOn: [], tools: [], budgetUsd: 0.1, maxCalls: 2, maxSearches: 1, carried: false, taskId: null, ...o,
});
const now = new Date("2026-11-04T10:00:00Z");
const later = "2026-11-06T10:00:00Z";

describe("plan en la interfaz", () => {
  it("los totales solo cuentan los pasos nuevos (los aprobados antes ya se ejecutaron)", () => {
    expect(planTotals({ steps: [step({ budgetUsd: 0.45, maxCalls: 4, maxSearches: 3 }), step({ budgetUsd: 0.2, maxCalls: 3, maxSearches: 0 }), step({ carried: true, budgetUsd: 0.5 })] }))
      .toEqual({ steps: 2, budgetUsd: 0.65, calls: 7, searches: 3 });
  });

  it("decisiones: pendiente y vigente; en la versión 3 no se pueden pedir más cambios; caducado o decidido, nada", () => {
    expect(planDecisions({ status: "pending", version: 1, expiresAt: later }, now)).toEqual({ approve: true, requestChanges: true, reject: true });
    expect(planDecisions({ status: "pending", version: MAX_PLAN_VERSIONS, expiresAt: later }, now)).toEqual({ approve: true, requestChanges: false, reject: true });
    expect(planDecisions({ status: "pending", version: 1, expiresAt: "2026-11-04T09:59:00Z" }, now)).toEqual({ approve: false, requestChanges: false, reject: false });
    for (const s of ["approved", "rejected", "changes_requested", "superseded", "expired"] as const) {
      expect(planDecisions({ status: s, version: 1, expiresAt: later }, now).approve).toBe(false);
    }
  });

  it("estado visible: con el plan pendiente nadie trabaja y la página no pide pasadas", () => {
    const base = { lockedUntil: null, runAfter: null, heartbeatAt: null, error: null };
    expect(missionPhase({ ...base, status: "needs_approval", phase: "plan_review" }, [], now)).toEqual({ kind: "plan_review" });
    expect(missionPhase({ ...base, status: "needs_approval", phase: "synthesis" }, [], now).kind).toBe("waiting");
  });
});
