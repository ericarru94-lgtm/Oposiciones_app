import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authRequerido } from "../middleware/auth";
import { asyncHandler } from "../lib/asyncHandler";
import { pushConfigurado } from "../lib/webPush";

export const pushRouter = Router();

/**
 * Clave pública VAPID que el frontend necesita para suscribirse
 * (PushManager.subscribe). Pública a propósito (por diseño de Web Push, la
 * clave pública no es secreta) y sin autenticación para poder consultarla
 * antes de saber si el usuario va a aceptar el permiso. Si no hay claves
 * configuradas en el servidor, responde 404 para que el frontend sepa que
 * la función no está disponible y no muestre el aviso de activarla.
 */
pushRouter.get(
  "/clave-publica",
  asyncHandler(async (_req, res) => {
    if (!pushConfigurado()) return res.status(404).json({ error: "Notificaciones push no configuradas" });
    res.json({ clavePublica: process.env.VAPID_PUBLIC_KEY });
  })
);

const suscripcionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/** Da de alta (o actualiza, si el endpoint ya existía) la suscripción push del dispositivo actual. */
pushRouter.post(
  "/suscribir",
  authRequerido,
  asyncHandler(async (req, res) => {
    const parsed = suscripcionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { endpoint, keys } = parsed.data;

    await prisma.pushSuscripcion.upsert({
      where: { endpoint },
      create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, usuarioId: req.auth!.usuarioId },
      update: { p256dh: keys.p256dh, auth: keys.auth, usuarioId: req.auth!.usuarioId },
    });
    res.status(201).json({ ok: true });
  })
);

const bajaSchema = z.object({ endpoint: z.string().url() });

/** Da de baja la suscripción push del dispositivo actual (p.ej. al desactivar las notificaciones desde Perfil). */
pushRouter.post(
  "/desuscribir",
  authRequerido,
  asyncHandler(async (req, res) => {
    const parsed = bajaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    await prisma.pushSuscripcion.deleteMany({
      where: { endpoint: parsed.data.endpoint, usuarioId: req.auth!.usuarioId },
    });
    res.json({ ok: true });
  })
);
