/**
 * Tests de integración de DELETE /api/auth/cuenta (borrado de cuenta
 * autoservicio): cancela la suscripción de Stripe si la hay, borra el
 * historial propio y la fila de Usuario, y borra también el usuario en
 * Clerk. Tanto Stripe como Clerk se mockean por completo.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: {
    subscriptions: { retrieve: vi.fn(), cancel: vi.fn() },
  },
}));

vi.mock("../../lib/stripe", () => ({
  obtenerStripe: () => stripeMock,
}));
vi.mock("@clerk/express", () => import("../../test-utils/clerkMock"));

import { crearApp } from "../../app";
import { prisma } from "../../lib/prisma";
import { mockUsuarioClerk, clerkClient } from "../../test-utils/clerkMock";

const app = crearApp();

async function limpiarFixtures() {
  await prisma.intento.deleteMany({ where: { preguntaId: { startsWith: "test-elimina-cuenta-" } } });
  await prisma.pregunta.deleteMany({ where: { id: { startsWith: "test-elimina-cuenta-" } } });
  await prisma.usuario.deleteMany({ where: { email: { startsWith: "test-elimina-cuenta-" } } });
}

afterAll(async () => {
  await limpiarFixtures();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limpiarFixtures();
  vi.clearAllMocks();
});

describe("DELETE /api/auth/cuenta", () => {
  it("responde 401 sin sesión", async () => {
    const res = await request(app).delete("/api/auth/cuenta");
    expect(res.status).toBe(401);
  });

  it("borra la fila de Usuario y su historial (plan gratuito, sin Stripe)", async () => {
    const clerkUserId = "clerk_test-elimina-cuenta-gratis";
    mockUsuarioClerk(clerkUserId, "test-elimina-cuenta-gratis@example.com");
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${clerkUserId}`);
    const usuarioId = me.body.id;

    const tema = await prisma.tema.upsert({
      where: { bloque_numero: { bloque: "I", numero: 996 } },
      create: { bloque: "I", numero: 996, nombre: "Tema de test (elimina cuenta)" },
      update: {},
    });
    const pregunta = await prisma.pregunta.create({
      data: {
        id: "test-elimina-cuenta-pregunta-1",
        temaId: tema.id,
        enunciado: "[fixture] ¿Pregunta de prueba?",
        opciones: ["A", "B", "C", "D"],
        respuestaCorrecta: "a",
        origen: "generada_ia",
        estado: "verificada",
        tipo: "teorica",
      },
    });
    await request(app)
      .post(`/api/preguntas/${pregunta.id}/responder`)
      .set("Authorization", `Bearer ${clerkUserId}`)
      .send({ opcion: "a" });

    const res = await request(app).delete("/api/auth/cuenta").set("Authorization", `Bearer ${clerkUserId}`);
    expect(res.status).toBe(204);

    expect(await prisma.usuario.findUnique({ where: { id: usuarioId } })).toBeNull();
    expect(await prisma.intento.count({ where: { usuarioId } })).toBe(0);
    expect(await prisma.progreso.count({ where: { usuarioId } })).toBe(0);
    expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
    expect(clerkClient.users.deleteUser).toHaveBeenCalledWith(clerkUserId);
  });

  it("cancela la suscripción de Stripe activa antes de borrar la cuenta", async () => {
    const clerkUserId = "clerk_test-elimina-cuenta-premium";
    mockUsuarioClerk(clerkUserId, "test-elimina-cuenta-premium@example.com");
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${clerkUserId}`);
    await prisma.usuario.update({
      where: { id: me.body.id },
      data: { plan: "premium", stripeCustomerId: "cus_test_elimina", stripeSubscriptionId: "sub_test_elimina" },
    });
    stripeMock.subscriptions.retrieve.mockResolvedValueOnce({ status: "active" });
    stripeMock.subscriptions.cancel.mockResolvedValueOnce({});

    const res = await request(app).delete("/api/auth/cuenta").set("Authorization", `Bearer ${clerkUserId}`);
    expect(res.status).toBe(204);
    expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith("sub_test_elimina");
  });

  it("borra la cuenta igualmente si Stripe o Clerk fallan al cancelar/borrar", async () => {
    const clerkUserId = "clerk_test-elimina-cuenta-falla-stripe";
    mockUsuarioClerk(clerkUserId, "test-elimina-cuenta-falla-stripe@example.com");
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${clerkUserId}`);
    const usuarioId = me.body.id;
    await prisma.usuario.update({
      where: { id: usuarioId },
      data: { stripeCustomerId: "cus_test_falla", stripeSubscriptionId: "sub_test_falla" },
    });
    stripeMock.subscriptions.retrieve.mockRejectedValueOnce(new Error("No such subscription"));
    (clerkClient.users.deleteUser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Clerk caído"));

    const res = await request(app).delete("/api/auth/cuenta").set("Authorization", `Bearer ${clerkUserId}`);
    expect(res.status).toBe(204);
    expect(await prisma.usuario.findUnique({ where: { id: usuarioId } })).toBeNull();
  });
});
