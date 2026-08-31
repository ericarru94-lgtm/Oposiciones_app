import { parsearResumen } from "../lib/generarPdfResumen";

/**
 * Renderiza el resumen/esquema de un tema (texto plano con una convención
 * ligera: "## " para encabezados de sección y "- " para puntos de la
 * lista) sin depender de una librería de markdown — el formato que
 * generamos es lo bastante simple como para no necesitarla. El parseo lo
 * comparte con la generación del PDF (lib/generarPdfResumen.ts) para no
 * mantener dos lectores del mismo formato.
 */
export function EsquemaResumen({ texto }: { texto: string }) {
  const bloques = parsearResumen(texto).map((bloque, i) => {
    if (bloque.tipo === "titulo") {
      return (
        <h3 key={i} className="mt-5 text-sm font-semibold text-ink first:mt-0">
          {bloque.texto}
        </h3>
      );
    }
    if (bloque.tipo === "lista") {
      return (
        <ul key={i} className="ml-1 list-disc space-y-1.5 pl-4">
          {bloque.items.map((item, j) => (
            <li key={j}>{item}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={i} className="text-sm text-muted">
        {bloque.texto}
      </p>
    );
  });

  return <div className="space-y-2 text-sm leading-relaxed text-ink">{bloques}</div>;
}
