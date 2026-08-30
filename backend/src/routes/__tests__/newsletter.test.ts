/**
 * Tests de integración de /api/newsletter/*: alta con consentimiento
 * explícito (RGPD), confirmación por token (doble opt-in) y baja.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("@clerk/express", () => import("../../test-utils/clerkMock"));

import { crearApp } from "../../app";
import { prisma } from "../../lib/prisma";

const app = crearApp();

const EMAIL = "test-newsletter-alta@example.com";

async function limpiarFixtures() {
  await prisma.newsletterSuscriptor.deleteMany({ where: { email: { startsWith: "test-newsletter-" } } });
}

beforeAll(async () => {
  await limpiarFixtures();
});

beforeEach(async () => {
  await limpiarFixtures();
});

afterAll(async () => {
  await limpiarFixtures();
  await prisma.$disconnect();
});

describe("POST /api/newsletter/suscribir", () => {
  it("rechaza el alta sin consentimiento explícito", async () => {
    const res = await request(app)
      .post("/api/newsletter/suscribir")
      .send({ email: EMAIL, consentimiento: false });
    expect(res.status).toBe(400);

    const fila = await prisma.newsletterSuscriptor.findUnique({ where: { email: EMAIL } });
    expect(fila).toBeNull();
  });

  it("rechaza el alta si falta el campo consentimiento", async () => {
    const res = await request(app).post("/api/newsletter/suscribir").send({ email: EMAIL });
    expect(res.status).toBe(400);
  });

  it("registra el consentimiento y la fecha, en estado pendiente", async () => {
    const res = await request(app)
      .post("/api/newsletter/suscribir")
      .send({ email: EMAIL, consentimiento: true });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe("pendiente");

    const fila = await prisma.newsletterSuscriptor.findUnique({ where: { email: EMAIL } });
    expect(fila).not.toBeNull();
    expect(fila!.consentimiento).toBe(true);
    expect(fila!.fechaConsentimiento).toBeInstanceOf(Date);
    expect(fila!.estado).toBe("pendiente");
    expect(fila!.tokenConfirmacion).toBeTruthy();
    expect(fila!.tokenBaja).toBeTruthy();
  });

  it("es idempotente: repetir el alta con el mismo email no crea una segunda fila", async () => {
    await request(app).post("/api/newsletter/suscribir").send({ email: EMAIL, consentimiento: true });
    const res2 = await request(app)
      .post("/api/newsletter/suscribir")
      .send({ email: EMAIL, consentimiento: true });
    expect(res2.status).toBe(200);

    const filas = await prisma.newsletterSuscriptor.findMany({ where: { email: EMAIL } });
    expect(filas).toHaveLength(1);
  });

  it("permite volver a suscribirse tras una baja", async () => {
    await request(app).post("/api/newsletter/suscribir").send({ email: EMAIL, consentimiento: true });
    const fila = await prisma.newsletterSuscriptor.findUnique({ where: { email: EMAIL } });
    await request(app).post(`/api/newsletter/baja?token=${fila!.tokenBaja}`);

    const res = await request(app)
      .post("/api/newsletter/suscribir")
      .send({ email: EMAIL, consentimiento: true });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe("pendiente");
  });
});

describe("GET /api/newsletter/confirmar", () => {
  it("confirma una suscripción pendiente con un token válido", async () => {
    await request(app).post("/api/newsletter/suscribir").send({ email: EMAIL, consentimiento: true });
    const pendiente = await prisma.newsletterSuscriptor.findUnique({ where: { email: EMAIL } });

    const res = await request(app).get(`/api/newsletter/confirmar?token=${pendiente!.tokenConfirmacion}`);
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe("confirmado");

    const confirmado = await prisma.newsletterSuscriptor.findUnique({ where: { email: EMAIL } });
    expect(confirmado!.estado).toBe("confirmado");
    expect(confirmado!.confirmadoEn).toBeInstanceOf(Date);
  });

  it("responde 404 con un token de confirmación que no existe", async () => {
    const res = await request(app).get("/api/newsletter/confirmar?token=no-existe");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/newsletter/baja", () => {
  it("da de baja una suscripción con un token de baja válido", async () => {
    await request(app).post("/api/newsletter/suscribir").send({ email: EMAIL, consentimiento: true });
    const fila = await prisma.newsletterSuscriptor.findUnique({ where: { email: EMAIL } });

    const res = await request(app).post(`/api/newsletter/baja?token=${fila!.tokenBaja}`);
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe("baja");

    const actualizada = await prisma.newsletterSuscriptor.findUnique({ where: { email: EMAIL } });
    expect(actualizada!.estado).toBe("baja");
    expect(actualizada!.bajaEn).toBeInstanceOf(Date);
  });

  it("responde 404 con un token de baja que no existe", async () => {
    const res = await request(app).post("/api/newsletter/baja?token=no-existe");
    expect(res.status).toBe(404);
  });
});
