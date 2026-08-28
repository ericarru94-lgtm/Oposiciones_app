import { useState } from "react";
import { TemaCard } from "./TemaCard";
import type { ProgresoPorTema } from "../api/types";

/** Bloque de temas colapsable: cerrado por defecto, con el % global del bloque en la cabecera. */
export function BloqueDesplegable({ titulo, temas }: { titulo: string; temas: ProgresoPorTema[] }) {
  const [abierto, setAbierto] = useState(false);

  const totalPreguntas = temas.reduce((suma, t) => suma + t.totalPreguntas, 0);
  const totalContestadas = temas.reduce((suma, t) => suma + t.preguntasContestadas, 0);
  const cobertura = totalPreguntas > 0 ? Math.round((totalContestadas / totalPreguntas) * 100) : 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <button
        onClick={() => setAbierto((valor) => !valor)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-3 p-5 text-left"
      >
        <span className="text-sm font-semibold uppercase tracking-wide text-muted">{titulo}</span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            {cobertura}%
          </span>
          <span className={`text-muted transition-transform ${abierto ? "rotate-180" : ""}`}>▾</span>
        </span>
      </button>
      {abierto && (
        <div className="grid grid-cols-1 gap-4 border-t border-line p-5 sm:grid-cols-2">
          {temas.map((tema) => (
            <TemaCard key={tema.temaId} tema={tema} />
          ))}
        </div>
      )}
    </div>
  );
}
