/**
 * Importa el dataset preguntas_auxiliar_estado_combinado.json a la base de
 * datos. Es idempotente: puede ejecutarse varias veces (upsert por id de
 * tema y de pregunta) para re-importar tras corregir o ampliar el dataset.
 *
 * Uso: npm run import:questions [-- ruta/al/archivo.json]
 */
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { Bloque, EstadoPregunta, Opcion, OrigenPregunta, TipoPregunta } from "@prisma/client";

interface ResumenTemaJSON {
  bloque: string;
  numero: number;
  resumen: string;
  resumen_generado_ia?: boolean;
}

interface PreguntaJSON {
  id: string;
  tema: { bloque: string; numero: number; nombre: string } | null;
  enunciado: string;
  opciones: string[];
  respuesta_correcta: string | null;
  explicacion: string | null;
  explicacion_generada_ia?: boolean;
  fuente: string | null;
  origen: string;
  convocatoria: string | null;
  estado: string;
  fecha_verificacion: string | null;
  reportes_usuario: number;
  tipo: string;
  es_pregunta_reserva: boolean;
  numero_original_examen: number | null;
}

async function main() {
  const rutaArg = process.argv[2];
  const rutaArchivo = rutaArg
    ? path.resolve(rutaArg)
    : path.join(__dirname, "../../data/preguntas_auxiliar_estado_combinado.json");

  console.log(`Leyendo dataset desde ${rutaArchivo}`);
  const raw = fs.readFileSync(rutaArchivo, "utf-8");
  const preguntas: PreguntaJSON[] = JSON.parse(raw);
  console.log(`${preguntas.length} preguntas encontradas en el dataset`);

  // 1) Upsert de todos los temas distintos primero, para poder referenciarlos.
  const temasUnicos = new Map<string, { bloque: string; numero: number; nombre: string }>();
  for (const p of preguntas) {
    if (!p.tema) continue;
    const key = `${p.tema.bloque}-${p.tema.numero}`;
    if (!temasUnicos.has(key)) temasUnicos.set(key, p.tema);
  }

  // Resúmenes de estudio por tema: fichero aparte (no van dentro de cada
  // pregunta) y opcional — todavía no cubre los 28 temas (empezó como
  // piloto en el Bloque I, ver backend/docs/contenido-estudio.md), así que
  // un tema ausente de este fichero simplemente no toca su `resumen` en
  // este import, sea cual sea su valor actual en la base de datos.
  const rutaResumenes = path.join(__dirname, "../../data/resumenes_temas.json");
  const resumenesPorClave = new Map<string, ResumenTemaJSON>();
  if (fs.existsSync(rutaResumenes)) {
    const resumenes: ResumenTemaJSON[] = JSON.parse(fs.readFileSync(rutaResumenes, "utf-8"));
    for (const r of resumenes) resumenesPorClave.set(`${r.bloque}-${r.numero}`, r);
  }

  const temaIdPorClave = new Map<string, number>();
  for (const [key, tema] of temasUnicos) {
    const resumenTema = resumenesPorClave.get(key);
    const datosResumen = resumenTema
      ? { resumen: resumenTema.resumen, resumenGeneradoIA: resumenTema.resumen_generado_ia ?? false }
      : {};
    const registrado = await prisma.tema.upsert({
      where: { bloque_numero: { bloque: tema.bloque as Bloque, numero: tema.numero } },
      create: {
        bloque: tema.bloque as Bloque,
        numero: tema.numero,
        nombre: tema.nombre,
        ...datosResumen,
      },
      update: { nombre: tema.nombre, ...datosResumen },
    });
    temaIdPorClave.set(key, registrado.id);
  }
  console.log(`${temaIdPorClave.size} temas sincronizados (${resumenesPorClave.size} con resumen de estudio en el dataset)`);

  // 2) Upsert de las preguntas. Una vez que un admin ha revisado una
  // pregunta (estado ya no es "borrador"), reimportar el dataset nunca la
  // toca: si no, un re-import pisaría sin darse cuenta el trabajo
  // editorial hecho en /admin/revision (volvería a "borrador" una
  // pregunta ya verificada, o restauraría el enunciado original sobre uno
  // corregido a mano). Ver backend/docs/banco-preguntas.md.
  let creadas = 0;
  let actualizadas = 0;
  let completadas = 0;
  let reordenadas = 0;
  let omitidas = 0;
  const LETRAS: Opcion[] = [Opcion.a, Opcion.b, Opcion.c, Opcion.d];
  for (const p of preguntas) {
    const temaId = p.tema ? temaIdPorClave.get(`${p.tema.bloque}-${p.tema.numero}`) : null;

    const existente = await prisma.pregunta.findUnique({ where: { id: p.id } });
    if (existente && existente.estado !== "borrador") {
      // No tocamos estado/enunciado/opciones/respuestaCorrecta de una
      // pregunta ya revisada por un admin (ver más abajo). Pero sí
      // completamos explicación/fuente si hoy están vacías en la fila y el
      // dataset ya trae contenido nuevo para ellas (p.ej. explicaciones
      // generadas por IA a posteriori) — nunca al revés, nunca pisando
      // contenido que ya existiera.
      const completar: {
        explicacion?: string;
        explicacionGeneradaIA?: boolean;
        fuente?: string;
        opciones?: string[];
        respuestaCorrecta?: Opcion;
      } = {};
      if (!existente.explicacion && p.explicacion) {
        completar.explicacion = p.explicacion;
        completar.explicacionGeneradaIA = p.explicacion_generada_ia ?? false;
      }
      if (!existente.fuente && p.fuente) completar.fuente = p.fuente;

      // Excepción también deliberada: si el dataset reordena las opciones
      // de una pregunta ya revisada (p.ej. para repartir mejor la posición
      // de la respuesta correcta) pero el CONTENIDO no cambia — mismo
      // conjunto de textos de opción, mismo texto en la respuesta
      // correcta —, sí aplicamos el nuevo orden. Es un reordenamiento, no
      // una reescritura: nunca se sobreescribe si el conjunto de textos
      // difiere (eso sí sería una edición de contenido, y esa se protege
      // como siempre).
      const opcionesJSON = p.opciones;
      const opcionesDB = existente.opciones as unknown as string[];
      const mismoConjunto =
        Array.isArray(opcionesDB) &&
        opcionesJSON.length === opcionesDB.length &&
        [...opcionesJSON].sort().join("|") === [...opcionesDB].sort().join("|");
      const indiceCorrectaJSON = p.respuesta_correcta ? LETRAS.indexOf(p.respuesta_correcta as Opcion) : -1;
      const indiceCorrectaDB =
        mismoConjunto && existente.respuestaCorrecta ? LETRAS.indexOf(existente.respuestaCorrecta) : -1;
      const textoCorrectaJSON = indiceCorrectaJSON >= 0 ? opcionesJSON[indiceCorrectaJSON] : null;
      const textoCorrectaDB = indiceCorrectaDB >= 0 ? opcionesDB[indiceCorrectaDB] : null;
      const ordenDistinto = JSON.stringify(opcionesJSON) !== JSON.stringify(opcionesDB);
      if (mismoConjunto && textoCorrectaJSON !== null && textoCorrectaJSON === textoCorrectaDB && ordenDistinto) {
        completar.opciones = opcionesJSON;
        completar.respuestaCorrecta = p.respuesta_correcta as Opcion;
      }

      if (Object.keys(completar).length > 0) {
        await prisma.pregunta.update({ where: { id: p.id }, data: completar });
        if (completar.opciones) reordenadas++;
        if (completar.explicacion || completar.fuente) completadas++;
        if (!completar.opciones && !completar.explicacion && !completar.fuente) omitidas++;
      } else {
        omitidas++;
      }
      continue;
    }

    const data = {
      temaId: temaId ?? null,
      enunciado: p.enunciado,
      opciones: p.opciones,
      respuestaCorrecta: (p.respuesta_correcta as Opcion | null) ?? null,
      explicacion: p.explicacion,
      explicacionGeneradaIA: p.explicacion_generada_ia ?? false,
      fuente: p.fuente,
      origen: p.origen as OrigenPregunta,
      convocatoria: p.convocatoria,
      estado: p.estado as EstadoPregunta,
      fechaVerificacion: p.fecha_verificacion ? new Date(p.fecha_verificacion) : null,
      reportesUsuario: p.reportes_usuario,
      tipo: p.tipo as TipoPregunta,
      esPreguntaReserva: p.es_pregunta_reserva,
      numeroOriginalExamen: p.numero_original_examen,
    };

    await prisma.pregunta.upsert({
      where: { id: p.id },
      create: { id: p.id, ...data },
      update: data,
    });
    if (existente) actualizadas++;
    else creadas++;
  }

  console.log(
    `Importación completada: ${creadas} creadas, ${actualizadas} actualizadas, ${completadas} completadas (explicación/fuente añadidas a preguntas ya revisadas), ${reordenadas} reordenadas (opciones reordenadas sin cambiar contenido en preguntas ya revisadas), ${omitidas} omitidas sin cambios`
  );
}

main()
  .catch((err) => {
    console.error("Error importando preguntas:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
