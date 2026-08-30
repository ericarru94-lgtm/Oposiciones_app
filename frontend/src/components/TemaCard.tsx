import { Link, useNavigate } from "react-router-dom";
import { ProgressBar } from "./ProgressBar";
import type { ProgresoPorTema } from "../api/types";

export function TemaCard({ tema }: { tema: ProgresoPorTema }) {
  const navigate = useNavigate();
  const cobertura = tema.totalPreguntas > 0 ? tema.preguntasContestadas / tema.totalPreguntas : 0;
  const dominado = cobertura >= 1 && (tema.precision ?? 0) >= 0.9;

  return (
    <div
      className={`w-full rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40 ${
        dominado ? "border-success/30" : "border-line"
      }`}
    >
      <button onClick={() => navigate(`/practicar/${tema.temaId}`)} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-ink">
            {dominado && <span aria-label="Tema dominado">🏆 </span>}
            Tema {tema.numero}. {tema.nombre}
          </p>
          {tema.precision !== null && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                tema.precision >= 0.7 ? "bg-success/10 text-success" : "bg-accent/10 text-accent"
              }`}
            >
              {Math.round(tema.precision * 100)}%
            </span>
          )}
        </div>
        <div className="mt-4">
          <ProgressBar valor={cobertura} />
          <p className="mt-2 text-xs text-muted">
            {tema.preguntasContestadas}/{tema.totalPreguntas} preguntas practicadas
          </p>
        </div>
      </button>
      <Link
        to={`/temas/${tema.temaId}/resumen`}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        📖 Ver resumen
      </Link>
    </div>
  );
}
