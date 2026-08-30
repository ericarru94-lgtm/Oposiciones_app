import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { obtenerPreguntasSimulacro, obtenerTemas } from "../api/endpoints";
import { AppLayout } from "../components/AppLayout";
import { SimulacroRunner, type ResultadoSimulacro } from "../components/SimulacroRunner";
import { PageTitle } from "../components/PageTitle";
import type { Bloque, PreguntaParaResponder, Tema } from "../api/types";

type Paso =
  | { fase: "config" }
  | { fase: "cargando"; numPreguntas: number; tiempoLimiteMin: number }
  | { fase: "test"; preguntas: PreguntaParaResponder[]; tiempoLimiteMin: number; temas: Tema[] }
  | { fase: "resultados"; resultado: ResultadoSimulacro; temas: Tema[] };

const OPCIONES_PREGUNTAS = [10, 25, 50, 75];
const OPCIONES_TIEMPO = [15, 30, 45, 60];

export function Simulacro() {
  const navigate = useNavigate();
  const [paso, setPaso] = useState<Paso>({ fase: "config" });
  const [numPreguntas, setNumPreguntas] = useState(25);
  const [tiempoLimiteMin, setTiempoLimiteMin] = useState(30);
  const [error, setError] = useState<string | null>(null);

  async function empezar() {
    setError(null);
    setPaso({ fase: "cargando", numPreguntas, tiempoLimiteMin });
    try {
      const [{ preguntas }, { temas }] = await Promise.all([
        obtenerPreguntasSimulacro(numPreguntas),
        obtenerTemas(),
      ]);
      if (preguntas.length === 0) {
        setError("No hay preguntas verificadas todavía para generar un simulacro.");
        setPaso({ fase: "config" });
        return;
      }
      setPaso({ fase: "test", preguntas, tiempoLimiteMin, temas });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo preparar el simulacro");
      setPaso({ fase: "config" });
    }
  }

  if (paso.fase === "resultados") {
    return (
      <AppLayout>
        <ResultadosSimulacro resultado={paso.resultado} temas={paso.temas} onVolver={() => navigate("/progreso")} />
      </AppLayout>
    );
  }

  if (paso.fase === "test") {
    return (
      <AppLayout>
        <SimulacroRunner
          preguntas={paso.preguntas}
          tiempoLimiteMin={paso.tiempoLimiteMin}
          onFinalizar={(resultado) => setPaso({ fase: "resultados", resultado, temas: paso.temas })}
          onLimiteAlcanzado={() => navigate("/upgrade")}
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-lg">
        <PageTitle icono="🎓">Simulacro de examen</PageTitle>
        <p className="mt-2 text-sm text-muted">
          Preguntas de todo el temario, repartidas proporcionalmente al peso de cada tema, con tiempo límite como en
          un examen real.
        </p>

        <div className="mt-8 rounded-3xl bg-card p-8 shadow-sm">
          <label className="block text-sm font-semibold text-ink">📝 Número de preguntas</label>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {OPCIONES_PREGUNTAS.map((n) => (
              <button
                key={n}
                onClick={() => setNumPreguntas(n)}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                  numPreguntas === n ? "border-primary bg-primary/10 text-primary" : "border-line text-muted hover:border-primary/40"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <label className="mt-7 block text-sm font-semibold text-ink">⏱ Tiempo límite</label>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {OPCIONES_TIEMPO.map((min) => (
              <button
                key={min}
                onClick={() => setTiempoLimiteMin(min)}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                  tiempoLimiteMin === min ? "border-primary bg-primary/10 text-primary" : "border-line text-muted hover:border-primary/40"
                }`}
              >
                {min} min
              </button>
            ))}
          </div>

          {error && <p className="mt-5 text-sm text-error">{error}</p>}

          <button
            data-testid="empezar-simulacro"
            onClick={empezar}
            disabled={paso.fase === "cargando"}
            className="mt-8 w-full rounded-xl bg-primary px-4 py-3 text-base font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {paso.fase === "cargando" ? "Preparando…" : "Empezar simulacro"}
          </button>
        </div>
      </div>
    </AppLayout>
  );
}

function formatoDuracion(ms: number): string {
  const segundosTotales = Math.round(ms / 1000);
  const m = Math.floor(segundosTotales / 60);
  const s = segundosTotales % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ResultadosSimulacro({
  resultado,
  temas,
  onVolver,
}: {
  resultado: ResultadoSimulacro;
  temas: Tema[];
  onVolver: () => void;
}) {
  const bloqueDeTema = new Map(temas.map((t) => [t.id, t.bloque]));
  const respondidas = resultado.respuestas.length;
  const aciertos = resultado.respuestas.filter((r) => r.esCorrecta).length;
  const fallos = respondidas - aciertos;
  const porcentaje = respondidas > 0 ? Math.round((aciertos / respondidas) * 100) : 0;

  const porBloque = new Map<Bloque, { aciertos: number; total: number }>();
  for (const r of resultado.respuestas) {
    const bloque = r.temaId !== null ? bloqueDeTema.get(r.temaId) : undefined;
    if (!bloque) continue;
    const actual = porBloque.get(bloque) ?? { aciertos: 0, total: 0 };
    actual.total += 1;
    if (r.esCorrecta) actual.aciertos += 1;
    porBloque.set(bloque, actual);
  }

  const icono = porcentaje >= 90 ? "🏆" : porcentaje >= 70 ? "🎉" : porcentaje >= 40 ? "💪" : "📚";

  return (
    <div data-testid="resultados-simulacro" className="mx-auto max-w-lg overflow-hidden rounded-3xl bg-card text-center">
      <div className="bg-primary px-8 pb-8 pt-10 text-white">
        <p className="text-5xl">{icono}</p>
        <h2 className="mt-3 text-xl font-bold">Simulacro completado</h2>
        {resultado.agotoTiempo && (
          <p className="mt-1 text-sm text-white/80">Se acabó el tiempo: se han contado las preguntas respondidas.</p>
        )}
        <p className="mt-1 text-sm text-white/80">
          {respondidas} de {resultado.totalPreguntas} preguntas respondidas
        </p>
      </div>

      <div className="p-8">
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl bg-success/10 p-3">
            <p className="text-xl font-bold text-success">{aciertos}</p>
            <p className="text-xs text-muted">Aciertos</p>
          </div>
          <div className="rounded-xl bg-error/10 p-3">
            <p className="text-xl font-bold text-error">{fallos}</p>
            <p className="text-xs text-muted">Fallos</p>
          </div>
          <div className="rounded-xl bg-primary/10 p-3">
            <p className="text-xl font-bold text-ink">{formatoDuracion(resultado.duracionMs)}</p>
            <p className="text-xs text-muted">Tiempo</p>
          </div>
        </div>
        <p className="mt-6 text-sm font-semibold text-primary">{porcentaje}% de aciertos</p>

        {porBloque.size > 0 && (
          <div className="mt-8 space-y-3 text-left">
            <p className="text-sm font-semibold text-ink">Resultado por bloque</p>
            {[...porBloque.entries()].map(([bloque, datos]) => (
              <div key={bloque} className="flex items-center justify-between rounded-xl border border-line px-4 py-3">
                <span className="text-sm text-ink">{bloque === "I" ? "📘" : "💻"} Bloque {bloque}</span>
                <span className="text-sm font-semibold text-muted">
                  {datos.aciertos}/{datos.total} ({Math.round((datos.aciertos / datos.total) * 100)}%)
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={onVolver}
          className="mt-8 w-full rounded-xl bg-primary px-4 py-3 text-base font-medium text-white hover:bg-primary-hover"
        >
          Volver a Tests
        </button>
      </div>
    </div>
  );
}
