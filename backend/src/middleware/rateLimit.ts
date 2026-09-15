import rateLimit, { type Options } from "express-rate-limit";
import type { RequestHandler } from "express";

/**
 * En test la misma app (y por tanto el mismo almacén en memoria del
 * limitador) persiste entre los `it()` de un archivo entero — una suite
 * normal ya hace más peticiones que cualquier límite razonable, así que
 * se desactiva del todo: aquí no hay tráfico real que frenar.
 */
const ENTORNO_TEST = process.env.NODE_ENV === "test";

function crearLimitador(opciones: Partial<Options> & { windowMs: number; limit: number }): RequestHandler {
  if (ENTORNO_TEST) return (_req, _res, next) => next();
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    ...opciones,
  });
}

/**
 * Alta a la newsletter: pensado para frenar un script dando de alta muchos
 * emails distintos (gasta la cuota de Resend y llena la tabla de
 * suscriptores), no a una persona suscribiéndose una vez y reintentando si
 * falla. Por IP — ver `app.set("trust proxy", 1)` en app.ts, sin eso todas
 * las peticiones detrás del proxy de Render compartirían la misma IP.
 */
export const limitarNewsletter = crearLimitador({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: { error: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo." },
});

/**
 * Respuestas del mini-test sin registro (POST /preguntas/:id/responder sin
 * sesión): un límite generoso, pensado para frenar un script respondiendo
 * en bucle, no a una persona haciendo el mini-test con normalidad. Nunca
 * afecta a usuarios autenticados (`skip`): ya están identificados por su
 * cuenta, no hace falta frenarlos por IP.
 */
export const limitarRespuestasAnonimas = crearLimitador({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  skip: (req) => Boolean(req.auth),
  message: { error: "Demasiadas respuestas seguidas sin iniciar sesión. Espera unos minutos." },
});
