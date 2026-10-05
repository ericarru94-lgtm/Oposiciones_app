import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authRequerido } from "../middleware/auth";
import { asyncHandler } from "../lib/asyncHandler";
import { actualizarProgresoSM2 } from "../lib/progreso";
import { haAlcanzadoLimiteSesionesDiario, registrarInicioSesionTest } from "../lib/dailyLimit";
import {
  claveDiaMadrid,
  inicioDelDiaMadridDesdeClave,
  ultimasClavesDiaMadrid,
} from "../lib/fechaLocal";

export const progresoRouter = Router();
progresoRouter.use(authRequerido);

const hoyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * "Repasar hoy": preguntas cuya próxima revisión SM-2 ya ha vencido, más
 * preguntas nuevas (sin progreso todavía) hasta `limit`. Cada llamada
 * empieza un test y cuenta contra el límite diario de tests del plan
 * gratuito (ver lib/dailyLimit.ts) — una vez empezado, se responde con
 * normalidad, sin límite por número de preguntas.
 */
progresoRouter.get("/hoy", asyncHandler(async (req, res) => {
  const parsed = hoyQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { limit } = parsed.data;
  const usuarioId = req.auth!.usuarioId;

  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });

  const { alcanzado } = await haAlcanzadoLimiteSesionesDiario({
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
      error: "Has alcanzado el límite diario de tests del plan gratuito",
      restantes: 0,
    });
  }
  await registrarInicioSesionTest(usuarioId);

  const pendientesRevision = await prisma.progreso.findMany({
    where: { usuarioId, proximaRevision: { lte: new Date() } },
    orderBy: { proximaRevision: "asc" },
    take: limit,
    include: { pregunta: true },
  });

  const preguntasNuevas =
    pendientesRevision.length < limit
      ? await prisma.pregunta.findMany({
          where: {
            estado: "verificada",
            progresos: { none: { usuarioId } },
          },
          take: limit - pendientesRevision.length,
        })
      : [];

  res.json({
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

  const progreso = await actualizarProgresoSM2(usuarioId, preguntaId, calidad);

  res.json({ progreso });
}));

/**
 * Racha de días consecutivos con al menos un intento, a partir del conjunto
 * de días (clave `claveDiaMadrid`, ver lib/fechaLocal.ts) con actividad. Si
 * hoy todavía no hay actividad, la racha se cuenta hasta ayer (no se da por
 * "rota" hasta que el día termine sin actividad), igual que en apps tipo
 * Duolingo. Función pura para poder reutilizarla tanto para un usuario
 * (calcularRacha) como para todos a la vez (ver /comunidad, que evita N+1
 * consultas).
 *
 * El cursor retrocede en saltos de 24h exactas desde el mediodía UTC de
 * "hoy en Madrid" (no desde la medianoche local del proceso): así cada
 * paso cae siempre lejos de cualquier frontera de día tanto en UTC como en
 * Madrid, y el cambio de horario (CET/CEST) no puede hacer que se salte o
 * repita un día.
 */
