"use client";

import { useActionState } from "react";
import { cancelMission, type CancelState } from "@/app/actions/mission-control";

export function CancelForm({ missionId }: { missionId: string }) {
  const [state, action, pending] = useActionState<CancelState, FormData>(cancelMission, { message: null });
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("¿Detener la misión? Las subtareas se cancelan y no se puede reanudar.")) e.preventDefault();
      }}
      className="flex flex-wrap items-center gap-3"
    >
      <input type="hidden" name="missionId" value={missionId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-signal/60 px-3 py-1.5 text-xs text-signal hover:bg-signal/10 disabled:opacity-50"
      >
        {pending ? "Deteniendo…" : "Detener misión"}
      </button>
      {state.message && <p role="status" className="text-xs text-muted">{state.message}</p>}
    </form>
  );
}
