import { obtenerClavePublicaPush, suscribirPush, desuscribirPush } from "../api/endpoints";
import { ApiError } from "../api/client";

/** true si el navegador soporta service worker + Push API + Notification (Safari de escritorio antiguo, por ejemplo, no). */
export function soportaNotificacionesPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Convierte la clave pública VAPID (base64url) al Uint8Array que exige PushManager.subscribe. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Pide permiso de notificaciones y, si se concede, suscribe este
 * dispositivo al recordatorio diario. Pensado para llamarse solo tras una
 * acción explícita del usuario sobre nuestro propio aviso (nunca al cargar
 * la página) — así el permiso nativo del navegador no aparece de sorpresa.
 * Nunca lanza: cualquier fallo (no soportado, permiso denegado, VAPID no
 * configurado en el servidor, red) se resuelve como `{ ok: false, motivo }`
 * para que quien llama pueda mostrar un mensaje sin romper el resto de la app.
 */
export async function activarRecordatorioDiario(
  token: string
): Promise<{ ok: true } | { ok: false; motivo: "no-soportado" | "permiso-denegado" | "no-disponible" | "error" }> {
  if (!soportaNotificacionesPush()) return { ok: false, motivo: "no-soportado" };

  try {
    const { clavePublica } = await obtenerClavePublicaPush();

    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") return { ok: false, motivo: "permiso-denegado" };

    const registro = await navigator.serviceWorker.ready;
    const suscripcionExistente = await registro.pushManager.getSubscription();
    const suscripcion =
      suscripcionExistente ??
      (await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(clavePublica),
      }));

    const json = suscripcion.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { ok: false, motivo: "error" };

    await suscribirPush(token, { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { ok: false, motivo: "no-disponible" };
    console.error("No se pudo activar el recordatorio diario:", err);
    return { ok: false, motivo: "error" };
  }
}

/** Da de baja la suscripción push de este dispositivo, tanto en el navegador como en el backend. */
export async function desactivarRecordatorioDiario(token: string): Promise<void> {
  if (!soportaNotificacionesPush()) return;
  const registro = await navigator.serviceWorker.getRegistration();
  const suscripcion = await registro?.pushManager.getSubscription();
  if (!suscripcion) return;
  await desuscribirPush(token, suscripcion.endpoint).catch(() => undefined);
  await suscripcion.unsubscribe().catch(() => undefined);
}
