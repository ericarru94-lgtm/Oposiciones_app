import { enviarEmailResiliente } from "./enviarEmailResiliente";

/**
 * Destino de los avisos operativos (registro nuevo, etc.), no de acceso de
 * usuario final. Por defecto reutiliza el primer email de ADMIN_EMAILS
 * (normalmente el único admin) para no exigir configurar nada aparte; se
 * puede desacoplar con NOTIFICACIONES_ADMIN_EMAIL si algún día se quiere
 * mandar a una dirección distinta de la que tiene acceso a /admin.
 */
const EMAIL_NOTIFICACIONES =
  process.env.NOTIFICACIONES_ADMIN_EMAIL ?? process.env.ADMIN_EMAILS?.split(",")[0]?.trim();

/**
 * Avisa por email de un registro nuevo. Fire-and-forget (ver
 * enviarEmailResiliente): nunca debe poder tumbar el login ni el alta del
 * usuario. Sin RESEND_API_KEY ni un email de destino configurado, es un
 * no-op silencioso.
 */
export async function notificarNuevoRegistro(email: string) {
  if (!EMAIL_NOTIFICACIONES) return;
  await enviarEmailResiliente("notificacionesAdmin", {
    to: EMAIL_NOTIFICACIONES,
    subject: `Nuevo registro en Aprobox: ${email}`,
    text: `Se acaba de registrar un nuevo usuario en Aprobox: ${email}`,
  });
}

/**
 * Avisa por email al pasar a premium por primera vez (o al resuscribirse
 * tras haber caído a free) — llamarlo solo en esa transición, no en cada
 * sincronización del webhook mientras ya era premium (renovaciones,
 * cambios de `cancel_at_period_end`, etc.), o mandaría un aviso por cada
 * evento de Stripe en vez de uno por alta real.
 */
export async function notificarNuevaSuscripcionPremium(email: string) {
  if (!EMAIL_NOTIFICACIONES) return;
  await enviarEmailResiliente("notificacionesAdmin", {
    to: EMAIL_NOTIFICACIONES,
    subject: `Nueva suscripción premium en Aprobox: ${email}`,
    text: `Un usuario se acaba de hacer premium en Aprobox: ${email}`,
  });
}
