import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { obtenerPreguntasSimulacro, obtenerTemas } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
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
/** Configuración básica del simulacro libre: la única disponible sin premium (ver GET /preguntas/simulacro). */
const PREGUNTAS_GRATIS = OPCIONES_PREGUNTAS[0];
const TIEMPO_GRATIS = OPCIONES_TIEMPO[0];

export function Simulacro() {
  const navigate = useNavigate();
  const { usuario, getToken } = useSession();
  const esPremium = usuario?.plan === "premium";
  const [paso, setPaso] = useState<Paso>({ fase: "config" });
  const [numPreguntas, setNumPreguntas] = useState(25);
  const [tiempoLimiteMin, setTiempoLimiteMin] = useState(30);
  const [error, setError] = useState<string | null>(null);

  // Un usuario gratuito no puede cambiar la configuración básica, aunque
  // el estado de arriba guarde otra cosa (p.ej. mientras se resuelve el
  // plan al cargar la página): la petición y el cronómetro siempre usan
  // este valor "efectivo", nunca el estado en bruto directamente.
  const numPreguntasEfectivo = esPremium ? numPreguntas : PREGUNTAS_GRATIS;
  const tiempoLimiteEfectivo = esPremium ? tiempoLimiteMin : TIEMPO_GRATIS;

  async function empezar() {
    setError(null);
    setPaso({ fase: "cargando", numPreguntas: numPreguntasEfectivo, tiempoLimiteMin: tiempoLimiteEfectivo });
    try {
      const token = await getToken();
      const [{ preguntas }, { temas }] = await Promise.all([
        obtenerPreguntasSimulacro(numPreguntasEfectivo, token),
        obtenerTemas(),
      ]);
      if (preguntas.length === 0) {
        setError("No hay preguntas verificadas todavía para generar un simulacro.");
        setPaso({ fase: "config" });
        return;
      }
      setPaso({ fase: "test", preguntas, tiempoLimiteMin: tiempoLimiteEfectivo, temas });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        navigate("/upgrade?motivo=simulacro-configuracion");
        return;
      }
      setError(err instanceof Error ? err.message : "No se pudo preparar el simulacro");
      setPaso({ fase: "config" });
    }
  }

  /** Pulsar una opción bloqueada (no premium) lleva a Upgrade en vez de aplicarla. */
  function elegirOpcion(valor: number, opcionGratis: number, aplicar: (v: number) => void) {
    if (!esPremium && valor !== opcionGratis) {
      navigate("/upgrade?motivo=simulacro-configuracion");
      return;
    }
    aplicar(valor);
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
          Dos formas de practicar en condiciones de examen: la estructura exacta del examen oficial, o tu propio
          simulacro configurable sobre todo el temario.
        </p>

        {/* Misma tarjeta blanca con sombra que el bloque de abajo, con tratamiento
            "premium" (borde y badge en ámbar) para que no se confunda visualmente
            con una opción más del simulacro libre — un usuario del plan gratuito
            llegó a completar el simulacro libre pensando que era el examen oficial. */}
        <div className="relative overflow-hidden rounded-3xl border-2 border-accent bg-card p-6 shadow-sm">
          <span className="absolute right-5 top-5 rounded-full bg-accent px-3 py-1 text-xs font-bold text-white">
            Premium
          </span>
          <p className="text-sm font-semibold text-ink">🏛️ Examen oficial</p>
          <p className="mt-1 text-xs text-muted">
            La estructura exacta del primer ejercicio real: Parte 1, 60 preg. (30 Bloque I + 30 psicotécnicas) en 90
            min · Parte 2, 50 preg. de ofimática en 45 min. Sin configurar nada, tal cual el examen.
          </p>
          <Link
            to="/simulacro/examen-oficial"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:opacity-90"
          >
            Ir al examen oficial →
          </Link>
        </div>

        <p className="mt-8 text-sm font-semibold text-ink">O configura tu propio simulacro libre</p>
        <div className="mt-3 rounded-3xl bg-card p-8 shadow-sm">
          <label className="block text-sm font-semibold text-ink">📝 Número de preguntas</label>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {OPCIONES_PREGUNTAS.map((n) => {
              const bloqueada = !esPremium && n !== PREGUNTAS_GRATIS;
              return (
                <button
                  key={n}
                  onClick={() => elegirOpcion(n, PREGUNTAS_GRATIS, setNumPreguntas)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                    numPreguntasEfectivo === n
                      ? "border-primary bg-primary/10 text-primary"
                      : bloqueada
                        ? "border-line text-muted/60 hover:border-accent/40"
                        : "border-line text-muted hover:border-primary/40"
                  }`}
                >
                  {bloqueada && "🔒 "}
                  {n}
                </button>
              );
            })}
          </div>

          <label className="mt-7 block text-sm font-semibold text-ink">⏱ Tiempo límite</label>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {OPCIONES_TIEMPO.map((min) => {
              const bloqueada = !esPremium && min !== TIEMPO_GRATIS;
              return (
                <button
                  key={min}
                  onClick={() => elegirOpcion(min, TIEMPO_GRATIS, setTiempoLimiteMin)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                    tiempoLimiteEfectivo === min
                      ? "border-primary bg-primary/10 text-primary"
                      : bloqueada
                        ? "border-line text-muted/60 hover:border-accent/40"
                        : "border-line text-muted hover:border-primary/40"
                  }`}
                >
                  {bloqueada && "🔒 "}
                  {min} min
                </button>
              );
            })}
          </div>

          {!esPremium && (
            <p className="mt-4 text-xs text-muted">
              Plan gratuito: simulacro libre de {PREGUNTAS_GRATIS} preguntas y {TIEMPO_GRATIS} min. Hazte premium
              para elegir más preguntas y más tiempo.
            </p>
          )}

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
