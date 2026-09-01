import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SimulacroRunner } from "./SimulacroRunner";
import { ApiError } from "../api/client";
import { responderPregunta } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import type { PreguntaParaResponder } from "../api/types";

vi.mock("../context/SessionContext", () => ({
  useSession: vi.fn(),
}));
vi.mock("../api/endpoints", () => ({
  responderPregunta: vi.fn(),
}));

const preguntas: PreguntaParaResponder[] = [
  { id: "p1", enunciado: "¿Pregunta 1?", opciones: ["A1", "B1", "C1", "D1"], tipo: "teorica", temaId: 1 },
  { id: "p2", enunciado: "¿Pregunta 2?", opciones: ["A2", "B2", "C2", "D2"], tipo: "teorica", temaId: 2 },
];

beforeEach(() => {
  vi.mocked(useSession).mockReturnValue({
    getToken: vi.fn().mockResolvedValue(null),
    sesionAnonima: "sesion-test",
  } as unknown as ReturnType<typeof useSession>);
  vi.mocked(responderPregunta).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SimulacroRunner", () => {
  it("no revela si la respuesta es correcta, y al terminar todas llama a onFinalizar con el detalle por pregunta", async () => {
    const user = userEvent.setup();
    vi.mocked(responderPregunta)
      .mockResolvedValueOnce({
        esCorrecta: true,
        respuestaCorrecta: "a",
        explicacion: null,
        fuente: null,
      })
      .mockResolvedValueOnce({
        esCorrecta: false,
        respuestaCorrecta: "b",
        explicacion: null,
        fuente: null,
      });

    const onFinalizar = vi.fn();
    render(
      <SimulacroRunner preguntas={preguntas} tiempoLimiteMin={30} onFinalizar={onFinalizar} onLimiteAlcanzado={vi.fn()} />
    );

    await user.click(screen.getByTestId("opcion-a"));
    expect(screen.queryByTestId("feedback")).not.toBeInTheDocument();
    expect(screen.queryByText(/Correcto/)).not.toBeInTheDocument();

    await user.click(screen.getByTestId("siguiente"));
    await waitFor(() => expect(screen.getByText("¿Pregunta 2?")).toBeInTheDocument());

    await user.click(screen.getByTestId("opcion-b"));
    await user.click(screen.getByTestId("siguiente"));

    await waitFor(() => expect(onFinalizar).toHaveBeenCalledTimes(1));
    expect(onFinalizar).toHaveBeenCalledWith(
      expect.objectContaining({
        totalPreguntas: 2,
        agotoTiempo: false,
        respuestas: [
          { temaId: 1, esCorrecta: true },
          { temaId: 2, esCorrecta: false },
        ],
      })
    );
  });

  it("el botón Siguiente permanece deshabilitado hasta elegir una opción", async () => {
    render(
      <SimulacroRunner preguntas={preguntas} tiempoLimiteMin={30} onFinalizar={vi.fn()} onLimiteAlcanzado={vi.fn()} />
    );
    expect(screen.getByTestId("siguiente")).toBeDisabled();
  });

  it("al recibir un 429 llama a onLimiteAlcanzado sin llamar a onFinalizar", async () => {
    const user = userEvent.setup();
    vi.mocked(responderPregunta).mockRejectedValueOnce(new ApiError(429, { error: "Límite diario alcanzado" }));

    const onLimiteAlcanzado = vi.fn();
    const onFinalizar = vi.fn();
    render(
      <SimulacroRunner
        preguntas={preguntas}
        tiempoLimiteMin={30}
        onFinalizar={onFinalizar}
        onLimiteAlcanzado={onLimiteAlcanzado}
      />
    );

    await user.click(screen.getByTestId("opcion-a"));
    await user.click(screen.getByTestId("siguiente"));

    await waitFor(() => expect(onLimiteAlcanzado).toHaveBeenCalledTimes(1));
    expect(onFinalizar).not.toHaveBeenCalled();
  });

  it("al agotar el tiempo, finaliza automáticamente con lo respondido hasta ese momento", async () => {
    vi.useFakeTimers();
    const onFinalizar = vi.fn();
    render(
      <SimulacroRunner
        preguntas={preguntas}
        tiempoLimiteMin={1 / 60}
        onFinalizar={onFinalizar}
        onLimiteAlcanzado={vi.fn()}
      />
    );

    await vi.advanceTimersByTimeAsync(1500);

    expect(onFinalizar).toHaveBeenCalledWith(
      expect.objectContaining({ agotoTiempo: true, respuestas: [], totalPreguntas: 2 })
    );
  });
});
