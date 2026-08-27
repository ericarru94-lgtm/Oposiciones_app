/**
 * Tests de integración de Stripe (/api/stripe/*): crear Checkout Session
 * y el webhook que sincroniza el estado de la suscripción. El cliente de
 * Stripe (lib/stripe.ts) se mockea por completo — nunca se llama a la
 * API real, así que estos tests corren igual de aislados que el resto
 * de la suite (misma BD de test, sin red).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: {
    customers: { create: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
    subscriptions: { retrieve: vi.fn() },
    webhooks: { constructEvent: vi.fn() },
  },
}));

vi.mock("../../lib/stripe", () => ({
  obtenerStripe: () => stripeMock,
}));
vi.mock("@clerk/express", () => import("../../test-utils/clerkMock"));

import { crearApp } from "../../app";
import { prisma } from "../../lib/prisma";
import { mockUsuarioClerk } from "../../test-utils/clerkMock";

const app = crearApp();

async function limpiarFixtures() {
  await prisma.usuario.deleteMany({ where: { email: { startsWith: "test-stripe-" } } });
}

const tokenUsuario = "clerk_test_stripe_usuario";
let usuarioId: string;

beforeAll(async () => {
  await limpiarFixtures();
  mockUsuarioClerk(tokenUsuario, "test-stripe-usuario@example.com");
  const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${tokenUsuario}`);
  usuarioId = me.body.id;
});

afterAll(async () => {
  await limpiarFixtures();
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/stripe/crear-checkout-session", () => {
  it("responde 401 sin token", async () => {
    const res = await request(app).post("/api/stripe/crear-checkout-session");
    expect(res.status).toBe(401);
  });

  it("crea un Customer nuevo si el usuario no tenía uno, y lo guarda", async () => {
    stripeMock.customers.create.mockResolvedValueOnce({ id: "cus_nuevo" });
    stripeMock.checkout.sessions.create.mockResolvedValueOnce({ url: "https://checkout.stripe.com/pay/cs_test_1" });

    const res = await request(app)
      .post("/api/stripe/crear-checkout-session")
      .set("Authorization", `Bearer ${tokenUsuario}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://checkout.stripe.com/pay/cs_test_1");
    expect(stripeMock.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "test-stripe-usuario@example.com" })
    );
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_nuevo",
        mode: "subscription",
        line_items: [{ price: "price_test_dummy", quantity: 1 }],
      })
    );

    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    expect(usuario?.stripeCustomerId).toBe("cus_nuevo");
  });

  it("reutiliza el Customer si el usuario ya tenía uno", async () => {
    await prisma.usuario.update({ where: { id: usuarioId }, data: { stripeCustomerId: "cus_existente" } });
    stripeMock.checkout.sessions.create.mockResolvedValueOnce({ url: "https://checkout.stripe.com/pay/cs_test_2" });

    const res = await request(app)
      .post("/api/stripe/crear-checkout-session")
      .set("Authorization", `Bearer ${tokenUsuario}`);

    expect(res.status).toBe(200);
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existente" })
    );
  });

  it("un usuario que inicia sesión con Clerk por primera vez (fila creada al vuelo) también puede suscribirse", async () => {
    // Sin ningún GET /auth/me previo: el primer request autenticado de este
    // clerkUserId es directamente el checkout, para confirmar que
    // obtenerOCrearUsuarioDesdeClerk crea la fila a tiempo para que el
    // Customer de Stripe se cree sin problema (mismo camino que un usuario
    // nuevo que llega a /upgrade y se registra con Clerk desde ahí).
    const clerkUserIdNuevo = "clerk_test_stripe_usuario_nuevo";
    mockUsuarioClerk(clerkUserIdNuevo, "test-stripe-usuario-nuevo@example.com");
    stripeMock.customers.create.mockResolvedValueOnce({ id: "cus_recien_creado" });
    stripeMock.checkout.sessions.create.mockResolvedValueOnce({ url: "https://checkout.stripe.com/pay/cs_test_nuevo" });

    const res = await request(app)
      .post("/api/stripe/crear-checkout-session")
      .set("Authorization", `Bearer ${clerkUserIdNuevo}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://checkout.stripe.com/pay/cs_test_nuevo");
    expect(stripeMock.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "test-stripe-usuario-nuevo@example.com" })
    );

    const usuario = await prisma.usuario.findUnique({ where: { email: "test-stripe-usuario-nuevo@example.com" } });
    expect(usuario?.clerkUserId).toBe(clerkUserIdNuevo);
    expect(usuario?.stripeCustomerId).toBe("cus_recien_creado");
  });

  it("responde 500 si STRIPE_PRICE_ID no está configurado", async () => {
    const original = process.env.STRIPE_PRICE_ID;
    delete process.env.STRIPE_PRICE_ID;
    try {
      const res = await request(app)
        .post("/api/stripe/crear-checkout-session")
        .set("Authorization", `Bearer ${tokenUsuario}`);
      expect(res.status).toBe(500);
    } finally {
      process.env.STRIPE_PRICE_ID = original;
    }
  });
});

describe("POST /api/stripe/webhook", () => {
  it("responde 400 sin cabecera stripe-signature", async () => {
    const res = await request(app).post("/api/stripe/webhook").send({ tipo: "lo-que-sea" });
    expect(res.status).toBe(400);
  });

  it("responde 400 si la firma no es válida", async () => {
    stripeMock.webhooks.constructEvent.mockImplementationOnce(() => {
      throw new Error("firma no coincide");
    });
    const res = await request(app)
      .post("/api/stripe/webhook")
      .set("stripe-signature", "firma-falsa")
      .send({ tipo: "lo-que-sea" });
    expect(res.status).toBe(400);
  });

  it("checkout.session.completed activa la suscripción (plan=premium)", async () => {
    await prisma.usuario.update({ where: { id: usuarioId }, data: { stripeCustomerId: "cus_existente" } });

    const finPeriodo = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    stripeMock.webhooks.constructEvent.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: { object: { subscription: "sub_123" } },
    });
    stripeMock.subscriptions.retrieve.mockResolvedValueOnce({
      id: "sub_123",
      customer: "cus_existente",
      status: "active",
      items: { data: [{ current_period_end: finPeriodo }] },
    });

    const res = await request(app).post("/api/stripe/webhook").set("stripe-signature", "sig").send({});
    expect(res.status).toBe(200);

    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    expect(usuario?.plan).toBe("premium");
    expect(usuario?.stripeSubscriptionId).toBe("sub_123");
    expect(usuario?.stripeSubscriptionStatus).toBe("active");
    expect(usuario?.premiumHasta?.getTime()).toBe(finPeriodo * 1000);
  });

  it("customer.subscription.updated con estado past_due degrada a plan=free", async () => {
    await prisma.usuario.update({
      where: { id: usuarioId },
      data: { stripeCustomerId: "cus_existente", plan: "premium" },
    });
    stripeMock.webhooks.constructEvent.mockReturnValueOnce({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_existente",
          status: "past_due",
          items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) }] },
        },
      },
    });

    const res = await request(app).post("/api/stripe/webhook").set("stripe-signature", "sig").send({});
    expect(res.status).toBe(200);

    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    expect(usuario?.plan).toBe("free");
    expect(usuario?.stripeSubscriptionStatus).toBe("past_due");
  });

  it("customer.subscription.deleted cancela sin borrar premiumHasta (queda como histórico)", async () => {
    const usuarioAntes = await prisma.usuario.update({
      where: { id: usuarioId },
      data: { stripeCustomerId: "cus_existente", plan: "premium", premiumHasta: new Date() },
    });

    stripeMock.webhooks.constructEvent.mockReturnValueOnce({
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_existente",
          status: "canceled",
          items: { data: [] },
        },
      },
    });

    const res = await request(app).post("/api/stripe/webhook").set("stripe-signature", "sig").send({});
    expect(res.status).toBe(200);

    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    expect(usuario?.plan).toBe("free");
    expect(usuario?.stripeSubscriptionStatus).toBe("canceled");
    expect(usuario?.premiumHasta?.getTime()).toBe(usuarioAntes.premiumHasta?.getTime());
  });

  it("un evento de un customer desconocido no rompe nada (200, sin cambios)", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValueOnce({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_fantasma",
          customer: "cus_no_existe",
          status: "active",
          items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) }] },
        },
      },
    });

    const res = await request(app).post("/api/stripe/webhook").set("stripe-signature", "sig").send({});
    expect(res.status).toBe(200);
  });

  it("invoice.payment_failed responde 200 sin lanzar", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValueOnce({
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_existente" } },
    });
    const res = await request(app).post("/api/stripe/webhook").set("stripe-signature", "sig").send({});
    expect(res.status).toBe(200);
  });
});
