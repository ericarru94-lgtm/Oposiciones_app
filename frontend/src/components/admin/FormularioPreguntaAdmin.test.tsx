import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormularioPreguntaAdmin } from "./FormularioPreguntaAdmin";
import { ApiError } from "../../api/client";
import { actualizarPreguntaAdmin } from "../../api/endpoints";
import { useSession } from "../../context/SessionContext";
import type { PreguntaAdmin } from "../../api/types";

vi.mock("../../context/SessionContext", () => ({
  useSession: vi.fn(),
}));
vi.mock("../../api/endpoints", () => ({
  actualizarPreguntaAdmin: vi.fn(),
}));

const preguntaBase: PreguntaAdmin = {
  id: "q1",
  temaId: 1,
  tema: { id: 1, bloque: "I", numero: 1, nombre: "La Constitución Española de 1978", resumen: null },
  enunciado: "¿Enunciado original?",
  opciones: ["Opción A", "Opción B", "Opción C", "Opción D"],
  respuestaCorrecta: "a",
  explicacion: null,
  fuente: null,
  origen: "examen_oficial",
  convocatoria: "2025",
  estado: "borrador",
  tipo: "teorica",
  numeroOriginalExamen: 1,
};

beforeEach(() => {
  vi.mocked(useSession).mockReturnValue({
    getToken: vi.fn().mockResolvedValue("token-admin"),
  } as unknown as ReturnType<typeof useSession>);
  vi.mocked(actualizarPreguntaAdmin).mockReset();
});

describe("FormularioPreguntaAdmin", () => {
  it("deshabilita 'Verificar' cuando la pregunta no tiene respuesta correcta", () => {
    render(
      <FormularioPreguntaAdmin
        pregunta={{ ...preguntaBase, respuestaCorrecta: null }}
        onCompletado={vi.fn()}
        onSaltar={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Verificar" })).toBeDisabled();
    expect(screen.getByText(/Selecciona la respuesta correcta/)).toBeInTheDocument();
  });

  it("permite editar el enunciado y verificar, enviando los cambios al backend", async () => {
    const user = userEvent.setup();
    vi.mocked(actualizarPreguntaAdmin).mockResolvedValueOnce({ pregunta: { ...preguntaBase, estado: "verificada" } });
    const onCompletado = vi.fn();

    render(<FormularioPreguntaAdmin pregunta={preguntaBase} onCompletado={onCompletado} onSaltar={vi.fn()} />);

    const textarea = screen.getByLabelText("Enunciado");
    await user.clear(textarea);
    await user.type(textarea, "Enunciado corregido");

    await user.click(screen.getByRole("button", { name: "Verificar" }));

    await waitFor(() => expect(actualizarPreguntaAdmin).toHaveBeenCalledTimes(1));
    expect(actualizarPreguntaAdmin).toHaveBeenCalledWith("token-admin", "q1", {
      enunciado: "Enunciado corregido",
      opciones: preguntaBase.opciones,
      respuestaCorrecta: "a",
      explicacion: null,
      fuente: null,
      estado: "verificada",
    });
    expect(onCompletado).toHaveBeenCalledTimes(1);
  });

  it("anular pide confirmación antes de llamar al backend", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<FormularioPreguntaAdmin pregunta={preguntaBase} onCompletado={vi.fn()} onSaltar={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Anular" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(actualizarPreguntaAdmin).not.toHaveBeenCalled();
  });

  it("anula la pregunta cuando se confirma", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(actualizarPreguntaAdmin).mockResolvedValueOnce({ pregunta: { ...preguntaBase, estado: "anulada" } });
    const onCompletado = vi.fn();

    render(<FormularioPreguntaAdmin pregunta={preguntaBase} onCompletado={onCompletado} onSaltar={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Anular" }));

    await waitFor(() => expect(onCompletado).toHaveBeenCalledTimes(1));
    expect(actualizarPreguntaAdmin).toHaveBeenCalledWith(
      "token-admin",
      "q1",
      expect.objectContaining({ estado: "anulada" })
    );
  });

  it("muestra un error si el backend rechaza el cambio y no avanza", async () => {
    const user = userEvent.setup();
    vi.mocked(actualizarPreguntaAdmin).mockRejectedValueOnce(
      new ApiError(400, { error: "No se puede marcar como verificada una pregunta sin respuesta correcta" })
    );
    const onCompletado = vi.fn();

    render(<FormularioPreguntaAdmin pregunta={preguntaBase} onCompletado={onCompletado} onSaltar={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Guardar sin verificar" }));

    await waitFor(() =>
      expect(screen.getByText("No se puede marcar como verificada una pregunta sin respuesta correcta")).toBeInTheDocument()
    );
    expect(onCompletado).not.toHaveBeenCalled();
  });

  it("Saltar no llama al backend", async () => {
    const user = userEvent.setup();
    const onSaltar = vi.fn();
    render(<FormularioPreguntaAdmin pregunta={preguntaBase} onCompletado={vi.fn()} onSaltar={onSaltar} />);
    await user.click(screen.getByRole("button", { name: "Saltar" }));
    expect(onSaltar).toHaveBeenCalledTimes(1);
    expect(actualizarPreguntaAdmin).not.toHaveBeenCalled();
  });
});
