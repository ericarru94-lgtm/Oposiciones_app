"use client";

import { useActionState } from "react";
import { updateLimits, type LimitsState } from "@/app/actions/settings";

export function LimitsForm({
  monthly,
  task,
  disabled,
}: {
  monthly: number | null;
  task: number | null;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<LimitsState, FormData>(updateLimits, { ok: false, message: null });
  const input = "w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-cobalt";
  return (
    <form action={action} className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-muted">
          Mensual ($)
          <input name="monthly" inputMode="decimal" defaultValue={monthly ?? ""} placeholder="Sin límite" disabled={disabled} className={input} />
        </label>
        <label className="space-y-1 text-xs text-muted">
          Por tarea ($)
          <input name="task" inputMode="decimal" defaultValue={task ?? ""} placeholder="Sin límite" disabled={disabled} className={input} />
        </label>
      </div>
      <button
        type="submit"
        disabled={disabled || pending}
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
