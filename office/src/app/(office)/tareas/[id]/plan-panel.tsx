"use client";

import { useActionState, useState } from "react";
import { decidePlan, type PlanDecisionState } from "@/app/actions/plans";
import { MAX_PLAN_VERSIONS, PLAN_STATUS_LABEL, planDecisions, planTotals, type PlanView } from "@/lib/domain/plan";

const usd = (v: number) => `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const AGENT: Record<string, string> = { marcus: "Marcus", sofia: "Sofia", alex: "Alex" };

function Steps({ plan }: { plan: PlanView }) {
  return (
    <ol className="mt-3 space-y-2">
      {plan.steps.map((s) => (
        <li key={s.key} className={`rounded-lg border p-3 text-sm ${s.carried ? "border-line/60 opacity-70" : "border-line bg-ink"}`}>
          <p className="font-medium">
            {AGENT[s.agent] ?? s.agent} · {s.title}
            {s.carried && <span className="ml-2 text-xs text-muted">(aprobado antes, no cambia)</span>}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted">{s.instructions}</p>
          <p className="mt-2 text-xs">
            Máximo {usd(s.budgetUsd)} · {s.maxCalls} llamadas · {s.maxSearches} búsquedas
            {s.dependsOn.length > 0 && <> · espera a {s.dependsOn.map((k) => `«${k}»`).join(", ")}</>}
          </p>
          <p className="mt-1 break-words text-xs text-muted">Herramientas: {s.tools.length ? s.tools.join(", ") : "ninguna"} · clave «{s.key}»</p>
        </li>
      ))}
    </ol>
  );
}

function Decide({ missionId, plan }: { missionId: string; plan: PlanView }) {
  const [state, action, pending] = useActionState<PlanDecisionState, FormData>(decidePlan, { message: null });
  const [mode, setMode] = useState<"approve" | "changes" | "reject" | null>(null);
  const can = planDecisions(plan);
  const totals = planTotals(plan);
  if (state.ok) return <p role="status" className="mt-4 text-sm text-online">{state.message}</p>;
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const text = mode === "approve"
          ? `¿Aprobar el plan v${plan.version}? Se ejecutarán ${totals.steps} paso(s) con un máximo de ${usd(totals.budgetUsd)}.`
          : mode === "reject" ? "¿Rechazar el plan? La misión se cancela definitivamente." : null;
        if (text && !confirm(text)) e.preventDefault();
      }}
      className="mt-4 space-y-3"
    >
      <input type="hidden" name="missionId" value={missionId} />
      <input type="hidden" name="planId" value={plan.id} />
      <input type="hidden" name="version" value={plan.version} />
      <input type="hidden" name="hash" value={plan.hash} />
      <input type="hidden" name="decision" value={mode ?? ""} />
      {(mode === "changes" || mode === "reject") && (
        <label className="block text-xs text-muted">
          {mode === "changes" ? "¿Qué debe cambiar Alex?" : "Motivo del rechazo"}
          <textarea name="reason" required minLength={3} maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-line bg-ink p-2 text-sm text-foreground" />
        </label>
      )}
      {mode === "approve" && (
        <label className="block text-xs text-muted">
          Nota (opcional)
          <input name="note" maxLength={2000} className="mt-1 w-full rounded-lg border border-line bg-ink p-2 text-sm text-foreground" />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {can.approve && (
          <button type={mode === "approve" ? "submit" : "button"} disabled={pending} onClick={mode === "approve" ? undefined : () => setMode("approve")}
            className="rounded-lg bg-online/20 px-3 py-2 text-sm text-online ring-1 ring-online/40 hover:bg-online/30 disabled:opacity-50">
            {mode === "approve" ? (pending ? "Aprobando…" : "Confirmar aprobación") : "Aprobar"}
          </button>
        )}
        {can.requestChanges && (
          <button type={mode === "changes" ? "submit" : "button"} disabled={pending} onClick={mode === "changes" ? undefined : () => setMode("changes")}
            className="rounded-lg border border-warn/50 px-3 py-2 text-sm text-warn hover:bg-warn/10 disabled:opacity-50">
            {mode === "changes" ? (pending ? "Enviando…" : "Enviar cambios a Alex") : "Pedir cambios"}
          </button>
        )}
        {can.reject && (
          <button type={mode === "reject" ? "submit" : "button"} disabled={pending} onClick={mode === "reject" ? undefined : () => setMode("reject")}
            className="rounded-lg border border-signal/60 px-3 py-2 text-sm text-signal hover:bg-signal/10 disabled:opacity-50">
            {mode === "reject" ? (pending ? "Rechazando…" : "Confirmar rechazo") : "Rechazar"}
          </button>
        )}
        {mode && <button type="button" onClick={() => setMode(null)} className="px-2 text-xs text-muted underline">Cancelar</button>}
      </div>
      {!can.requestChanges && can.approve && (
        <p className="text-xs text-muted">Es la versión {MAX_PLAN_VERSIONS} (el máximo): solo puedes aprobarla o rechazarla.</p>
      )}
      {state.message && <p role="status" className="text-xs text-signal">{state.message}</p>}
    </form>
  );
}

export function PlanPanel({ missionId, plans, missionStopped }: { missionId: string; plans: PlanView[]; missionStopped: boolean }) {
  const current = plans.find((p) => p.status === "pending") ?? plans.filter((p) => p.status === "approved").at(-1) ?? plans.at(-1);
  const history = plans.filter((p) => p !== current).reverse();
  if (!current) {
    return (
      <section className="rounded-2xl bg-surface/80 ring-1 ring-white/5 p-5">
        <h2 className="font-display font-semibold">Plan de la misión</h2>
        <p className="mt-2 text-sm text-muted">Alex todavía no ha propuesto un plan. Nada se ejecuta hasta que lo apruebes.</p>
      </section>
    );
  }
  const totals = planTotals(current);
  const expired = current.status === "pending" && Date.parse(current.expiresAt) <= Date.now();
  return (
    <section className={`rounded-2xl p-5 ring-1 ${current.status === "pending" ? "bg-warn/5 ring-warn/40" : "bg-surface/80 ring-white/5"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display font-semibold">
          Plan v{current.version} {current.kind === "amendment" ? "· ampliación" : ""}
        </h2>
        <p className="text-xs text-muted">{expired ? "Caducado (72 h sin decisión)" : PLAN_STATUS_LABEL[current.status]}</p>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{current.summary}</p>
      <p className="mt-2 text-xs">
        {current.kind === "amendment" ? "Pasos nuevos" : "Pasos"}: {totals.steps} · presupuesto máximo {usd(totals.budgetUsd)} · hasta {totals.calls} llamadas · {totals.searches} búsquedas
      </p>
      {current.status === "pending" && (
        <p className="mt-1 text-xs text-muted">
          Propuesto {when(current.createdAt)} · caduca {when(current.expiresAt)} · huella {current.hash.slice(0, 12)}…
        </p>
      )}
      {current.decisionNote && <p className="mt-1 text-xs text-muted">Nota: {current.decisionNote}</p>}
      <Steps plan={current} />
      {current.status === "pending" && !expired && !missionStopped && <Decide missionId={missionId} plan={current} />}
      {history.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-muted">Versiones anteriores ({history.length})</summary>
          <ul className="mt-2 space-y-2 text-xs">
            {history.map((p) => (
              <li key={p.id} className="rounded-lg border border-line p-2">
                v{p.version} · {PLAN_STATUS_LABEL[p.status]} · {when(p.decidedAt ?? p.createdAt)}
                {p.decisionNote && <> · «{p.decisionNote}»</>}
                <details className="mt-1"><summary className="cursor-pointer text-muted">Ver pasos</summary><Steps plan={p} /></details>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
