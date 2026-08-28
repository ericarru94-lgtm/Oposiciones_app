import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import { responderPregunta } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import type { Opcion, PreguntaParaResponder } from "../api/types";

export interface RespuestaSimulacro {
  temaId: number | null;
  esCorrecta: boolean;
}

export interface ResultadoSimulacro {
  totalPreguntas: number;
  respuestas: RespuestaSimulacro[];
  duracionMs: number;
  agotoTiempo: boolean;
}

const ETIQUETA_OPCION: Opcion[] = ["a", "b", "c", "d"];

function formatoTiempo(segundos: number): string {
  const s = Math.max(0, segundos);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

interface SimulacroRunnerProps {
  preguntas: PreguntaParaResponder[];
  tiempoLimiteMin: number;
  onFinalizar: (resultado: ResultadoSimulacro) => void;
  onLimiteAlcanzado: () => void;
}

/**
 * Ejecuta el simulacro de examen: a diferencia de TestRunner, no muestra si
 * cada respuesta es correcta hasta el final (más fiel a un examen real), y
 * añade un temporizador que termina el simulacro automáticamente al agotar
 * el tiempo, con lo respondido hasta ese momento.
 */
export function SimulacroRunner({ preguntas, tiempoLimiteMin, onFinalizar, onLimiteAlcanzado }: SimulacroRunnerProps) {
  const { getToken, sesionAnonima } = useSession();
  const [indice, setIndice] = useState(0);
  const [opcionElegida, setOpcionElegida] = useState<Opcion | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [respuestas, setRespuestas] = useState<RespuestaSimulacro[]>([]);
  const [horaInicio] = useState(() => Date.now());
  const [horaFin] = useState(() => Date.now() + tiempoLimiteMin * 60_000);
  const [segundosRestantes, setSegundosRestantes] = useState(() => Math.round(tiempoLimiteMin * 60));

  const pregunta = preguntas[indice];
  const terminado = indice >= preguntas.length;

  const finalizar = useMemo(
    () => (agotoTiempo: boolean) =>
      onFinalizar({
        totalPreguntas: preguntas.length,
        respuestas,
        duracionMs: Date.now() - horaInicio,
        agotoTiempo,
      }),
    [preguntas.length, respuestas, horaInicio, onFinalizar]
  );

  useEffect(() => {
    if (terminado) return;
    const id = setInterval(() => {
      const restante = Math.round((horaFin - Date.now()) / 1000);
      setSegundosRestantes(restante);
      if (restante <= 0) {
        clearInterval(id);
        finalizar(true);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [terminado, horaFin, finalizar]);

  useEffect(() => {
    if (terminado) finalizar(false);
    // Se dispara solo cuando `terminado` pasa a true (última pregunta respondida).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminado]);

  if (!pregunta) return null;

  async function elegirOpcion(opcion: Opcion) {
    setOpcionElegida(opcion);
  }

  async function siguiente() {
    if (!opcionElegida || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const token = await getToken();
      const resultado = await responderPregunta(
        pregunta.id,
        { opcion: opcionElegida, sesionAnonima: token ? undefined : sesionAnonima },
        token
      );
      setRespuestas((prev) => [...prev, { temaId: pregunta.temaId, esCorrecta: resultado.esCorrecta }]);
      setOpcionElegida(null);
      setIndice((i) => i + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        onLimiteAlcanzado();
        return;
      }
      setError(err instanceof Error ? err.message : "No se pudo enviar la respuesta");
    } finally {
      setEnviando(false);
    }
  }

  const urgente = segundosRestantes <= 60;

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8 flex items-center justify-between">
        <div className="text-xs text-muted">
          <p>Simulacro de examen</p>
          <p className="mt-0.5">
            Pregunta {indice + 1} de {preguntas.length}
          </p>
        </div>
        <span
          data-testid="temporizador"
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            urgente ? "bg-error/10 text-error" : "bg-primary/10 text-primary"
          }`}
        >
          ⏱ {formatoTiempo(segundosRestantes)}
        </span>
      </div>
      <div className="mb-8 h-1 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${(indice / preguntas.length) * 100}%` }}
        />
      </div>

      <div className="rounded-3xl bg-card p-8">
        <p className="text-xl font-semibold leading-relaxed text-ink">{pregunta.enunciado}</p>

        <div className="mt-8 space-y-3">
          {pregunta.opciones.map((texto, i) => {
            const opcion = ETIQUETA_OPCION[i];
            const esElegida = opcionElegida === opcion;
            return (
              <button
                key={opcion}
                data-testid={`opcion-${opcion}`}
                disabled={enviando}
                onClick={() => elegirOpcion(opcion)}
                className={`w-full rounded-xl border px-5 py-4 text-left text-base transition-colors disabled:cursor-default ${
                  esElegida ? "border-primary bg-primary/10" : "border-line hover:border-primary/40"
                }`}
              >
                <span className="mr-3 font-semibold uppercase text-muted">{opcion}</span>
                {texto}
              </button>
            );
          })}
        </div>

        {error && <p className="mt-4 text-sm text-error">{error}</p>}

        <button
          data-testid="siguiente"
          disabled={!opcionElegida || enviando}
          onClick={siguiente}
          className="mt-6 w-full rounded-xl bg-primary px-4 py-3 text-base font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {indice + 1 < preguntas.length ? "Siguiente" : "Terminar simulacro"}
        </button>
      </div>
    </div>
  );
}
