import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authRequerido } from "../middleware/auth";
import { asyncHandler } from "../lib/asyncHandler";
import { obtenerStripe } from "../lib/stripe";
import { sincronizarSuscripcionDesdeStripe } from "../lib/sincronizarSuscripcion";

const ESTADOS_ACTIVOS = new Set(["active", "trialing"]);

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
      // Este email puede tener ya un Customer de Stripe con una suscripción
      // activa asociado a OTRA fila de Usuario — típicamente por el bug de
      // usuario duplicado tras migrar Clerk de Development a Production
      // (ver backend/docs/clerk.md): el usuario ya pagó, pero su sesión
      // actual apunta a una fila nueva sin stripeCustomerId. Crear aquí una
      // Checkout Session normal le cobraría una segunda suscripción por
      // error, así que primero se busca esa suscripción activa y, si
      // existe, se adopta en vez de iniciar un cobro nuevo.
      const clientesExistentes = await stripe.customers.list({ email: usuario.email, limit: 10 });
      for (const cliente of clientesExistentes.data) {
        const suscripciones = await stripe.subscriptions.list({ customer: cliente.id, status: "all", limit: 10 });
        const activa = suscripciones.data.find((s) => ESTADOS_ACTIVOS.has(s.status));
        if (!activa) continue;

        // stripeCustomerId es único: si ya está enlazado a OTRA fila de
        // Usuario (típicamente la cuenta original antes de una cuenta
        // duplicada por el bug de clerkUserId tras migrar Clerk — ver
        // backend/docs/clerk.md), no se puede enlazar aquí sin fusionar
        // las cuentas primero (backend/src/scripts/fusionar-usuario-duplicado.ts).
        const otraFilaConEsteCustomer = await prisma.usuario.findUnique({ where: { stripeCustomerId: cliente.id } });
        if (otraFilaConEsteCustomer && otraFilaConEsteCustomer.id !== usuario.id) {
          return res.status(409).json({
            error:
              "Ya existe una suscripción premium activa para este email en otra cuenta. Contacta con soporte para fusionar las cuentas antes de suscribirte de nuevo.",
          });
        }

        await prisma.usuario.update({ where: { id: usuario.id }, data: { stripeCustomerId: cliente.id } });
        await sincronizarSuscripcionDesdeStripe(activa);
        return res.json({ yaActivo: true });
      }

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
