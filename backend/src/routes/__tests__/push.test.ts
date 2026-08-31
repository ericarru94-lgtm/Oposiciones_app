/**
 * Tests de integración de /api/push/*: consulta de la clave pública VAPID,
 * alta/actualización de una suscripción push y baja restringida al propio
 * usuario. No se llama nunca a un servicio push real — estos tests solo
 * ejercen el CRUD sobre PushSuscripcion, no el envío (ver
 * lib/enviarRecordatorios.ts para eso).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import { vi } from "vitest";
vi.mock("@clerk/express", () => import("../../test-utils/clerkMock"));

import { crearApp } from "../../app";
import { prisma } from "../../lib/prisma";
import { mockUsuarioClerk } from "../../test-utils/clerkMock";

const app = crearApp();

const tokenA = "clerk_test_push_a";
const tokenB = "clerk_test_push_b";
const EMAIL_A = "test-push-a@example.com";
const EMAIL_B = "test-push-b@example.com";
const ENDPOINT_A = "https://push.example.com/endpoint-a";
const ENDPOINT_B = "https://push.example.com/endpoint-b";

async function limpiarFixtures() {
  await prisma.pushSuscripcion.deleteMany({ where: { endpoint: { in: [ENDPOINT_A, ENDPOINT_B] } } });
  await prisma.usuario.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B] } } });
}

beforeAll(async () => {
  await limpiarFixtures();
  mockUsuarioClerk(tokenA, EMAIL_A);
  mockUsuarioClerk(tokenB, EMAIL_B);
});

beforeEach(async () => {
  await prisma.pushSuscripcion.deleteMany({ where: { endpoint: { in: [ENDPOINT_A, ENDPOINT_B] } } });
});

afterAll(async () => {
  await limpiarFixtures();
  await prisma.$disconnect();
});

describe("GET /api/push/clave-publica", () => {
  it("devuelve la clave pública VAPID configurada", async () => {
    const res = await request(app).get("/api/push/clave-publica");
    expect(res.status).toBe(200);
    expect(res.body.clavePublica).toEqual(expect.any(String));
    expect(res.body.clavePublica.length).toBeGreaterThan(10);
  });
});

describe("POST /api/push/suscribir", () => {
  it("rechaza sin autenticación", async () => {
    const res = await request(app)
      .post("/api/push/suscribir")
      .send({ endpoint: ENDPOINT_A, keys: { p256dh: "clave-p256dh", auth: "clave-auth" } });
    expect(res.status).toBe(401);
  });

  it("da de alta la suscripción del usuario autenticado", async () => {
    const res = await request(app)
      .post("/api/push/suscribir")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ endpoint: ENDPOINT_A, keys: { p256dh: "clave-p256dh", auth: "clave-auth" } });
    expect(res.status).toBe(201);

    const fila = await prisma.pushSuscripcion.findUnique({ where: { endpoint: ENDPOINT_A } });
    expect(fila).not.toBeNull();
    expect(fila?.p256dh).toBe("clave-p256dh");

    const usuario = await prisma.usuario.findUnique({ where: { email: EMAIL_A } });
    expect(fila?.usuarioId).toBe(usuario!.id);
  });

  it("reasigna la suscripción si el mismo endpoint se resuscribe con otro usuario", async () => {
    await request(app)
      .post("/api/push/suscribir")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ endpoint: ENDPOINT_A, keys: { p256dh: "p1", auth: "a1" } });

    await request(app)
      .post("/api/push/suscribir")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ endpoint: ENDPOINT_A, keys: { p256dh: "p2", auth: "a2" } });

    const filas = await prisma.pushSuscripcion.findMany({ where: { endpoint: ENDPOINT_A } });
    expect(filas).toHaveLength(1);
    const usuarioB = await prisma.usuario.findUnique({ where: { email: EMAIL_B } });
    expect(filas[0].usuarioId).toBe(usuarioB!.id);
    expect(filas[0].p256dh).toBe("p2");
  });

  it("rechaza un body inválido (falta el objeto keys)", async () => {
    const res = await request(app)
      .post("/api/push/suscribir")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ endpoint: ENDPOINT_A });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/push/desuscribir", () => {
  it("borra solo la suscripción del propio usuario, nunca la de otro", async () => {
    await request(app)
      .post("/api/push/suscribir")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ endpoint: ENDPOINT_A, keys: { p256dh: "p1", auth: "a1" } });

    // El usuario B intenta borrar el endpoint de A: no debe afectar a la fila de A.
    await request(app)
      .post("/api/push/desuscribir")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ endpoint: ENDPOINT_A });
    expect(await prisma.pushSuscripcion.findUnique({ where: { endpoint: ENDPOINT_A } })).not.toBeNull();

    // El propio usuario A sí puede darse de baja.
    const res = await request(app)
      .post("/api/push/desuscribir")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ endpoint: ENDPOINT_A });
    expect(res.status).toBe(200);
    expect(await prisma.pushSuscripcion.findUnique({ where: { endpoint: ENDPOINT_A } })).toBeNull();
  });
});
