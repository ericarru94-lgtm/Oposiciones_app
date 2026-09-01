import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Auth } from "./Auth";

vi.mock("../context/SessionContext", () => ({
  usandoClerk: false,
  iniciarSesionBypass: vi.fn(),
}));

function renderAuth() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<Auth modoInicial="login" />} />
        <Route path="/" element={<p>Landing</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Auth", () => {
  it("muestra un enlace para volver a la landing sin tener que autenticarse", () => {
    renderAuth();

    const enlace = screen.getByRole("link", { name: /volver a aprobox/i });
    expect(enlace).toHaveAttribute("href", "/");
  });
});
