import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ExamenOficial } from "./ExamenOficial";
import { obtenerExamenOficial } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { PreguntaParaResponder } from "../api/types";
import type { ResultadoSimulacro } from "../components/SimulacroRunner";

vi.mock("../api/endpoints", () => ({
  obtenerExamenOficial: vi.fn(),
}));
vi.mock("../context/SessionContext", () => ({
  useSession: () => ({
    usuario: { id: "u1", email: "a@a.com", plan: "gratis" },
    logout: vi.fn(),
    getToken: vi.fn().mockResolvedValue("token-test"),
  }),
}));

// Stub de SimulacroRunner: en vez de reproducir el flujo real de preguntas
// (ya cubierto por SimulacroRunner.test.tsx), expone un botón que dispara
// onFinalizar con un resultado fijo, para poder probar en aislamiento la
// orquestación de las dos fases y el cálculo de resultados de esta página.
vi.mock("../components/SimulacroRunner", () => ({
  SimulacroRunner: ({
    preguntas,
    onFinalizar,
  }: {
    preguntas: PreguntaParaResponder[];
    onFinalizar: (r: ResultadoSimulacro) => void;
  }) => (
    <div>
      <p data-testid="runner-preguntas">{preguntas.length} preguntas</p>
      <button
        onClick={() =>
          onFinalizar({
            totalPreguntas: preguntas.length,
            respuestas: preguntas.map((_, i) => ({ temaId: null, esCorrecta: i % 2 === 0 })),
            duracionMs: 1000,
            agotoTiempo: false,
          })
        }
      >
        Finalizar fase (stub)
      </button>
    </div>
  ),
}));

const preguntasParte1: PreguntaParaResponder[] = Array.from({ length: 60 }, (_, i) => ({
  id: `p1-${i}`,
  enunciado: `Pregunta parte 1 #${i}`,
  opciones: ["a", "b", "c", "d"],
  tipo: i < 30 ? "teorica" : "psicotecnica",
  temaId: i < 30 ? 1 : null,
}));
const preguntasParte2: PreguntaParaResponder[] = Array.from({ length: 50 }, (_, i) => ({
  id: `p2-${i}`,
  enunciado: `Pregunta parte 2 #${i}`,
  opciones: ["a", "b", "c", "d"],
  tipo: "teorica",
  temaId: 2,
}));

function renderExamen() {
  return render(
    <MemoryRouter initialEntries={["/simulacro/examen-oficial"]}>
      <Routes>
        <Route path="/simulacro/examen-oficial" element={<ExamenOficial />} />
        <Route path="/progreso" element={<p>Pantalla de progreso</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ExamenOficial", () => {
  beforeEach(() => {
    vi.mocked(obtenerExamenOficial).mockReset();
  });

  it("muestra la estructura fija (60 + 90min / 50 + 45min) antes de empezar", () => {
    renderExamen();
    expect(screen.getByText(/60 preguntas · 90 minutos/i)).toBeInTheDocument();
    expect(screen.getByText(/50 preguntas · 45 minutos/i)).toBeInTheDocument();
  });

  it("recorre Parte 1 -> transición -> Parte 2 -> resultados agregados", async () => {
    vi.mocked(obtenerExamenOficial).mockResolvedValue({
      parte1: { preguntas: preguntasParte1, tiempoLimiteMin: 90 },
      parte2: { preguntas: preguntasParte2, tiempoLimiteMin: 45 },
    });
    const user = userEvent.setup();
    renderExamen();

    await user.click(screen.getByRole("button", { name: "Empezar Parte 1" }));

    // Parte 1: 60 preguntas servidas al runner.
    expect(await screen.findByText("60 preguntas")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finalizar fase (stub)" }));

    // Transición: 30 de 60 correctas (índices pares) = 50%.
    expect(await screen.findByText(/Parte 1 completada/i)).toBeInTheDocument();
    expect(screen.getByText(/50% de acierto en la Parte 1/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Empezar Parte 2" }));

    // Parte 2: 50 preguntas servidas al runner.
    expect(await screen.findByText("50 preguntas")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finalizar fase (stub)" }));

    // Resultados agregados: 30/60 + 25/50 = 55/110 correctas.
    const resultados = await screen.findByTestId("resultados-examen-oficial");
    expect(resultados).toHaveTextContent("55 de 110 correctas");
  });

  it("si el backend responde que no hay preguntas suficientes, muestra el error y no avanza de fase", async () => {
    vi.mocked(obtenerExamenOficial).mockRejectedValue(
      new ApiError(409, { error: "Todavía no hay preguntas verificadas suficientes." })
    );
    const user = userEvent.setup();
    renderExamen();

    await user.click(screen.getByRole("button", { name: "Empezar Parte 1" }));

    expect(await screen.findByText(/Todavía no hay preguntas verificadas suficientes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Empezar Parte 1" })).toBeInTheDocument();
  });
});
