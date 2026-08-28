import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { obtenerProgresoPorTema, obtenerResumenProgreso } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import { AppLayout } from "../components/AppLayout";
import { RachaBadge } from "../components/RachaBadge";
import { BloqueDesplegable } from "../components/BloqueDesplegable";
import type { ProgresoPorTema, ProgresoResumen } from "../api/types";

export function Home() {
  const { getToken } = useSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [temas, setTemas] = useState<ProgresoPorTema[] | null>(null);
  const [resumen, setResumen] = useState<ProgresoResumen | null>(null);
  const pagoCompletado = searchParams.get("checkout") === "success";

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const token = await getToken();
      if (!token) return;
      const [porTema, resumen] = await Promise.all([obtenerProgresoPorTema(token), obtenerResumenProgreso(token)]);
      if (cancelado) return;
      setTemas(porTema.temas);
      setResumen(resumen);
    })();
    return () => {
      cancelado = true;
    };
  }, [getToken]);

  const bloqueI = temas?.filter((t) => t.bloque === "I") ?? [];
  const bloqueII = temas?.filter((t) => t.bloque === "II") ?? [];

  return (
    <AppLayout>
      {pagoCompletado && (
        <div className="mb-6 flex items-center justify-between rounded-xl bg-success/10 px-4 py-3 text-sm text-success">
          <span>¡Pago completado! Tu cuenta pasará a premium en unos segundos.</span>
          <button onClick={() => setSearchParams({}, { replace: true })} className="ml-4 hover:opacity-70">
            Cerrar
          </button>
        </div>
      )}

      <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-medium text-muted">Tu progreso</p>
          {resumen && (
            <p className="text-sm text-muted">
              {resumen.totalIntentos} preguntas ·{" "}
              {resumen.precision !== null ? `${Math.round(resumen.precision * 100)}% de acierto` : "sin datos aún"}
            </p>
          )}
        </div>
        {resumen && <RachaBadge dias={resumen.racha.dias} />}
      </div>

      {/* Foco principal de la pantalla: siempre lo primero y lo más grande. */}
      <button
        onClick={() => navigate("/repasar-hoy")}
        className="mb-12 w-full rounded-3xl bg-primary p-8 text-left text-white transition-colors hover:bg-primary-hover"
      >
        <p className="text-2xl font-bold">Repasar hoy</p>
        <p className="mt-2 text-base text-white/80">
          {resumen && resumen.pendientesHoy > 0
            ? `${resumen.pendientesHoy} preguntas listas para repasar por repetición espaciada`
            : "Practica preguntas nuevas priorizadas para ti"}
        </p>
        {resumen && resumen.pendientesHoy > 0 && (
          <span className="mt-5 inline-block rounded-full bg-accent px-3 py-1 text-sm font-semibold text-white">
            {resumen.pendientesHoy} pendientes
          </span>
        )}
      </button>

      {!temas && <p className="text-sm text-muted">Cargando temas…</p>}

      {temas && (
        <div className="space-y-4">
          <BloqueDesplegable titulo="Bloque I · Materias comunes" icono="📘" temas={bloqueI} />
          <BloqueDesplegable titulo="Bloque II · Materias específicas" icono="💻" temas={bloqueII} />
        </div>
      )}
    </AppLayout>
  );
}
