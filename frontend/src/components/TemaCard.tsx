import { useNavigate } from "react-router-dom";
import { ProgressBar } from "./ProgressBar";
import type { ProgresoPorTema } from "../api/types";

export function TemaCard({ tema }: { tema: ProgresoPorTema }) {
  const navigate = useNavigate();
  const cobertura = tema.totalPreguntas > 0 ? tema.preguntasContestadas / tema.totalPreguntas : 0;

  return (
    <button
      onClick={() => navigate(`/practicar/${tema.temaId}`)}
      className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-indigo-300"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">
          Tema {tema.numero}. {tema.nombre}
        </p>
        {tema.precision !== null && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
              tema.precision >= 0.7 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {Math.round(tema.precision * 100)}%
          </span>
        )}
      </div>
      <div className="mt-3">
        <ProgressBar valor={cobertura} />
        <p className="mt-1 text-xs text-slate-400">
          {tema.preguntasContestadas}/{tema.totalPreguntas} preguntas practicadas
        </p>
      </div>
    </button>
  );
}
