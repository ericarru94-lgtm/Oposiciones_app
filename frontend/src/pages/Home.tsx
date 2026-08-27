import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { obtenerProgresoPorTema, obtenerResumenProgreso } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import { AppLayout } from "../components/AppLayout";
import { RachaBadge } from "../components/RachaBadge";
import { TemaCard } from "../components/TemaCard";
import type { ProgresoPorTema, ProgresoResumen } from "../api/types";

export function Home() {
  const { token } = useSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [temas, setTemas] = useState<ProgresoPorTema[] | null>(null);
  const [resumen, setResumen] = useState<ProgresoResumen | null>(null);
  const pagoCompletado = searchParams.get("checkout") === "success";

  useEffect(() => {
    if (!token) return;
    Promise.all([obtenerProgresoPorTema(token), obtenerResumenProgreso(token)]).then(([porTema, resumen]) => {
      setTemas(porTema.temas);
      setResumen(resumen);
    });
  }, [token]);

  const bloqueI = temas?.filter((t) => t.bloque === "I") ?? [];
  const bloqueII = temas?.filter((t) => t.bloque === "II") ?? [];

  return (
    <AppLayout>
      {pagoCompletado && (
        <div className="mb-6 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>¡Pago completado! Tu cuenta pasará a premium en unos segundos.</span>
          <button
            onClick={() => setSearchParams({}, { replace: true })}
            className="ml-4 text-emerald-600 hover:text-emerald-800"
          >
            Cerrar
          </button>
        </div>
      )}
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tu progreso</h1>
          {resumen && (
            <p className="mt-1 text-sm text-slate-500">
              {resumen.totalIntentos} preguntas respondidas ·{" "}
              {resumen.precision !== null ? `${Math.round(resumen.precision * 100)}% de acierto` : "sin datos aún"}
            </p>
          )}
        </div>
        {resumen && <RachaBadge dias={resumen.racha.dias} />}
      </div>

      <button
        onClick={() => navigate("/repasar-hoy")}
        className="mb-8 w-full rounded-2xl bg-indigo-600 p-6 text-left text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
      >
        <p className="text-lg font-semibold">Repasar hoy</p>
        <p className="mt-1 text-sm text-indigo-100">
          {resumen && resumen.pendientesHoy > 0
            ? `${resumen.pendientesHoy} preguntas listas para repasar por repetición espaciada`
            : "Practica preguntas nuevas priorizadas para ti"}
        </p>
      </button>

      {!temas && <p className="text-slate-400">Cargando temas…</p>}

      {temas && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Bloque I · Materias comunes
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {bloqueI.map((tema) => (
                <TemaCard key={tema.temaId} tema={tema} />
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Bloque II · Materias específicas
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {bloqueII.map((tema) => (
                <TemaCard key={tema.temaId} tema={tema} />
              ))}
            </div>
          </section>
        </div>
      )}
    </AppLayout>
  );
}
