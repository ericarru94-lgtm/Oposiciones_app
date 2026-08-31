import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { obtenerEvolucion, obtenerProgresoPorTema, obtenerResumenProgreso } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import { AppLayout } from "../components/AppLayout";
import { AvisoRecordatorioPush } from "../components/AvisoRecordatorioPush";
import { BloqueDesplegable } from "../components/BloqueDesplegable";
import { ProgressBar } from "../components/ProgressBar";
import { EvolucionChart } from "../components/EvolucionChart";
import type { Bloque, EvolucionDia, ProgresoPorTema, ProgresoResumen } from "../api/types";

export function Home() {
  const { getToken } = useSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [temas, setTemas] = useState<ProgresoPorTema[] | null>(null);
  const [resumen, setResumen] = useState<ProgresoResumen | null>(null);
  const [evolucion, setEvolucion] = useState<EvolucionDia[] | null>(null);
  const pagoCompletado = searchParams.get("checkout") === "success";

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const token = await getToken();
      if (!token) return;
      const [porTema, resumen, evolucion] = await Promise.all([
        obtenerProgresoPorTema(token),
        obtenerResumenProgreso(token),
        obtenerEvolucion(token, 14),
      ]);
      if (cancelado) return;
      setTemas(porTema.temas);
      setResumen(resumen);
      setEvolucion(evolucion.serie);
    })();
    return () => {
      cancelado = true;
    };
  }, [getToken]);

  const bloqueI = temas?.filter((t) => t.bloque === "I") ?? [];
  const bloqueII = temas?.filter((t) => t.bloque === "II") ?? [];

  // Punto débil del momento: el tema con peor % de acierto entre los ya practicados.
  const puntoDebil = (temas ?? [])
    .filter((t) => t.totalIntentos > 0)
    .sort((a, b) => (a.precision ?? 1) - (b.precision ?? 1))[0];

  // Próximo hito: el bloque más cerca de completarse (menos preguntas le faltan), si queda alguno por completar.
  const hitos: Array<{ bloque: Bloque; total: number; contestadas: number; restantes: number }> = (["I", "II"] as const)
    .map((bloque) => {
      const ts = (temas ?? []).filter((t) => t.bloque === bloque);
      const total = ts.reduce((s, t) => s + t.totalPreguntas, 0);
      const contestadas = ts.reduce((s, t) => s + Math.min(t.preguntasContestadas, t.totalPreguntas), 0);
      return { bloque, total, contestadas, restantes: total - contestadas };
    })
    .filter((h) => h.total > 0);
  const proximoHito = hitos.filter((h) => h.restantes > 0).sort((a, b) => a.restantes - b.restantes)[0];
  const todoCompletado = temas !== null && hitos.length > 0 && !proximoHito;

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

      {resumen && <AvisoRecordatorioPush diasRacha={resumen.racha.dias} />}

      {/* Racha: tarjeta compacta (icono + número + texto en una fila), no un bloque de pantalla completa. */}
      {resumen && (
        <div className="mb-6 flex items-center gap-4 rounded-2xl border border-accent/30 bg-accent/10 px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/20 text-2xl">
            🔥
          </span>
          <div className="flex items-baseline gap-2">
            <p className="text-lg font-bold text-ink">
              {resumen.racha.dias} {resumen.racha.dias === 1 ? "día" : "días"}
            </p>
            <p className="text-sm text-muted">de racha seguidos</p>
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {puntoDebil && (
          <div className="rounded-2xl border border-accent/30 bg-accent/5 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">⚠️ Punto débil del momento</p>
            <p className="mt-2 text-base font-bold text-ink">
              Tema {puntoDebil.numero}. {puntoDebil.nombre}
            </p>
            <p className="mt-1 text-sm text-muted">{Math.round((puntoDebil.precision ?? 0) * 100)}% de acierto</p>
            <button
              onClick={() => navigate(`/practicar/${puntoDebil.temaId}`)}
              className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              Practicar ahora →
            </button>
          </div>
        )}

        {proximoHito && (
          <div className="rounded-2xl border border-line bg-card p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">🎯 Próximo hito</p>
            <p className="mt-2 text-base font-bold text-ink">
              Te faltan {proximoHito.restantes} preguntas para completar el Bloque {proximoHito.bloque}
            </p>
            <div className="mt-4">
              <ProgressBar valor={proximoHito.contestadas / proximoHito.total} />
            </div>
          </div>
        )}

        {todoCompletado && !puntoDebil && (
          <div className="rounded-2xl border border-success/30 bg-success/5 p-6 sm:col-span-2">
            <p className="text-base font-bold text-ink">🎉 ¡Has completado todo el banco de preguntas disponible!</p>
            <p className="mt-1 text-sm text-muted">Sigue repasando desde "Repasar hoy" para no perder lo aprendido.</p>
          </div>
        )}
      </div>

      {evolucion && evolucion.some((d) => d.intentos > 0) && (
        <section className="mb-6 rounded-2xl border border-line bg-card p-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
            📈 Tu evolución (últimos 14 días)
          </p>
          <EvolucionChart serie={evolucion} />
        </section>
      )}

      {/* CTA principal: cierre de la jerarquía, no todo el contenido de la pantalla. */}
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
