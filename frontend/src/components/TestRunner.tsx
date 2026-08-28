import { useMemo, useState } from "react";
import { ApiError } from "../api/client";
import { responderPregunta } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import type { Opcion, PreguntaParaResponder, RespuestaFeedback } from "../api/types";

export interface ResumenTest {
  totalPreguntas: number;
  aciertos: number;
  fallos: number;
  duracionMs: number;
}

const ETIQUETA_OPCION: Opcion[] = ["a", "b", "c", "d"];

interface TestRunnerProps {
  titulo: string;
  preguntas: PreguntaParaResponder[];
  onFinalizar: (resumen: ResumenTest) => void;
  onLimiteAlcanzado: () => void;
}

/**
 * Ejecuta un test una pregunta a la vez: selección -> feedback inmediato
 * (correcto/incorrecto + explicación + fuente) -> siguiente, y termina con
 * un resumen (aciertos/fallos/tiempo). Se usa tanto en el onboarding
 * (usuario anónimo) como en "repasar hoy" y la práctica por tema (usuario
 * autenticado): la única diferencia es si se manda `token` o
 * `sesionAnonima` a /responder, lo que ya resuelve el SessionContext.
 */
export function TestRunner({ titulo, preguntas, onFinalizar, onLimiteAlcanzado }: TestRunnerProps) {
  const { getToken, sesionAnonima } = useSession();
  const [indice, setIndice] = useState(0);
  const [feedback, setFeedback] = useState<RespuestaFeedback | null>(null);
  const [opcionElegida, setOpcionElegida] = useState<Opcion | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultados, setResultados] = useState<boolean[]>([]);
  const [horaInicioPregunta] = useState(() => Date.now());
  const [horaInicioTest] = useState(() => Date.now());

  const pregunta = preguntas[indice];
  const terminado = indice >= preguntas.length;

  const resumen = useMemo<ResumenTest>(
    () => ({
      totalPreguntas: preguntas.length,
      aciertos: resultados.filter(Boolean).length,
      fallos: resultados.filter((r) => !r).length,
      duracionMs: Date.now() - horaInicioTest,
    }),
    [preguntas.length, resultados, horaInicioTest]
  );

  if (preguntas.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl bg-card p-8 text-center">
        <p className="text-base text-muted">
          No hay preguntas disponibles para este test todavía. Vuelve a intentarlo más tarde.
        </p>
        <button
          data-testid="volver-vacio"
          onClick={() => onFinalizar({ totalPreguntas: 0, aciertos: 0, fallos: 0, duracionMs: 0 })}
          className="mt-6 rounded-xl bg-primary px-4 py-2.5 text-base font-medium text-white hover:bg-primary-hover"
        >
          Volver
        </button>
      </div>
    );
  }

  if (terminado) {
    const porcentaje = resumen.totalPreguntas > 0 ? Math.round((resumen.aciertos / resumen.totalPreguntas) * 100) : 0;
    return (
      <div data-testid="resumen" className="mx-auto max-w-lg rounded-3xl bg-card p-8 text-center">
        <h2 className="text-xl font-semibold text-ink">¡Test completado!</h2>
        <p className="mt-1 text-sm text-muted">{titulo}</p>
        <div className="mt-8 grid grid-cols-3 gap-4">
          <div>
            <p data-testid="resumen-aciertos" className="text-xl font-bold text-success">
              {resumen.aciertos}
            </p>
            <p className="text-sm text-muted">Aciertos</p>
          </div>
          <div>
            <p data-testid="resumen-fallos" className="text-xl font-bold text-error">
              {resumen.fallos}
            </p>
            <p className="text-sm text-muted">Fallos</p>
          </div>
          <div>
            <p className="text-xl font-bold text-ink">{Math.round(resumen.duracionMs / 1000)}s</p>
            <p className="text-sm text-muted">Tiempo</p>
          </div>
        </div>
        <p className="mt-6 text-sm text-muted">{porcentaje}% de aciertos</p>
        <button
          data-testid="continuar"
          onClick={() => onFinalizar(resumen)}
          className="mt-8 w-full rounded-xl bg-primary px-4 py-3 text-base font-medium text-white hover:bg-primary-hover"
        >
          Continuar
        </button>
      </div>
    );
  }

  async function elegirOpcion(opcion: Opcion) {
    if (feedback || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const token = await getToken();
      const resultado = await responderPregunta(
        pregunta.id,
        {
          opcion,
          sesionAnonima: token ? undefined : sesionAnonima,
          tiempoMs: Date.now() - horaInicioPregunta,
        },
        token
      );
      setOpcionElegida(opcion);
      setFeedback(resultado);
      setResultados((prev) => [...prev, resultado.esCorrecta]);
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

  function siguiente() {
    setFeedback(null);
    setOpcionElegida(null);
    setIndice((i) => i + 1);
  }

  return (
    <div className="mx-auto max-w-lg">
      {/* Progreso: discreto a propósito, para que no compita con la pregunta. */}
      <div className="mb-8 flex items-center justify-between text-xs text-muted">
        <span>{titulo}</span>
        <span>
          Pregunta {indice + 1} de {preguntas.length}
        </span>
      </div>
      <div className="mb-8 h-1 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${(indice / preguntas.length) * 100}%` }}
        />
      </div>

      {/* Foco absoluto de la pantalla: la pregunta y sus opciones. */}
      <div className="rounded-3xl bg-card p-8">
        <p className="text-xl font-semibold leading-relaxed text-ink">{pregunta.enunciado}</p>

        <div className="mt-8 space-y-3">
          {pregunta.opciones.map((texto, i) => {
            const opcion = ETIQUETA_OPCION[i];
            const esElegida = opcionElegida === opcion;
            const esCorrectaReal = feedback && feedback.respuestaCorrecta === opcion;
            let estilo = "border-line hover:border-primary/40";
            if (feedback) {
              if (esCorrectaReal) estilo = "border-success bg-success/10";
              else if (esElegida) estilo = "border-error bg-error/10";
              else estilo = "border-line opacity-50";
            }
            return (
              <button
                key={opcion}
                data-testid={`opcion-${opcion}`}
                disabled={!!feedback || enviando}
                onClick={() => elegirOpcion(opcion)}
                className={`w-full rounded-xl border px-5 py-4 text-left text-base transition-colors disabled:cursor-default ${estilo}`}
              >
                <span className="mr-3 font-semibold uppercase text-muted">{opcion}</span>
                {texto}
              </button>
            );
          })}
        </div>

        {error && <p className="mt-4 text-sm text-error">{error}</p>}

        {feedback && (
          <div data-testid="feedback" className="mt-6 rounded-xl bg-canvas p-5 text-base">
            <p className={feedback.esCorrecta ? "font-semibold text-success" : "font-semibold text-error"}>
              {feedback.esCorrecta ? "¡Correcto!" : `Incorrecto. La respuesta correcta es la ${feedback.respuestaCorrecta}.`}
            </p>
            {feedback.explicacion && <p className="mt-2 text-sm text-muted">{feedback.explicacion}</p>}
            {feedback.fuente && <p className="mt-1 text-xs text-muted">Fuente: {feedback.fuente}</p>}
            {!feedback.explicacion && !feedback.fuente && (
              <p className="mt-2 text-xs text-muted">
                Esta pregunta todavía no tiene explicación ni fuente legal añadidas.
              </p>
            )}
            <button
              data-testid="siguiente"
              onClick={siguiente}
              className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-base font-medium text-white hover:bg-primary-hover"
            >
              {indice + 1 < preguntas.length ? "Siguiente" : "Ver resumen"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
