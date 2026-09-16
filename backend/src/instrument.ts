import * as Sentry from "@sentry/node";

/**
 * Debe ser el PRIMER import de server.ts (antes de crearApp y de
 * cualquier otro módulo): Sentry.init() instrumenta automáticamente
 * módulos como http al cargarse, y solo captura lo que pasa por código
 * importado después de esta llamada. Sin SENTRY_DSN en el entorno (dev/
 * test/E2E no la configuran a propósito) esto es un no-op y el backend
 * arranca igual, sin monitorización de errores.
 */
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
  });
}
