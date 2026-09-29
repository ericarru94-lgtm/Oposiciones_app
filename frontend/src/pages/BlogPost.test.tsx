import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BlogPost } from "./BlogPost";
import { ENTRADAS_BLOG } from "../content/blog";

function renderPost(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/blog/${slug}`]}>
      <Routes>
        <Route path="/blog/:slug" element={<BlogPost />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("BlogPost", () => {
  it("muestra el título y el cuerpo del artículo cuando el slug existe", () => {
    const entrada = ENTRADAS_BLOG[0];
    renderPost(entrada.slug);

    expect(screen.getByRole("heading", { name: entrada.titulo })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ver el temario completo/i })).toHaveAttribute("href", "/temario");
    expect(screen.getByRole("link", { name: /Empezar test gratis/i })).toHaveAttribute("href", "/onboarding");
  });

  it("muestra un aviso de no encontrado con un slug inexistente, sin romper la página", () => {
    renderPost("esto-no-existe");

    expect(screen.getByRole("heading", { name: /Artículo no encontrado/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Volver al blog/i })).toHaveAttribute("href", "/blog");
  });
});
