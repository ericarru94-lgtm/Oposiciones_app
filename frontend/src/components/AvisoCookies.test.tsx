import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AvisoCookies } from "./AvisoCookies";
import { analyticsConfigurado, cargarAnalytics } from "../lib/analytics";

vi.mock("../lib/analytics", () => ({
  analyticsConfigurado: vi.fn(),
  cargarAnalytics: vi.fn(),
}));

const CLAVE = "aprobox-consentimiento-cookies";

beforeEach(() => {
  localStorage.clear();
  vi.mocked(analyticsConfigurado).mockReturnValue(true);
  vi.mocked(cargarAnalytics).mockClear();
});
afterEach(() => localStorage.clear());

describe("AvisoCookies", () => {
  it("no muestra nada si Analytics no está configurado, aunque no haya decisión guardada", () => {
    vi.mocked(analyticsConfigurado).mockReturnValue(false);
    render(<AvisoCookies />);
    expect(screen.queryByText(/Usamos cookies analíticas/)).not.toBeInTheDocument();
  });

  it("muestra el banner en la primera visita (sin decisión guardada)", () => {
    render(<AvisoCookies />);
    expect(screen.getByText(/Usamos cookies analíticas/)).toBeInTheDocument();
    expect(cargarAnalytics).not.toHaveBeenCalled();
  });

  it("al aceptar: carga Analytics, guarda la decisión y oculta el banner", async () => {
    const user = userEvent.setup();
    render(<AvisoCookies />);

    await user.click(screen.getByRole("button", { name: "Aceptar" }));

    expect(cargarAnalytics).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CLAVE)).toBe("aceptado");
    expect(screen.queryByText(/Usamos cookies analíticas/)).not.toBeInTheDocument();
  });

  it("al rechazar: no carga Analytics, guarda la decisión y oculta el banner", async () => {
    const user = userEvent.setup();
    render(<AvisoCookies />);

    await user.click(screen.getByRole("button", { name: "Rechazar" }));

    expect(cargarAnalytics).not.toHaveBeenCalled();
    expect(localStorage.getItem(CLAVE)).toBe("rechazado");
    expect(screen.queryByText(/Usamos cookies analíticas/)).not.toBeInTheDocument();
  });

  it("si ya había un consentimiento aceptado guardado, no muestra el banner y carga Analytics solo", () => {
    localStorage.setItem(CLAVE, "aceptado");
    render(<AvisoCookies />);
    expect(screen.queryByText(/Usamos cookies analíticas/)).not.toBeInTheDocument();
    expect(cargarAnalytics).toHaveBeenCalledTimes(1);
  });

  it("si ya había un rechazo guardado, no muestra el banner ni carga Analytics", () => {
    localStorage.setItem(CLAVE, "rechazado");
    render(<AvisoCookies />);
    expect(screen.queryByText(/Usamos cookies analíticas/)).not.toBeInTheDocument();
    expect(cargarAnalytics).not.toHaveBeenCalled();
  });
});