function calcularRachaDesdeDias(diasConActividad: Set<string>): number {
  const UN_DIA_MS = 24 * 60 * 60 * 1000;
  const [anio, mes, dia] = claveDiaMadrid(new Date()).split("-").map(Number);
  let cursorUTC = Date.UTC(anio, mes - 1, dia, 12, 0, 0);

  if (!diasConActividad.has(claveDiaMadrid(new Date(cursorUTC)))) {
    cursorUTC -= UN_DIA_MS;
  }

  let dias = 0;
  while (diasConActividad.has(claveDiaMadrid(new Date(cursorUTC)))) {
    dias++;
    cursorUTC -= UN_DIA_MS;
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

  const diasConActividad = new Set(intentos.map((i) => claveDiaMadrid(i.createdAt)));
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
    entrada.dias.add(claveDiaMadrid(intento.createdAt));
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
 *
 * Antes hacía 2 consultas POR TEMA (un `count` y un `findMany`) dentro de un
 * `Promise.all` sobre `temas.map` — con N temas, eso es 1 + 2N round-trips a
 * la base de datos en cada carga de Inicio o Progreso, un N+1 clásico que
 * empeora según crece el temario. Ahora son 3 consultas en total, sin
 * importar cuántos temas haya: una lista de temas, un recuento agregado de
 * preguntas por tema (`groupBy`) y los intentos propios del usuario (ya
 * acotados a sus propias filas por el índice `[usuarioId, createdAt]`),
 * agrupados en memoria en JS — igual de barato que antes para el propio
 * usuario, pero ya no multiplicado por el número de temas.
 */
progresoRouter.get("/por-tema", asyncHandler(async (req, res) => {
  const usuarioId = req.auth!.usuarioId;

  const [temas, totalesPorTema, intentosPropios] = await Promise.all([
    prisma.tema.findMany({ orderBy: [{ bloque: "asc" }, { numero: "asc" }] }),
    prisma.pregunta.groupBy({
      by: ["temaId"],
      where: { estado: "verificada" },
      _count: { _all: true },
    }),
    prisma.intento.findMany({
      where: { usuarioId, pregunta: { temaId: { not: null } } },
      select: { preguntaId: true, esCorrecta: true, pregunta: { select: { temaId: true } } },
    }),
  ]);

  const totalPreguntasPorTema = new Map(totalesPorTema.map((t) => [t.temaId, t._count._all]));

  const intentosPorTema = new Map<number, { total: number; aciertos: number; preguntas: Set<string> }>();
  for (const intento of intentosPropios) {
    const temaId = intento.pregunta.temaId;
    if (temaId === null) continue;
    const acumulado = intentosPorTema.get(temaId) ?? { total: 0, aciertos: 0, preguntas: new Set<string>() };
    acumulado.total++;
    if (intento.esCorrecta) acumulado.aciertos++;
    acumulado.preguntas.add(intento.preguntaId);
    intentosPorTema.set(temaId, acumulado);
  }

  const porTema = temas.map((tema) => {
    const acumulado = intentosPorTema.get(tema.id);
    const totalIntentos = acumulado?.total ?? 0;
    const aciertos = acumulado?.aciertos ?? 0;

    return {
      temaId: tema.id,
      bloque: tema.bloque,
      numero: tema.numero,
      nombre: tema.nombre,
      totalPreguntas: totalPreguntasPorTema.get(tema.id) ?? 0,
      preguntasContestadas: acumulado?.preguntas.size ?? 0,
      totalIntentos,
      aciertos,
      precision: totalIntentos > 0 ? aciertos / totalIntentos : null,
    };
  });

  res.json({ temas: porTema });
}));

const evolucionQuerySchema = z.object({
  dias: z.coerce.number().int().min(1).max(90).default(14),
});

/**
 * Serie diaria de intentos/aciertos, para el gráfico de evolución del %
 * de acierto. Los días de la serie son días civiles en Madrid (ver
 * lib/fechaLocal.ts) — antes se calculaban sumando/restando días con
 * `Date.setDate`/`setHours` en la hora local del proceso (UTC en
 * producción), lo que podía desplazar en qué día caía cada intento.
 */
progresoRouter.get("/evolucion", asyncHandler(async (req, res) => {
  const parsed = evolucionQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { dias } = parsed.data;
  const usuarioId = req.auth!.usuarioId;

  const claves = ultimasClavesDiaMadrid(dias); // más antiguo -> más reciente
  const desde = inicioDelDiaMadridDesdeClave(claves[0]);

  const intentos = await prisma.intento.findMany({
    where: { usuarioId, createdAt: { gte: desde } },
    select: { createdAt: true, esCorrecta: true },
  });

  const porDia = new Map<string, { intentos: number; aciertos: number }>();
  for (const intento of intentos) {
    const clave = claveDiaMadrid(intento.createdAt);
    const actual = porDia.get(clave) ?? { intentos: 0, aciertos: 0 };
    actual.intentos += 1;
    if (intento.esCorrecta) actual.aciertos += 1;
    porDia.set(clave, actual);
  }

  const serie = claves.map((clave) => {
    const datos = porDia.get(clave) ?? { intentos: 0, aciertos: 0 };
    return {
      fecha: clave,
      intentos: datos.intentos,
      aciertos: datos.aciertos,
      precision: datos.intentos > 0 ? datos.aciertos / datos.intentos : null,
    };
  });

  res.json({ serie });
}));
