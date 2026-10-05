import { prisma } from "./prisma";
import { siguienteEstadoSM2 } from "./sm2";
import type { Progreso } from "@prisma/client";

/**
 * Aplica el algoritmo SM-2 al progreso de un usuario en una pregunta y
 * guarda el resultado (upsert). Único punto de escritura de `Progreso` —
 * tanto POST /preguntas/:id/responder (calidad derivada del acierto, ver
 * calidadDesdeAcierto en lib/sm2.ts) como POST /progreso/:preguntaId/revisar
 * (calidad explícita 0-5) pasan por aquí, para que la fórmula SM-2 y la
 * forma de la fila nunca puedan divergir entre los dos flujos.
 */
export async function actualizarProgresoSM2(
  usuarioId: string,
  preguntaId: string,
  calidad: number
): Promise<Progreso> {
  const progresoActual = await prisma.progreso.findUnique({
    where: { usuarioId_preguntaId: { usuarioId, preguntaId } },
  });
  const base = progresoActual ?? {
    repeticiones: 0,
    factorFacilidad: 2.5,
    intervaloDias: 0,
  };
  const siguiente = siguienteEstadoSM2(base, calidad);
  const esCorrecta = calidad >= 3;

  return prisma.progreso.upsert({
    where: { usuarioId_preguntaId: { usuarioId, preguntaId } },
    create: {
      usuarioId,
      preguntaId,
      repeticiones: siguiente.repeticiones,
      factorFacilidad: siguiente.factorFacilidad,
      intervaloDias: siguiente.intervaloDias,
      proximaRevision: siguiente.proximaRevision,
      ultimaRevision: new Date(),
      ultimaCalidad: calidad,
      vecesVista: 1,
      vecesCorrecta: esCorrecta ? 1 : 0,
    },
    update: {
      repeticiones: siguiente.repeticiones,
      factorFacilidad: siguiente.factorFacilidad,
      intervaloDias: siguiente.intervaloDias,
      proximaRevision: siguiente.proximaRevision,
      ultimaRevision: new Date(),
      ultimaCalidad: calidad,
      vecesVista: { increment: 1 },
      vecesCorrecta: esCorrecta ? { increment: 1 } : undefined,
    },
  });
}
