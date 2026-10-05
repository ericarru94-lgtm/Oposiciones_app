import type { Prisma, PrismaClient } from "@prisma/client";
import { siguienteEstadoSM2 } from "./sm2";

type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * Punto único para registrar un resultado SM-2: carga el Progreso actual
 * (o el estado de partida 0 repeticiones / 2.5 facilidad / 0 días si es la
 * primera vez), calcula el siguiente estado y hace el upsert. Antes este
 * mismo bloque vivía copiado tres veces — routes/preguntas.ts (/responder),
 * routes/progreso.ts (/revisar) y lib/reclamarIntentosAnonimos.ts.
 *
 * `fechaRevision` por defecto es ahora; reclamarIntentosAnonimos.ts la pasa
 * explícita (la fecha real del intento anónimo que está reproduciendo) para
 * no fechar como "repasado justo ahora" algo que en realidad pasó antes.
 */
export async function registrarProgresoSM2(
  cliente: Cliente,
  params: { usuarioId: string; preguntaId: string; calidad: number; fechaRevision?: Date }
) {
  const { usuarioId, preguntaId, calidad, fechaRevision = new Date() } = params;
  const esCorrecta = calidad >= 3;

  const progresoActual = await cliente.progreso.findUnique({
    where: { usuarioId_preguntaId: { usuarioId, preguntaId } },
  });
  const base = progresoActual ?? { repeticiones: 0, factorFacilidad: 2.5, intervaloDias: 0 };
  const siguiente = siguienteEstadoSM2(base, calidad);

  return cliente.progreso.upsert({
    where: { usuarioId_preguntaId: { usuarioId, preguntaId } },
    create: {
      usuarioId,
      preguntaId,
      repeticiones: siguiente.repeticiones,
      factorFacilidad: siguiente.factorFacilidad,
      intervaloDias: siguiente.intervaloDias,
      proximaRevision: siguiente.proximaRevision,
      ultimaRevision: fechaRevision,
      ultimaCalidad: calidad,
      vecesVista: 1,
      vecesCorrecta: esCorrecta ? 1 : 0,
    },
    update: {
      repeticiones: siguiente.repeticiones,
      factorFacilidad: siguiente.factorFacilidad,
      intervaloDias: siguiente.intervaloDias,
      proximaRevision: siguiente.proximaRevision,
      ultimaRevision: fechaRevision,
      ultimaCalidad: calidad,
      vecesVista: { increment: 1 },
      vecesCorrecta: esCorrecta ? { increment: 1 } : undefined,
    },
  });
}
