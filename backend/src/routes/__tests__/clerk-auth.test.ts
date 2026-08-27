/**
 * Tests de integración de la autenticación con Clerk (/api/auth/*):
 * find-or-create de Usuario por clerkUserId, vínculo de filas
 * preexistentes por email, reclamo de intentos anónimos tras el
 * onboarding, y el bypass exclusivo de E2E. Ver backend/docs/clerk.md.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("@clerk/express", () => import("../../test-utils/clerkMock"));

import { crearApp } from "../../app";
import { prisma } from "../../lib/prisma";
import { mockUsuarioClerk } from "../../test-utils/clerkMock";

const app = crearApp();

async function limpiarFixtures() {
  await prisma.intento.deleteMany({ where: { preguntaId: { startsWith: "test-clerk-" } } });
  await prisma.progreso.deleteMany({ where: { preguntaId: { startsWith: "test-clerk-" } } });
  await prisma.pregunta.deleteMany({ where: { id: { startsWith: "test-clerk-" } } });
  await prisma.usuario.deleteMany({ where: { email: { startsWith: "test-clerk-" } } });
}

beforeAll(limpiarFixtures);
afterAll(async () => {
  await limpiarFixtures();
  await prisma.$disconnect();
});

describe("GET /api/auth/me", () => {
  it("responde 401 sin sesión", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("crea la fila de Usuario en el primer login y la reutiliza después", async () => {
    const clerkUserId = "clerk_test-clerk-nuevo";
    mockUsuarioClerk(clerkUserId, "test-clerk-nuevo@example.com");

    const primero = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${clerkUserId}`);
    expect(primero.status).toBe(200);
    expect(primero.body.email).toBe("test-clerk-nuevo@example.com");

    const segundo = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${clerkUserId}`);
    expect(segundo.status).toBe(200);
    expect(segundo.body.id).toBe(primero.body.id);

    const filas = await prisma.usuario.count({ where: { clerkUserId } });
    expect(filas).toBe(1);
  });

  it("vincula por email una fila de Usuario ya existente (previa a Clerk) en vez de duplicarla", async () => {
    const previa = await prisma.usuario.create({
      data: { email: "test-clerk-preexistente@example.com" },
    });

    const clerkUserId = "clerk_test-clerk-preexistente";
    mockUsuarioClerk(clerkUserId, "test-clerk-preexistente@example.com");

    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${clerkUserId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(previa.id);

    const actualizada = await prisma.usuario.findUnique({ where: { id: previa.id } });
    expect(actualizada?.clerkUserId).toBe(clerkUserId);
  });
});

describe("POST /api/auth/reclamar-sesion-anonima", () => {
  it("adopta los intentos anónimos como progreso del usuario autenticado", async () => {
    const tema = await prisma.tema.upsert({
      where: { bloque_numero: { bloque: "I", numero: 997 } },
      create: { bloque: "I", numero: 997, nombre: "Tema de test (clerk)" },
      update: {},
    });
    const pregunta = await prisma.pregunta.create({
      data: {
        id: "test-clerk-pregunta-1",
        temaId: tema.id,
        enunciado: "[fixture] ¿Pregunta de prueba?",
        opciones: ["A", "B", "C", "D"],
        respuestaCorrecta: "a",
        origen: "generada_ia",
        estado: "verificada",
        tipo: "teorica",
      },
    });

    const sesionAnonima = "test-clerk-sesion-anonima-1";
    await request(app)
      .post(`/api/preguntas/${pregunta.id}/responder`)
      .send({ opcion: "a", sesionAnonima });

    const clerkUserId = "clerk_test-clerk-reclama";
    mockUsuarioClerk(clerkUserId, "test-clerk-reclama@example.com");
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${clerkUserId}`);
    const usuarioId = me.body.id;

    const res = await request(app)
      .post("/api/auth/reclamar-sesion-anonima")
      .set("Authorization", `Bearer ${clerkUserId}`)
      .send({ sesionAnonima });
    expect(res.status).toBe(204);

    const intento = await prisma.intento.findFirst({ where: { preguntaId: pregunta.id } });
    expect(intento?.usuarioId).toBe(usuarioId);
    expect(intento?.sesionAnonima).toBeNull();

    const progreso = await prisma.progreso.findUnique({
      where: { usuarioId_preguntaId: { usuarioId, preguntaId: pregunta.id } },
    });
    expect(progreso).not.toBeNull();
  });
});

describe("Bypass de autenticación exclusivo de E2E (AUTH_TEST_BYPASS_SECRET)", () => {
  it("sin la variable de entorno definida, el prefijo e2e-bypass no es mágico: se trata como un clerkUserId normal", async () => {
    const clerkUserId = "e2e-bypass:cualquier-cosa:algun-id";
    mockUsuarioClerk(clerkUserId, "test-clerk-no-bypass@example.com");

    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${clerkUserId}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("test-clerk-no-bypass@example.com");
  });

  it("con AUTH_TEST_BYPASS_SECRET definido, confía en el usuarioId del header sin pasar por Clerk", async () => {
    const usuario = await prisma.usuario.create({ data: { email: "test-clerk-bypass@example.com" } });
    const original = process.env.AUTH_TEST_BYPASS_SECRET;
    process.env.AUTH_TEST_BYPASS_SECRET = "secreto-de-test";
    try {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer e2e-bypass:secreto-de-test:${usuario.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(usuario.id);
    } finally {
      process.env.AUTH_TEST_BYPASS_SECRET = original;
    }
  });
});
