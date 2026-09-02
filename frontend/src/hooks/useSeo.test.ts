import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSeo } from "./useSeo";

function limpiarHead() {
  document.title = "";
  document.head.querySelectorAll('meta[name], meta[property], link[rel="canonical"]').forEach((el) => el.remove());
}

afterEach(limpiarHead);

describe("useSeo", () => {
  it("fija título, description, canonical y las etiquetas OG/Twitter", () => {
    renderHook(() =>
      useSeo({ titulo: "Contacto", descripcion: "Escríbenos.", ruta: "/contacto" })
    );

    expect(document.title).toBe("Contacto | Aprobox");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("Escríbenos.");
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://aprobox.es/contacto"
    );
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(
      "https://aprobox.es/contacto"
    );
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe("Contacto | Aprobox");
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe(
      "https://aprobox.es/og-image.png"
    );
    expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe(
      "summary_large_image"
    );
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("index, follow");
  });

  it("con noIndexar, pone meta robots a noindex", () => {
    renderHook(() =>
      useSeo({ titulo: "Baja", descripcion: "Baja de la newsletter.", ruta: "/newsletter/baja", noIndexar: true })
    );

    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex");
  });

  it("reutiliza las etiquetas existentes (una sola de cada) al cambiar de página", () => {
    const { rerender } = renderHook((props) => useSeo(props), {
      initialProps: { titulo: "Contacto", descripcion: "Uno.", ruta: "/contacto" },
    });
    rerender({ titulo: "Aviso legal", descripcion: "Dos.", ruta: "/aviso-legal" });

    expect(document.title).toBe("Aviso legal | Aprobox");
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://aprobox.es/aviso-legal"
    );
  });
});
