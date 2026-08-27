import { Request, Response } from "express";
import Stripe from "stripe";
import { obtenerStripe } from "../lib/stripe";
import { asyncHandler } from "../lib/asyncHandler";
import { sincronizarSuscripcionDesdeStripe } from "../lib/sincronizarSuscripcion";

/**
 * Handler crudo (sin JSON-parsear: ver app.ts, se monta con express.raw()
 * ANTES del express.json() global) para poder verificar la firma de
 * Stripe contra los bytes exactos del body.
 *
 * Eventos que nos importan:
 * - checkout.session.completed: primer pago hecho, activa la suscripción.
 * - customer.subscription.created/updated/deleted: cualquier cambio de
 *   estado (renovación, impago -> "past_due", cancelación...).
 * - invoice.payment_failed: solo se registra; el cambio de estado real
 *   (a "past_due") llega vía customer.subscription.updated.
 */
export const stripeWebhookHandler = asyncHandler(async (req: Request, res: Response) => {
  const secreto = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secreto) {
    return res.status(500).json({ error: "STRIPE_WEBHOOK_SECRET no está configurado en el servidor" });
  }
  const firma = req.headers["stripe-signature"];
  if (!firma || typeof firma !== "string") {
    return res.status(400).json({ error: "Falta la cabecera stripe-signature" });
  }

  const stripe = obtenerStripe();
  let evento: Stripe.Event;
  try {
    evento = stripe.webhooks.constructEvent(req.body, firma, secreto);
  } catch (err) {
    return res.status(400).json({ error: `Firma de webhook inválida: ${(err as Error).message}` });
  }

  switch (evento.type) {
    case "checkout.session.completed": {
      const session = evento.data.object as Stripe.Checkout.Session;
      if (typeof session.subscription === "string") {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        await sincronizarSuscripcionDesdeStripe(subscription);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await sincronizarSuscripcionDesdeStripe(evento.data.object as Stripe.Subscription);
      break;
    case "invoice.payment_failed": {
      const invoice = evento.data.object as Stripe.Invoice;
      console.warn(`Stripe: pago fallido para customer=${invoice.customer}`);
      break;
    }
    default:
      break;
  }

  res.json({ received: true });
});
