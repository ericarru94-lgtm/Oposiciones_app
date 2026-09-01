/**
 * Tests de integración del límite diario del plan gratuito, rediseñado como
 * "2 tests empezados al día en total" (Practicar tema / Repasar hoy), en
 * vez del antiguo límite por número de preguntas respondidas. Ver
 * backend/src/lib/dailyLimit.ts y el modelo SesionTest en el schema.
 *
 * Requieren una base de datos de test real, ya migrada (`npm test` ejecuta
 * `prisma migrate deploy` antes de la suite).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("@clerk/express", () => import("../../test-utils/clerkMock"));

import { crearApp } from "../../app";
import { prisma } from "../../lib/prisma";
import { mockUsuarioClerk } from "../../test-utils/clerkMock";
import { FREE_PLAN_DAILY_TEST_SESSIONS } from "../../lib/dailyLimit";

const app = crearApp();

const TEMA_FIXTURE = { bloque: "I" as const, numero: 998, nombre: "Tema de test (límite de sesiones)" };
let temaId: number;
let idVerificada: string;

async function limpiarFixtures() {
  await prisma.intento.deleteMany({ where: { preguntaId: { startsWith: "test-limite-sesiones-" } } });
  await prisma.progreso.deleteMany({ where: { preguntaId: { startsWith: "test-limite-sesiones-" } } });
  await prisma.pregunta.deleteMany({ where: { id: { startsWith: "test-limite-sesiones-" } } });
  await prisma.tema.deleteMany({ where: { numero: TEMA_FIXTURE.numero, bloque: TEMA_FIXTURE.bloque } });
}

async function crearUsuario(clerkUserId: string, email: string, plan: "free" | "premium" = "free") {
  mockUsuarioClerk(clerkUserId, email);
  const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${clerkUserId}`);
  const usuarioId = me.body.id as string;
  if (plan === "premium") {
    await prisma.usuario.update({ where: { id: usuarioId }, data: { plan: "premium" } });
  }
  return { usuarioId, token: clerkUserId };
}

beforeAll(async () => {
  await limpiarFixtures();
  const tema = await prisma.tema.create({ data: TEMA_FIXTURE });
  temaId = tema.id;
  const pregunta = await prisma.pregunta.create({
    data: {
      id: "test-limite-sesiones-p1",
      temaId,
      enunciado: "[fixture] Pregunta para el límite de sesiones",
      opciones: ["Opción A", "Opción B", "Opción C", "Opción D"],
      respuestaCorrecta: "a",
      origen: "examen_oficial",
      estado: "verificada",
      tipo: "teorica",
    },
  });
  idVerificada = pregunta.id;
});

afterAll(async () => {
  await limpiarFixtures();
  await prisma.$disconnect();
});

describe("GET /api/preguntas/aleatorias — límite diario de tests (plan gratuito)", () => {
  it(`un usuario gratuito puede empezar ${FREE_PLAN_DAILY_TEST_SESSIONS} tests con temaId y el siguiente devuelve 429`, async () => {
    const { token } = await crearUsuario(`clerk_test-limite-a-${Date.now()}`, `test-limite-a-${Date.now()}@example.com`);

    for (let i = 0; i < FREE_PLAN_DAILY_TEST_SESSIONS; i++) {
      const res = await request(app)
        .get(`/api/preguntas/aleatorias?temaId=${temaId}&limit=1`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    }

    const res = await request(app)
      .get(`/api/preguntas/aleatorias?temaId=${temaId}&limit=1`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(429);
    expect(res.body.restantes).toBe(0);
  });

  it("un usuario premium no tiene límite de tests empezados", async () => {
    const { token } = await crearUsuario(
      `clerk_test-limite-premium-${Date.now()}`,
      `test-limite-premium-${Date.now()}@example.com`,
      "premium"
    );

    for (let i = 0; i < FREE_PLAN_DAILY_TEST_SESSIONS + 2; i++) {
      const res = await request(app)
        .get(`/api/preguntas/aleatorias?temaId=${temaId}&limit=1`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    }
  });

  it("sin temaId (mini-test), no consume ni comprueba el límite de tests, con o sin autenticación", async () => {
    const { token } = await crearUsuario(`clerk_test-limite-b-${Date.now()}`, `test-limite-b-${Date.now()}@example.com`);

    // Agota el límite con temaId...
    for (let i = 0; i < FREE_PLAN_DAILY_TEST_SESSIONS; i++) {
      await request(app).get(`/api/preguntas/aleatorias?temaId=${temaId}&limit=1`).set("Authorization", `Bearer ${token}`);
    }

    // ...pero sin temaId sigue respondiendo 200 (mismo usuario, y también sin autenticar).
    const conAuth = await request(app).get("/api/preguntas/aleatorias?limit=1").set("Authorization", `Bearer ${token}`);
    expect(conAuth.status).toBe(200);
    const sinAuth = await request(app).get("/api/preguntas/aleatorias?limit=1");
    expect(sinAuth.status).toBe(200);
  });

  it("con temaId pero sin autenticación (compatibilidad), no aplica el límite de tests", async () => {
    for (let i = 0; i < FREE_PLAN_DAILY_TEST_SESSIONS + 2; i++) {
      const res = await request(app).get(`/api/preguntas/aleatorias?temaId=${temaId}&limit=1`);
      expect(res.status).toBe(200);
    }
  });
});

describe("POST /api/preguntas/:id/responder — ya no limita por número de preguntas respondidas", () => {
  it("responder más preguntas que el antiguo límite diario no devuelve 429", async () => {
    const { token } = await crearUsuario(`clerk_test-limite-c-${Date.now()}`, `test-limite-c-${Date.now()}@example.com`);

    for (let i = 0; i < FREE_PLAN_DAILY_TEST_SESSIONS + 5; i++) {
      const res = await request(app)
        .post(`/api/preguntas/${idVerificada}/responder`)
        .set("Authorization", `Bearer ${token}`)
        .send({ opcion: "a" });
      expect(res.status).toBe(200);
    }
  });
});
