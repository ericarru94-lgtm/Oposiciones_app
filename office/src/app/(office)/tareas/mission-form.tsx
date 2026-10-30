"use client";

import { useActionState, useRef, useState } from "react";
import { createMission, type MissionState } from "@/app/actions/missions";

// Primera misión del piloto, tal como la definió el administrador.
const PILOT_MISSION = {
  title: "Estudio comercial: gimnasios y centros deportivos en Barcelona",
  description:
    "Preparar un estudio comercial para captar gimnasios y centros deportivos como clientes de HE Signal Agency en Barcelona. Marcus debe identificar gimnasios reales, investigar su presencia digital, detectar posibles oportunidades de mejora y preparar una ficha comercial individual de cada empresa con sus fuentes verificables. Sofia debe analizar las oportunidades encontradas y preparar una estrategia de captación para HE Signal Agency, incluyendo una propuesta de servicios de automatización e inteligencia artificial, acciones comerciales, ideas de campañas y presupuesto estimado. Alex debe coordinar ambos trabajos, revisar los resultados y entregar un informe final priorizado con las mejores oportunidades comerciales y un plan de actuación. Todo debe quedar en borrador. No se debe contactar con ninguna empresa ni ejecutar ninguna campaña.",
};

export function MissionForm({ disabled, reason }: { disabled: boolean; reason: string | null }) {
  const [state, action, pending] = useActionState<MissionState, FormData>(createMission, { message: null });
  const [nonce] = useState(() => crypto.randomUUID());
  const title = useRef<HTMLInputElement>(null);
  const description = useRef<HTMLTextAreaElement>(null);
  const input = "w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-cobalt";

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="nonce" value={nonce} />
      <label className="block space-y-1 text-xs text-muted">
        Título
        <input ref={title} name="title" required maxLength={200} disabled={disabled} className={input} />
      </label>
      <label className="block space-y-1 text-xs text-muted">
        Encargo para Alex
        <textarea ref={description} name="description" required rows={6} maxLength={8000} disabled={disabled} className={input} />
      </label>
      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" name="reuse" defaultChecked disabled={disabled} className="mt-0.5" />
        <span>
          Reutilizar las fichas ya investigadas del CRM (máx. 5). Marcus solo completará lo pendiente y no creará duplicados.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={disabled || pending}
          className="rounded-lg bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-soft disabled:opacity-50"
        >
          {pending ? "Creando…" : "Crear encargo"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (title.current) title.current.value = PILOT_MISSION.title;
            if (description.current) description.current.value = PILOT_MISSION.description;
          }}
          className="text-xs text-cobalt-soft underline-offset-2 hover:underline disabled:opacity-50"
        >
          Rellenar con la misión del piloto
        </button>
      </div>
      {(state.message || reason) && <p role="status" className="text-xs text-signal">{state.message ?? reason}</p>}
    </form>
  );
}
