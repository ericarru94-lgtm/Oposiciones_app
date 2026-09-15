import cron from "node-cron";
import { crearApp } from "./app";
import { pushConfigurado } from "./lib/webPush";
import { enviarRecordatoriosDiarios } from "./lib/enviarRecordatorios";

/**
 * Este archivo no carga ningún `.env`: en producción (Render) las
 * variables las inyecta la plataforma directamente en `process.env`, y en
 * local/test/E2E cada script (`dev`, `test`, `e2e:serve`... en
 * package.json) ya arranca envuelto en `dotenv -e <archivo>` con el
 * `.env*` que corresponda. Cargar aquí además el `.env` por defecto (como
 * hacía antes `import "dotenv/config"`) rellenaría con valores reales
 * cualquier variable que un `.env.test`/`.env.e2e` deje sin definir a
 * propósito (p.ej. CLERK_SECRET_KEY, para que esos entornos usen el
 * paso-a-través o el bypass en vez de Clerk/Stripe de verdad) — rompiendo
 * el aislamiento que esos entornos existen para garantizar.
 */
const app = crearApp();

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`Backend escuchando en http://localhost:${PORT}`);
});

/**
 * Recordatorio diario de repaso (Web Push): programado en proceso para que
 * funcione sin configurar nada más en Render — mientras el servicio esté
 * despierto a las 18:00 UTC, se envía. Si el plan free de Render lo
 * hubiera dormido por inactividad, no se enviaría ese día; para no
 * depender de eso, `npm run enviar-recordatorios` (scripts/enviar-
 * recordatorios-diarios.ts) hace exactamente lo mismo y puede invocarse
 * desde un Cron Job externo — ver backend/docs/notificaciones-push.md.
 * Sin VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY configuradas (dev/test) esto no
 * se programa.
 */
if (pushConfigurado()) {
  cron.schedule("0 18 * * *", () => {
    enviarRecordatoriosDiarios().catch((err) => console.error("[push] Error en el envío diario programado:", err));
  });
  console.log("[push] Recordatorio diario programado a las 18:00 UTC.");
}
