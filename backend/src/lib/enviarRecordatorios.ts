import { prisma } from "./prisma";
import { obtenerWebPush, pushConfigurado } from "./webPush";
import { ejecutarConLimite } from "./concurrencia";

/**
 * Cuántos envíos push en vuelo a la vez (ver lib/concurrencia.ts). Un
 * valor conservador por defecto: cada envío es una petición HTTP a un
 * servicio push externo (FCM, Mozilla Push...) ajeno a nuestro control, así
 * que un límite demasiado alto podría saturarlo o disparar sus propios
 * límites de tasa. Configurable por si hace falta ajustarlo sin desplegar.
 */
const CONCURRENCIA_ENVIO_PUSH = Number(process.env.PUSH_CONCURRENCIA ?? 20);

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

  // En paralelo con un límite de concurrencia, no una suscripción tras otra:
  // secuencial, con miles de suscripciones (cada envío es una petición HTTP
  // a un servicio externo que fácilmente tarda cientos de ms), este cron
  // diario podía tardar horas en terminar en vez de segundos.
  const resultados = await ejecutarConLimite(suscripciones, CONCURRENCIA_ENVIO_PUSH, async (suscripcion) => {
    try {
      await webpush.sendNotification(
        { endpoint: suscripcion.endpoint, keys: { p256dh: suscripcion.p256dh, auth: suscripcion.auth } },
        payload
      );
      return "enviado" as const;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSuscripcion.delete({ where: { id: suscripcion.id } }).catch(() => undefined);
        return "caducada" as const;
      }
      console.error(`[push] Error enviando a la suscripción ${suscripcion.id}:`, err);
      return "fallido" as const;
    }
  });

  let enviados = 0;
  let caducadas = 0;
  let fallidos = 0;
  for (const resultado of resultados) {
    // tarea() captura sus propios errores arriba y nunca relanza, así que
    // resultado.ok es siempre true aquí; se comprueba igual por si
    // ejecutarConLimite se reutiliza en el futuro con una tarea que sí lance.
    const tipo = resultado.ok ? resultado.valor : "fallido";
    if (tipo === "enviado") enviados++;
    else if (tipo === "caducada") caducadas++;
    else fallidos++;
  }

  console.log(`[push] Recordatorios: ${enviados} enviados, ${caducadas} suscripciones caducadas eliminadas, ${fallidos} fallidos.`);
  return { enviados, caducadas, fallidos };
}
