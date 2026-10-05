/**
 * Tests de integración de GET /api/progreso/por-tema: cuántas preguntas
 * verificadas tiene cada tema, cuántas distintas ha contestado el usuario y
 * su precisión en ese tema — usado por el grid de Home y los "puntos
 * débiles" del panel de Progreso.
 *
 * Escrito para fijar el comportamiento actual antes de optimizar el
 * endpoint (hoy hace 2 consultas por tema en un bucle; ver
 * lib/progresoPorTema.ts), así que cubre deliberadamente: el filtro por
 * estado "verificada" (una pregunta en "borrador" no debe contar en
 * totalPreguntas), el conteo de preguntas distintas contestadas frente al
 * total de intentos, la precisión null cuando no hay intentos, y que los
 * intentos de otro usuario no se mezclen con los del usuario autenticado.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("@clerk/express", () => import("../../test-utils/clerkMock"));

import { crearApp } from "../../app";
import { prisma } from "../../lib/prisma";
import { mockUsuarioClerk } from "../../test-utils/clerkMock";

const app = crearApp();
const PREFIJO = "test-por-tema-";

let temaA: { id: number };
let temaB: { id: number };
let preguntaA1: string;
let preguntaA2: string;
let preguntaABorrador: string;

beforeAll(async () => {
  temaA = await prisma.tema.upsert({
    where: { bloque_numero: { bloque: "I", numero: 994 } },
    create: { bloque: "I", numero: 994, nombre: "Tema de test (por-tema, A)" },
    update: {},
  });
  temaB = await prisma.tema.upsert({
    where: { bloque_numero: { bloque: "I", numero: 993 } },
    create: { bloque: "I", numero: 993, nombre: "Tema de test (por-tema, B)" },
    update: {},
  });

  preguntaA1 = `${PREFIJO}a1`;
  preguntaA2 = `${PREFIJO}a2`;
  preguntaABorrador = `${PREFIJO}a-borrador`;
  const preguntaB1 = `${PREFIJO}b1`;

  await prisma.pregunta.createMany({
    data: [
      {
        id: preguntaA1,
        temaId: temaA.id,
        enunciado: "[fixture] A1",
        opciones: ["A", "B", "C", "D"],
        respuestaCorrecta: "a",
        origen: "examen_oficial",
        estado: "verificada",
        tipo: "teorica",
      },
      {
        id: preguntaA2,
        temaId: temaA.id,
        enunciado: "[fixture] A2",
        opciones: ["A", "B", "C", "D"],
        respuestaCorrecta: "a",
        origen: "examen_oficial",
        estado: "verificada",
        tipo: "teorica",
      },
      {
        id: preguntaABorrador,
        temaId: temaA.id,
        enunciado: "[fixture] A-borrador",
        opciones: ["A", "B", "C", "D"],
        respuestaCorrecta: "a",
        origen: "examen_oficial",
        estado: "borrador",
        tipo: "teorica",
      },
      {
        id: preguntaB1,
        temaId: temaB.id,
        enunciado: "[fixture] B1",
        opciones: ["A", "B", "C", "D"],
        respuestaCorrecta: "a",
        origen: "examen_oficial",
        estado: "verificada",
        tipo: "teorica",
      },
    ],
  });
});

afterAll(async () => {
  await prisma.intento.deleteMany({ where: { preguntaId: { startsWith: PREFIJO } } });
  await prisma.pregunta.deleteMany({ where: { id: { startsWith: PREFIJO } } });
  await prisma.tema.deleteMany({ where: { id: { in: [temaA.id, temaB.id] } } });
  await prisma.$disconnect();
});

describe("GET /api/progreso/por-tema", () => {
  it("cuenta solo preguntas verificadas, distingue preguntas contestadas de intentos totales, y no mezcla datos de otro usuario", async () => {
    const clerkUserId = `${PREFIJO}clerk-propio`;
    mockUsuarioClerk(clerkUserId, `${PREFIJO}propio@example.com`);
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${clerkUserId}`);
    const usuarioId = me.body.id as string;

    const otroClerkUserId = `${PREFIJO}clerk-otro`;
    mockUsuarioClerk(otroClerkUserId, `${PREFIJO}otro@example.com`);
    const otro = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${otroClerkUserId}`);
    const otroUsuarioId = otro.body.id as string;

    // Usuario propio, Tema A: preguntaA1 contestada 2 veces (1 acierto, 1
    // fallo), preguntaA2 contestada 1 vez (acierto) => 3 intentos, 2
    // aciertos, 2 preguntas distintas contestadas, precisión 2/3.
    await prisma.intento.createMany({
      data: [
        { usuarioId, preguntaId: preguntaA1, esCorrecta: true },
        { usuarioId, preguntaId: preguntaA1, esCorrecta: false },
        { usuarioId, preguntaId: preguntaA2, esCorrecta: true },
      ],
    });
    // Mismo usuario, Tema B: sin intentos (debe salir precisión null).

    // Otro usuario, Tema A: no debe filtrarse en absoluto en la respuesta del usuario propio.
    await prisma.intento.create({ data: { usuarioId: otroUsuarioId, preguntaId: preguntaA1, esCorrecta: false } });

    const res = await request(app).get("/api/progreso/por-tema").set("Authorization", `Bearer ${clerkUserId}`);
    expect(res.status).toBe(200);

    const filaA = res.body.temas.find((t: { temaId: number }) => t.temaId === temaA.id);
    expect(filaA).toMatchObject({
      bloque: "I",
      numero: 994,
      totalPreguntas: 2, // las 2 verificadas; la de "borrador" no cuenta
      preguntasContestadas: 2,
      totalIntentos: 3,
      aciertos: 2,
    });
    expect(filaA.precision).toBeCloseTo(2 / 3, 5);

    const filaB = res.body.temas.find((t: { temaId: number }) => t.temaId === temaB.id);
    expect(filaB).toMatchObject({
      bloque: "I",
      numero: 993,
      totalPreguntas: 1,
      preguntasContestadas: 0,
      totalIntentos: 0,
      aciertos: 0,
      precision: null,
    });

    await prisma.usuario.deleteMany({ where: { id: { in: [usuarioId, otroUsuarioId] } } });
  });
});
