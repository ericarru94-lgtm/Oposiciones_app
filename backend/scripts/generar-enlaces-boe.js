/**
 * Añade (o regenera) el campo `fuente_url` de cada pregunta del dataset
 * (backend/data/preguntas_auxiliar_estado_combinado.json) a partir del
 * texto ya existente en `fuente`, apuntando al artículo correspondiente en
 * la web de legislación consolidada del BOE.
 *
 * Uso: node scripts/generar-enlaces-boe.js
 *
 * Cómo funciona:
 * 1. Detecta qué norma cita `fuente` (por nombre completo o abreviatura:
 *    "CE", "TREBEP", "LO 3/2007"...) usando el diccionario LEYES de abajo,
 *    cuyos identificadores BOE-A-AAAA-NNNNN se han verificado uno a uno
 *    contra boe.es (búsqueda web, agosto 2026 — ver el informe de la
 *    conversación que introdujo este script para el detalle norma a norma).
 * 2. Si el texto de `fuente` incluye "Art./Arts./Artículo N", añade el
 *    ancla #aN al final de la URL para enlazar directamente a ese artículo
 *    dentro del texto consolidado (formato de ancla estándar de BOE para
 *    "legislación consolidada"). Si `fuente` cita varios artículos (p. ej.
 *    "Arts. 68.4 y 69.6 CE"), se ancla al primero.
 * 3. Si `fuente` solo nombra la ley (sin artículo) o cita una disposición
 *    adicional/transitoria/final en vez de un artículo, enlaza a la página
 *    de la ley sin ancla (evita adivinar un formato de ancla no verificado
 *    para disposiciones).
 * 4. Si `fuente` cita una norma que NO se publica en el BOE (derecho de la
 *    Unión Europea: RGPD, TUE, TFUE, tratados; o documentos no normativos
 *    como planes de Gobierno Abierto o protocolos institucionales), no
 *    genera enlace — `fuente_url` queda null. Enlazar a EUR-Lex en vez del
 *    BOE se descartó porque el encargo pedía explícitamente "la URL oficial
 *    del BOE", y BOE no publica esas normas.
 *
 * Importante: el ancla #aN no se ha podido verificar en vivo (el acceso a
 * boe.es está bloqueado en el entorno de desarrollo de este proyecto), pero
 * es el formato documentado y usado de forma consistente en enlaces reales
 * a legislación consolidada del BOE. Verificar manualmente en un navegador
 * tras desplegar, con un par de artículos, antes de darlo por definitivo.
 */
const fs = require("fs");
const path = require("path");

const RUTA_DATASET = path.join(__dirname, "..", "data", "preguntas_auxiliar_estado_combinado.json");

/**
 * Cada entrada: patrones (regex, probados en orden) → id BOE-A de la norma.
 * Los patrones más específicos van primero para evitar falsos positivos
 * (p. ej. "LO 3/2007" antes que un genérico "3/2007").
 */
