import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Upgrade } from "./Upgrade";
import { crearCheckoutSession } from "../api/endpoints";
import { useSession } from "../context/SessionContext";

vi.mock("../context/SessionContext", () => ({
  useSession: vi.fn(),
}));
vi.mock("../api/endpoints", () => ({
  crearCheckoutSession: vi.fn(),
}));

/** Ruta destino a la que debería llegar el usuario al pulsar "Suscribirme" sin sesión. */
function renderUpgrade(rutaInicial = "/upgrade") {
  return render(
    <MemoryRouter initialEntries={[rutaInicial]}>
      <Routes>
        <Route path="/upgrade" element={<Upgrade />} />
        <Route path="/registro" element={<p>Pantalla de registro</p>} />
        <Route path="/login" element={<p>Pantalla de login</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(crearCheckoutSession).mockReset();
  vi.mocked(useSession).mockReset();
  vi.stubGlobal("location", { ...window.location, href: "" });
});

describe("Upgrade — sin sesión", () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({
      estaAutenticado: false,
      cargando: false,
      getToken: vi.fn(),
    } as unknown as ReturnType<typeof useSession>);
  });

  it("pulsar 'Suscribirme' lleva al registro de Clerk, no llama al backend", async () => {
    const user = userEvent.setup();
    renderUpgrade();

    await user.click(screen.getByRole("button", { name: "Suscribirme" }));

    await waitFor(() => expect(screen.getByText("Pantalla de registro")).toBeInTheDocument());
    expect(crearCheckoutSession).not.toHaveBeenCalled();
  });

  it("ofrece un enlace para iniciar sesión si ya se tiene cuenta", async () => {
    const user = userEvent.setup();
    renderUpgrade();

    await user.click(screen.getByRole("button", { name: "Inicia sesión" }));

    await waitFor(() => expect(screen.getByText("Pantalla de login")).toBeInTheDocument());
  });
});

describe("Upgrade — con sesión", () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({
      estaAutenticado: true,
      cargando: false,
      getToken: vi.fn().mockResolvedValue("token-usuario"),
    } as unknown as ReturnType<typeof useSession>);
  });

  it("pulsar 'Suscribirme' crea la Checkout Session y redirige", async () => {
    const user = userEvent.setup();
    vi.mocked(crearCheckoutSession).mockResolvedValueOnce({ url: "https://checkout.stripe.com/pay/cs_test_1" });
    renderUpgrade();

    await user.click(screen.getByRole("button", { name: "Suscribirme" }));

    await waitFor(() => expect(crearCheckoutSession).toHaveBeenCalledWith("token-usuario"));
    await waitFor(() => expect(window.location.href).toBe("https://checkout.stripe.com/pay/cs_test_1"));
  });

  it("muestra un error si el backend rechaza el checkout", async () => {
    const user = userEvent.setup();
    vi.mocked(crearCheckoutSession).mockRejectedValueOnce(new Error("fallo cualquiera"));
    renderUpgrade();

    await user.click(screen.getByRole("button", { name: "Suscribirme" }));

    await waitFor(() =>
      expect(screen.getByText("No se pudo iniciar el pago. Inténtalo de nuevo.")).toBeInTheDocument()
    );
  });

  it("al volver con ?continuar=1 (tras registrarse/iniciar sesión desde el botón), continúa el pago solo", async () => {
    vi.mocked(crearCheckoutSession).mockResolvedValueOnce({ url: "https://checkout.stripe.com/pay/cs_test_2" });
    renderUpgrade("/upgrade?continuar=1");

    await waitFor(() => expect(crearCheckoutSession).toHaveBeenCalledWith("token-usuario"));
    await waitFor(() => expect(window.location.href).toBe("https://checkout.stripe.com/pay/cs_test_2"));
  });

  it("sin ?continuar=1 no llama sola al checkout, hay que pulsar el botón", () => {
    renderUpgrade("/upgrade");
    expect(crearCheckoutSession).not.toHaveBeenCalled();
  });
});
