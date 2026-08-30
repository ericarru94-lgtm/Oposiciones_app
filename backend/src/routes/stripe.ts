import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authRequerido } from "../middleware/auth";
import { asyncHandler } from "../lib/asyncHandler";
import { obtenerStripe } from "../lib/stripe";

export const stripeRouter = Router();

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

/**
 * Crea una Checkout Session de Stripe (modo suscripción) para el usuario
 * autenticado y devuelve su URL para redirigir el navegador. Reutiliza el
 * Customer de Stripe si el usuario ya tenía uno (p.ej. de un intento de
 * suscripción anterior que canceló antes de pagar).
 */
stripeRouter.post(
  "/crear-checkout-session",
  authRequerido,
  asyncHandler(async (req, res) => {
    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      return res.status(500).json({ error: "STRIPE_PRICE_ID no está configurado en el servidor" });
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: req.auth!.usuarioId } });
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });

    const stripe = obtenerStripe();

    let stripeCustomerId = usuario.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: usuario.email,
        metadata: { usuarioId: usuario.id },
      });
      stripeCustomerId = customer.id;
      await prisma.usuario.update({ where: { id: usuario.id }, data: { stripeCustomerId } });
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: usuario.id,
      subscription_data: { metadata: { usuarioId: usuario.id } },
      success_url: `${FRONTEND_URL}/home?checkout=success`,
      cancel_url: `${FRONTEND_URL}/upgrade?checkout=cancelado`,
    });

    if (!session.url) {
      return res.status(500).json({ error: "Stripe no devolvió una URL de Checkout" });
    }

    res.json({ url: session.url });
  })
);

/**
 * Crea una sesión del Billing Portal de Stripe para el usuario autenticado
 * (gestionar método de pago, ver facturas, cancelar la suscripción) y
 * devuelve su URL. Requiere que el usuario ya tenga un Customer de Stripe
 * (siempre lo tiene si llegó a premium: se crea en /crear-checkout-session).
 */
stripeRouter.post(
  "/crear-portal-session",
  authRequerido,
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.auth!.usuarioId } });
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
    if (!usuario.stripeCustomerId) {
      return res.status(400).json({ error: "Este usuario todavía no tiene una suscripción de Stripe" });
    }

    const stripe = obtenerStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: usuario.stripeCustomerId,
      return_url: `${FRONTEND_URL}/perfil`,
      // Sin esto, el Billing Portal usa el locale del navegador o el de la
      // cuenta de Stripe, que puede quedar en inglés aunque toda la app sea
      // en español.
      locale: "es",
    });

    res.json({ url: session.url });
  })
);
