import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComunidadComparativa } from "./ComunidadComparativa";
import type { ProgresoComunidad } from "../api/types";

describe("ComunidadComparativa", () => {
  it("no renderiza nada mientras no hay datos todavía", () => {
    const { container } = render(<ComunidadComparativa comunidad={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("muestra un aviso (sin cifras) cuando la muestra es demasiado pequeña", () => {
    const comunidad: ProgresoComunidad = {
      disponible: false,
      usuariosComparados: 2,
      propia: { racha: 3, precision: 0.8 },
      media: null,
    };
    render(<ComunidadComparativa comunidad={comunidad} />);
    expect(screen.getByText(/Todavía no hay suficientes usuarios activos/)).toBeInTheDocument();
    expect(screen.queryByText(/% de acierto/)).not.toBeInTheDocument();
  });

  it("muestra la racha y el % de acierto propios frente a la media, sin nombres", () => {
    const comunidad: ProgresoComunidad = {
      disponible: true,
      usuariosComparados: 12,
      propia: { racha: 7, precision: 0.75 },
      media: { racha: 3, precision: 0.6 },
    };
    render(<ComunidadComparativa comunidad={comunidad} />);

    expect(screen.getByText(/Comparativa con la comunidad/)).toBeInTheDocument();
    expect(screen.getByText(/otros 12 usuarios/)).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
  });
});
