import { useEffect, useState } from "react";
import { obtenerEvolucion, obtenerProgresoPorTema, obtenerResumenProgreso } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import { AppLayout } from "../components/AppLayout";
import { RachaBadge } from "../components/RachaBadge";
import { EvolucionChart } from "../components/EvolucionChart";
import { BloqueDesplegable } from "../components/BloqueDesplegable";
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
      <h1 className="mb-6 text-2xl font-bold text-ink">Panel de progreso</h1>

      {resumen && (
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Preguntas respondidas" valor={String(resumen.totalIntentos)} />
          <StatTile
            label="% de acierto global"
            valor={resumen.precision !== null ? `${Math.round(resumen.precision * 100)}%` : "—"}
          />
          <StatTile label="Pendientes hoy" valor={String(resumen.pendientesHoy)} />
          <div className="rounded-xl border border-line bg-card p-4">
            <p className="text-xs text-muted">Racha</p>
            <div className="mt-1">
              <RachaBadge dias={resumen.racha.dias} />
            </div>
          </div>
        </div>
      )}

      <section className="mb-8 rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">Evolución del % de acierto (últimos 14 días)</h2>
        {evolucion ? <EvolucionChart serie={evolucion} /> : <p className="text-muted">Cargando…</p>}
      </section>

      <section className="mb-8 rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">Puntos débiles</h2>
        {temas === null && <p className="text-muted">Cargando…</p>}
        {temas !== null && puntosDebiles.length === 0 && (
          <p className="text-sm text-muted">Todavía no tienes suficientes respuestas para ver puntos débiles.</p>
        )}
        <ul className="space-y-3">
          {puntosDebiles.map((tema) => (
            <li key={tema.temaId} className="flex items-center justify-between">
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
        <h2 className="mb-4 text-sm font-semibold text-ink">Progreso por bloque</h2>
        {temas === null && <p className="text-muted">Cargando…</p>}
        {temas !== null && (
          <div className="space-y-4">
            <BloqueDesplegable titulo="Bloque I · Materias comunes" temas={bloqueI} />
            <BloqueDesplegable titulo="Bloque II · Materias específicas" temas={bloqueII} />
          </div>
        )}
      </section>
    </AppLayout>
  );
}

function StatTile({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{valor}</p>
    </div>
  );
}
