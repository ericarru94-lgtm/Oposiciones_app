import { Resend } from "resend";

let cliente: Resend | null = null;

/**
 * Cliente de Resend con inicialización perezosa: importar este módulo NO
 * requiere RESEND_API_KEY (así el backend arranca normalmente en
 * dev/test/E2E sin esa variable, y sin ella /suscribir sigue guardando el
 * consentimiento con normalidad — el envío del email es lo único que
 * falla, capturado por asyncHandler); solo falla al intentar usarlo de
 * verdad. Mismo patrón que lib/stripe.ts.
 */
export function obtenerResend(): Resend {
  if (!cliente) {
    const clave = process.env.RESEND_API_KEY;
    if (!clave) {
      throw new Error(
        "Falta RESEND_API_KEY en el entorno. Ver backend/docs/newsletter.md para darte de alta en Resend y configurarla."
      );
    }
    cliente = new Resend(clave);
  }
  return cliente;
}

/**
 * Remitente de los emails de la newsletter. En el dominio de pruebas de
 * Resend (mientras Aprobox no tenga dominio propio verificado) solo vale
 * "onboarding@resend.dev"; en cuanto haya un dominio propio verificado en
 * Resend, se cambia solo esta variable de entorno, sin tocar código.
 */
export const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "Aprobox <onboarding@resend.dev>";
