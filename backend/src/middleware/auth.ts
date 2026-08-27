import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET ?? "change-me-in-production";

export interface AuthPayload {
  usuarioId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

function extraerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return null;
}

/** Adjunta req.auth si hay un JWT válido, pero no bloquea la petición si no lo hay. */
export function authOpcional(req: Request, _res: Response, next: NextFunction) {
  const token = extraerToken(req);
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
      req.auth = payload;
    } catch {
      // token inválido o caducado: se trata como usuario anónimo
    }
  }
  next();
}

/** Exige un JWT válido; responde 401 si no lo hay. */
export function authRequerido(req: Request, res: Response, next: NextFunction) {
  const token = extraerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Autenticación requerida" });
  }
  try {
    req.auth = jwt.verify(token, JWT_SECRET) as AuthPayload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o caducado" });
  }
}

export function firmarToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

/**
 * Exige que el usuario autenticado (usar siempre después de authRequerido)
 * tenga `esAdmin = true`. Consulta la BD en cada petición en lugar de
 * confiar en un claim del JWT: es una herramienta de un único admin y de
 * bajo volumen, así que se prioriza poder revocar el acceso al instante
 * (UPDATE en BD) sobre ahorrarse esta consulta.
 */
export async function requiereAdmin(req: Request, res: Response, next: NextFunction) {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.auth!.usuarioId } });
  if (!usuario?.esAdmin) {
    return res.status(403).json({ error: "Requiere permisos de administrador" });
  }
  next();
}
