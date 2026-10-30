import { describe, expect, it } from "vitest";
import { agentStatusForTask, canTransitionTask, TASK_STATUSES } from "@/lib/domain/status";

const ctx = { requiresReview: false, reviewApproved: false, attempts: 0, maxAttempts: 2 };

describe("máquina de estados de tareas", () => {
  it("sigue el flujo normal", () => {
    expect(canTransitionTask("pending", "assigned", ctx).ok).toBe(true);
    expect(canTransitionTask("assigned", "in_progress", ctx).ok).toBe(true);
    expect(canTransitionTask("in_progress", "completed", ctx).ok).toBe(true);
  });

  it("no permite saltos inválidos ni reabrir tareas completadas", () => {
    expect(canTransitionTask("pending", "completed", ctx).ok).toBe(false);
    for (const to of TASK_STATUSES) expect(canTransitionTask("completed", to, ctx).ok).toBe(false);
  });

  it("exige control de calidad cuando la tarea lo requiere", () => {
    const review = { ...ctx, requiresReview: true };
    const r = canTransitionTask("in_progress", "completed", review);
    expect(r.ok).toBe(false);
    expect(canTransitionTask("in_review", "completed", { ...review, reviewApproved: true }).ok).toBe(true);
  });

  it("limita los reintentos", () => {
    expect(canTransitionTask("failed", "pending", { ...ctx, attempts: 1 }).ok).toBe(true);
    expect(canTransitionTask("failed", "pending", { ...ctx, attempts: 2 }).ok).toBe(false);
  });

  it("deriva el estado del agente de su tarea", () => {
    expect(agentStatusForTask(null)).toBe("available");
    expect(agentStatusForTask("in_progress")).toBe("working");
    expect(agentStatusForTask("needs_approval")).toBe("waiting_approval");
    expect(agentStatusForTask("failed")).toBe("error");
  });
});

import { missionPhase } from "@/lib/domain/mission-state";

describe("estado visible de una misión", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const task = (o: Partial<Parameters<typeof missionPhase>[0]> = {}) => ({ status: "assigned", lockedUntil: null, runAfter: null, heartbeatAt: null, error: null, ...o });
  it("trabajando solo si hay un lease vigente; si no, lista para reanudar o reintento programado", () => {
    expect(missionPhase(task({ status: "in_progress", lockedUntil: "2026-10-30T12:03:00Z" }), [], now).kind).toBe("working");
    expect(missionPhase(task({ status: "in_progress", lockedUntil: "2026-10-30T11:59:00Z" }), [], now).kind).toBe("ready");
    expect(missionPhase(task({ status: "in_progress", runAfter: "2026-10-30T12:01:00Z" }), [], now)).toEqual({ kind: "retry", at: "2026-10-30T12:01:00Z" });
    expect(missionPhase(task(), [task({ status: "completed" }), task()], now).kind).toBe("ready");
    expect(missionPhase(task({ status: "failed", error: "Detenida" }), [], now)).toEqual({ kind: "stopped", reason: "Detenida" });
    expect(missionPhase(task({ status: "completed" }), [], now).kind).toBe("completed");
  });
});
