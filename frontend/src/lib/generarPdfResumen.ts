import { jsPDF } from "jspdf";
import type { Tema } from "../api/types";

/**
 * Parsea el mismo formato ligero que EsquemaResumen (texto plano con
 * "## " para encabezados y "- " para puntos de lista) en una lista de
 * bloques tipados, reutilizable tanto para pintar en pantalla como para
 * generar el PDF sin duplicar la lógica de parseo.
 */
type BloqueResumen = { tipo: "titulo"; texto: string } | { tipo: "lista"; items: string[] } | { tipo: "parrafo"; texto: string };

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

const COLOR_PRIMARY = "#4338ca";
const COLOR_ACCENT = "#f59e0b";
const COLOR_INK = "#1e1b2e";
const COLOR_MUTED = "#6b7280";

const MARGEN = 18;
const ANCHO_UTIL = 210 - MARGEN * 2; // A4 en mm, menos márgenes

/**
 * Construye (sin descargar) el PDF con el esquema del tema: título,
 * apartados y citas legales, con la marca Aprobox. Separado de
 * `generarPdfResumen` para poder probar el contenido generado (p.ej. con
 * `doc.output("arraybuffer")`) sin depender del DOM que necesita `.save()`.
 */
export function construirPdfResumen(tema: Tema): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGEN;

  function nuevaPaginaSiHaceFalta(alturaNecesaria: number) {
    if (y + alturaNecesaria > 297 - MARGEN) {
      pintarPiePagina();
      doc.addPage();
      y = MARGEN;
    }
  }

  function pintarPiePagina() {
    const pagina = doc.getCurrentPageInfo().pageNumber;
    doc.setFontSize(8);
    doc.setTextColor(COLOR_MUTED);
    doc.text("Aprobox — aprobox.app", MARGEN, 290);
    doc.text(String(pagina), 210 - MARGEN, 290, { align: "right" });
  }

  // Cabecera de marca.
  doc.setFillColor(COLOR_PRIMARY);
  doc.roundedRect(MARGEN, y, 10, 10, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor("#ffffff");
  doc.text("A", MARGEN + 5, y + 6.8, { align: "center" });
  doc.setFillColor(COLOR_ACCENT);
  doc.circle(MARGEN + 8, y + 2.2, 1.3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(COLOR_PRIMARY);
  doc.text("Aprobox", MARGEN + 14, y + 6.8);
  y += 16;

  doc.setDrawColor(COLOR_ACCENT);
  doc.setLineWidth(0.8);
  doc.line(MARGEN, y, MARGEN + ANCHO_UTIL, y);
  y += 8;

  // Título del tema.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(COLOR_INK);
  const tituloLineas = doc.splitTextToSize(`Tema ${tema.numero}. ${tema.nombre}`, ANCHO_UTIL);
  doc.text(tituloLineas, MARGEN, y);
  y += tituloLineas.length * 7 + 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(COLOR_MUTED);
  doc.text(`Bloque ${tema.bloque} — esquema de repaso`, MARGEN, y);
  y += 10;

  // Cuerpo del resumen.
  const bloques = parsearResumen(tema.resumen ?? "");
  for (const bloque of bloques) {
    if (bloque.tipo === "titulo") {
      nuevaPaginaSiHaceFalta(12);
      y += 3;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(COLOR_PRIMARY);
      const lineas = doc.splitTextToSize(bloque.texto, ANCHO_UTIL);
      doc.text(lineas, MARGEN, y);
      y += lineas.length * 6 + 2;
    } else if (bloque.tipo === "parrafo") {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(COLOR_INK);
      const lineas = doc.splitTextToSize(bloque.texto, ANCHO_UTIL);
      nuevaPaginaSiHaceFalta(lineas.length * 5 + 2);
      doc.text(lineas, MARGEN, y);
      y += lineas.length * 5 + 3;
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(COLOR_INK);
      for (const item of bloque.items) {
        const lineas = doc.splitTextToSize(item, ANCHO_UTIL - 6);
        nuevaPaginaSiHaceFalta(lineas.length * 5 + 1);
        doc.setFillColor(COLOR_ACCENT);
        doc.circle(MARGEN + 1.3, y - 1.3, 0.8, "F");
        doc.text(lineas, MARGEN + 5, y);
        y += lineas.length * 5 + 1;
      }
      y += 2;
    }
  }

  if (tema.resumenGeneradoIA) {
    nuevaPaginaSiHaceFalta(10);
    y += 4;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(COLOR_MUTED);
    const aviso = doc.splitTextToSize(
      "Resumen generado automáticamente — verifica siempre el contenido con otras fuentes.",
      ANCHO_UTIL
    );
    doc.text(aviso, MARGEN, y);
  }

  pintarPiePagina();
  return doc;
}

/** Genera y descarga (en el navegador) el PDF del esquema del tema. */
export function generarPdfResumen(tema: Tema) {
  const doc = construirPdfResumen(tema);
  const nombreArchivo = `aprobox-tema-${tema.bloque}${tema.numero}-resumen.pdf`;
  doc.save(nombreArchivo);
}
