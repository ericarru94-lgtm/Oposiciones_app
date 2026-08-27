/**
 * Seed determinista para la base de datos de E2E (oposiciones_e2e).
 * Se ejecuta antes de cada tanda de tests de Playwright: borra todo lo que
 * hubiera (es una BD desechable, dedicada solo a E2E) y crea un dataset
 * mínimo y conocido.
 *
 * Cada spec de Playwright usa un tema distinto para no pisarse entre sí
 * (el orden de ejecución de los ficheros de test no está garantizado):
 *   - Tema 1 "Constitución": onboarding.spec (primer test) y
 *     daily-limit.spec (drenado del límite diario).
 *   - Tema 2 "práctica": test-screen.spec (responder/feedback/resumen).
 *   - Tema 3 "revisión": admin.spec (cola de revisión editorial).
 */
import { prisma } from "../lib/prisma";
import { Opcion } from "@prisma/client";

const OPCIONES_GENERICAS = ["Opción A", "Opción B", "Opción C", "Opción D"];

async function crearPreguntas(params: {
  prefijo: string;
  temaId: number;
  cantidad: number;
  estado: "borrador" | "verificada";
  respuestas: Opcion[] | Opcion;
}) {
  for (let i = 1; i <= params.cantidad; i++) {
    const respuestaCorrecta = Array.isArray(params.respuestas) ? params.respuestas[i - 1] : params.respuestas;
    await prisma.pregunta.create({
      data: {
        id: `${params.prefijo}-${i}`,
        temaId: params.temaId,
        enunciado: `[E2E] Pregunta ${i} (${params.prefijo})`,
        opciones: OPCIONES_GENERICAS,
        respuestaCorrecta,
        origen: "examen_oficial",
        estado: params.estado,
        tipo: "teorica",
      },
    });
  }
}

async function main() {
  console.log("Reseteando la base de datos de E2E…");
  await prisma.intento.deleteMany();
  await prisma.progreso.deleteMany();
  await prisma.pregunta.deleteMany();
  await prisma.tema.deleteMany();
  await prisma.usuario.deleteMany();

  const temaConstitucion = await prisma.tema.create({
    data: { bloque: "I", numero: 1, nombre: "La Constitución Española de 1978" },
  });
  await crearPreguntas({
    prefijo: "e2e-const",
    temaId: temaConstitucion.id,
    cantidad: 6,
    estado: "verificada",
    respuestas: "a",
  });

  const temaPractica = await prisma.tema.create({
    data: { bloque: "I", numero: 2, nombre: "Tema de prueba E2E — práctica" },
  });
  await crearPreguntas({
    prefijo: "e2e-practica",
    temaId: temaPractica.id,
    cantidad: 3,
    estado: "verificada",
    respuestas: ["b", "b", "b"],
  });

  const temaRevision = await prisma.tema.create({
    data: { bloque: "I", numero: 3, nombre: "Tema de prueba E2E — revisión" },
  });
  await crearPreguntas({
    prefijo: "e2e-revision",
    temaId: temaRevision.id,
    cantidad: 3,
    estado: "borrador",
    respuestas: "c",
  });

  const totalPreguntas = await prisma.pregunta.count();
  console.log(`Seed de E2E completado: 3 temas, ${totalPreguntas} preguntas.`);
}

main()
  .catch((err) => {
    console.error("Error en el seed de E2E:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
