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

interface PreguntaJSON {
  id: string;
  tema: { bloque: string; numero: number; nombre: string } | null;
  enunciado: string;
  opciones: string[];
  respuesta_correcta: string | null;
  explicacion: string | null;
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

  const temaIdPorClave = new Map<string, number>();
  for (const [key, tema] of temasUnicos) {
    const registrado = await prisma.tema.upsert({
      where: { bloque_numero: { bloque: tema.bloque as Bloque, numero: tema.numero } },
      create: {
        bloque: tema.bloque as Bloque,
        numero: tema.numero,
        nombre: tema.nombre,
      },
      update: { nombre: tema.nombre },
    });
    temaIdPorClave.set(key, registrado.id);
  }
  console.log(`${temaIdPorClave.size} temas sincronizados`);

  // 2) Upsert de las preguntas.
  let creadas = 0;
  let actualizadas = 0;
  for (const p of preguntas) {
    const temaId = p.tema ? temaIdPorClave.get(`${p.tema.bloque}-${p.tema.numero}`) : null;

    const data = {
      temaId: temaId ?? null,
      enunciado: p.enunciado,
      opciones: p.opciones,
      respuestaCorrecta: (p.respuesta_correcta as Opcion | null) ?? null,
      explicacion: p.explicacion,
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

    const existia = await prisma.pregunta.findUnique({ where: { id: p.id } });
    await prisma.pregunta.upsert({
      where: { id: p.id },
      create: { id: p.id, ...data },
      update: data,
    });
    if (existia) actualizadas++;
    else creadas++;
  }

  console.log(`Importación completada: ${creadas} creadas, ${actualizadas} actualizadas`);
}

main()
  .catch((err) => {
    console.error("Error importando preguntas:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
