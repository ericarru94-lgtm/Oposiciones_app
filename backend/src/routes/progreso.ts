import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authRequerido } from "../middleware/auth";
import { asyncHandler } from "../lib/asyncHandler";
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
progresoRouter.get("/hoy", asyncHandler(async (req, res) => {
  const parsed = hoyQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { limit } = parsed.data;
  const usuarioId = req.auth!.usuarioId;

  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });

  const { alcanzado, restantes } = await haAlcanzadoLimiteDiario({
    usuarioId,
    esPremium: usuario.plan === "premium",
  });
  // Antes, con el límite ya agotado, esto devolvía 200 con repaso/nuevas
  // vacíos: indistinguible en el frontend de "no hay contenido todavía"
  // (mismo componente, mismo mensaje genérico). Devolver 429 aquí, igual
  // que /responder, deja que CargadorTest lo trate como límite alcanzado
  // y lleve a /upgrade en vez de ese mensaje confuso.
  if (alcanzado) {
    return res.status(429).json({
      error: "Has alcanzado el límite diario de preguntas del plan gratuito",
      restantes: 0,
    });
  }
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
      tablaDatos: p.pregunta.tablaDatos,
      esNueva: false,
    })),
    nuevas: preguntasNuevas.map((p) => ({
      preguntaId: p.id,
      enunciado: p.enunciado,
      opciones: p.opciones,
      tipo: p.tipo,
      tablaDatos: p.tablaDatos,
      esNueva: true,
    })),
  });
}));

const revisarSchema = z.object({
  calidad: z.number().int().min(0).max(5),
});

/**
 * Registra el resultado de un repaso con una calidad SM-2 explícita (0-5),
 * típico de una UI estilo Anki ("otra vez / difícil / bien / fácil").
 */
progresoRouter.post("/:preguntaId/revisar", asyncHandler(async (req, res) => {
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
}));

function claveDiaLocal(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Racha de días consecutivos con al menos un intento, a partir del conjunto
 * de días (clave `claveDiaLocal`) con actividad. Si hoy todavía no hay
 * actividad, la racha se cuenta hasta ayer (no se da por "rota" hasta que
 * el día termine sin actividad), igual que en apps tipo Duolingo. Función
 * pura para poder reutilizarla tanto para un usuario (calcularRacha) como
 * para todos a la vez (ver /comunidad, que evita N+1 consultas).
 */
function calcularRachaDesdeDias(diasConActividad: Set<string>): number {
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
  return dias;
}

async function calcularRacha(usuarioId: string): Promise<{ dias: number; ultimaActividad: Date | null }> {
  const intentos = await prisma.intento.findMany({
    where: { usuarioId },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (intentos.length === 0) return { dias: 0, ultimaActividad: null };

  const diasConActividad = new Set(intentos.map((i) => claveDiaLocal(i.createdAt)));
  return { dias: calcularRachaDesdeDias(diasConActividad), ultimaActividad: intentos[0].createdAt };
}

/** Resumen para el home y el panel de progreso: totales, precisión y racha. */
progresoRouter.get("/resumen", asyncHandler(async (req, res) => {
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
}));

/**
 * Con menos usuarios que esto en la muestra, la "media" se acercaría
 * demasiado a los datos de una sola persona (o los revelaría del todo con
 * 1). Por debajo del umbral, /comunidad responde `disponible: false` y no
 * manda ninguna media — ver también el aviso en el frontend.
 */
const MUESTRA_MINIMA_COMUNIDAD = 5;

/**
 * Comparativa anónima con el resto de usuarios: la racha propia y el % de
 * acierto propio frente a la media de "los demás" (nunca incluye al
 * propio usuario en su propia media, ni expone dato alguno por usuario,
 * solo el agregado). Puramente motivador — no es un ranking ni identifica
 * a nadie.
 */
progresoRouter.get("/comunidad", asyncHandler(async (req, res) => {
  const usuarioId = req.auth!.usuarioId;

  const [propioTotal, propioAciertos, propiaRacha, intentosAjenos] = await Promise.all([
    prisma.intento.count({ where: { usuarioId } }),
    prisma.intento.count({ where: { usuarioId, esCorrecta: true } }),
    calcularRacha(usuarioId),
    prisma.intento.findMany({
      where: { usuarioId: { not: usuarioId } },
      select: { usuarioId: true, createdAt: true, esCorrecta: true },
    }),
  ]);

  const porUsuario = new Map<string, { total: number; aciertos: number; dias: Set<string> }>();
  for (const intento of intentosAjenos) {
    if (!intento.usuarioId) continue; // intentos anónimos (sesionAnonima, sin cuenta): fuera de la comparativa
    const entrada = porUsuario.get(intento.usuarioId) ?? { total: 0, aciertos: 0, dias: new Set<string>() };
    entrada.total++;
    if (intento.esCorrecta) entrada.aciertos++;
    entrada.dias.add(claveDiaLocal(intento.createdAt));
    porUsuario.set(intento.usuarioId, entrada);
  }

  const otrosUsuarios = [...porUsuario.values()];
  const disponible = otrosUsuarios.length >= MUESTRA_MINIMA_COMUNIDAD;

  let media: { racha: number; precision: number | null } | null = null;
  if (disponible) {
    const rachas = otrosUsuarios.map((u) => calcularRachaDesdeDias(u.dias));
    const conIntentos = otrosUsuarios.filter((u) => u.total > 0);
    media = {
      racha: rachas.reduce((a, b) => a + b, 0) / rachas.length,
      precision:
        conIntentos.length > 0
          ? conIntentos.reduce((suma, u) => suma + u.aciertos / u.total, 0) / conIntentos.length
          : null,
    };
  }

  res.json({
    disponible,
    usuariosComparados: otrosUsuarios.length,
    propia: {
      racha: propiaRacha.dias,
      precision: propioTotal > 0 ? propioAciertos / propioTotal : null,
    },
    media,
  });
}));

/**
 * Progreso por tema (para el grid de la home y los "puntos débiles" del
 * panel de progreso): cuántas preguntas verificadas tiene el tema, cuántas
 * distintas ha contestado el usuario y su precisión en ese tema.
 */
progresoRouter.get("/por-tema", asyncHandler(async (req, res) => {
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
}));

const evolucionQuerySchema = z.object({
  dias: z.coerce.number().int().min(1).max(90).default(14),
});

/** Serie diaria de intentos/aciertos, para el gráfico de evolución del % de acierto. */
progresoRouter.get("/evolucion", asyncHandler(async (req, res) => {
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
}));
