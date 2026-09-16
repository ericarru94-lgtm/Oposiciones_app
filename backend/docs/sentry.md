# Monitorización de errores (Sentry)

## 1. Qué hace hoy

Captura en Sentry los errores no controlados del backend: excepciones
que llegan hasta el error handler final de Express y rechazos/excepciones
fuera de una petición HTTP (el propio SDK instrumenta `process` para eso).

Piezas:

- **`src/instrument.ts`**: inicializa el SDK (`Sentry.init`) si hay
  `SENTRY_DSN` en el entorno. Se importa como la primera línea de
  `server.ts`, antes que cualquier otro módulo — el SDK solo instrumenta
  correctamente lo que se importa después de `Sentry.init()`.
- **`app.ts`**: `Sentry.setupExpressErrorHandler(app)`, montado después
  de todas las rutas y antes del error handler propio que responde el
  JSON `{ error: "Error interno del servidor" }` — Sentry ve el error
  primero (lo envía) y luego sigue la cadena hacia ese handler, que no
  cambia de comportamiento.

## 2. Variables de entorno

```
SENTRY_DSN=""
```

Se obtiene creando un proyecto Node en [sentry.io](https://sentry.io).
Sin ella (dev/test/E2E no la configuran a propósito), tanto
`instrument.ts` como el error handler de Sentry en `app.ts` son un
no-op: el backend arranca y responde igual, solo que sin mandar nada.

## 3. Por qué no está en `server.ts` junto al resto de imports

`server.ts` documenta ya por qué no carga ningún `.env` (en producción
las inyecta la plataforma; en local/test cada script arranca envuelto
en `dotenv -e`). `instrument.ts` depende de esa misma variable ya
presente en `process.env`, así que solo necesita ir *primero*, no
cargar nada por su cuenta.
