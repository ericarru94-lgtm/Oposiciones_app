/**
 * Redistribuye la posición de la opción correcta en el dataset de
 * preguntas para que ninguna letra (A/B/C/D) quede sobrerrepresentada.
 *
 * No es un shuffle "por pregunta" simple: eso deja la posición de cada
 * pregunta al azar, pero con ~1000 preguntas el resultado agregado puede
 * seguir desviándose de forma perceptible. En su lugar, se reparte a
 * propósito un cupo casi idéntico de correctas entre A/B/C/D (repartiendo
 * el resto, si no es múltiplo de 4, entre letras elegidas al azar) y
 * LUEGO se asigna aleatoriamente qué pregunta recibe cada letra — así el
 * resultado es tanto equilibrado (cada letra ~25% del total) como
 * impredecible (qué pregunta le toca cada letra es puro azar, y las 3
 * opciones incorrectas de cada pregunta también se reordenan al azar
 * entre sí, para no dejar un patrón secundario ahí).
 *
 * Solo toca preguntas con estado "verificada" (las únicas que de verdad
 * se sirven en los tests, ver routes/preguntas.ts) y con exactamente 4
 * opciones + respuesta_correcta no nula. Reescribe
 * data/preguntas_auxiliar_estado_combinado.json en el mismo formato (2
 * espacios de indentación). Después hace falta `npm run import:questions`
 * para llevar el nuevo orden a una base de datos ya poblada — el import
 * ya protege el reordenamiento en preguntas ya revisadas (mismo conjunto
 * de textos, mismo texto de la respuesta correcta, solo cambia el orden).
 *
 * Uso: npm run aleatorizar-respuestas
 */
import fs from "fs";
import path from "path";

type Letra = "a" | "b" | "c" | "d";
const LETRAS: Letra[] = ["a", "b", "c", "d"];

interface PreguntaJSON {
  id: string;
  opciones: string[];
  respuesta_correcta: string | null;
  estado: string;
  [clave: string]: unknown;
}

/** Fisher-Yates in-place: cada permutación de `array` es igual de probable. */
function barajar<T>(array: T[]): T[] {
  const copia = [...array];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function main() {
  const rutaArchivo = path.join(__dirname, "../../data/preguntas_auxiliar_estado_combinado.json");
  const preguntas: PreguntaJSON[] = JSON.parse(fs.readFileSync(rutaArchivo, "utf-8"));

  const elegibles = preguntas.filter(
    (p) => p.estado === "verificada" && p.opciones?.length === 4 && p.respuesta_correcta
  );

  // Cupo de correctas por letra: base a partes iguales + el resto (si
  // elegibles.length no es múltiplo de 4) repartido entre letras
  // elegidas al azar, para no favorecer sistemáticamente a "a".
  const base = Math.floor(elegibles.length / 4);
  const resto = elegibles.length - base * 4;
  const letrasConExtra = new Set(barajar(LETRAS).slice(0, resto));
  const bolsaLetras: Letra[] = [];
  for (const letra of LETRAS) {
    const cupo = base + (letrasConExtra.has(letra) ? 1 : 0);
    for (let i = 0; i < cupo; i++) bolsaLetras.push(letra);
  }
  const asignacion = barajar(bolsaLetras); // qué pregunta recibe cada letra: al azar

  let cambiadas = 0;
  elegibles.forEach((p, i) => {
    const indiceActual = LETRAS.indexOf(p.respuesta_correcta as Letra);
    const textoCorrecta = p.opciones[indiceActual];
    const textosIncorrectos = barajar(p.opciones.filter((_, idx) => idx !== indiceActual));

    const letraNueva = asignacion[i];
    const nuevasOpciones: string[] = [];
    let cursor = 0;
    for (const letra of LETRAS) {
      nuevasOpciones.push(letra === letraNueva ? textoCorrecta : textosIncorrectos[cursor++]);
    }

    if (JSON.stringify(nuevasOpciones) !== JSON.stringify(p.opciones) || letraNueva !== p.respuesta_correcta) {
      cambiadas++;
    }
    p.opciones = nuevasOpciones;
    p.respuesta_correcta = letraNueva;
  });

  fs.writeFileSync(rutaArchivo, JSON.stringify(preguntas, null, 2) + "\n");

  const recuento: Record<Letra, number> = { a: 0, b: 0, c: 0, d: 0 };
  for (const p of elegibles) recuento[p.respuesta_correcta as Letra]++;
  console.log(`${elegibles.length} preguntas elegibles, ${cambiadas} reordenadas.`);
  console.log("Nuevo recuento de respuestas correctas:", recuento);
}

main();
