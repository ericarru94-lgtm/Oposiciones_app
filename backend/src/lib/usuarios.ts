import { prisma } from "./prisma";

/**
 * true si el usuario existe y tiene el plan premium activo. Centraliza la
 * comprobación `usuario?.plan === "premium"` que se repetía detrás de un
 * `findUnique` propio en cada endpoint que solo necesita saber si aplican
 * los límites del plan gratuito (p.ej. /preguntas/aleatorias,
 * /preguntas/simulacro) — así la condición de "qué cuenta como premium"
 * vive en un solo sitio.
 *
 * No la uses donde además haga falta distinguir "usuario inexistente" de
 * "usuario no premium" con respuestas distintas (p.ej. /preguntas/examen-oficial
 * responde 401 si el usuario no existe y 403 si no es premium): ahí el
 * `findUnique` propio sigue siendo necesario.
 */
export async function esUsuarioPremium(usuarioId: string): Promise<boolean> {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { plan: true } });
  return usuario?.plan === "premium";
}
