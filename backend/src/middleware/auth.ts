import { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { prisma } from "../lib/prisma";
import { obtenerOCrearUsuarioDesdeClerk } from "../lib/clerkSync";
import { asyncHandler } from "../lib/asyncHandler";

export interface AuthPayload {
  usuarioId: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

/**
 * Vía de entrada solo para el entorno E2E (Playwright): verificar una sesión
 * real de Clerk requiere red hacia clerk.com, bloqueada en el sandbox de
 * desarrollo de este proyecto, así que Playwright no puede iniciar sesión de
 * verdad. Si `AUTH_TEST_BYPASS_SECRET` está definido (SOLO en
 * backend/.env.e2e — nunca en .env de producción) y el header trae
 * `Bearer e2e-bypass:<secreto>:<usuarioId>` con el secreto correcto, se
 * confía en ese usuarioId sin pasar por Clerk. Ver backend/docs/clerk.md.
 */
function extraerUsuarioIdDeBypassE2E(req: Request): string | null {
  const secreto = process.env.AUTH_TEST_BYPASS_SECRET;
  if (!secreto) return null;
  const header = req.headers.authorization;
  const prefijo = `Bearer e2e-bypass:${secreto}:`;
  if (!header?.startsWith(prefijo)) return null;
  return header.slice(prefijo.length) || null;
}

function obtenerClerkUserId(req: Request): string | null {
  try {
    return getAuth(req as Parameters<typeof getAuth>[0]).userId ?? null;
  } catch {
    // `clerkMiddleware()` no está montado (p.ej. CLERK_SECRET_KEY ausente en
    // este entorno) — tratar la petición como anónima en vez de romper.
    return null;
  }
}

async function resolverUsuarioId(req: Request): Promise<string | null> {
  const bypassId = extraerUsuarioIdDeBypassE2E(req);
  if (bypassId) return bypassId;

  const clerkUserId = obtenerClerkUserId(req);
  if (!clerkUserId) return null;

  const usuario = await obtenerOCrearUsuarioDesdeClerk(clerkUserId);
  return usuario.id;
}

export const authOpcional = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const usuarioId = await resolverUsuarioId(req);
  if (usuarioId) req.auth = { usuarioId };
  next();
});

export const authRequerido = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const usuarioId = await resolverUsuarioId(req);
  if (!usuarioId) return res.status(401).json({ error: "Autenticación requerida" });
  req.auth = { usuarioId };
  next();
});

export async function requiereAdmin(req: Request, res: Response, next: NextFunction) {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.auth!.usuarioId } });
  if (!usuario?.esAdmin) {
    return res.status(403).json({ error: "Requiere permisos de administrador" });
  }
  next();
}
