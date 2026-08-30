import Stripe from "stripe";
import { prisma } from "./prisma";

/** Solo estos dos estados de Stripe dan acceso premium (bypass del límite diario). */
const ESTADOS_PREMIUM = new Set(["active", "trialing"]);

/**
 * Punto único de verdad para reflejar una Subscription de Stripe en
 * nuestro Usuario. La llaman tanto el webhook (checkout.session.completed,
 * customer.subscription.created/updated/deleted) como, potencialmente,
 * una futura sincronización manual — así el mapeo estado-de-Stripe ->
 * plan/premiumHasta vive en un solo sitio.
 */
export async function sincronizarSuscripcionDesdeStripe(subscription: Stripe.Subscription): Promise<void> {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const usuario = await prisma.usuario.findUnique({ where: { stripeCustomerId: customerId } });
  if (!usuario) {
    console.warn(`Webhook de Stripe: ningún Usuario con stripeCustomerId=${customerId} (subscription=${subscription.id})`);
    return;
  }

  const esPremium = ESTADOS_PREMIUM.has(subscription.status);
  // `current_period_end` vive en cada item de la suscripción (no en el
  // objeto Subscription) en la versión de API que usa este SDK.
  const finPeriodoUnix = subscription.items.data[0]?.current_period_end;

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: {
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
      plan: esPremium ? "premium" : "free",
      // Si deja de ser premium (cancelada, impago...) no borramos
      // premiumHasta: queda como registro de hasta cuándo estuvo cubierto.
      premiumHasta: esPremium && finPeriodoUnix ? new Date(finPeriodoUnix * 1000) : usuario.premiumHasta,
      // Cancelar desde el Billing Portal no borra la suscripción al momento:
      // Stripe la deja "active" con cancel_at_period_end=true hasta que
      // termine el periodo ya pagado. Sin este flag, Perfil seguiría
      // mostrando "Plan premium" sin más, como si la cancelación no hubiera
      // registrado nada.
      cancelaAlFinalizarPeriodo: esPremium && subscription.cancel_at_period_end,
    },
  });
}
