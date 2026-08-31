# Notificaciones push: recordatorio diario de repaso

## 1. Qué hace hoy

Recordatorio diario ("Tu repaso diario te espera") vía Web Push,
enviado a todos los dispositivos suscritos, con enlace directo a
`/repasar-hoy`. El usuario lo activa desde un aviso propio en Inicio
(nunca el permiso nativo del navegador sin avisar antes) que aparece
solo cuando lleva 2 o más días de racha — no en la primera visita.

Piezas:

- **Modelo `PushSuscripcion`** (`prisma/schema.prisma`): un dispositivo/
  navegador suscrito, con su `endpoint`, `p256dh` y `auth` (los tres
  campos que exige la Push API), enlazado al `Usuario`.
- **`GET /api/push/clave-publica`**: pública, sin autenticación — el
  frontend la necesita antes de saber si el usuario va a aceptar el
  permiso. Responde 404 si el servidor no tiene VAPID configurado, y
  el frontend usa eso para no ofrecer la función.
- **`POST /api/push/suscribir`** / **`POST /api/push/desuscribir`**
  (autenticadas): dan de alta o de baja la suscripción del dispositivo
  actual. La baja solo puede borrar la suscripción del propio usuario
  autenticado (nunca la de otro, aunque conozca su `endpoint`).
- **`lib/enviarRecordatorios.ts`**: la lógica de envío en sí —
  recorre todas las suscripciones y usa `web-push` para mandarles el
  aviso. Si el servicio push responde 404/410 (suscripción caducada:
  el usuario desinstaló la PWA, borró datos del sitio…), la borra en
  vez de reintentar.
- **Scheduler en proceso** (`server.ts`): programado con `node-cron` a
  las 18:00 UTC, solo si hay VAPID configurado. Pensado para no tener
  que configurar nada más en Render, con la salvedad de abajo.
- **`npm run enviar-recordatorios`**
  (`scripts/enviar-recordatorios-diarios.ts`): la misma lógica,
  invocable a mano o desde un cron externo — ver más abajo por qué
  puede hacer falta.
- **Service worker** (`frontend/public/service-worker.js`): maneja el
  evento `push` (muestra la notificación) y `notificationclick`
  (enfoca una pestaña de Aprobox ya abierta, o abre una nueva, en la
  URL del aviso).

## 2. Variables de entorno

```
VAPID_PUBLIC_KEY=""
VAPID_PRIVATE_KEY=""
VAPID_SUBJECT="mailto:aprobox.app@gmail.com"
```

Genera un par nuevo con:

```
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Sin `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, el backend arranca
exactamente igual (mismo patrón que `lib/stripe.ts`/`lib/resend.ts`):
`/api/push/clave-publica` responde 404, el frontend nunca ofrece
activar el recordatorio, y el scheduler en proceso no se programa.

## 3. Por qué el scheduler en proceso puede no bastar

`server.ts` programa el envío a las 18:00 UTC dentro del mismo
proceso Node que sirve la API — funciona sin configurar nada más
siempre que el servicio esté despierto a esa hora. En el plan free de
Render, un servicio sin tráfico puede dormirse por inactividad; si
eso ocurre justo a las 18:00 UTC, ese día no se envía el recordatorio
(se retoma normal al día siguiente, no hay nada que arreglar a mano).

Si se quiere una entrega más fiable sin depender de que el servicio
esté despierto en ese instante exacto, la alternativa es un **Cron
Job de Render** (o cualquier scheduler externo) que invoque
`npm run enviar-recordatorios` una vez al día — hace exactamente lo
mismo, es idempotente (una suscripción caducada solo se borra una
vez, volver a correrlo no duplica nada) y no depende de que el web
service esté ya despierto en ese momento.

## 4. Frontend: cuándo y cómo se pide el permiso

`components/AvisoRecordatorioPush.tsx` se muestra en Inicio solo
cuando: el navegador soporta Service Worker + Push API + Notification,
el usuario lleva 2+ días de racha (reutiliza `resumen.racha.dias`, ya
calculado para la tarjeta de racha — no hay un contador de "días de
uso" aparte), el permiso del navegador está en `"default"` (no
concedido ni denegado todavía) y el usuario no lo ha descartado antes
desde ese mismo aviso (`localStorage`, clave
`aprobox-push-descartado`).

Solo al pulsar "Sí, avísame" se llama a `Notification.requestPermission()`
— nunca al cargar la página. Si el usuario lo rechaza desde el diálogo
nativo, o pulsa "Ahora no", no se le vuelve a ofrecer en ese
navegador. Si el navegador no soporta Web Push, o el servidor no tiene
VAPID configurado, el aviso simplemente no aparece — el resto de la
app sigue funcionando con normalidad (`lib/notificacionesPush.ts`
nunca lanza, siempre resuelve `{ ok: false, motivo }`).
