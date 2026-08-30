import { randomBytes } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";

export const newsletterRouter = Router();

/** Misma variable que ya usan las URLs de Stripe (routes/stripe.ts) para volver al frontend. */
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

function generarToken(): string {
  return randomBytes(24).toString("hex");
}

const suscribirSchema = z.object({
  email: z.string().email(),
  /**
   * RGPD: consentimiento explícito. El frontend nunca premarca el checkbox
   * que produce este valor, así que aquí solo se acepta `true` — un `false`
   * o ausente es tratado como una solicitud inválida, no como "sin
   * newsletter".
   */
  consentimiento: z.literal(true),
});

/**
 * Alta a la newsletter (RGPD: consentimiento explícito + doble opt-in).
 * Solo registra el consentimiento (con fecha) y deja la fila en "pendiente"
 * con un token de confirmación — el envío real del email de confirmación
 * no está implementado todavía (ver backend/docs/newsletter.md), así que
 * de momento la confirmación solo puede completarse llamando a
 * GET /confirmar con ese token por otra vía (p.ej. a mano en QA).
 */
newsletterRouter.post("/suscribir", asyncHandler(async (req, res) => {
  const parsed = suscribirSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email } = parsed.data;

  const existente = await prisma.newsletterSuscriptor.findUnique({ where: { email } });
  if (existente && existente.estado !== "baja") {
    // Ya está de alta (pendiente o confirmado): no se genera un token
    // nuevo ni se manda como error, para no filtrar a un tercero si ese
    // email ya está suscrito ni relanzar la confirmación sin necesidad.
    return res.json({ estado: existente.estado });
  }

  const datos = {
    consentimiento: true,
    fechaConsentimiento: new Date(),
    estado: "pendiente" as const,
    tokenConfirmacion: generarToken(),
    tokenBaja: generarToken(),
    confirmadoEn: null,
    bajaEn: null,
  };

  const suscriptor = existente
    ? await prisma.newsletterSuscriptor.update({ where: { email }, data: datos })
    : await prisma.newsletterSuscriptor.create({ data: { email, ...datos } });

  // TODO(newsletter): en cuanto haya proveedor de email (ver
  // backend/docs/newsletter.md), enviar aquí el correo de confirmación con
  // el enlace a /newsletter/confirmar?token=<tokenConfirmacion>. Mientras
  // tanto, se deja constancia en el log del servidor para poder confirmar
  // manualmente en QA/soporte.
  console.log(
    `[newsletter] Alta pendiente de confirmar para ${email}. Enlace de confirmación (envío de email aún no implementado): ${FRONTEND_URL}/newsletter/confirmar?token=${suscriptor.tokenConfirmacion}`
  );

  res.status(201).json({ estado: suscriptor.estado });
}));

const tokenQuerySchema = z.object({ token: z.string().min(1) });

/** Confirma la suscripción (segundo paso del doble opt-in). */
newsletterRouter.get("/confirmar", asyncHandler(async (req, res) => {
  const parsed = tokenQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Falta el token de confirmación" });

  const suscriptor = await prisma.newsletterSuscriptor.findUnique({
    where: { tokenConfirmacion: parsed.data.token },
  });
  if (!suscriptor) return res.status(404).json({ error: "Token de confirmación no válido" });
  if (suscriptor.estado === "baja") {
    return res.status(410).json({ error: "Esta suscripción ya se dio de baja" });
  }
  if (suscriptor.estado === "confirmado") {
    return res.json({ estado: "confirmado" });
  }

  await prisma.newsletterSuscriptor.update({
    where: { id: suscriptor.id },
    data: { estado: "confirmado", confirmadoEn: new Date() },
  });
  res.json({ estado: "confirmado" });
}));

/** Baja de la newsletter (enlace que debe ir en cada envío una vez haya envíos). */
newsletterRouter.post("/baja", asyncHandler(async (req, res) => {
  const parsed = tokenQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Falta el token de baja" });

  const suscriptor = await prisma.newsletterSuscriptor.findUnique({
    where: { tokenBaja: parsed.data.token },
  });
  if (!suscriptor) return res.status(404).json({ error: "Token de baja no válido" });

  if (suscriptor.estado !== "baja") {
    await prisma.newsletterSuscriptor.update({
      where: { id: suscriptor.id },
      data: { estado: "baja", bajaEn: new Date() },
    });
  }
  res.json({ estado: "baja" });
}));
