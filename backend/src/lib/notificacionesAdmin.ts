import { obtenerResend, RESEND_FROM_EMAIL } from "./resend";

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
 * Avisa por email de un registro nuevo. Fire-and-forget: nunca debe poder
 * tumbar el login ni el alta del usuario (mismo motivo y mismo patrón que
 * `enviarEmail` en routes/newsletter.ts). Sin RESEND_API_KEY ni un email de
 * destino configurado, es un no-op silencioso.
 */
export async function notificarNuevoRegistro(email: string) {
  if (!EMAIL_NOTIFICACIONES) return;
  try {
    const { error } = await obtenerResend().emails.send({
      from: RESEND_FROM_EMAIL,
      to: EMAIL_NOTIFICACIONES,
      subject: `Nuevo registro en Aprobox: ${email}`,
      text: `Se acaba de registrar un nuevo usuario en Aprobox: ${email}`,
    });
    if (error) console.error("[notificacionesAdmin] Resend rechazó el aviso de registro:", error);
  } catch (err) {
    console.error("[notificacionesAdmin] No se pudo enviar el aviso de registro:", err);
  }
}
