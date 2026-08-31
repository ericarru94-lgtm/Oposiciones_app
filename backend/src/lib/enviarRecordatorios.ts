import { prisma } from "./prisma";
import { obtenerWebPush, pushConfigurado } from "./webPush";

/**
 * Envía el recordatorio diario de repaso a todas las suscripciones push
 * activas. Usado tanto por el scheduler en proceso (server.ts) como por el
 * script standalone (scripts/enviar-recordatorios-diarios.ts, pensado para
 * invocarse desde un cron externo si no se quiere depender del scheduler
 * en proceso — ver backend/docs/notificaciones-push.md).
 *
 * Las suscripciones que el navegador ya considera caducadas (404/410 al
 * enviar) se borran: son una causa habitual y esperable (el usuario
 * desinstaló la PWA, borró datos del sitio, etc.), no un error a reintentar.
 */
export async function enviarRecordatoriosDiarios(): Promise<{ enviados: number; caducadas: number; fallidos: number }> {
  if (!pushConfigurado()) {
    console.log("[push] VAPID no configurado, no se envían recordatorios.");
    return { enviados: 0, caducadas: 0, fallidos: 0 };
  }

  const webpush = obtenerWebPush();
  const suscripciones = await prisma.pushSuscripcion.findMany();

  const payload = JSON.stringify({
    title: "Aprobox",
    body: "Tu repaso diario te espera — unos minutos para no perder la racha 🔥",
    url: "/repasar-hoy",
  });

  let enviados = 0;
  let caducadas = 0;
  let fallidos = 0;

  for (const suscripcion of suscripciones) {
    try {
      await webpush.sendNotification(
        {
          endpoint: suscripcion.endpoint,
          keys: { p256dh: suscripcion.p256dh, auth: suscripcion.auth },
        },
        payload
      );
      enviados++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSuscripcion.delete({ where: { id: suscripcion.id } }).catch(() => undefined);
        caducadas++;
      } else {
        console.error(`[push] Error enviando a la suscripción ${suscripcion.id}:`, err);
        fallidos++;
      }
    }
  }

  console.log(`[push] Recordatorios: ${enviados} enviados, ${caducadas} suscripciones caducadas eliminadas, ${fallidos} fallidos.`);
  return { enviados, caducadas, fallidos };
}
