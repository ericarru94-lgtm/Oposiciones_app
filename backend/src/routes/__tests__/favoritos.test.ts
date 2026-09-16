/**
 * Tests de integración de /api/favoritos/*: marcar/desmarcar una pregunta
 * favorita (idempotente en ambos sentidos), listar solo los ids (para que
 * TestRunner sepa qué estrella pintar) y listar las preguntas completas
 * en formato listo para practicar (sin la respuesta correcta).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("@clerk/express", () => import("../../test-utils/clerkMock"));

import { crearApp } from "../../app";
import { prisma } from "../../lib/prisma";
import { mockUsuarioClerk } from "../../test-utils/clerkMock";

const app = crearApp();

const tokenUsuario = "clerk_test_favoritos_usuario";
const EMAIL = "test-favoritos-usuario@example.com";
let usuarioId: string;
let temaId: number;

async function limpiarFixtures() {
  await prisma.preguntaFavorita.deleteMany({ where: { preguntaId: { startsWith: "test-favoritos-" } } });
  await prisma.pregunta.deleteMany({ where: { id: { startsWith: "test-favoritos-" } } });
  await prisma.usuario.deleteMany({ where: { email: EMAIL } });
}

beforeAll(async () => {
  await limpiarFixtures();
  mockUsuarioClerk(tokenUsuario, EMAIL);
  const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${tokenUsuario}`);
  usuarioId = me.body.id;

  const tema = await prisma.tema.upsert({
    where: { bloque_numero: { bloque: "I", numero: 995 } },
    create: { bloque: "I", numero: 995, nombre: "Tema de test (favoritos)" },
    update: {},
  });
  temaId = tema.id;

  await prisma.pregunta.createMany({
    data: [
      {
        id: "test-favoritos-verificada",
        temaId,
        enunciado: "[fixture] ¿Pregunta verificada?",
        opciones: ["A", "B", "C", "D"],
        respuestaCorrecta: "a",
        origen: "generada_ia",
        estado: "verificada",
        tipo: "teorica",
      },
      {
        id: "test-favoritos-borrador",
        temaId,
        enunciado: "[fixture] ¿Pregunta en borrador?",
        opciones: ["A", "B", "C", "D"],
        respuestaCorrecta: "a",
        origen: "generada_ia",
        estado: "borrador",
        tipo: "teorica",
      },
    ],
  });
});

beforeEach(async () => {
  await prisma.preguntaFavorita.deleteMany({ where: { usuarioId } });
});

afterAll(async () => {
  await limpiarFixtures();
  await prisma.$disconnect();
});

describe("POST /api/favoritos/:preguntaId", () => {
  it("responde 401 sin sesión", async () => {
    const res = await request(app).post("/api/favoritos/test-favoritos-verificada");
    expect(res.status).toBe(401);
  });

  it("marca una pregunta verificada como favorita", async () => {
    const res = await request(app)
      .post("/api/favoritos/test-favoritos-verificada")
      .set("Authorization", `Bearer ${tokenUsuario}`);
    expect(res.status).toBe(204);

    const favorita = await prisma.preguntaFavorita.findUnique({
      where: { usuarioId_preguntaId: { usuarioId, preguntaId: "test-favoritos-verificada" } },
    });
    expect(favorita).not.toBeNull();
  });

  it("es idempotente: marcarla dos veces no duplica ni falla", async () => {
    await request(app).post("/api/favoritos/test-favoritos-verificada").set("Authorization", `Bearer ${tokenUsuario}`);
    const segunda = await request(app)
      .post("/api/favoritos/test-favoritos-verificada")
      .set("Authorization", `Bearer ${tokenUsuario}`);
    expect(segunda.status).toBe(204);

    const total = await prisma.preguntaFavorita.count({ where: { usuarioId, preguntaId: "test-favoritos-verificada" } });
    expect(total).toBe(1);
  });

  it("responde 404 para una pregunta que no existe o no está verificada", async () => {
    const inexistente = await request(app)
      .post("/api/favoritos/no-existe")
      .set("Authorization", `Bearer ${tokenUsuario}`);
    expect(inexistente.status).toBe(404);

    const enBorrador = await request(app)
      .post("/api/favoritos/test-favoritos-borrador")
      .set("Authorization", `Bearer ${tokenUsuario}`);
    expect(enBorrador.status).toBe(404);
  });
});

describe("DELETE /api/favoritos/:preguntaId", () => {
  it("desmarca una pregunta favorita", async () => {
    await request(app).post("/api/favoritos/test-favoritos-verificada").set("Authorization", `Bearer ${tokenUsuario}`);

    const res = await request(app)
      .delete("/api/favoritos/test-favoritos-verificada")
      .set("Authorization", `Bearer ${tokenUsuario}`);
    expect(res.status).toBe(204);

    const favorita = await prisma.preguntaFavorita.findUnique({
      where: { usuarioId_preguntaId: { usuarioId, preguntaId: "test-favoritos-verificada" } },
    });
    expect(favorita).toBeNull();
  });

  it("es idempotente: desmarcar una que no estaba marcada también responde 204", async () => {
    const res = await request(app)
      .delete("/api/favoritos/test-favoritos-verificada")
      .set("Authorization", `Bearer ${tokenUsuario}`);
    expect(res.status).toBe(204);
  });
});

describe("GET /api/favoritos/ids", () => {
  it("devuelve solo los ids de las preguntas marcadas por ese usuario", async () => {
    await request(app).post("/api/favoritos/test-favoritos-verificada").set("Authorization", `Bearer ${tokenUsuario}`);

    const res = await request(app).get("/api/favoritos/ids").set("Authorization", `Bearer ${tokenUsuario}`);
    expect(res.status).toBe(200);
    expect(res.body.ids).toEqual(["test-favoritos-verificada"]);
  });
});

describe("GET /api/favoritos", () => {
  it("devuelve las preguntas favoritas sin la respuesta correcta", async () => {
    await request(app).post("/api/favoritos/test-favoritos-verificada").set("Authorization", `Bearer ${tokenUsuario}`);

    const res = await request(app).get("/api/favoritos").set("Authorization", `Bearer ${tokenUsuario}`);
    expect(res.status).toBe(200);
    expect(res.body.preguntas).toHaveLength(1);
    expect(res.body.preguntas[0].id).toBe("test-favoritos-verificada");
    expect(res.body.preguntas[0].respuestaCorrecta).toBeUndefined();
  });
});
