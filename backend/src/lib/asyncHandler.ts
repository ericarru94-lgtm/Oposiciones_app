import { NextFunction, Request, Response } from "express";

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Express 4 no espera la promesa devuelta por un handler async: si esa
 * promesa rechaza, el error nunca llega al middleware de errores de
 * app.ts, se convierte en un "unhandledRejection" a nivel de proceso y
 * Node 15+ mata el servidor entero por ello (se vio en producción: un
 * error de Prisma en /responder tumbaba el backend para todos los
 * usuarios, no solo para la petición que fallaba). Este wrapper captura
 * el rechazo y lo pasa a `next(err)`, que sí llega al error handler.
 */
export function asyncHandler(fn: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
