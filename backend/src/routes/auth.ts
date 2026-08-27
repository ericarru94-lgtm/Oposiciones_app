import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { firmarToken, authRequerido } from "../middleware/auth";

export const authRouter = Router();

const registroSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  nivelInicial: z.string().optional(),
});

authRouter.post("/registro", async (req, res) => {
  const parsed = registroSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password, nivelInicial } = parsed.data;

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    return res.status(409).json({ error: "Ya existe una cuenta con ese email" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const usuario = await prisma.usuario.create({
    data: { email, passwordHash, nivelInicial },
  });

  const token = firmarToken({ usuarioId: usuario.id });
  res.status(201).json({
    token,
    usuario: { id: usuario.id, email: usuario.email, plan: usuario.plan },
  });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  if (!usuario) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }
  const ok = await bcrypt.compare(password, usuario.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }

  const token = firmarToken({ usuarioId: usuario.id });
  res.json({
    token,
    usuario: { id: usuario.id, email: usuario.email, plan: usuario.plan },
  });
});

authRouter.get("/me", authRequerido, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.auth!.usuarioId },
    select: { id: true, email: true, plan: true, nivelInicial: true, createdAt: true },
  });
  if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
  res.json(usuario);
});

const onboardingSchema = z.object({
  nivelInicial: z.string(),
});

authRouter.patch("/me/onboarding", authRequerido, async (req, res) => {
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const usuario = await prisma.usuario.update({
    where: { id: req.auth!.usuarioId },
    data: { nivelInicial: parsed.data.nivelInicial },
  });
  res.json({ id: usuario.id, nivelInicial: usuario.nivelInicial });
});
