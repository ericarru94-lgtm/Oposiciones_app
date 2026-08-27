import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { preguntasRouter } from "./routes/preguntas";
import { progresoRouter } from "./routes/progreso";
import { adminRouter } from "./routes/admin";
import { stripeRouter } from "./routes/stripe";
import { stripeWebhookHandler } from "./routes/stripeWebhook";

/**
 * App de Express sin `listen()`, para poder importarla tanto desde
 * server.ts como desde los tests (supertest habla directamente con la
 * app sin necesidad de abrir un puerto real).
 */
export function crearApp() {
  const app = express();

  app.use(cors());

  // El webhook de Stripe necesita el body crudo (sin JSON-parsear) para
  // verificar la firma, así que se monta ANTES de express.json() global
  // y con su propio parser. Al no matchear otras rutas, el resto sigue
  // llegando a express.json() con normalidad.
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);

  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api/preguntas", preguntasRouter);
  app.use("/api/progreso", progresoRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/stripe", stripeRouter);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  });

  return app;
}
