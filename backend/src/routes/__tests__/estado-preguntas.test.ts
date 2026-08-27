/**
 * Tests de integración del flujo de `estado` en Pregunta
 * (borrador → verificada / anulada). Ver `backend/docs/estados-preguntas.md`
 * para la documentación completa del comportamiento que estos tests fijan.
 *
 * Requieren una base de datos de test real (ver backend/.env.test.example)
 * ya migrada: `npm test` ejecuta `prisma migrate deploy` antes de la suite.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { crearApp } from "../../app";
import { prisma } from "../../lib/prisma";

const app = crearApp();

const TEMA_FIXTURE = { bloque: "I" as const, numero: 999, nombre: "Tema de test (estados)" };

let temaId: number;
let idVerificada: string;
let idBorrador: string;
let idAnulada: string;

async function limpiarFixtures() {
  await prisma.intento.deleteMany({ where: { preguntaId: { startsWith: "test-estado-" } } });
  await prisma.progreso.deleteMany({ where: { preguntaId: { startsWith: "test-estado-" } } });
  await prisma.pregunta.deleteMany({ where: { id: { startsWith: "test-estado-" } } });
  await prisma.tema.deleteMany({ where: { numero: TEMA_FIXTURE.numero, bloque: TEMA_FIXTURE.bloque } });
}

beforeAll(async () => {
  await limpiarFixtures();

  const tema = await prisma.tema.create({ data: TEMA_FIXTURE });
  temaId = tema.id;

  const verificada = await prisma.pregunta.create({
    data: {
      id: "test-estado-verificada",
      temaId,
      enunciado: "[fixture] Pregunta verificada",
      opciones: ["Opción A", "Opción B", "Opción C", "Opción D"],
      respuestaCorrecta: "b",
      origen: "examen_oficial",
      estado: "verificada",
      tipo: "teorica",
    },
  });
  idVerificada = verificada.id;

  const borrador = await prisma.pregunta.create({
    data: {
      id: "test-estado-borrador",
      temaId,
      enunciado: "[fixture] Pregunta en borrador",
      opciones: ["Opción A", "Opción B", "Opción C", "Opción D"],
      respuestaCorrecta: "a",
      origen: "generada_ia",
      estado: "borrador",
      tipo: "teorica",
    },
  });
  idBorrador = borrador.id;

  const anulada = await prisma.pregunta.create({
    data: {
      id: "test-estado-anulada",
      temaId,
      enunciado: "[fixture] Pregunta anulada",
      opciones: ["Opción A", "Opción B", "Opción C", "Opción D"],
      respuestaCorrecta: null,
      origen: "examen_oficial",
      estado: "anulada",
      tipo: "teorica",
    },
  });
  idAnulada = anulada.id;
});

afterAll(async () => {
  await limpiarFixtures();
  await prisma.$disconnect();
});

describe("GET /api/preguntas/aleatorias — visibilidad por estado", () => {
  it("por defecto (sin filtro estado) solo devuelve preguntas verificadas", async () => {
    const res = await request(app).get("/api/preguntas/aleatorias?limit=50");
    expect(res.status).toBe(200);

    const ids = res.body.preguntas.map((p: { id: string }) => p.id);
    expect(ids).toContain(idVerificada);
    expect(ids).not.toContain(idBorrador);
    expect(ids).not.toContain(idAnulada);
  });

  it("permite forzar estado=borrador (uso interno de QA), pero sigue ocultando la respuesta correcta", async () => {
    const res = await request(app).get("/api/preguntas/aleatorias?limit=50&estado=borrador");
    expect(res.status).toBe(200);

    const pregunta = res.body.preguntas.find((p: { id: string }) => p.id === idBorrador);
    expect(pregunta).toBeDefined();
    expect(pregunta.respuestaCorrecta).toBeUndefined();
  });

  it("rechaza estado=anulada como filtro: nunca es un valor válido, ni siquiera para QA interno", async () => {
    const res = await request(app).get("/api/preguntas/aleatorias?limit=50&estado=anulada");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/preguntas/:id/responder — reglas por estado", () => {
  it("se puede responder una pregunta verificada y queda registrado el intento", async () => {
    const res = await request(app)
      .post(`/api/preguntas/${idVerificada}/responder`)
      .send({ opcion: "b", sesionAnonima: "test-estado-sesion-1" });

    expect(res.status).toBe(200);
    expect(res.body.esCorrecta).toBe(true);
    expect(res.body.respuestaCorrecta).toBe("b");

    const intento = await prisma.intento.findFirst({
      where: { preguntaId: idVerificada, sesionAnonima: "test-estado-sesion-1" },
    });
    expect(intento).not.toBeNull();
  });

  it("rechaza con 410 responder una pregunta anulada, y no crea Intento", async () => {
    const antes = await prisma.intento.count({ where: { preguntaId: idAnulada } });

    const res = await request(app)
      .post(`/api/preguntas/${idAnulada}/responder`)
      .send({ opcion: "a", sesionAnonima: "test-estado-sesion-2" });

    expect(res.status).toBe(410);
    const despues = await prisma.intento.count({ where: { preguntaId: idAnulada } });
    expect(despues).toBe(antes);
  });

  it("SÍ permite responder una pregunta en borrador si se conoce su id: el estado solo controla el descubrimiento, no el acceso directo", async () => {
    const res = await request(app)
      .post(`/api/preguntas/${idBorrador}/responder`)
      .send({ opcion: "a", sesionAnonima: "test-estado-sesion-3" });

    expect(res.status).toBe(200);
    expect(res.body.esCorrecta).toBe(true);
  });
});

describe("GET /api/progreso/hoy — solo propone verificadas como nuevas", () => {
  it("nunca sugiere una pregunta en borrador o anulada dentro de 'nuevas'", async () => {
    const email = `test-estado-${Date.now()}@example.com`;
    const registro = await request(app)
      .post("/api/auth/registro")
      .send({ email, password: "password123" });
    expect(registro.status).toBe(201);
    const token = registro.body.token as string;

    const res = await request(app)
      .get("/api/progreso/hoy?limit=50")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const idsNuevas = res.body.nuevas.map((p: { preguntaId: string }) => p.preguntaId);
    expect(idsNuevas).not.toContain(idBorrador);
    expect(idsNuevas).not.toContain(idAnulada);
  });
});

describe("Transición borrador → verificada", () => {
  it("promover una pregunta (UPDATE directo, no hay endpoint de moderación todavía) la hace visible de inmediato en /aleatorias", async () => {
    await prisma.pregunta.update({
      where: { id: idBorrador },
      data: { estado: "verificada", fechaVerificacion: new Date() },
    });

    try {
      const res = await request(app).get("/api/preguntas/aleatorias?limit=50");
      const ids = res.body.preguntas.map((p: { id: string }) => p.id);
      expect(ids).toContain(idBorrador);
    } finally {
      // Revertir para no afectar el resto de tests de este archivo.
      await prisma.pregunta.update({
        where: { id: idBorrador },
        data: { estado: "borrador", fechaVerificacion: null },
      });
    }
  });
});
