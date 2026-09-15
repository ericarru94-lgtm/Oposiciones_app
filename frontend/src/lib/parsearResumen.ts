/**
 * Parsea el formato ligero de los resúmenes de tema (texto plano con
 * "## " para encabezados y "- " para puntos de lista) en una lista de
 * bloques tipados. Vive en su propio módulo, sin nada de jsPDF, para que
 * quien solo necesita pintar el resumen en pantalla (EsquemaResumen) no
 * arrastre la librería de generación de PDF (lib/generarPdfResumen.ts,
 * que sí usa esto) al bundle — juntos en el mismo archivo, cualquier
 * import estático de uno tira del otro y rompe el code-splitting.
 */
export type BloqueResumen =
  | { tipo: "titulo"; texto: string }
  | { tipo: "lista"; items: string[] }
  | { tipo: "parrafo"; texto: string };

export function parsearResumen(texto: string): BloqueResumen[] {
  const bloques: BloqueResumen[] = [];
  let listaActual: string[] = [];

  function cerrarLista() {
    if (listaActual.length === 0) return;
    bloques.push({ tipo: "lista", items: listaActual });
    listaActual = [];
  }

  for (const linea of texto.split("\n")) {
    if (linea.startsWith("## ")) {
      cerrarLista();
      bloques.push({ tipo: "titulo", texto: linea.slice(3) });
    } else if (linea.startsWith("- ")) {
      listaActual.push(linea.slice(2));
    } else if (linea.trim() === "") {
      cerrarLista();
    } else {
      cerrarLista();
      bloques.push({ tipo: "parrafo", texto: linea });
    }
  }
  cerrarLista();
  return bloques;
}
