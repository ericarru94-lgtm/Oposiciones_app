import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PantallaCargando } from "./PantallaCargando";

afterEach(() => {
  vi.useRealTimers();
});

describe("PantallaCargando", () => {
  it("muestra el spinner simple al principio, sin el aviso de timeout", () => {
    render(<PantallaCargando />);

    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/tardando más de lo normal/i)).not.toBeInTheDocument();
  });

  it("tras el timeout, muestra el aviso accionable con botón de recargar", () => {
    vi.useFakeTimers();
    render(<PantallaCargando />);

    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(screen.getByText(/tardando más de lo normal/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recargar" })).toBeInTheDocument();
  });
});
