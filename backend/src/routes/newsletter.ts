import { randomBytes } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { obtenerResend, RESEND_FROM_EMAIL } from "../lib/resend";
import { plantillaBienvenida, plantillaConfirmacion } from "../lib/emailTemplates";

export const newsletterRouter = Router();

/** Misma variable que ya usan las URLs de Stripe (routes/stripe.ts) para volver al frontend. */
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

function generarToken(): string {
  return randomBytes(24).toString("hex");
}

function urlConfirmar(token: string): string {
  return `${FRONTEND_URL}/newsletter/confirmar?token=${token}`;
}

function urlBaja(token: string): string {
  return `${FRONTEND_URL}/newsletter/baja?token=${token}`;
}

/**
 * Envía un email de la newsletter sin dejar que un fallo (RESEND_API_KEY
 * ausente en dev/test, o un error real de Resend) tumbe la petición: la
 * captura del consentimiento en base de datos ya ha ocurrido antes de
 * llamar a esto y es lo que RGPD exige poder demostrar, así que un email
 * no entregado no debe deshacer ni ocultar esa alta. Solo queda registrado
 * en el log del servidor para poder investigarlo.
 */
async function enviarEmail(params: { to: string; subject: string; html: string; text: string }) {
  try {
    const { error } = await obtenerResend().emails.send({
      from: RESEND_FROM_EMAIL,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
    if (error) console.error(`[newsletter] Resend rechazó el envío a ${params.to}:`, error);
  } catch (err) {
    console.error(`[newsletter] No se pudo enviar el email a ${params.to}:`, err);
  }
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
 * en el log del servidor (ver enviarEmail más arriba).
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

  const { subject, html, text } = plantillaConfirmacion({
    confirmarUrl: urlConfirmar(suscriptor.tokenConfirmacion),
    bajaUrl: urlBaja(suscriptor.tokenBaja),
  });
  await enviarEmail({ to: email, subject, html, text });

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
  await enviarEmail({ to: suscriptor.email, subject, html, text });

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
