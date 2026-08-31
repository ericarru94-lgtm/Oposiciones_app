/**
 * Tests de integración de GET /api/preguntas/examen-oficial: comprueba que
 * la estructura fija (30 Bloque I + 30 psicotécnicas en la Parte 1, 50
 * Bloque II en la Parte 2) se respeta exactamente, a diferencia del
 * simulacro libre (proporcional). fileParallelism está desactivado (ver
 * vitest.config.mts), así que estos fixtures no compiten con los de otros
 * archivos de test contra la misma base de datos.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("@clerk/express", () => import("../../test-utils/clerkMock"));

import { crearApp } from "../../app";
import { prisma } from "../../lib/prisma";
import { ESTRUCTURA_EXAMEN_OFICIAL } from "../../lib/examenOficial";

const app = crearApp();

const TEMA_BLOQUE_I = { bloque: "I" as const, numero: 997, nombre: "Tema de test (examen oficial, Bloque I)" };
const TEMA_BLOQUE_II = { bloque: "II" as const, numero: 997, nombre: "Tema de test (examen oficial, Bloque II)" };

let temaIId: number;
let temaIIId: number;

async function limpiarFixtures() {
  await prisma.intento.deleteMany({ where: { preguntaId: { startsWith: "test-examen-" } } });
  await prisma.progreso.deleteMany({ where: { preguntaId: { startsWith: "test-examen-" } } });
  await prisma.pregunta.deleteMany({ where: { id: { startsWith: "test-examen-" } } });
  await prisma.tema.deleteMany({
    where: {
      OR: [
        { numero: TEMA_BLOQUE_I.numero, bloque: TEMA_BLOQUE_I.bloque },
        { numero: TEMA_BLOQUE_II.numero, bloque: TEMA_BLOQUE_II.bloque },
      ],
    },
  });
}

beforeAll(async () => {
  await limpiarFixtures();

  const temaI = await prisma.tema.create({ data: TEMA_BLOQUE_I });
  temaIId = temaI.id;
  const temaII = await prisma.tema.create({ data: TEMA_BLOQUE_II });
  temaIIId = temaII.id;

  const datosBase = {
    opciones: ["Opción A", "Opción B", "Opción C", "Opción D"],
    respuestaCorrecta: "a" as const,
    origen: "examen_oficial" as const,
    estado: "verificada" as const,
  };

  // Pool amplio (por encima de los cupos exigidos) en cada categoría, para
  // poder comprobar que la selección se recorta exactamente al cupo fijo.
  await prisma.pregunta.createMany({
    data: Array.from({ length: 40 }, (_, i) => ({
      ...datosBase,
      id: `test-examen-bloque1-${i}`,
      temaId: temaIId,
      tipo: "teorica" as const,
      enunciado: `[fixture] Bloque I teórica ${i}`,
    })),
  });
  await prisma.pregunta.createMany({
    data: Array.from({ length: 60 }, (_, i) => ({
      ...datosBase,
      id: `test-examen-bloque2-${i}`,
      temaId: temaIIId,
      tipo: "teorica" as const,
      enunciado: `[fixture] Bloque II teórica ${i}`,
    })),
  });
  await prisma.pregunta.createMany({
    data: Array.from({ length: 40 }, (_, i) => ({
      ...datosBase,
      id: `test-examen-psico-${i}`,
      temaId: null,
      tipo: "psicotecnica" as const,
      enunciado: `[fixture] Psicotécnica ${i}`,
    })),
  });

  // Preguntas que NUNCA deben aparecer: en borrador, o del Bloque I pero psicotécnica.
  await prisma.pregunta.create({
    data: {
      ...datosBase,
      id: "test-examen-borrador",
      temaId: temaIId,
      tipo: "teorica",
      enunciado: "[fixture] Pregunta en borrador",
      estado: "borrador",
    },
  });
});

afterAll(async () => {
  await limpiarFixtures();
  await prisma.$disconnect();
});

describe("GET /api/preguntas/examen-oficial", () => {
  it("devuelve la Parte 1 con exactamente 60 preguntas (30 Bloque I + 30 psicotécnicas) y la Parte 2 con exactamente 50", async () => {
    const res = await request(app).get("/api/preguntas/examen-oficial");
    expect(res.status).toBe(200);

    expect(res.body.parte1.preguntas).toHaveLength(
      ESTRUCTURA_EXAMEN_OFICIAL.parte1.bloqueI + ESTRUCTURA_EXAMEN_OFICIAL.parte1.psicotecnicas
    );
    expect(res.body.parte2.preguntas).toHaveLength(ESTRUCTURA_EXAMEN_OFICIAL.parte2.bloqueII);

    expect(res.body.parte1.tiempoLimiteMin).toBe(ESTRUCTURA_EXAMEN_OFICIAL.parte1.tiempoLimiteMin);
    expect(res.body.parte2.tiempoLimiteMin).toBe(ESTRUCTURA_EXAMEN_OFICIAL.parte2.tiempoLimiteMin);
  });

  it("la Parte 1 contiene exactamente 30 preguntas del Bloque I (temaId de test) y exactamente 30 psicotécnicas", async () => {
    const res = await request(app).get("/api/preguntas/examen-oficial");
    const idsParte1: string[] = res.body.parte1.preguntas.map((p: { id: string }) => p.id);

    const deBloqueI = idsParte1.filter((id) => id.startsWith("test-examen-bloque1-"));
    const psicotecnicas = idsParte1.filter((id) => id.startsWith("test-examen-psico-"));

    expect(deBloqueI).toHaveLength(30);
    expect(psicotecnicas).toHaveLength(30);
  });

  it("la Parte 2 son las 50 preguntas del Bloque II, ninguna del Bloque I ni psicotécnica", async () => {
    const res = await request(app).get("/api/preguntas/examen-oficial");
    const idsParte2: string[] = res.body.parte2.preguntas.map((p: { id: string }) => p.id);

    expect(idsParte2.every((id: string) => id.startsWith("test-examen-bloque2-"))).toBe(true);
    expect(idsParte2).toHaveLength(50);
  });

  it("nunca incluye la pregunta en borrador ni la respuesta correcta de ninguna pregunta", async () => {
    const res = await request(app).get("/api/preguntas/examen-oficial");
    const todasLasPreguntas = [...res.body.parte1.preguntas, ...res.body.parte2.preguntas];

    expect(todasLasPreguntas.map((p: { id: string }) => p.id)).not.toContain("test-examen-borrador");
    for (const p of todasLasPreguntas) {
      expect(p.respuestaCorrecta).toBeUndefined();
    }
  });

  it("no repite ninguna pregunta entre la Parte 1 y la Parte 2", async () => {
    const res = await request(app).get("/api/preguntas/examen-oficial");
    const idsParte1: string[] = res.body.parte1.preguntas.map((p: { id: string }) => p.id);
    const idsParte2: string[] = res.body.parte2.preguntas.map((p: { id: string }) => p.id);
    const interseccion = idsParte1.filter((id) => idsParte2.includes(id));
    expect(interseccion).toHaveLength(0);
  });
});
