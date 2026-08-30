import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestRunner } from "./TestRunner";
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
  { id: "p1", enunciado: "¿Pregunta 1?", opciones: ["Opción A1", "Opción B1", "Opción C1", "Opción D1"], tipo: "teorica", temaId: null },
  { id: "p2", enunciado: "¿Pregunta 2?", opciones: ["Opción A2", "Opción B2", "Opción C2", "Opción D2"], tipo: "teorica", temaId: null },
];

beforeEach(() => {
  vi.mocked(useSession).mockReturnValue({
    getToken: vi.fn().mockResolvedValue(null),
    sesionAnonima: "sesion-test",
  } as unknown as ReturnType<typeof useSession>);
  vi.mocked(responderPregunta).mockReset();
});

describe("TestRunner", () => {
  it("muestra feedback correcto con explicación y fuente, y permite avanzar", async () => {
    const user = userEvent.setup();
    vi.mocked(responderPregunta).mockResolvedValueOnce({
      esCorrecta: true,
      respuestaCorrecta: "a",
      explicacion: "Porque el artículo 1 lo dice.",
      fuente: "Art. 1 CE",
      limiteDiario: { restantes: 29, usadas: 1 },
    });

    const onFinalizar = vi.fn();
    render(
      <TestRunner
        titulo="Mini-test"
        preguntas={[preguntas[0]]}
        onFinalizar={onFinalizar}
        onLimiteAlcanzado={vi.fn()}
      />
    );

    await user.click(screen.getByTestId("opcion-a"));

    await waitFor(() => expect(screen.getByTestId("feedback")).toBeInTheDocument());
    expect(screen.getByText(/¡Correcto!/)).toBeInTheDocument();
    expect(screen.getByText("Porque el artículo 1 lo dice.")).toBeInTheDocument();
    expect(screen.getByText("Fuente: Art. 1 CE")).toBeInTheDocument();
    expect(responderPregunta).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ opcion: "a", sesionAnonima: "sesion-test" }),
      null
    );

    // Última pregunta: el botón dice "Ver resumen" y al pulsarlo se ve el resumen.
    await user.click(screen.getByTestId("siguiente"));
    expect(screen.getByTestId("resumen")).toBeInTheDocument();
    expect(screen.getByTestId("resumen-aciertos")).toHaveTextContent("1");
    expect(screen.getByTestId("resumen-fallos")).toHaveTextContent("0");

    await user.click(screen.getByTestId("continuar"));
    expect(onFinalizar).toHaveBeenCalledWith(expect.objectContaining({ totalPreguntas: 1, aciertos: 1, fallos: 0 }));
  });

  it("cuenta aciertos y fallos a lo largo de varias preguntas", async () => {
    const user = userEvent.setup();
    vi.mocked(responderPregunta)
      .mockResolvedValueOnce({
        esCorrecta: false,
        respuestaCorrecta: "b",
        explicacion: null,
        fuente: null,
        limiteDiario: { restantes: 28, usadas: 2 },
      })
      .mockResolvedValueOnce({
        esCorrecta: true,
        respuestaCorrecta: "a",
        explicacion: null,
        fuente: null,
        limiteDiario: { restantes: 27, usadas: 3 },
      });

    const onFinalizar = vi.fn();
    render(<TestRunner titulo="Test" preguntas={preguntas} onFinalizar={onFinalizar} onLimiteAlcanzado={vi.fn()} />);

    await user.click(screen.getByTestId("opcion-a"));
    await waitFor(() => expect(screen.getByTestId("feedback")).toBeInTheDocument());
    expect(screen.getByText(/Incorrecto/)).toBeInTheDocument();
    expect(
      screen.getByText(/Sigue repasando este tema, pronto añadiremos más detalle\./)
    ).toBeInTheDocument();
    await user.click(screen.getByTestId("siguiente"));

    await user.click(screen.getByTestId("opcion-a"));
    await waitFor(() => expect(screen.getByTestId("feedback")).toBeInTheDocument());
    await user.click(screen.getByTestId("siguiente"));

    expect(screen.getByTestId("resumen-aciertos")).toHaveTextContent("1");
    expect(screen.getByTestId("resumen-fallos")).toHaveTextContent("1");
  });

  it("al recibir un 429 llama a onLimiteAlcanzado y no muestra feedback", async () => {
    const user = userEvent.setup();
    vi.mocked(responderPregunta).mockRejectedValueOnce(new ApiError(429, { error: "Límite diario alcanzado" }));

    const onLimiteAlcanzado = vi.fn();
    render(
      <TestRunner titulo="Test" preguntas={[preguntas[0]]} onFinalizar={vi.fn()} onLimiteAlcanzado={onLimiteAlcanzado} />
    );

    await user.click(screen.getByTestId("opcion-a"));

    await waitFor(() => expect(onLimiteAlcanzado).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("feedback")).not.toBeInTheDocument();
  });

  it("con explicacionGeneradaIA muestra el aviso discreto de contenido generado", async () => {
    const user = userEvent.setup();
    vi.mocked(responderPregunta).mockResolvedValueOnce({
      esCorrecta: true,
      respuestaCorrecta: "a",
      explicacion: "La opción a es correcta porque...",
      explicacionGeneradaIA: true,
      fuente: null,
      limiteDiario: { restantes: 29, usadas: 1 },
    });

    render(
      <TestRunner titulo="Test" preguntas={[preguntas[0]]} onFinalizar={vi.fn()} onLimiteAlcanzado={vi.fn()} />
    );
    await user.click(screen.getByTestId("opcion-a"));

    await waitFor(() =>
      expect(screen.getByText(/Explicación generada automáticamente/)).toBeInTheDocument()
    );
  });

  it("sin explicacionGeneradaIA no muestra el aviso de contenido generado", async () => {
    const user = userEvent.setup();
    vi.mocked(responderPregunta).mockResolvedValueOnce({
      esCorrecta: true,
      respuestaCorrecta: "a",
      explicacion: "Porque el artículo 1 lo dice.",
      explicacionGeneradaIA: false,
      fuente: "Art. 1 CE",
      limiteDiario: { restantes: 29, usadas: 1 },
    });

    render(
      <TestRunner titulo="Test" preguntas={[preguntas[0]]} onFinalizar={vi.fn()} onLimiteAlcanzado={vi.fn()} />
    );
    await user.click(screen.getByTestId("opcion-a"));

    await waitFor(() => expect(screen.getByTestId("feedback")).toBeInTheDocument());
    expect(screen.queryByText(/Explicación generada automáticamente/)).not.toBeInTheDocument();
  });

  it("sin preguntas muestra un estado vacío y permite volver", async () => {
    const user = userEvent.setup();
    const onFinalizar = vi.fn();
    render(<TestRunner titulo="Test" preguntas={[]} onFinalizar={onFinalizar} onLimiteAlcanzado={vi.fn()} />);

    expect(screen.getByText(/No hay preguntas disponibles/)).toBeInTheDocument();
    await user.click(screen.getByTestId("volver-vacio"));
    expect(onFinalizar).toHaveBeenCalledWith({ totalPreguntas: 0, aciertos: 0, fallos: 0, duracionMs: 0 });
  });
});
