"use client";

import { useActionState } from "react";
import { updateLimits, type LimitsState } from "@/app/actions/settings";
import type { LimitCeilings } from "@/lib/domain/limits";

const usd = (v: number) => `${v.toLocaleString("es-ES", { maximumFractionDigits: 2 })} $`;

export function LimitsForm({
  monthly,
  task,
  mission,
  ceilings,
  disabled,
}: {
  monthly: number | null;
  task: number | null;
  mission: number | null;
  /** Máximos aprobados, leídos de la base de datos (settings_ceilings). */
  ceilings: LimitCeilings | null;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<LimitsState, FormData>(updateLimits, { ok: false, message: null });
  const off = disabled || !ceilings;
  const input = "w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-cobalt invalid:border-signal";
  const fields = [
    { name: "monthly", label: "Mensual ($)", value: monthly, max: ceilings?.monthly_ai_budget_usd },
    { name: "task", label: "Por tarea ($)", value: task, max: ceilings?.task_ai_budget_usd },
    { name: "mission", label: "Por misión ($)", value: mission, max: ceilings?.mission_ai_budget_usd },
  ];
  return (
    <form action={action} className="mt-4 space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {fields.map((f) => (
          <label key={f.name} className="space-y-1 text-xs text-muted">
            {f.label}
            <input
              name={f.name}
              type="number"
              inputMode="decimal"
              required
              min={0}
              max={f.max}
              step={0.01}
              defaultValue={f.value ?? ""}
              disabled={off}
              className={input}
            />
            <span className="block">{f.max === undefined ? "Máximo no disponible" : `Máximo ${usd(f.max)}`}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted">
        Todos los límites son obligatorios. Puedes bajarlos; para subirlos por encima del máximo aprobado hace falta un
        cambio autorizado en la base de datos. La tarea y la misión no pueden superar el mensual.
      </p>
      <button
        type="submit"
        disabled={off || pending}
        className="rounded-lg bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-soft disabled:opacity-50"
      >
        {pending ? "Guardando…" : "Guardar límites"}
      </button>
      {state.message && (
        <p role="status" className={`text-xs ${state.ok ? "text-online" : "text-signal"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
