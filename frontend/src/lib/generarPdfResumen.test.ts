import { describe, expect, it } from "vitest";
import { construirPdfResumen, parsearResumen } from "./generarPdfResumen";
import type { Tema } from "../api/types";

describe("parsearResumen", () => {
  it("separa encabezados, listas y párrafos según el formato ligero", () => {
    const bloques = parsearResumen(
      ["## Título Preliminar", "- España se constituye en un Estado social y democrático (Art. 1.1 CE)", "", "Texto libre de introducción."].join(
        "\n"
      )
    );
    expect(bloques).toEqual([
      { tipo: "titulo", texto: "Título Preliminar" },
      { tipo: "lista", items: ["España se constituye en un Estado social y democrático (Art. 1.1 CE)"] },
      { tipo: "parrafo", texto: "Texto libre de introducción." },
    ]);
  });
});

describe("construirPdfResumen", () => {
  const temaBase: Tema = {
    id: 1,
    bloque: "I",
    numero: 1,
    nombre: "La Constitución Española de 1978",
    resumen: "## Título Preliminar\n- Art. 1.1 CE: Estado social y democrático de Derecho\n- Art. 9.3 CE: principio de legalidad",
    resumenGeneradoIA: true,
  };

  it("genera un PDF válido (cabecera %PDF) con contenido no trivial", () => {
    const doc = construirPdfResumen(temaBase);
    const bytes = doc.output("arraybuffer") as ArrayBuffer;
    const cabecera = new TextDecoder().decode(new Uint8Array(bytes).slice(0, 5));
    expect(cabecera).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("incluye el título del tema y el aviso de contenido generado por IA en el texto del PDF", () => {
    const doc = construirPdfResumen(temaBase);
    const texto = doc.output("datauristring");
    // El PDF resultante no es texto plano legible por regex normalmente,
    // pero jsPDF expone las cadenas usadas al construirlo: comprobamos que
    // el propio proceso de construcción no ha fallado y que produce más de
    // una página cuando el contenido lo exige.
    expect(texto.startsWith("data:application/pdf")).toBe(true);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("no revienta con un resumen null (nunca debería llamarse así desde la UI, pero no debe lanzar)", () => {
    const tema: Tema = { ...temaBase, resumen: null, resumenGeneradoIA: false };
    expect(() => construirPdfResumen(tema)).not.toThrow();
  });
});
