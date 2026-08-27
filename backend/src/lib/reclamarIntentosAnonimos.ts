import { Prisma, PrismaClient } from "@prisma/client";
import { calidadDesdeAcierto, siguienteEstadoSM2 } from "./sm2";

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
    const progresoActual = await prisma.progreso.findUnique({
      where: { usuarioId_preguntaId: { usuarioId, preguntaId: intento.preguntaId } },
    });
    const base = progresoActual ?? { repeticiones: 0, factorFacilidad: 2.5, intervaloDias: 0 };
    const calidad = calidadDesdeAcierto(intento.esCorrecta);
    const siguiente = siguienteEstadoSM2(base, calidad);

    await prisma.progreso.upsert({
      where: { usuarioId_preguntaId: { usuarioId, preguntaId: intento.preguntaId } },
      create: {
        usuarioId,
        preguntaId: intento.preguntaId,
        repeticiones: siguiente.repeticiones,
        factorFacilidad: siguiente.factorFacilidad,
        intervaloDias: siguiente.intervaloDias,
        proximaRevision: siguiente.proximaRevision,
        ultimaRevision: intento.createdAt,
        ultimaCalidad: calidad,
        vecesVista: 1,
        vecesCorrecta: intento.esCorrecta ? 1 : 0,
      },
      update: {
        repeticiones: siguiente.repeticiones,
        factorFacilidad: siguiente.factorFacilidad,
        intervaloDias: siguiente.intervaloDias,
        proximaRevision: siguiente.proximaRevision,
        ultimaRevision: intento.createdAt,
        ultimaCalidad: calidad,
        vecesVista: { increment: 1 },
        vecesCorrecta: intento.esCorrecta ? { increment: 1 } : undefined,
      },
    });
  }

  await prisma.intento.updateMany({
    where: { sesionAnonima, usuarioId: null },
    data: { usuarioId, sesionAnonima: null },
  });
}
