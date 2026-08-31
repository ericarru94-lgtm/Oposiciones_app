import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ResumenTema } from "./ResumenTema";
import { obtenerTemas } from "../api/endpoints";
import { generarPdfResumen } from "../lib/generarPdfResumen";
import { useSession } from "../context/SessionContext";
import type { Tema } from "../api/types";

vi.mock("../context/SessionContext", () => ({
  useSession: vi.fn(),
}));
vi.mock("../api/endpoints", () => ({
  obtenerTemas: vi.fn(),
}));
vi.mock("../lib/generarPdfResumen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/generarPdfResumen")>()),
  generarPdfResumen: vi.fn(),
}));

const temaConResumen: Tema = {
  id: 1,
  bloque: "I",
  numero: 1,
  nombre: "La Constitución Española de 1978",
  resumen: "## Título Preliminar\n- Art. 1.1 CE: Estado social y democrático de Derecho",
  resumenGeneradoIA: true,
};

const temaSinResumen: Tema = {
  id: 2,
  bloque: "I",
  numero: 2,
  nombre: "El Tribunal Constitucional",
  resumen: null,
};

function renderResumen(temaId: number) {
  return render(
    <MemoryRouter initialEntries={[`/temas/${temaId}/resumen`]}>
      <Routes>
        <Route path="/temas/:temaId/resumen" element={<ResumenTema />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ResumenTema", () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({
      usuario: { id: "u1", email: "a@a.com", plan: "gratis" },
      logout: vi.fn(),
    } as unknown as ReturnType<typeof useSession>);
    vi.mocked(generarPdfResumen).mockClear();
  });

  it("muestra el botón 'Descargar PDF' cuando el tema tiene resumen, y lo genera al pulsarlo", async () => {
    vi.mocked(obtenerTemas).mockResolvedValue({ temas: [temaConResumen, temaSinResumen] });
    const user = userEvent.setup();
    renderResumen(1);

    const boton = await screen.findByRole("button", { name: /Descargar PDF/i });
    await user.click(boton);

    expect(generarPdfResumen).toHaveBeenCalledTimes(1);
    expect(generarPdfResumen).toHaveBeenCalledWith(temaConResumen);
  });

  it("no muestra el botón 'Descargar PDF' cuando el tema todavía no tiene resumen", async () => {
    vi.mocked(obtenerTemas).mockResolvedValue({ temas: [temaConResumen, temaSinResumen] });
    renderResumen(2);

    await waitFor(() => expect(screen.getByText(/Todavía no hay un resumen/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Descargar PDF/i })).not.toBeInTheDocument();
  });
});
