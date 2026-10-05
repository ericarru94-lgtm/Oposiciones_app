/**
 * URL base del frontend, para construir enlaces que se mandan por email o
 * redirects de Stripe. El fallback a localhost:5173 es solo para dev/test
 * sin FRONTEND_URL configurada. Antes esta misma línea vivía duplicada en
 * routes/newsletter.ts y routes/stripe.ts.
 */
export const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
