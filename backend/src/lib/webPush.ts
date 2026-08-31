import webpush from "web-push";

let configurado = false;

/** true si VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY están definidas (dev/test no las requieren). */
export function pushConfigurado(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Cliente de web-push con inicialización perezosa (mismo patrón que
 * lib/stripe.ts): sin las claves VAPID el backend arranca igual, y las
 * rutas/scripts que dependen de esto fallan con un error claro solo al
 * intentar usarlo de verdad, no al arrancar.
 */
function asegurarConfigurado() {
  if (configurado) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error(
      "Faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY en el entorno. Genera un par con " +
        "`node -e \"console.log(require('web-push').generateVAPIDKeys())\"` y añádelas a backend/.env " +
        "(ver backend/docs/notificaciones-push.md)."
    );
  }
  const subject = process.env.VAPID_SUBJECT || "mailto:aprobox.app@gmail.com";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configurado = true;
}

export function obtenerWebPush(): typeof webpush {
  asegurarConfigurado();
  return webpush;
}
