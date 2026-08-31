/**
 * Envía el recordatorio push diario a todas las suscripciones activas.
 * Pensado para invocarse desde un cron externo (p.ej. un Cron Job de
 * Render) si se prefiere no depender del scheduler en proceso que arranca
 * server.ts — ver backend/docs/notificaciones-push.md.
 *
 * Uso: npm run enviar-recordatorios
 */
import { prisma } from "../lib/prisma";
import { enviarRecordatoriosDiarios } from "../lib/enviarRecordatorios";

enviarRecordatoriosDiarios()
  .catch((err) => {
    console.error("Error enviando recordatorios:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
