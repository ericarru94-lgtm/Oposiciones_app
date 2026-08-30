/**
 * Renderiza el resumen/esquema de un tema (texto plano con una convención
 * ligera: "## " para encabezados de sección y "- " para puntos de la
 * lista) sin depender de una librería de markdown — el formato que
 * generamos es lo bastante simple como para no necesitarla.
 */
export function EsquemaResumen({ texto }: { texto: string }) {
  const bloques: React.ReactNode[] = [];
  let listaActual: string[] = [];

  function cerrarLista() {
    if (listaActual.length === 0) return;
    bloques.push(
      <ul key={`ul-${bloques.length}`} className="ml-1 list-disc space-y-1.5 pl-4">
        {listaActual.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
    listaActual = [];
  }

  for (const linea of texto.split("\n")) {
    if (linea.startsWith("## ")) {
      cerrarLista();
      bloques.push(
        <h3 key={`h-${bloques.length}`} className="mt-5 text-sm font-semibold text-ink first:mt-0">
          {linea.slice(3)}
        </h3>
      );
    } else if (linea.startsWith("- ")) {
      listaActual.push(linea.slice(2));
    } else if (linea.trim() === "") {
      cerrarLista();
    } else {
      cerrarLista();
      bloques.push(
        <p key={`p-${bloques.length}`} className="text-sm text-muted">
          {linea}
        </p>
      );
    }
  }
  cerrarLista();

  return <div className="space-y-2 text-sm leading-relaxed text-ink">{bloques}</div>;
}
