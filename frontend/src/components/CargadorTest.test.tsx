import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CargadorTest } from "./CargadorTest";
import { ApiError } from "../api/client";
import type { PreguntaParaResponder } from "../api/types";

vi.mock("../context/SessionContext", () => ({
  useSession: vi.fn(() => ({ getToken: vi.fn(), sesionAnonima: "sesion-test" })),
}));

const preguntas: PreguntaParaResponder[] = [
  { id: "p1", enunciado: "¿Pregunta 1?", opciones: ["A", "B", "C", "D"], tipo: "teorica", temaId: null },
];

describe("CargadorTest", () => {
  it("con un 429 al cargar (límite diario ya agotado), llama a onLimiteAlcanzado en vez de mostrar un error genérico", async () => {
    const onLimiteAlcanzado = vi.fn();
    const cargar = vi.fn().mockRejectedValue(new ApiError(429, { error: "Has alcanzado el límite diario de preguntas del plan gratuito" }));

    render(
      <CargadorTest titulo="Repasar hoy" cargar={cargar} onFinalizar={vi.fn()} onLimiteAlcanzado={onLimiteAlcanzado} />
    );

    await waitFor(() => expect(onLimiteAlcanzado).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/l[ií]mite diario/i)).not.toBeInTheDocument();
  });

  it("con un error que no es 429, muestra el mensaje de error (no llama a onLimiteAlcanzado)", async () => {
    const onLimiteAlcanzado = vi.fn();
    const cargar = vi.fn().mockRejectedValue(new Error("Fallo de red"));

    render(
      <CargadorTest titulo="Repasar hoy" cargar={cargar} onFinalizar={vi.fn()} onLimiteAlcanzado={onLimiteAlcanzado} />
    );

    await waitFor(() => expect(screen.getByText("Fallo de red")).toBeInTheDocument());
    expect(onLimiteAlcanzado).not.toHaveBeenCalled();
  });

  it("con preguntas cargadas con éxito, monta el TestRunner", async () => {
    const cargar = vi.fn().mockResolvedValue(preguntas);

    render(<CargadorTest titulo="Repasar hoy" cargar={cargar} onFinalizar={vi.fn()} onLimiteAlcanzado={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("¿Pregunta 1?")).toBeInTheDocument());
  });
});
