import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppLayout } from "./AppLayout";
import { useSession } from "../context/SessionContext";

vi.mock("../context/SessionContext", () => ({
  useSession: vi.fn(),
}));

/**
 * El footer también tiene un enlace "Inicio" (ver Footer.tsx), así que hay
 * que acotar las búsquedas a la barra de navegación de la cabecera —
 * ambos <nav> del documento, el de la cabecera y el del footer.
 */
function navCabecera() {
  return within(screen.getAllByRole("navigation")[0]);
}

function renderEnRuta(ruta: string, esAdmin = false) {
  vi.mocked(useSession).mockReturnValue({
    usuario: { esAdmin },
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useSession>);

  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <AppLayout>
        <p>Contenido</p>
      </AppLayout>
    </MemoryRouter>
  );
}

describe("AppLayout — estado activo de la navegación", () => {
  it("marca 'Inicio' en negrita y el resto sin negrita en /home", () => {
    renderEnRuta("/home");
    expect(navCabecera().getByRole("link", { name: "Inicio" })).toHaveClass("font-bold");
    expect(navCabecera().getByRole("link", { name: "Tests" })).not.toHaveClass("font-bold");
    expect(navCabecera().getByRole("link", { name: "Perfil" })).not.toHaveClass("font-bold");
  });

  it("marca 'Tests' en negrita en /progreso", () => {
    renderEnRuta("/progreso");
    expect(navCabecera().getByRole("link", { name: "Tests" })).toHaveClass("font-bold");
    expect(navCabecera().getByRole("link", { name: "Inicio" })).not.toHaveClass("font-bold");
  });

  it("marca 'Tests' en negrita también al practicar un tema o ver su resumen", () => {
    renderEnRuta("/practicar/3");
    expect(navCabecera().getByRole("link", { name: "Tests" })).toHaveClass("font-bold");

    renderEnRuta("/temas/3/resumen");
    expect(navCabecera().getByRole("link", { name: "Tests" })).toHaveClass("font-bold");
  });

  it("marca 'Perfil' en negrita en /perfil", () => {
    renderEnRuta("/perfil");
    expect(navCabecera().getByRole("link", { name: "Perfil" })).toHaveClass("font-bold");
    expect(navCabecera().getByRole("link", { name: "Inicio" })).not.toHaveClass("font-bold");
  });

  it("marca 'Revisión' en negrita en /admin/revision para un admin", () => {
    renderEnRuta("/admin/revision", true);
    expect(navCabecera().getByRole("link", { name: "Revisión" })).toHaveClass("font-bold");
    expect(navCabecera().getByRole("link", { name: "Tests" })).not.toHaveClass("font-bold");
  });
});
