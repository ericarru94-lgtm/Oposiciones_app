import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authRequerido } from "../middleware/auth";
import { siguienteEstadoSM2 } from "../lib/sm2";
import { haAlcanzadoLimiteDiario } from "../lib/dailyLimit";

export const progresoRouter = Router();
progresoRouter.use(authRequerido);

const hoyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * "Repasar hoy": preguntas cuya próxima revisión SM-2 ya ha vencido,
 * más preguntas nuevas (sin progreso todavía) hasta completar el límite
 * diario restante del plan gratuito.
 */
progresoRouter.get("/hoy", async (req, res) => {
  const parsed = hoyQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { limit } = parsed.data;
  const usuarioId = req.auth!.usuarioId;

  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });

  const { restantes } = await haAlcanzadoLimiteDiario({
    usuarioId,
    esPremium: usuario.plan === "premium",
  });
  const tope = Math.min(limit, restantes);

  const pendientesRevision = await prisma.progreso.findMany({
    where: { usuarioId, proximaRevision: { lte: new Date() } },
    orderBy: { proximaRevision: "asc" },
    take: tope,
    include: { pregunta: true },
  });

  const preguntasNuevas =
    pendientesRevision.length < tope
      ? await prisma.pregunta.findMany({
          where: {
            estado: "verificada",
            progresos: { none: { usuarioId } },
          },
          take: tope - pendientesRevision.length,
        })
      : [];

  res.json({
    limiteDiario: { restantes },
    repaso: pendientesRevision.map((p) => ({
      preguntaId: p.preguntaId,
      enunciado: p.pregunta.enunciado,
      opciones: p.pregunta.opciones,
      tipo: p.pregunta.tipo,
      esNueva: false,
    })),
    nuevas: preguntasNuevas.map((p) => ({
      preguntaId: p.id,
      enunciado: p.enunciado,
      opciones: p.opciones,
      tipo: p.tipo,
      esNueva: true,
    })),
  });
});

const revisarSchema = z.object({
  calidad: z.number().int().min(0).max(5),
});

/**
 * Registra el resultado de un repaso con una calidad SM-2 explícita (0-5),
 * típico de una UI estilo Anki ("otra vez / difícil / bien / fácil").
 */
progresoRouter.post("/:preguntaId/revisar", async (req, res) => {
  const parsed = revisarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { calidad } = parsed.data;
  const usuarioId = req.auth!.usuarioId;
  const { preguntaId } = req.params;

  const pregunta = await prisma.pregunta.findUnique({ where: { id: preguntaId } });
  if (!pregunta) return res.status(404).json({ error: "Pregunta no encontrada" });

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

  const progreso = await prisma.progreso.upsert({
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

  res.json({ progreso });
});

/** Resumen para el panel de progreso: totales, precisión y desglose por tema. */
progresoRouter.get("/resumen", async (req, res) => {
  const usuarioId = req.auth!.usuarioId;

  const [totalIntentos, aciertos, preguntasEnSeguimiento, pendientesHoy] =
    await Promise.all([
      prisma.intento.count({ where: { usuarioId } }),
      prisma.intento.count({ where: { usuarioId, esCorrecta: true } }),
      prisma.progreso.count({ where: { usuarioId } }),
      prisma.progreso.count({
        where: { usuarioId, proximaRevision: { lte: new Date() } },
      }),
    ]);

  res.json({
    totalIntentos,
    aciertos,
    precision: totalIntentos > 0 ? aciertos / totalIntentos : null,
    preguntasEnSeguimiento,
    pendientesHoy,
  });
});
