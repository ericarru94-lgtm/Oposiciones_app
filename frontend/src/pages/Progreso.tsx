import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { obtenerEvolucion, obtenerProgresoPorTema, obtenerResumenProgreso } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import { AppLayout } from "../components/AppLayout";
import { RachaBadge } from "../components/RachaBadge";
import { EvolucionChart } from "../components/EvolucionChart";
import { BloqueDesplegable } from "../components/BloqueDesplegable";
import { StatTile } from "../components/StatTile";
import { PageTitle } from "../components/PageTitle";
import type { EvolucionDia, ProgresoPorTema, ProgresoResumen } from "../api/types";

export function Progreso() {
  const { getToken } = useSession();
  const [resumen, setResumen] = useState<ProgresoResumen | null>(null);
  const [temas, setTemas] = useState<ProgresoPorTema[] | null>(null);
  const [evolucion, setEvolucion] = useState<EvolucionDia[] | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const token = await getToken();
      if (!token) return;
      const [r, t, e] = await Promise.all([
        obtenerResumenProgreso(token),
        obtenerProgresoPorTema(token),
        obtenerEvolucion(token, 14),
      ]);
      if (cancelado) return;
      setResumen(r);
      setTemas(t.temas);
      setEvolucion(e.serie);
    })();
    return () => {
      cancelado = true;
    };
  }, [getToken]);

  const puntosDebiles = (temas ?? [])
    .filter((t) => t.totalIntentos > 0)
    .sort((a, b) => (a.precision ?? 1) - (b.precision ?? 1))
    .slice(0, 5);

  const bloqueI = (temas ?? []).filter((t) => t.bloque === "I");
  const bloqueII = (temas ?? []).filter((t) => t.bloque === "II");

  return (
    <AppLayout>
      <PageTitle icono="📊">Tests y progreso</PageTitle>

      <Link
        to="/simulacro"
        className="mb-8 flex items-center justify-between rounded-2xl bg-primary p-6 text-white transition-colors hover:bg-primary-hover"
      >
        <div>
          <p className="text-lg font-bold">🎯 Simulacro de examen</p>
          <p className="mt-1 text-sm text-white/80">
            Elige nº de preguntas y tiempo límite: todo el temario, como en el examen real.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold">Empezar →</span>
      </Link>

      {resumen && (
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile icono="📝" label="Preguntas respondidas" valor={resumen.totalIntentos} />
          <StatTile
            icono="🎯"
            label="% de acierto global"
            valor={resumen.precision !== null ? `${Math.round(resumen.precision * 100)}%` : "—"}
          />
          <StatTile icono="⏳" label="Pendientes hoy" valor={resumen.pendientesHoy} />
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-base">🔥</div>
            <p className="mt-3 text-xs text-muted">Racha</p>
            <div className="mt-1">
              <RachaBadge dias={resumen.racha.dias} />
            </div>
          </div>
        </div>
      )}

      <section className="mb-8 rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">
          <span aria-hidden>📈</span> Evolución del % de acierto (últimos 14 días)
        </h2>
        {evolucion ? <EvolucionChart serie={evolucion} /> : <p className="text-muted">Cargando…</p>}
      </section>

      <section className="mb-8 rounded-2xl border border-accent/20 bg-accent/5 p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">
          <span aria-hidden>⚠️</span> Puntos débiles
        </h2>
        {temas === null && <p className="text-muted">Cargando…</p>}
        {temas !== null && puntosDebiles.length === 0 && (
          <p className="text-sm text-muted">Todavía no tienes suficientes respuestas para ver puntos débiles.</p>
        )}
        <ul className="space-y-3">
          {puntosDebiles.map((tema) => (
            <li key={tema.temaId} className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
              <span className="text-sm text-ink">
                Tema {tema.numero}. {tema.nombre}
              </span>
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                {Math.round((tema.precision ?? 0) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink">Progreso por bloque</h2>
        <p className="mb-4 mt-1 text-xs text-muted">
          Temario oficial: 2 bloques (Materias comunes y Materias específicas).
        </p>
        {temas === null && <p className="text-muted">Cargando…</p>}
        {temas !== null && (
          <div className="space-y-4">
            <BloqueDesplegable titulo="Bloque I · Materias comunes" icono="📘" temas={bloqueI} />
            <BloqueDesplegable titulo="Bloque II · Materias específicas" icono="💻" temas={bloqueII} />
          </div>
        )}
      </section>
    </AppLayout>
  );
}
