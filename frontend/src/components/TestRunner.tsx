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
      <div className="mx-auto max-w-lg rounded-2xl bg-white p-8 text-center shadow-sm">
        <p className="text-slate-600">
          No hay preguntas disponibles para este test todavía. Vuelve a intentarlo más tarde.
        </p>
        <button
          data-testid="volver-vacio"
          onClick={() => onFinalizar({ totalPreguntas: 0, aciertos: 0, fallos: 0, duracionMs: 0 })}
          className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-white"
        >
          Volver
        </button>
      </div>
    );
  }

  if (terminado) {
    const porcentaje = resumen.totalPreguntas > 0 ? Math.round((resumen.aciertos / resumen.totalPreguntas) * 100) : 0;
    return (
      <div data-testid="resumen" className="mx-auto max-w-lg rounded-2xl bg-white p-8 text-center shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">¡Test completado!</h2>
        <p className="mt-1 text-sm text-slate-500">{titulo}</p>
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div>
            <p data-testid="resumen-aciertos" className="text-2xl font-bold text-emerald-600">
              {resumen.aciertos}
            </p>
            <p className="text-xs text-slate-500">Aciertos</p>
          </div>
          <div>
            <p data-testid="resumen-fallos" className="text-2xl font-bold text-rose-600">
              {resumen.fallos}
            </p>
            <p className="text-xs text-slate-500">Fallos</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{Math.round(resumen.duracionMs / 1000)}s</p>
            <p className="text-xs text-slate-500">Tiempo</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-slate-600">{porcentaje}% de aciertos</p>
        <button
          data-testid="continuar"
          onClick={() => onFinalizar(resumen)}
          className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700"
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
      <div className="mb-4 flex items-center justify-between text-sm text-slate-500">
        <span>{titulo}</span>
        <span>
          Pregunta {indice + 1} de {preguntas.length}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-indigo-600 transition-all"
          style={{ width: `${(indice / preguntas.length) * 100}%` }}
        />
      </div>

      <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-lg font-medium text-slate-900">{pregunta.enunciado}</p>

        <div className="mt-5 space-y-2">
          {pregunta.opciones.map((texto, i) => {
            const opcion = ETIQUETA_OPCION[i];
            const esElegida = opcionElegida === opcion;
            const esCorrectaReal = feedback && feedback.respuestaCorrecta === opcion;
            let estilo = "border-slate-200 hover:border-indigo-300";
            if (feedback) {
              if (esCorrectaReal) estilo = "border-emerald-500 bg-emerald-50";
              else if (esElegida) estilo = "border-rose-500 bg-rose-50";
              else estilo = "border-slate-200 opacity-60";
            }
            return (
              <button
                key={opcion}
                data-testid={`opcion-${opcion}`}
                disabled={!!feedback || enviando}
                onClick={() => elegirOpcion(opcion)}
                className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition-colors disabled:cursor-default ${estilo}`}
              >
                <span className="mr-2 font-semibold uppercase text-slate-400">{opcion}</span>
                {texto}
              </button>
            );
          })}
        </div>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

        {feedback && (
          <div data-testid="feedback" className="mt-5 rounded-lg bg-slate-50 p-4 text-sm">
            <p className={feedback.esCorrecta ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
              {feedback.esCorrecta ? "¡Correcto!" : `Incorrecto. La respuesta correcta es la ${feedback.respuestaCorrecta}.`}
            </p>
            {feedback.explicacion && <p className="mt-2 text-slate-600">{feedback.explicacion}</p>}
            {feedback.fuente && <p className="mt-1 text-xs text-slate-400">Fuente: {feedback.fuente}</p>}
            {!feedback.explicacion && !feedback.fuente && (
              <p className="mt-2 text-xs text-slate-400">
                Esta pregunta todavía no tiene explicación ni fuente legal añadidas.
              </p>
            )}
            <button
              data-testid="siguiente"
              onClick={siguiente}
              className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
            >
              {indice + 1 < preguntas.length ? "Siguiente" : "Ver resumen"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
