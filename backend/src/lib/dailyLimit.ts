import { prisma } from "./prisma";

export const FREE_PLAN_DAILY_LIMIT = Number(
  process.env.FREE_PLAN_DAILY_LIMIT ?? 30
);

function inicioDeHoy(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Cuenta cuántas preguntas ha respondido hoy un usuario (o sesión anónima). */
export async function contarIntentosHoy(params: {
  usuarioId?: string;
  sesionAnonima?: string;
}): Promise<number> {
  const { usuarioId, sesionAnonima } = params;
  if (!usuarioId && !sesionAnonima) return 0;

  return prisma.intento.count({
    where: {
      createdAt: { gte: inicioDeHoy() },
      ...(usuarioId ? { usuarioId } : { sesionAnonima }),
    },
  });
}

/**
 * Determina si el usuario (o visitante anónimo) ha alcanzado el límite
 * diario del plan gratuito. Los usuarios premium no tienen límite.
 */
export async function haAlcanzadoLimiteDiario(params: {
  usuarioId?: string;
  sesionAnonima?: string;
  esPremium: boolean;
}): Promise<{ alcanzado: boolean; restantes: number; usadas: number }> {
  if (params.esPremium) {
    return { alcanzado: false, restantes: Infinity, usadas: 0 };
  }
  const usadas = await contarIntentosHoy(params);
  const restantes = Math.max(0, FREE_PLAN_DAILY_LIMIT - usadas);
  return { alcanzado: usadas >= FREE_PLAN_DAILY_LIMIT, restantes, usadas };
}
