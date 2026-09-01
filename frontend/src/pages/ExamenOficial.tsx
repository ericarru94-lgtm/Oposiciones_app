import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { obtenerExamenOficial } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import { AppLayout } from "../components/AppLayout";
import { PageTitle } from "../components/PageTitle";
import { SimulacroRunner, type ResultadoSimulacro } from "../components/SimulacroRunner";
import type { FaseExamenOficial } from "../api/endpoints";

type Paso =
  | { fase: "intro" }
  | { fase: "cargando" }
  | { fase: "parte1"; parte1: FaseExamenOficial; parte2: FaseExamenOficial }
  | { fase: "transicion"; parte2: FaseExamenOficial; resultadoParte1: ResultadoSimulacro }
  | { fase: "parte2"; parte2: FaseExamenOficial; resultadoParte1: ResultadoSimulacro }
  | { fase: "resultados"; resultadoParte1: ResultadoSimulacro; resultadoParte2: ResultadoSimulacro };

function icono(porcentaje: number): string {
  return porcentaje >= 90 ? "🏆" : porcentaje >= 70 ? "🎉" : porcentaje >= 40 ? "💪" : "📚";
}

function porcentaje(resultado: ResultadoSimulacro): number {
  const respondidas = resultado.respuestas.length;
  if (respondidas === 0) return 0;
  const aciertos = resultado.respuestas.filter((r) => r.esCorrecta).length;
  return Math.round((aciertos / respondidas) * 100);
}

/**
 * Simulacro "Examen oficial": la estructura exacta del primer ejercicio
 * real (Parte 1: 60 preguntas —30 Bloque I + 30 psicotécnicas— en 90
 * minutos; Parte 2: 50 preguntas de ofimática del Bloque II en 45
 * minutos), como dos fases separadas del mismo simulacro. Reutiliza el
 * mismo motor que el simulacro libre (SimulacroRunner) para cada fase, sin
 * configuración por parte del usuario: la estructura es fija.
 */
export function ExamenOficial() {
  const navigate = useNavigate();
  const { usuario, cargando, getToken } = useSession();
  const [paso, setPaso] = useState<Paso>({ fase: "intro" });
  const [error, setError] = useState<string | null>(null);

  // Exclusivo de premium: si el plan gratuito llega aquí (enlace directo,
  // pestaña ya abierta al cancelar la suscripción...), lo mandamos a
  // Upgrade antes de mostrar siquiera la pantalla de intro. El backend
  // también lo rechaza con 403 (ver el catch de empezar más abajo) por si
  // se salta esta pantalla y llama a la API directamente.
  useEffect(() => {
    if (cargando || usuario?.plan === "premium") return;
    navigate("/upgrade?motivo=examen-oficial", { replace: true });
  }, [cargando, usuario, navigate]);

  async function empezar() {
    setError(null);
    setPaso({ fase: "cargando" });
    try {
      const token = await getToken();
      const { parte1, parte2 } = await obtenerExamenOficial(token);
      setPaso({ fase: "parte1", parte1, parte2 });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        navigate("/upgrade?motivo=examen-oficial");
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo preparar el examen oficial. Inténtalo de nuevo en unos minutos."
      );
      setPaso({ fase: "intro" });
    }
  }

  if (paso.fase === "resultados") {
    return (
      <AppLayout>
        <ResultadosExamenOficial
          resultadoParte1={paso.resultadoParte1}
          resultadoParte2={paso.resultadoParte2}
          onVolver={() => navigate("/progreso")}
        />
      </AppLayout>
    );
  }

  if (paso.fase === "parte1") {
    return (
      <AppLayout>
        <SimulacroRunner
          preguntas={paso.parte1.preguntas}
          tiempoLimiteMin={paso.parte1.tiempoLimiteMin}
          onFinalizar={(resultadoParte1) => setPaso({ fase: "transicion", parte2: paso.parte2, resultadoParte1 })}
          onLimiteAlcanzado={() => navigate("/upgrade")}
        />
      </AppLayout>
    );
  }

  if (paso.fase === "parte2") {
    return (
      <AppLayout>
        <SimulacroRunner
          preguntas={paso.parte2.preguntas}
          tiempoLimiteMin={paso.parte2.tiempoLimiteMin}
          onFinalizar={(resultadoParte2) =>
            setPaso({ fase: "resultados", resultadoParte1: paso.resultadoParte1, resultadoParte2 })
          }
          onLimiteAlcanzado={() => navigate("/upgrade")}
        />
      </AppLayout>
    );
  }

  if (paso.fase === "transicion") {
    return (
      <AppLayout>
        <div className="mx-auto max-w-lg rounded-3xl bg-card p-8 text-center">
          <p className="text-4xl">✅</p>
          <h2 className="mt-3 text-xl font-bold text-ink">Parte 1 completada</h2>
          <p className="mt-2 text-sm text-muted">
            {porcentaje(paso.resultadoParte1)}% de acierto en la Parte 1. Ahora la Parte 2: {paso.parte2.preguntas.length}{" "}
            preguntas de ofimática en {paso.parte2.tiempoLimiteMin} minutos.
          </p>
          <button
            data-testid="empezar-parte2"
            onClick={() => setPaso({ fase: "parte2", parte2: paso.parte2, resultadoParte1: paso.resultadoParte1 })}
            className="mt-6 w-full rounded-xl bg-primary px-4 py-3 text-base font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Empezar Parte 2
          </button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-lg">
        <PageTitle icono="🏛️">Examen oficial</PageTitle>
        <p className="mt-2 text-sm text-muted">
          La estructura exacta del primer ejercicio de la oposición de Auxiliar Administrativo del Estado, en dos
          partes consecutivas y sin configuración: aquí no eliges número de preguntas ni tiempo, son los del examen
          real.
        </p>

        <div className="mt-8 space-y-4">
          <div className="rounded-2xl border border-line bg-card p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Parte 1</p>
            <p className="mt-1 text-base font-bold text-ink">60 preguntas · 90 minutos</p>
            <p className="mt-1 text-sm text-muted">30 de materias comunes (Bloque I) + 30 psicotécnicas</p>
          </div>
          <div className="rounded-2xl border border-line bg-card p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Parte 2</p>
            <p className="mt-1 text-base font-bold text-ink">50 preguntas · 45 minutos</p>
            <p className="mt-1 text-sm text-muted">Ofimática (Bloque II)</p>
          </div>
        </div>

        {error && <p className="mt-5 text-sm text-error">{error}</p>}

        <button
          data-testid="empezar-examen-oficial"
          onClick={empezar}
          disabled={paso.fase === "cargando"}
          className="mt-8 w-full rounded-xl bg-primary px-4 py-3 text-base font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {paso.fase === "cargando" ? "Preparando…" : "Empezar Parte 1"}
        </button>
      </div>
    </AppLayout>
  );
}

