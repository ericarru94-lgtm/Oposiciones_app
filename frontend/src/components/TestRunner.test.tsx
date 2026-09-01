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
      })
      .mockResolvedValueOnce({
        esCorrecta: true,
        respuestaCorrecta: "a",
        explicacion: null,
        fuente: null,
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
    });

    render(
      <TestRunner titulo="Test" preguntas={[preguntas[0]]} onFinalizar={vi.fn()} onLimiteAlcanzado={vi.fn()} />
    );
    await user.click(screen.getByTestId("opcion-a"));

    await waitFor(() => expect(screen.getByTestId("feedback")).toBeInTheDocument());
    expect(screen.queryByText(/Explicación generada automáticamente/)).not.toBeInTheDocument();
  });

  it("pregunta con tablaDatos: muestra la tabla y es resoluble con la respuesta correcta", async () => {
    // Datos reales de una de las 36 psicotécnicas revisadas (q0049, tabla
    // "Préstamos"): comprueba que la tabla se renderiza y que, con los datos
    // que contiene, la pregunta tiene una única respuesta correcta y coherente.
    const preguntaConTabla: PreguntaParaResponder = {
      id: "q0049",
      enunciado: "Tabla Préstamos: ¿editorial con más ejemplares disponibles?",
      opciones: ["Plaza & Janés.", "Santillana.", "Destino.", "Alfaguara."],
      tipo: "psicotecnica",
      temaId: null,
      tablaDatos: {
        titulo: "Préstamos de la biblioteca municipal (mes actual)",
        columnas: ["Título", "Autor", "Editorial", "Ciudad", "Año", "Ejemplares disponibles", "Ejemplares prestados", "Préstamos realizados"],
        filas: [
          ["Un calor tan cercano", "Puértolas, Soledad", "Anagrama", "Barcelona", 1980, 8, 2, 40],
          ["El amante lesbiano", "Marías, Javier", "Alfaguara", "Madrid", 1990, 6, 3, 35],
          ["Entre visillos", "Martín Gaite, Carmen", "Destino", "Barcelona", 1957, 10, 4, 50],
          ["Hija de la fortuna", "Puértolas, Soledad", "Plaza & Janés", "Barcelona", 1999, 12, 9, 45],
          ["El equipaje del viajero", "Martín Gaite, Carmen", "Santillana", "Madrid", 1996, 25, 5, 90],
          ["Aranmanoth", "Matute, Ana María", "Destino", "Barcelona", 2000, 4, 3, 30],
          ["La temporada de caza", "Sampedro, José Luis", "Alfaguara", "Madrid", 1995, 8, 4, 10],
        ],
      },
    };

    const user = userEvent.setup();
    vi.mocked(responderPregunta).mockResolvedValueOnce({
      esCorrecta: true,
      respuestaCorrecta: "b",
      explicacion: "Sumando por editorial, Santillana tiene 25 ejemplares disponibles (El equipaje del viajero), el máximo.",
      fuente: null,
    });

    render(
      <TestRunner titulo="Test" preguntas={[preguntaConTabla]} onFinalizar={vi.fn()} onLimiteAlcanzado={vi.fn()} />
    );

    // La tabla se ve antes de responder, con su título y todas las columnas.
    expect(screen.getByText("Préstamos de la biblioteca municipal (mes actual)")).toBeInTheDocument();
    expect(screen.getByText("Ejemplares disponibles")).toBeInTheDocument();
    expect(screen.getByText("Santillana")).toBeInTheDocument();
    expect(screen.getByText("Hija de la fortuna")).toBeInTheDocument();

    // Con los datos de la tabla, "Santillana" (opción b) es la única
    // editorial con más ejemplares disponibles (25, ninguna otra suma más).
    await user.click(screen.getByTestId("opcion-b"));

    await waitFor(() => expect(screen.getByTestId("feedback")).toBeInTheDocument());
    expect(screen.getByText(/¡Correcto!/)).toBeInTheDocument();
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
