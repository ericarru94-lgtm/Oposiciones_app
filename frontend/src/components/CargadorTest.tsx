import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { TestRunner, type ResumenTest } from "./TestRunner";
import type { PreguntaParaResponder } from "../api/types";

interface CargadorTestProps {
  titulo: string;
  cargar: () => Promise<PreguntaParaResponder[]>;
  onFinalizar: (resumen: ResumenTest) => void;
  onLimiteAlcanzado: () => void;
}

/** Carga las preguntas de un test antes de montar el TestRunner, con estados de carga/error. */
export function CargadorTest({ titulo, cargar, onFinalizar, onLimiteAlcanzado }: CargadorTestProps) {
  const [preguntas, setPreguntas] = useState<PreguntaParaResponder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    cargar()
      .then((p) => {
        if (!cancelado) setPreguntas(p);
      })
      .catch((err) => {
        if (cancelado) return;
        // Mismo criterio que TestRunner.elegirOpcion: un 429 al cargar (p.ej.
        // "Repasar hoy" con el límite diario ya agotado) es una situación de
        // "hazte premium", no un error genérico ni "no hay preguntas".
        if (err instanceof ApiError && err.status === 429) {
          onLimiteAlcanzado();
          return;
        }
        setError(err instanceof Error ? err.message : "No se pudieron cargar las preguntas");
      });
    return () => {
      cancelado = true;
    };
    // Se ejecuta una sola vez al montar este paso; `cargar` se define en el
    // padre para este paso concreto y no debe volver a dispararse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl bg-card p-8 text-center">
        <p className="text-4xl">⚠️</p>
        <p className="mt-3 text-base text-error">{error}</p>
      </div>
    );
  }

  if (!preguntas) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl bg-card p-8 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-line border-t-primary" />
        <p className="mt-4 text-base text-muted">Preparando tus preguntas…</p>
      </div>
    );
  }

  return (
    <TestRunner
      titulo={titulo}
      preguntas={preguntas}
      onFinalizar={onFinalizar}
      onLimiteAlcanzado={onLimiteAlcanzado}
    />
  );
}
