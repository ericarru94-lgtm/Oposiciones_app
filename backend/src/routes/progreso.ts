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

function claveDiaLocal(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Racha de días consecutivos con al menos un intento. Si hoy todavía no
 * hay actividad, la racha se cuenta hasta ayer (no se da por "rota" hasta
 * que el día termine sin actividad), igual que en apps tipo Duolingo.
 */
async function calcularRacha(usuarioId: string): Promise<{ dias: number; ultimaActividad: Date | null }> {
  const intentos = await prisma.intento.findMany({
    where: { usuarioId },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (intentos.length === 0) return { dias: 0, ultimaActividad: null };

  const diasConActividad = new Set(intentos.map((i) => claveDiaLocal(i.createdAt)));
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!diasConActividad.has(claveDiaLocal(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let dias = 0;
  while (diasConActividad.has(claveDiaLocal(cursor))) {
    dias++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { dias, ultimaActividad: intentos[0].createdAt };
}

/** Resumen para el home y el panel de progreso: totales, precisión y racha. */
progresoRouter.get("/resumen", async (req, res) => {
  const usuarioId = req.auth!.usuarioId;

  const [totalIntentos, aciertos, preguntasEnSeguimiento, pendientesHoy, racha] =
    await Promise.all([
      prisma.intento.count({ where: { usuarioId } }),
      prisma.intento.count({ where: { usuarioId, esCorrecta: true } }),
      prisma.progreso.count({ where: { usuarioId } }),
      prisma.progreso.count({
        where: { usuarioId, proximaRevision: { lte: new Date() } },
      }),
      calcularRacha(usuarioId),
    ]);

  res.json({
    totalIntentos,
    aciertos,
    precision: totalIntentos > 0 ? aciertos / totalIntentos : null,
    preguntasEnSeguimiento,
    pendientesHoy,
    racha,
  });
});

/**
 * Progreso por tema (para el grid de la home y los "puntos débiles" del
 * panel de progreso): cuántas preguntas verificadas tiene el tema, cuántas
 * distintas ha contestado el usuario y su precisión en ese tema.
 */
progresoRouter.get("/por-tema", async (req, res) => {
  const usuarioId = req.auth!.usuarioId;

  const temas = await prisma.tema.findMany({ orderBy: [{ bloque: "asc" }, { numero: "asc" }] });

  const porTema = await Promise.all(
    temas.map(async (tema) => {
      const [totalPreguntas, intentosTema] = await Promise.all([
        prisma.pregunta.count({ where: { temaId: tema.id, estado: "verificada" } }),
        prisma.intento.findMany({
          where: { usuarioId, pregunta: { temaId: tema.id } },
          select: { preguntaId: true, esCorrecta: true },
        }),
      ]);

      const totalIntentos = intentosTema.length;
      const aciertos = intentosTema.filter((i) => i.esCorrecta).length;
      const preguntasContestadas = new Set(intentosTema.map((i) => i.preguntaId)).size;

      return {
        temaId: tema.id,
        bloque: tema.bloque,
        numero: tema.numero,
        nombre: tema.nombre,
        totalPreguntas,
        preguntasContestadas,
        totalIntentos,
        aciertos,
        precision: totalIntentos > 0 ? aciertos / totalIntentos : null,
      };
    })
  );

  res.json({ temas: porTema });
});

const evolucionQuerySchema = z.object({
  dias: z.coerce.number().int().min(1).max(90).default(14),
});

/** Serie diaria de intentos/aciertos, para el gráfico de evolución del % de acierto. */
progresoRouter.get("/evolucion", async (req, res) => {
  const parsed = evolucionQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { dias } = parsed.data;
  const usuarioId = req.auth!.usuarioId;

  const desde = new Date();
  desde.setHours(0, 0, 0, 0);
  desde.setDate(desde.getDate() - (dias - 1));

  const intentos = await prisma.intento.findMany({
    where: { usuarioId, createdAt: { gte: desde } },
    select: { createdAt: true, esCorrecta: true },
  });

  const porDia = new Map<string, { intentos: number; aciertos: number }>();
  for (const intento of intentos) {
    const clave = claveDiaLocal(intento.createdAt);
    const actual = porDia.get(clave) ?? { intentos: 0, aciertos: 0 };
    actual.intentos += 1;
    if (intento.esCorrecta) actual.aciertos += 1;
    porDia.set(clave, actual);
  }

  const serie = [];
  const cursor = new Date(desde);
  for (let i = 0; i < dias; i++) {
    const clave = claveDiaLocal(cursor);
    const datos = porDia.get(clave) ?? { intentos: 0, aciertos: 0 };
    serie.push({
      fecha: new Date(cursor).toISOString().slice(0, 10),
      intentos: datos.intentos,
      aciertos: datos.aciertos,
      precision: datos.intentos > 0 ? datos.aciertos / datos.intentos : null,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  res.json({ serie });
});
