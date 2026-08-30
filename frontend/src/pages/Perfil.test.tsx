import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Perfil } from "./Perfil";
import { crearPortalSession, obtenerResumenProgreso } from "../api/endpoints";
import { useSession } from "../context/SessionContext";

vi.mock("../context/SessionContext", () => ({
  useSession: vi.fn(),
}));
vi.mock("../api/endpoints", () => ({
  obtenerResumenProgreso: vi.fn(),
  crearPortalSession: vi.fn(),
}));

function renderPerfil() {
  return render(
    <MemoryRouter initialEntries={["/perfil"]}>
      <Routes>
        <Route path="/perfil" element={<Perfil />} />
        <Route path="/upgrade" element={<p>Pantalla de upgrade</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(obtenerResumenProgreso).mockResolvedValue({
    totalIntentos: 10,
    precision: 0.5,
    racha: { dias: 1 },
  } as unknown as Awaited<ReturnType<typeof obtenerResumenProgreso>>);
  vi.mocked(crearPortalSession).mockReset();
  vi.stubGlobal("location", { ...window.location, href: "" });
});

describe("Perfil — plan gratuito", () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({
      usuario: { plan: "free", email: "gratis@example.com" },
      perfilExterno: { nombreCompleto: null, email: "gratis@example.com", imagenUrl: null },
      getToken: vi.fn().mockResolvedValue("token"),
    } as unknown as ReturnType<typeof useSession>);
  });

  it("muestra un botón 'Hazte premium' que lleva a /upgrade", async () => {
    const user = userEvent.setup();
    renderPerfil();

    const boton = await screen.findByRole("button", { name: "Hazte premium" });
    await user.click(boton);

    await waitFor(() => expect(screen.getByText("Pantalla de upgrade")).toBeInTheDocument());
    expect(crearPortalSession).not.toHaveBeenCalled();
  });
});

describe("Perfil — plan premium", () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({
      usuario: { plan: "premium", email: "premium@example.com" },
      perfilExterno: { nombreCompleto: null, email: "premium@example.com", imagenUrl: null },
      getToken: vi.fn().mockResolvedValue("token"),
    } as unknown as ReturnType<typeof useSession>);
  });

  it("muestra 'Gestionar suscripción' que crea la sesión del Billing Portal y redirige", async () => {
    const user = userEvent.setup();
    vi.mocked(crearPortalSession).mockResolvedValueOnce({ url: "https://billing.stripe.com/session/test" });
    renderPerfil();

    const boton = await screen.findByRole("button", { name: "Gestionar suscripción" });
    await user.click(boton);

    await waitFor(() => expect(crearPortalSession).toHaveBeenCalledWith("token"));
    await waitFor(() => expect(window.location.href).toBe("https://billing.stripe.com/session/test"));
  });

  it("no muestra el botón de 'Hazte premium'", async () => {
    renderPerfil();
    await screen.findByRole("button", { name: "Gestionar suscripción" });
    expect(screen.queryByRole("button", { name: "Hazte premium" })).not.toBeInTheDocument();
  });
});

describe("Perfil — premium con cancelación programada", () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({
      usuario: {
        plan: "premium",
        email: "premium@example.com",
        cancelaAlFinalizarPeriodo: true,
        premiumHasta: "2026-12-31T12:00:00.000Z",
      },
      perfilExterno: { nombreCompleto: null, email: "premium@example.com", imagenUrl: null },
      getToken: vi.fn().mockResolvedValue("token"),
    } as unknown as ReturnType<typeof useSession>);
  });

  it("avisa de que la suscripción ya está cancelada y hasta cuándo dura el acceso", async () => {
    renderPerfil();
    expect(await screen.findByText(/Suscripción cancelada/)).toBeInTheDocument();
    expect(screen.getByText(/31\/12\/2026/)).toBeInTheDocument();
  });
});
