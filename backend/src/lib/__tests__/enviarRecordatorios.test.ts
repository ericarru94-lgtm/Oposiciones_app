/**
 * Tests de enviarRecordatoriosDiarios: verifica el recuento de
 * enviados/fallidos y, sobre todo, que una suscripción caducada (404/410
 * del servicio push) se borra de la base de datos en vez de reintentarse
 * indefinidamente. web-push se mockea por completo — nunca se llama a un
 * servicio push real.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendNotificationMock } = vi.hoisted(() => ({ sendNotificationMock: vi.fn() }));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: sendNotificationMock,
  },
}));

import { enviarRecordatoriosDiarios } from "../enviarRecordatorios";
import { prisma } from "../prisma";

const EMAIL = "test-recordatorios@example.com";
const ENDPOINT_VIVA = "https://push.example.com/viva";
const ENDPOINT_CADUCADA = "https://push.example.com/caducada";

async function limpiarFixtures() {
  await prisma.pushSuscripcion.deleteMany({ where: { endpoint: { in: [ENDPOINT_VIVA, ENDPOINT_CADUCADA] } } });
  await prisma.usuario.deleteMany({ where: { email: EMAIL } });
}

beforeEach(async () => {
  await limpiarFixtures();
  sendNotificationMock.mockReset();

  const usuario = await prisma.usuario.create({ data: { email: EMAIL } });
  await prisma.pushSuscripcion.createMany({
    data: [
      { endpoint: ENDPOINT_VIVA, p256dh: "p1", auth: "a1", usuarioId: usuario.id },
      { endpoint: ENDPOINT_CADUCADA, p256dh: "p2", auth: "a2", usuarioId: usuario.id },
    ],
  });
});

afterAll(async () => {
  await limpiarFixtures();
  await prisma.$disconnect();
});

describe("enviarRecordatoriosDiarios", () => {
  it("envía a las suscripciones activas y borra las que el servicio push marca como caducadas (404/410)", async () => {
    sendNotificationMock.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint === ENDPOINT_CADUCADA) {
        const error = new Error("Gone") as Error & { statusCode: number };
        error.statusCode = 410;
        throw error;
      }
      return { statusCode: 201 };
    });

    const resultado = await enviarRecordatoriosDiarios();

    expect(resultado).toEqual({ enviados: 1, caducadas: 1, fallidos: 0 });
    expect(await prisma.pushSuscripcion.findUnique({ where: { endpoint: ENDPOINT_VIVA } })).not.toBeNull();
    expect(await prisma.pushSuscripcion.findUnique({ where: { endpoint: ENDPOINT_CADUCADA } })).toBeNull();
  });

  it("cuenta como fallido un error que no sea 404/410, y no borra esa suscripción", async () => {
    sendNotificationMock.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint === ENDPOINT_CADUCADA) {
        const error = new Error("Server error") as Error & { statusCode: number };
        error.statusCode = 500;
        throw error;
      }
      return { statusCode: 201 };
    });

    const resultado = await enviarRecordatoriosDiarios();

    expect(resultado).toEqual({ enviados: 1, caducadas: 0, fallidos: 1 });
    expect(await prisma.pushSuscripcion.findUnique({ where: { endpoint: ENDPOINT_CADUCADA } })).not.toBeNull();
  });
});
