/**
 * Tests de integración de GET /api/progreso/comunidad: la comparativa
 * anónima de racha y % de acierto frente a la media de "los demás"
 * usuarios (nunca incluye al propio usuario en su propia media, nunca
 * expone un dato por usuario, y se oculta del todo por debajo de
 * MUESTRA_MINIMA_COMUNIDAD para no acercarse a identificar a nadie).
 *
 * Requieren una base de datos de test real (ver backend/.env.test.example)
 * ya migrada: `npm test` ejecuta `prisma migrate deploy` antes de la suite.
 */
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("@clerk/express", () => import("../../test-utils/clerkMock"));

import { crearApp } from "../../app";
import { prisma } from "../../lib/prisma";
import { mockUsuarioClerk } from "../../test-utils/clerkMock";

const app = crearApp();

const PREFIJO = "test-comunidad-";
let temaId: number;
let preguntaId: string;
const usuarioIdsCreados: string[] = [];

async function limpiarFixtures() {
  await prisma.intento.deleteMany({ where: { preguntaId } });
  if (usuarioIdsCreados.length > 0) {
    await prisma.usuario.deleteMany({ where: { id: { in: usuarioIdsCreados } } });
  }
  usuarioIdsCreados.length = 0;
}

/** Crea un usuario directo (sin pasar por Clerk) con los intentos dados, `hace` días atrás (0 = hoy). */
async function crearUsuarioConIntentos(sufijo: string, intentos: { esCorrecta: boolean; hace: number }[]) {
  const usuario = await prisma.usuario.create({
    data: { email: `${PREFIJO}${sufijo}@example.com`, clerkUserId: `${PREFIJO}clerk-${sufijo}` },
  });
  usuarioIdsCreados.push(usuario.id);

  for (const intento of intentos) {
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - intento.hace);
    await prisma.intento.create({
      data: { usuarioId: usuario.id, preguntaId, esCorrecta: intento.esCorrecta, createdAt },
    });
  }
  return usuario;
}

async function tokenParaUsuarioNuevo(sufijo: string): Promise<{ token: string; usuarioId: string }> {
  const clerkUserId = `${PREFIJO}clerk-propio-${sufijo}`;
  mockUsuarioClerk(clerkUserId, `${PREFIJO}propio-${sufijo}@example.com`);
  const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${clerkUserId}`);
  usuarioIdsCreados.push(me.body.id);
  return { token: clerkUserId, usuarioId: me.body.id as string };
}

beforeAll(async () => {
  const tema = await prisma.tema.create({ data: { bloque: "I", numero: 998, nombre: "Tema de test (comunidad)" } });
  temaId = tema.id;
  const pregunta = await prisma.pregunta.create({
    data: {
      id: `${PREFIJO}p1`,
      temaId,
      enunciado: "[fixture] Pregunta comunidad",
      opciones: ["A", "B", "C", "D"],
      respuestaCorrecta: "a",
      origen: "examen_oficial",
      estado: "verificada",
      tipo: "teorica",
    },
  });
  preguntaId = pregunta.id;
});

afterEach(limpiarFixtures);

afterAll(async () => {
  await prisma.intento.deleteMany({ where: { preguntaId } });
  await prisma.pregunta.deleteMany({ where: { id: preguntaId } });
  await prisma.tema.deleteMany({ where: { id: temaId } });
  await prisma.$disconnect();
});

describe("GET /api/progreso/comunidad", () => {
  it("por debajo de la muestra mínima no manda ninguna media (disponible: false)", async () => {
    const { token } = await tokenParaUsuarioNuevo("umbral");
    for (let i = 0; i < 4; i++) {
      await crearUsuarioConIntentos(`umbral-otro-${i}`, [{ esCorrecta: true, hace: 0 }]);
    }

    const res = await request(app).get("/api/progreso/comunidad").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.disponible).toBe(false);
    expect(res.body.usuariosComparados).toBe(4);
    expect(res.body.media).toBeNull();
    expect(res.body.propia).toBeDefined();
  });

  it("con muestra suficiente, calcula la media de racha y precisión de los demás, sin incluir al propio usuario", async () => {
    const { token, usuarioId } = await tokenParaUsuarioNuevo("media");
    // El propio usuario tiene datos extremos (0% de acierto) que romperían
    // la media si por error se incluyeran en el cálculo de "los demás".
    await prisma.intento.create({ data: { usuarioId, preguntaId, esCorrecta: false, createdAt: new Date() } });

    // 5 otros usuarios, todos con actividad solo hoy (racha=1 cada uno) y
    // precisiones 1.0, 1.0, 0.5, 0.5, 0.0 sobre 2 intentos cada uno.
    const correctosPorUsuario = [2, 2, 1, 1, 0];
    for (const [i, correctos] of correctosPorUsuario.entries()) {
      await crearUsuarioConIntentos(
        `media-otro-${i}`,
        Array.from({ length: 2 }, (_, j) => ({ esCorrecta: j < correctos, hace: 0 }))
      );
    }

    const res = await request(app).get("/api/progreso/comunidad").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.disponible).toBe(true);
    expect(res.body.usuariosComparados).toBe(5);
    expect(res.body.media.racha).toBeCloseTo(1, 5);
    expect(res.body.media.precision).toBeCloseTo(0.6, 5); // (1+1+0.5+0.5+0)/5
    expect(res.body.propia.precision).toBe(0); // el propio dato no se contamina con la media
  });

  it("un usuario con racha de varios días consecutivos entra en la media con su racha real", async () => {
    const { token } = await tokenParaUsuarioNuevo("racha");
    // 4 usuarios con racha=1 (hoy) + 1 usuario con racha=3 (hoy, ayer, antes de ayer) => media = (1+1+1+1+3)/5 = 1.4
    for (let i = 0; i < 4; i++) {
      await crearUsuarioConIntentos(`racha-otro-${i}`, [{ esCorrecta: true, hace: 0 }]);
    }
    await crearUsuarioConIntentos(`racha-otro-larga`, [
      { esCorrecta: true, hace: 0 },
      { esCorrecta: true, hace: 1 },
      { esCorrecta: true, hace: 2 },
    ]);

    const res = await request(app).get("/api/progreso/comunidad").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.disponible).toBe(true);
    expect(res.body.media.racha).toBeCloseTo(1.4, 5);
  });

  it("los intentos anónimos (sin usuarioId) no cuentan en la comparativa", async () => {
    const { token } = await tokenParaUsuarioNuevo("anonimos");
    for (let i = 0; i < 5; i++) {
      await crearUsuarioConIntentos(`anon-otro-${i}`, [{ esCorrecta: true, hace: 0 }]);
    }
    await prisma.intento.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        preguntaId,
        sesionAnonima: `${PREFIJO}sesion-anonima-${i}`,
        esCorrecta: false,
      })),
    });

    const res = await request(app).get("/api/progreso/comunidad").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.usuariosComparados).toBe(5); // no 15: los 10 anónimos no cuentan como "usuarios"
  });
});
