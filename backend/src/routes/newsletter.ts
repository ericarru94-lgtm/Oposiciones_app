import { randomBytes } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { enviarEmailResiliente } from "../lib/enviarEmailResiliente";
import { plantillaBienvenida, plantillaConfirmacion } from "../lib/emailTemplates";
import { limitarNewsletter } from "../middleware/rateLimit";
import { FRONTEND_URL } from "../lib/frontendUrl";

export const newsletterRouter = Router();

function generarToken(): string {
  return randomBytes(24).toString("hex");
}

function urlConfirmar(token: string): string {
  return `${FRONTEND_URL}/newsletter/confirmar?token=${token}`;
}

function urlBaja(token: string): string {
  return `${FRONTEND_URL}/newsletter/baja?token=${token}`;
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
 * Registra el consentimiento (con fecha), deja la fila en "pendiente" con
 * un token de confirmación, y envía el email de confirmación vía Resend
 * (ver lib/resend.ts) — si RESEND_API_KEY no está configurada (dev/test)
 * o Resend falla, el alta se guarda igual y el envío solo queda registrado
 * en el log del servidor (ver lib/enviarEmailResiliente.ts).
 */
newsletterRouter.post("/suscribir", limitarNewsletter, asyncHandler(async (req, res) => {
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

  // Fire-and-forget (ver enviarEmailResiliente): el consentimiento ya ha
  // quedado guardado en BD justo arriba, que es lo que RGPD exige poder
  // demostrar, así que un email no entregado no debe deshacer ni ocultar
  // esa alta — solo queda registrado en el log del servidor.
  const { subject, html, text } = plantillaConfirmacion({
    confirmarUrl: urlConfirmar(suscriptor.tokenConfirmacion),
    bajaUrl: urlBaja(suscriptor.tokenBaja),
  });
  await enviarEmailResiliente("newsletter", { to: email, subject, html, text });

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

  const { subject, html, text } = plantillaBienvenida({
    frontendUrl: FRONTEND_URL,
    bajaUrl: urlBaja(suscriptor.tokenBaja),
  });
  await enviarEmailResiliente("newsletter", { to: suscriptor.email, subject, html, text });

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
