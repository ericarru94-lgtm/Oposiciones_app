import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authRequerido } from "../middleware/auth";
import { asyncHandler } from "../lib/asyncHandler";
import { reclamarIntentosAnonimos } from "../lib/reclamarIntentosAnonimos";
import { esEmailAdmin } from "../lib/adminEmails";

export const authRouter = Router();

/**
 * El registro/login lo gestiona Clerk directamente desde el frontend
 * (`<SignIn/>`/`<SignUp/>`); esta fila de Usuario se crea sola en el primer
 * login vía `obtenerOCrearUsuarioDesdeClerk` (ver middleware/auth.ts), no
 * hay endpoint de alta aquí.
 */
authRouter.get("/me", authRequerido, asyncHandler(async (req, res) => {
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.auth!.usuarioId },
    select: { id: true, email: true, plan: true, nivelInicial: true, esAdmin: true, createdAt: true },
  });
  if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
  res.json(usuario);
}));

const onboardingSchema = z.object({
  nivelInicial: z.string(),
});

authRouter.patch("/me/onboarding", authRequerido, asyncHandler(async (req, res) => {
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const usuario = await prisma.usuario.update({
    where: { id: req.auth!.usuarioId },
    data: { nivelInicial: parsed.data.nivelInicial },
  });
  res.json({ id: usuario.id, nivelInicial: usuario.nivelInicial });
}));

const registroBypassSchema = z.object({
  email: z.string().email(),
  secreto: z.string(),
});

/**
 * Solo existe cuando AUTH_TEST_BYPASS_SECRET está definido (exclusivo de
 * backend/.env.e2e): permite al frontend E2E "iniciar sesión" sin pasar por
 * Clerk cuando no hay VITE_CLERK_PUBLISHABLE_KEY configurada (ver
 * frontend/src/context/SessionContext.tsx y backend/docs/clerk.md). Idempotente
 * (upsert por email), así sirve tanto para alta como para login.
 */
authRouter.post("/registro-bypass", asyncHandler(async (req, res) => {
  const secretoEsperado = process.env.AUTH_TEST_BYPASS_SECRET;
  if (!secretoEsperado) return res.status(404).end();

  const parsed = registroBypassSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.secreto !== secretoEsperado) return res.status(403).json({ error: "Secreto inválido" });

  const existente = await prisma.usuario.findUnique({ where: { email: parsed.data.email } });
  const usuario =
    existente ??
    (await prisma.usuario.create({
      data: { email: parsed.data.email, esAdmin: esEmailAdmin(parsed.data.email) },
    }));
  if (existente && !existente.esAdmin && esEmailAdmin(existente.email)) {
    await prisma.usuario.update({ where: { id: existente.id }, data: { esAdmin: true } });
  }
  res.status(201).json({ usuarioId: usuario.id });
}));

const reclamarSchema = z.object({
  sesionAnonima: z.string(),
});

/**
 * El onboarding (mini-test + primer test) se responde como visitante
 * anónimo, antes de que exista una cuenta. El frontend llama a esto justo
 * después de que Clerk confirme el alta/login, con el id de sesión anónima
 * guardado en localStorage, para adoptar esos intentos como progreso del
 * usuario. Es idempotente (reclamarIntentosAnonimos no encuentra nada la
 * segunda vez que se llama con la misma sesionAnonima), así que no pasa
 * nada si el frontend la llama más de una vez.
 */
authRouter.post("/reclamar-sesion-anonima", authRequerido, asyncHandler(async (req, res) => {
  const parsed = reclamarSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  await prisma.$transaction((tx) => reclamarIntentosAnonimos(tx, req.auth!.usuarioId, parsed.data.sesionAnonima));
  res.status(204).end();
}));
