/**
 * Tests de integración de GET /api/preguntas/simulacro: usa una base de
 * datos real (ver backend/.env.test.example), aislada con fixtures de
 * prefijo único para no interferir con el resto de la suite.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("@clerk/express", () => import("../../test-utils/clerkMock"));

import { crearApp } from "../../app";
import { prisma } from "../../lib/prisma";

const app = crearApp();

const TEMA_GRANDE = { bloque: "I" as const, numero: 998, nombre: "Tema de test (simulacro, grande)" };
const TEMA_PEQUENO = { bloque: "II" as const, numero: 998, nombre: "Tema de test (simulacro, pequeño)" };

let temaGrandeId: number;
let temaPequenoId: number;

async function limpiarFixtures() {
  await prisma.intento.deleteMany({ where: { preguntaId: { startsWith: "test-simulacro-" } } });
  await prisma.progreso.deleteMany({ where: { preguntaId: { startsWith: "test-simulacro-" } } });
  await prisma.pregunta.deleteMany({ where: { id: { startsWith: "test-simulacro-" } } });
  await prisma.tema.deleteMany({
    where: {
      OR: [
        { numero: TEMA_GRANDE.numero, bloque: TEMA_GRANDE.bloque },
        { numero: TEMA_PEQUENO.numero, bloque: TEMA_PEQUENO.bloque },
      ],
    },
  });
}

beforeAll(async () => {
  await limpiarFixtures();

  const temaGrande = await prisma.tema.create({ data: TEMA_GRANDE });
  temaGrandeId = temaGrande.id;
  const temaPequeno = await prisma.tema.create({ data: TEMA_PEQUENO });
  temaPequenoId = temaPequeno.id;

  const datosBase = {
    opciones: ["Opción A", "Opción B", "Opción C", "Opción D"],
    respuestaCorrecta: "a" as const,
    origen: "examen_oficial" as const,
    estado: "verificada" as const,
    tipo: "teorica" as const,
  };

  // 18 preguntas en el tema "grande" y 2 en el "pequeño": un reparto
  // proporcional de 10 preguntas debería acercarse a 9/1.
  await prisma.pregunta.createMany({
    data: Array.from({ length: 18 }, (_, i) => ({
      ...datosBase,
      id: `test-simulacro-grande-${i}`,
      temaId: temaGrandeId,
      enunciado: `[fixture] Pregunta grande ${i}`,
    })),
  });
  await prisma.pregunta.createMany({
    data: Array.from({ length: 2 }, (_, i) => ({
      ...datosBase,
      id: `test-simulacro-pequeno-${i}`,
      temaId: temaPequenoId,
      enunciado: `[fixture] Pregunta pequeña ${i}`,
    })),
  });

  // Una pregunta en borrador no debe poder salir nunca en un simulacro.
  await prisma.pregunta.create({
    data: {
      ...datosBase,
      id: "test-simulacro-borrador",
      temaId: temaGrandeId,
      enunciado: "[fixture] Pregunta en borrador",
      estado: "borrador",
    },
  });
});

afterAll(async () => {
  await limpiarFixtures();
  await prisma.$disconnect();
});

describe("GET /api/preguntas/simulacro", () => {
  it("devuelve el nº de preguntas pedido, repartidas entre temas de todo el temario", async () => {
    const res = await request(app).get("/api/preguntas/simulacro?numPreguntas=10");
    expect(res.status).toBe(200);
    expect(res.body.preguntas).toHaveLength(10);

    const temasEnSeleccion = new Set(res.body.preguntas.map((p: { temaId: number }) => p.temaId));
    expect(temasEnSeleccion.has(temaGrandeId)).toBe(true);
    expect(temasEnSeleccion.has(temaPequenoId)).toBe(true);
  });

  it("nunca incluye preguntas en borrador ni su respuesta correcta", async () => {
    const res = await request(app).get("/api/preguntas/simulacro?numPreguntas=20");
    expect(res.status).toBe(200);
    const ids = res.body.preguntas.map((p: { id: string }) => p.id);
    expect(ids).not.toContain("test-simulacro-borrador");
    for (const p of res.body.preguntas) {
      expect(p.respuestaCorrecta).toBeUndefined();
    }
  });

  it("rechaza numPreguntas fuera de rango (por debajo del mínimo)", async () => {
    const res = await request(app).get("/api/preguntas/simulacro?numPreguntas=0");
    expect(res.status).toBe(400);
  });

  it("rechaza numPreguntas fuera de rango (por encima del máximo)", async () => {
    const res = await request(app).get("/api/preguntas/simulacro?numPreguntas=500");
    expect(res.status).toBe(400);
  });

  it("usa 25 por defecto si no se especifica numPreguntas (acotado a las disponibles)", async () => {
    const res = await request(app).get("/api/preguntas/simulacro");
    expect(res.status).toBe(200);
    expect(res.body.preguntas.length).toBeLessThanOrEqual(20);
  });
});