const LEYES = [
  { id: "BOE-A-1978-31229", patrones: [/\bde la Constitución Española\b/i, /\bConstitución Española\b/i, /\bCE\b/] },
  {
    id: "BOE-A-2015-11719",
    patrones: [/\bTREBEP\b/, /Texto Refundido de la Ley del Estatuto Básico del Empleado Público/i, /RDLeg 5\/2015/i],
  },
  { id: "BOE-A-2013-12887", patrones: [/Ley 19\/2013/i] },
  { id: "BOE-A-2015-10565", patrones: [/Ley 39\/2015/i] },
  { id: "BOE-A-2015-10566", patrones: [/Ley 40\/2015/i] },
  { id: "BOE-A-2007-6115", patrones: [/LO 3\/2007/i, /Ley Orgánica 3\/2007/i] },
  { id: "BOE-A-2004-21760", patrones: [/LO 1\/2004/i, /Ley Orgánica 1\/2004/i] },
  { id: "BOE-A-2018-16673", patrones: [/LO 3\/2018/i, /Ley Orgánica 3\/2018/i] },
  { id: "BOE-A-2003-21614", patrones: [/Ley 47\/2003/i] },
  { id: "BOE-A-2007-19814", patrones: [/Ley 37\/2007/i] },
  { id: "BOE-A-1998-16718", patrones: [/Ley 29\/1998/i] },
  { id: "BOE-A-1997-25336", patrones: [/Ley 50\/1997/i] },
  { id: "BOE-A-1985-5392", patrones: [/Ley 7\/1985/i] },
  { id: "BOE-A-1981-10325", patrones: [/LO 3\/1981/i, /Ley Orgánica 3\/1981/i] },
  { id: "BOE-A-2013-12632", patrones: [/Real Decreto Legislativo 1\/2013/i] },
  { id: "BOE-A-2012-5730", patrones: [/LO 2\/2012/i, /Ley Orgánica 2\/2012/i] },
  { id: "BOE-A-2020-14046", patrones: [/Ley 6\/2020/i] },
  { id: "BOE-A-2011-18541", patrones: [/Real Decreto 1708\/2011/i] },
  { id: "BOE-A-1996-4997", patrones: [/Real Decreto 208\/1996/i] },
  { id: "BOE-A-2002-10337", patrones: [/Real Decreto 462\/2002/i] },
  { id: "BOE-A-2005-14836", patrones: [/Real Decreto 951\/2005/i] },
  { id: "BOE-A-2021-5032", patrones: [/Real Decreto 203\/2021/i] },
  { id: "BOE-A-2014-10908", patrones: [/Orden HAP\/1949\/2014/i] },
  { id: "BOE-A-2006-21990", patrones: [/Ley 39\/2006/i] },
  { id: "BOE-A-1984-17387", patrones: [/Ley 30\/1984/i] },
];

/**
 * Normas citadas en el dataset que NO se publican en el BOE (derecho de la
 * UE, documentos no normativos): se listan solo para dejar constancia
 * explícita de que se han considerado y descartado a propósito, no por
 * omisión. No se usan en la detección (ya no matchean ningún patrón de
 * LEYES), sirven de documentación.
 */
const SIN_BOE = [
  "TUE",
  "TFUE",
  "RGPD",
  "Reglamento (UE) 2016/679",
  "Reglamento (UE) 910/2014",
  "Tratado de Lisboa",
  "Tratado de Adhesión",
  "Tratado de retirada",
  "Protocolo sobre sedes de las instituciones",
  "Plan de Gobierno Abierto",
];

function detectarLey(fuente) {
  for (const ley of LEYES) {
    if (ley.patrones.some((re) => re.test(fuente))) return ley.id;
  }
  return null;
}

function extraerArticulo(fuente) {
  // "Art. 14", "Art.14", "Artículo 14", "Arts. 68.4 y 69.6" -> primer número
  const m = fuente.match(/Art(?:s?\.|ículo)\s*(\d+)/i);
  return m ? m[1] : null;
}

function construirUrl(fuente) {
  const leyId = detectarLey(fuente);
  if (!leyId) return null;
  const articulo = extraerArticulo(fuente);
  const base = `https://www.boe.es/buscar/act.php?id=${leyId}`;
  return articulo ? `${base}#a${articulo}` : base;
}

function main() {
  const dataset = JSON.parse(fs.readFileSync(RUTA_DATASET, "utf8"));

  let conEnlace = 0;
  let sinFuente = 0;
  let fuenteSinNormaBOE = 0;
  const normasNoBOE = new Set();

  for (const pregunta of dataset) {
    if (!pregunta.fuente) {
      sinFuente++;
      pregunta.fuente_url = null;
      continue;
    }
    const url = construirUrl(pregunta.fuente);
    if (url) {
      pregunta.fuente_url = url;
      conEnlace++;
    } else {
      pregunta.fuente_url = null;
      fuenteSinNormaBOE++;
      normasNoBOE.add(pregunta.fuente);
    }
  }

  fs.writeFileSync(RUTA_DATASET, JSON.stringify(dataset, null, 2) + "\n");

  console.log(`Total preguntas: ${dataset.length}`);
  console.log(`Con fuente_url generada: ${conEnlace}`);
  console.log(`Sin fuente (no aplica): ${sinFuente}`);
  console.log(`Con fuente pero sin norma BOE reconocida: ${fuenteSinNormaBOE}`);
  if (normasNoBOE.size > 0) {
    console.log("\nFuentes sin enlace generado (revisar si falta en el diccionario LEYES):");
    for (const f of [...normasNoBOE].sort()) console.log(" -", f);
  }
}

main();
