import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Perfil } from "./Perfil";
import { crearPortalSession, obtenerProgresoPorTema } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import type { ProgresoPorTema } from "../api/types";

vi.mock("../context/SessionContext", () => ({
  useSession: vi.fn(),
}));
vi.mock("../api/endpoints", () => ({
  obtenerProgresoPorTema: vi.fn(),
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

const temaSinPracticar: ProgresoPorTema = {
  temaId: 1,
  bloque: "I",
  numero: 1,
  nombre: "La Constitución Española de 1978",
  totalPreguntas: 10,
  preguntasContestadas: 0,
  totalIntentos: 0,
  aciertos: 0,
  precision: null,
};

beforeEach(() => {
  vi.mocked(obtenerProgresoPorTema).mockResolvedValue({ temas: [temaSinPracticar] });
  vi.mocked(crearPortalSession).mockReset();
  vi.stubGlobal("location", { ...window.location, href: "" });
});

describe("Perfil — plan gratuito", () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({
      usuario: { plan: "free", email: "gratis@example.com", createdAt: "2026-01-15T12:00:00.000Z" },
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

  it("muestra la fecha de alta y, sin temas dominados, el mensaje de ánimo en vez de la insignia", async () => {
    renderPerfil();
    expect(await screen.findByText(/Opositando desde/)).toBeInTheDocument();
    expect(screen.getByText(/15 de enero de 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Aún no tienes temas dominados/)).toBeInTheDocument();
  });

  it("no muestra la cuadrícula de estadísticas de estudio (vive en Tests\\/Progreso)", async () => {
    renderPerfil();
    await screen.findByText(/Opositando desde/);
    expect(screen.queryByText("Preguntas respondidas")).not.toBeInTheDocument();
    expect(screen.queryByText("% de acierto")).not.toBeInTheDocument();
  });
});

describe("Perfil — con un tema dominado", () => {
  beforeEach(() => {
    vi.mocked(obtenerProgresoPorTema).mockResolvedValue({
      temas: [
        {
          ...temaSinPracticar,
          preguntasContestadas: 10,
          totalIntentos: 10,
          aciertos: 10,
          precision: 1,
        },
      ],
    });
    vi.mocked(useSession).mockReturnValue({
      usuario: { plan: "free", email: "gratis@example.com", createdAt: "2026-01-15T12:00:00.000Z" },
      perfilExterno: { nombreCompleto: null, email: "gratis@example.com", imagenUrl: null },
      getToken: vi.fn().mockResolvedValue("token"),
    } as unknown as ReturnType<typeof useSession>);
  });

  it("lista el tema dominado como insignia", async () => {
    renderPerfil();
    expect(await screen.findByText(/La Constitución Española de 1978/)).toBeInTheDocument();
    expect(screen.queryByText(/Aún no tienes temas dominados/)).not.toBeInTheDocument();
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
