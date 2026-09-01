import { prisma } from "./prisma";

/**
 * Límite del plan gratuito: número de *tests empezados* al día (Practicar
 * tema o Repasar hoy), sin importar el bloque ni cuántas preguntas tenga
 * cada test — una vez empezado, se puede terminar con normalidad. El
 * simulacro libre y el examen oficial no pasan por aquí, no cuentan contra
 * este límite (ver SesionTest en el schema de Prisma).
 */
export const FREE_PLAN_DAILY_TEST_SESSIONS = Number(
  process.env.FREE_PLAN_DAILY_TEST_SESSIONS ?? 2
);

function inicioDeHoy(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Cuenta cuántos tests ha empezado hoy un usuario. */
export async function contarSesionesTestHoy(usuarioId: string): Promise<number> {
  return prisma.sesionTest.count({
    where: { usuarioId, createdAt: { gte: inicioDeHoy() } },
  });
}

/**
 * Determina si el usuario ha alcanzado el límite diario de tests empezados
 * del plan gratuito. Los usuarios premium no tienen límite.
 */
export async function haAlcanzadoLimiteSesionesDiario(params: {
  usuarioId: string;
  esPremium: boolean;
}): Promise<{ alcanzado: boolean; restantes: number; usadas: number }> {
  if (params.esPremium) {
    return { alcanzado: false, restantes: Infinity, usadas: 0 };
  }
  const usadas = await contarSesionesTestHoy(params.usuarioId);
  const restantes = Math.max(0, FREE_PLAN_DAILY_TEST_SESSIONS - usadas);
  return { alcanzado: usadas >= FREE_PLAN_DAILY_TEST_SESSIONS, restantes, usadas };
}

/** Registra el inicio de un test (Practicar tema o Repasar hoy) contra el límite diario. */
export async function registrarInicioSesionTest(usuarioId: string): Promise<void> {
  await prisma.sesionTest.create({ data: { usuarioId } });
}
