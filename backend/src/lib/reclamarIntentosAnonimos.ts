import { Prisma, PrismaClient } from "@prisma/client";
import { calidadDesdeAcierto } from "./sm2";
import { registrarProgresoSM2 } from "./progresoSM2";

type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * Al registrarse o iniciar sesión justo después del onboarding (mini-test +
 * primer test respondidos como visitante anónimo), reasigna esos intentos al
 * usuario y reconstruye su Progreso (SM-2) reproduciéndolos en orden
 * cronológico, para que Home refleje de inmediato lo que acaba de practicar
 * en vez de mostrar todo en 0.
 */
export async function reclamarIntentosAnonimos(
  prisma: Cliente,
  usuarioId: string,
  sesionAnonima: string
): Promise<void> {
  const intentos = await prisma.intento.findMany({
    where: { sesionAnonima, usuarioId: null },
    orderBy: { createdAt: "asc" },
  });
  if (intentos.length === 0) return;

  for (const intento of intentos) {
    await registrarProgresoSM2(prisma, {
      usuarioId,
      preguntaId: intento.preguntaId,
      calidad: calidadDesdeAcierto(intento.esCorrecta),
      fechaRevision: intento.createdAt,
    });
  }

  await prisma.intento.updateMany({
    where: { sesionAnonima, usuarioId: null },
    data: { usuarioId, sesionAnonima: null },
  });
}
