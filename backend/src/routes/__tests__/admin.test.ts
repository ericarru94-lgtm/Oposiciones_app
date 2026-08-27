/**
 * Tests de integración de la herramienta de revisión editorial (/api/admin/*).
 * Cubre: autorización (401/403), la cola de revisión filtrada por tema,
 * la edición + verificación de una pregunta, la validación que impide
 * verificar sin respuesta correcta, y el resumen de pendientes por tema.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("@clerk/express", () => import("../../test-utils/clerkMock"));

import { crearApp } from "../../app";
import { prisma } from "../../lib/prisma";
import { mockUsuarioClerk } from "../../test-utils/clerkMock";

const app = crearApp();

const TEMA_FIXTURE = { bloque: "I" as const, numero: 998, nombre: "Tema de test (admin)" };

let temaId: number;
let idBorrador: string;
let idSinRespuesta: string;
const tokenAdmin = "clerk_test_admin";
const tokenNoAdmin = "clerk_test_no_admin";

async function limpiarFixtures() {
  await prisma.intento.deleteMany({ where: { preguntaId: { startsWith: "test-admin-" } } });
  await prisma.progreso.deleteMany({ where: { preguntaId: { startsWith: "test-admin-" } } });
  await prisma.pregunta.deleteMany({ where: { id: { startsWith: "test-admin-" } } });
  await prisma.tema.deleteMany({ where: { numero: TEMA_FIXTURE.numero, bloque: TEMA_FIXTURE.bloque } });
  await prisma.usuario.deleteMany({
    where: { email: { in: ["admin-test@example.com", "test-admin-normal@example.com"] } },
  });
}

beforeAll(async () => {
  await limpiarFixtures();

  const tema = await prisma.tema.create({ data: TEMA_FIXTURE });
  temaId = tema.id;

  const borrador = await prisma.pregunta.create({
    data: {
      id: "test-admin-borrador",
      temaId,
      enunciado: "[fixture] Enunciado con una errata",
      opciones: ["Opción A", "Opción B", "Opción C", "Opción D"],
      respuestaCorrecta: "a",
      origen: "generada_ia",
      estado: "borrador",
      tipo: "teorica",
    },
  });
  idBorrador = borrador.id;

  const sinRespuesta = await prisma.pregunta.create({
    data: {
      id: "test-admin-sin-respuesta",
      temaId,
      enunciado: "[fixture] Pregunta importada sin respuesta clara",
      opciones: ["Opción A", "Opción B", "Opción C", "Opción D"],
      respuestaCorrecta: null,
      origen: "examen_oficial",
      estado: "borrador",
      tipo: "teorica",
    },
  });
  idSinRespuesta = sinRespuesta.id;

  mockUsuarioClerk(tokenAdmin, "admin-test@example.com");
  mockUsuarioClerk(tokenNoAdmin, "test-admin-normal@example.com");
});

afterAll(async () => {
  await limpiarFixtures();
  await prisma.$disconnect();
});

describe("Autorización de /api/admin", () => {
  it("responde 401 sin token", async () => {
    const res = await request(app).get("/api/admin/preguntas");
    expect(res.status).toBe(401);
  });

  it("responde 403 con un usuario autenticado que no es admin", async () => {
    const res = await request(app).get("/api/admin/preguntas").set("Authorization", `Bearer ${tokenNoAdmin}`);
    expect(res.status).toBe(403);
  });

  it("el email listado en ADMIN_EMAILS se activa como admin al registrarse", async () => {
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.esAdmin).toBe(true);
  });
});

describe("GET /api/admin/preguntas", () => {
  it("filtra por tema y devuelve la pregunta completa (con respuesta correcta)", async () => {
    const res = await request(app)
      .get(`/api/admin/preguntas?estado=borrador&temaId=${temaId}`)
      .set("Authorization", `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const ids = res.body.preguntas.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([idBorrador, idSinRespuesta]));
    const pregunta = res.body.preguntas.find((p: { id: string }) => p.id === idBorrador);
    expect(pregunta.respuestaCorrecta).toBe("a");
  });
});

describe("PATCH /api/admin/preguntas/:id", () => {
  it("permite editar campos y verificar en la misma llamada", async () => {
    const res = await request(app)
      .patch(`/api/admin/preguntas/${idBorrador}`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({
        enunciado: "[fixture] Enunciado corregido",
        explicacion: "Porque el art. X dice Y.",
        fuente: "Art. X de la Ley Z",
        estado: "verificada",
      });

    expect(res.status).toBe(200);
    expect(res.body.pregunta.estado).toBe("verificada");
    expect(res.body.pregunta.enunciado).toBe("[fixture] Enunciado corregido");
    expect(res.body.pregunta.fechaVerificacion).not.toBeNull();

    // Y ya es visible por la vía pública, como cualquier otra verificada
    // (se filtra por el tema de la fixture para no depender del muestreo
    // aleatorio sobre todo el banco de preguntas).
    const publica = await request(app).get(`/api/preguntas/aleatorias?limit=50&temaId=${temaId}`);
    const ids = publica.body.preguntas.map((p: { id: string }) => p.id);
    expect(ids).toContain(idBorrador);
  });

  it("rechaza marcar como verificada una pregunta sin respuesta correcta", async () => {
    const res = await request(app)
      .patch(`/api/admin/preguntas/${idSinRespuesta}`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ estado: "verificada" });

    expect(res.status).toBe(400);
    const actual = await prisma.pregunta.findUnique({ where: { id: idSinRespuesta } });
    expect(actual?.estado).toBe("borrador");
  });

  it("permite marcar como anulada", async () => {
    const res = await request(app)
      .patch(`/api/admin/preguntas/${idSinRespuesta}`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ estado: "anulada" });

    expect(res.status).toBe(200);
    expect(res.body.pregunta.estado).toBe("anulada");
    expect(res.body.pregunta.fechaVerificacion).toBeNull();
  });

  it("un usuario no admin no puede editar preguntas", async () => {
    const res = await request(app)
      .patch(`/api/admin/preguntas/${idBorrador}`)
      .set("Authorization", `Bearer ${tokenNoAdmin}`)
      .send({ estado: "verificada" });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/resumen-temas", () => {
  it("cuenta las pendientes del tema de test tras las verificaciones/anulaciones anteriores", async () => {
    const res = await request(app)
      .get("/api/admin/resumen-temas?estado=borrador")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const temaTest = res.body.temas.find((t: { id: number }) => t.id === temaId);
    // idBorrador pasó a verificada e idSinRespuesta a anulada: ya no quedan en borrador.
    expect(temaTest.pendientes).toBe(0);
  });
});
