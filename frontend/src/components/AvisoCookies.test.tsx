import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AvisoCookies } from "./AvisoCookies";
import { actualizarConsentimiento, analyticsConfigurado } from "../lib/analytics";

vi.mock("../lib/analytics", () => ({
  analyticsConfigurado: vi.fn(),
  actualizarConsentimiento: vi.fn(),
}));

const CLAVE = "aprobox-consentimiento-cookies";

beforeEach(() => {
  localStorage.clear();
  vi.mocked(analyticsConfigurado).mockReturnValue(true);
  vi.mocked(actualizarConsentimiento).mockClear();
});
afterEach(() => localStorage.clear());

describe("AvisoCookies", () => {
  it("no muestra nada si Analytics no está configurado, aunque no haya decisión guardada", () => {
    vi.mocked(analyticsConfigurado).mockReturnValue(false);
    render(<AvisoCookies />);
    expect(screen.queryByText(/Usamos cookies analíticas/)).not.toBeInTheDocument();
  });

  it("muestra el banner en la primera visita (sin decisión guardada) y no toca el consentimiento", () => {
    render(<AvisoCookies />);
    expect(screen.getByText(/Usamos cookies analíticas/)).toBeInTheDocument();
    expect(actualizarConsentimiento).not.toHaveBeenCalled();
  });

  it("al aceptar: concede el consentimiento, guarda la decisión y oculta el banner", async () => {
    const user = userEvent.setup();
    render(<AvisoCookies />);

    await user.click(screen.getByRole("button", { name: "Aceptar" }));

    expect(actualizarConsentimiento).toHaveBeenCalledWith(true);
    expect(localStorage.getItem(CLAVE)).toBe("aceptado");
    expect(screen.queryByText(/Usamos cookies analíticas/)).not.toBeInTheDocument();
  });

  it("al rechazar: deniega el consentimiento, guarda la decisión y oculta el banner", async () => {
    const user = userEvent.setup();
    render(<AvisoCookies />);

    await user.click(screen.getByRole("button", { name: "Rechazar" }));

    expect(actualizarConsentimiento).toHaveBeenCalledWith(false);
    expect(localStorage.getItem(CLAVE)).toBe("rechazado");
    expect(screen.queryByText(/Usamos cookies analíticas/)).not.toBeInTheDocument();
  });

  it("si ya había un consentimiento aceptado guardado, no muestra el banner y concede el consentimiento", () => {
    localStorage.setItem(CLAVE, "aceptado");
    render(<AvisoCookies />);
    expect(screen.queryByText(/Usamos cookies analíticas/)).not.toBeInTheDocument();
    expect(actualizarConsentimiento).toHaveBeenCalledWith(true);
  });

  it("si ya había un rechazo guardado, no muestra el banner y deniega el consentimiento", () => {
    localStorage.setItem(CLAVE, "rechazado");
    render(<AvisoCookies />);
    expect(screen.queryByText(/Usamos cookies analíticas/)).not.toBeInTheDocument();
    expect(actualizarConsentimiento).toHaveBeenCalledWith(false);
  });
});
