import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { authRouter } from "./routes/auth";
import { preguntasRouter } from "./routes/preguntas";
import { progresoRouter } from "./routes/progreso";
import { adminRouter } from "./routes/admin";
import { stripeRouter } from "./routes/stripe";
import { stripeWebhookHandler } from "./routes/stripeWebhook";
import { newsletterRouter } from "./routes/newsletter";
import { pushRouter } from "./routes/push";

/**
 * Orígenes desde los que el navegador puede llamar a esta API. En
 * desarrollo/E2E son puertos fijos de este repo (`npm run dev` y el modo
 * `--mode e2e`, ver `frontend/vite.config.ts` y `frontend/playwright.config.ts`);
 * en producción es el dominio real del frontend en Vercel, vía `FRONTEND_URL`
 * (la misma variable que ya usan las URLs de éxito/cancelación de Stripe en
 * `routes/stripe.ts`) — ver `backend/docs/despliegue.md`.
 */
const origenesPermitidos = ["http://localhost:5173", "http://localhost:5174", process.env.FRONTEND_URL].filter(
  (origen): origen is string => Boolean(origen)
);

/**
 * App de Express sin `listen()`, para poder importarla tanto desde
 * server.ts como desde los tests (supertest habla directamente con la
 * app sin necesidad de abrir un puerto real).
 */
export function crearApp() {
  const app = express();

  app.use(cors({ origin: origenesPermitidos }));

  // El webhook de Stripe necesita el body crudo (sin JSON-parsear) para
  // verificar la firma, así que se monta ANTES de express.json() global
  // y con su propio parser. Al no matchear otras rutas, el resto sigue
  // llegando a express.json() con normalidad.
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);

  app.use(express.json());

  // Sin CLERK_SECRET_KEY/CLERK_PUBLISHABLE_KEY (entornos de test/E2E, que no
  // los configuran a propósito) clerkMiddleware() lanzaría en cada petición
  // al intentar verificar la sesión; se sustituye por un paso-a-través para
  // que esas peticiones lleguen igualmente (como anónimas) a authOpcional/
  // authRequerido, que ya saben tratarlas — ver middleware/auth.ts.
  const clerkConfigurado = Boolean(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);
  app.use(clerkConfigurado ? clerkMiddleware() : (_req, _res, next) => next());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api/preguntas", preguntasRouter);
  app.use("/api/progreso", progresoRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/stripe", stripeRouter);
  app.use("/api/newsletter", newsletterRouter);
  app.use("/api/push", pushRouter);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  });

  return app;
}