function ResultadosExamenOficial({
  resultadoParte1,
  resultadoParte2,
  onVolver,
}: {
  resultadoParte1: ResultadoSimulacro;
  resultadoParte2: ResultadoSimulacro;
  onVolver: () => void;
}) {
  const totalRespondidas = resultadoParte1.respuestas.length + resultadoParte2.respuestas.length;
  const totalAciertos =
    resultadoParte1.respuestas.filter((r) => r.esCorrecta).length +
    resultadoParte2.respuestas.filter((r) => r.esCorrecta).length;
  const porcentajeGlobal = totalRespondidas > 0 ? Math.round((totalAciertos / totalRespondidas) * 100) : 0;

  return (
    <div
      data-testid="resultados-examen-oficial"
      className="mx-auto max-w-lg overflow-hidden rounded-3xl bg-card text-center"
    >
      <div className="bg-primary px-8 pb-8 pt-10 text-white">
        <p className="text-5xl">{icono(porcentajeGlobal)}</p>
        <h2 className="mt-3 text-xl font-bold">Examen oficial completado</h2>
        <p className="mt-1 text-white/80">
          {totalAciertos} de {totalRespondidas} correctas ({porcentajeGlobal}%)
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 p-6">
        <div className="rounded-2xl bg-canvas p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Parte 1</p>
          <p className="mt-1 text-lg font-bold text-ink">{porcentaje(resultadoParte1)}%</p>
          <p className="text-xs text-muted">
            {resultadoParte1.respuestas.filter((r) => r.esCorrecta).length} de {resultadoParte1.respuestas.length}
          </p>
          {resultadoParte1.agotoTiempo && <p className="mt-1 text-xs text-error">⏱ tiempo agotado</p>}
        </div>
        <div className="rounded-2xl bg-canvas p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Parte 2</p>
          <p className="mt-1 text-lg font-bold text-ink">{porcentaje(resultadoParte2)}%</p>
          <p className="text-xs text-muted">
            {resultadoParte2.respuestas.filter((r) => r.esCorrecta).length} de {resultadoParte2.respuestas.length}
          </p>
          {resultadoParte2.agotoTiempo && <p className="mt-1 text-xs text-error">⏱ tiempo agotado</p>}
        </div>
      </div>

      <div className="px-6 pb-6">
        <button
          onClick={onVolver}
          className="w-full rounded-xl bg-primary px-4 py-3 text-base font-medium text-white transition-colors hover:bg-primary-hover"
        >
          Volver a mi progreso
        </button>
      </div>
    </div>
  );
}
