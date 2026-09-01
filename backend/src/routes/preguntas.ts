import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authOpcional, authRequerido } from "../middleware/auth";
import { asyncHandler } from "../lib/asyncHandler";
import { haAlcanzadoLimiteSesionesDiario, registrarInicioSesionTest } from "../lib/dailyLimit";
import { seleccionarProporcionalAlTemario } from "../lib/seleccionProporcional";
import { ESTRUCTURA_EXAMEN_OFICIAL, seleccionarExamenOficial } from "../lib/examenOficial";
import { siguienteEstadoSM2, calidadDesdeAcierto } from "../lib/sm2";
import { Opcion, EstadoPregunta, TipoPregunta, Bloque } from "@prisma/client";

export const preguntasRouter = Router();

function barajar<T>(arr: T[]): T[] {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** Pregunta sin la respuesta correcta, para no filtrarla al cliente antes de responder. */
function ocultarRespuesta(p: {
  id: string;
  enunciado: string;
  opciones: unknown;
  tipo: string;
  temaId: number | null;
  tablaDatos?: unknown;
}) {
  return {
    id: p.id,
    enunciado: p.enunciado,
    opciones: p.opciones,
    tipo: p.tipo,
    temaId: p.temaId,
    tablaDatos: p.tablaDatos ?? null,
  };
}

/**
 * "anulada" queda deliberadamente fuera de los valores aceptables: una
 * pregunta anulada es inválida y no debe poder solicitarse ni siquiera
 * como override interno de QA (a diferencia de "borrador", que sí es
 * consultable explícitamente para revisar contenido pendiente de validar).
 */
const aleatoriasQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  tipo: z.nativeEnum(TipoPregunta).optional(),
  bloque: z.nativeEnum(Bloque).optional(),
  /** Filtra a un tema concreto (p.ej. el test de arranque del onboarding sobre Constitución). */
  temaId: z.coerce.number().int().positive().optional(),
  estado: z.enum(["borrador", "verificada"]).default(EstadoPregunta.verificada),
});

/**
 * Mini-test sin registro (sin `temaId`): devuelve preguntas al azar sin la
 * respuesta correcta, sin autenticación ni límite. Con `temaId` (Practicar
 * tema) y un usuario autenticado, cada llamada empieza un test y cuenta
 * contra el límite diario de tests del plan gratuito (ver lib/dailyLimit.ts).
 */
preguntasRouter.get("/aleatorias", authOpcional, asyncHandler(async (req, res) => {
  const parsed = aleatoriasQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { limit, tipo, bloque, temaId, estado } = parsed.data;
  const usuarioId = req.auth?.usuarioId;

  if (temaId && usuarioId) {
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    const limite = await haAlcanzadoLimiteSesionesDiario({
      usuarioId,
      esPremium: usuario?.plan === "premium",
    });
    if (limite.alcanzado) {
      return res.status(429).json({
        error: "Has alcanzado el límite diario de tests del plan gratuito",
        restantes: 0,
      });
    }
    await registrarInicioSesionTest(usuarioId);
  }

  const preguntas = await prisma.pregunta.findMany({
    where: {
      estado,
      ...(tipo ? { tipo } : {}),
      ...(temaId ? { temaId } : bloque ? { tema: { bloque } } : {}),
    },
    select: { id: true, enunciado: true, opciones: true, tipo: true, temaId: true, tablaDatos: true },
  });

  const seleccion = barajar(preguntas).slice(0, limit);
  res.json({ preguntas: seleccion.map(ocultarRespuesta) });
}));

const simulacroQuerySchema = z.object({
  numPreguntas: z.coerce.number().int().min(5).max(100).default(25),
});

/**
 * Simulacro de examen: selecciona preguntas de todo el temario a la vez,
 * repartidas proporcionalmente al peso de cada tema (ver
 * lib/seleccionProporcional.ts), en vez de limitarse a un bloque o tema
 * concreto como /aleatorias.
 */
preguntasRouter.get("/simulacro", asyncHandler(async (req, res) => {
  const parsed = simulacroQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { numPreguntas } = parsed.data;

  const disponibles = await prisma.pregunta.findMany({
    where: { estado: EstadoPregunta.verificada },
    select: { id: true, enunciado: true, opciones: true, tipo: true, temaId: true, tablaDatos: true },
  });

  const seleccion = seleccionarProporcionalAlTemario(disponibles, numPreguntas);
  res.json({ preguntas: seleccion.map(ocultarRespuesta) });
}));

/**
 * Simulacro "Examen oficial": estructura fija del primer ejercicio real de
 * la oposición (ver lib/examenOficial.ts), no proporcional ni configurable
 * por el usuario. Devuelve las dos fases por separado para que el
 * frontend las ejecute como dos simulacros consecutivos (mismo motor,
 * SimulacroRunner) con sus propios tiempos.
 *
 * Exclusivo del plan premium: a diferencia del simulacro libre, aquí se
 * exige autenticación y se rechaza con 403 a quien no sea premium, para que
 * el bloqueo no dependa solo de ocultar el botón en el frontend.
 */
preguntasRouter.get("/examen-oficial", authRequerido, asyncHandler(async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.auth!.usuarioId } });
  if (!usuario) return res.status(401).json({ error: "Usuario no válido" });

  // TODO(temporal, quitar tras diagnosticar el bug de acceso gratuito al
  // examen oficial): registra, por cada petición real, exactamente qué
  // instancia de backend la atendió y qué vio en BD justo antes de decidir
  // — para poder confirmar en los logs de Render si el request de un
  // usuario concreto pasa por aquí y qué instancia responde.
  const decision = usuario.plan === "premium" ? "PERMITIDO" : "BLOQUEADO_403";
  console.log(
    `[GATE-EXAMEN-OFICIAL] ${new Date().toISOString()} email=${usuario.email} usuarioId=${usuario.id} plan="${usuario.plan}" decision=${decision} instancia=${process.env.RENDER_INSTANCE_ID ?? "local"} servicio=${process.env.RENDER_SERVICE_NAME ?? "local"} commit=${(process.env.RENDER_GIT_COMMIT ?? "local").slice(0, 7)}`
  );

  if (usuario.plan !== "premium") {
    return res.status(403).json({ error: "El examen oficial cronometrado es exclusivo del plan premium" });
  }

  const disponibles = await prisma.pregunta.findMany({
    where: { estado: EstadoPregunta.verificada },
    select: {
      id: true,
      enunciado: true,
      opciones: true,
      tipo: true,
      temaId: true,
      tablaDatos: true,
      tema: { select: { bloque: true } },
    },
  });

  const normalizadas = disponibles.map((p) => ({ ...p, bloque: p.tema?.bloque ?? null }));
  const { bloqueI, psicotecnicas, bloqueII } = seleccionarExamenOficial(normalizadas);

  const { parte1, parte2 } = ESTRUCTURA_EXAMEN_OFICIAL;
  if (bloqueI.length < parte1.bloqueI || psicotecnicas.length < parte1.psicotecnicas || bloqueII.length < parte2.bloqueII) {
    return res.status(409).json({
      error:
        "Todavía no hay preguntas verificadas suficientes para generar el examen oficial completo (30 Bloque I + 30 psicotécnicas + 50 Bloque II).",
    });
  }

  res.json({
    parte1: {
      preguntas: barajar([...bloqueI, ...psicotecnicas]).map(ocultarRespuesta),
      tiempoLimiteMin: parte1.tiempoLimiteMin,
    },
    parte2: {
      preguntas: bloqueII.map(ocultarRespuesta),
      tiempoLimiteMin: parte2.tiempoLimiteMin,
    },
  });
}));

const responderSchema = z.object({
  opcion: z.nativeEnum(Opcion),
  sesionAnonima: z.string().optional(),
  tiempoMs: z.number().int().nonnegative().optional(),
});

/**
 * Registra la respuesta a una pregunta (usuario autenticado o anónimo).
 * El límite diario del plan gratuito ya se aplicó al empezar el test (ver
 * GET /aleatorias y GET /progreso/hoy): una vez empezado, se responde con
 * normalidad. Si hay usuario autenticado, además actualiza su progreso
 * SM-2 para esa pregunta.
 */
preguntasRouter.post("/:id/responder", authOpcional, asyncHandler(async (req, res) => {
  const parsed = responderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { opcion, sesionAnonima, tiempoMs } = parsed.data;
  const usuarioId = req.auth?.usuarioId;

  if (!usuarioId && !sesionAnonima) {
    return res
      .status(400)
      .json({ error: "Se requiere sesionAnonima si no hay usuario autenticado" });
  }

  const pregunta = await prisma.pregunta.findUnique({ where: { id: req.params.id } });
  if (!pregunta) return res.status(404).json({ error: "Pregunta no encontrada" });
  if (pregunta.estado === EstadoPregunta.anulada || !pregunta.respuestaCorrecta) {
    return res.status(410).json({ error: "Esta pregunta ha sido anulada" });
  }

  if (usuarioId) {
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario) return res.status(401).json({ error: "Usuario no válido" });
  }

  const esCorrecta = opcion === pregunta.respuestaCorrecta;

  await prisma.intento.create({
    data: {
      usuarioId,
      sesionAnonima: usuarioId ? undefined : sesionAnonima,
      preguntaId: pregunta.id,
      opcionElegida: opcion,
      esCorrecta,
      tiempoMs,
    },
  });

  if (usuarioId) {
    const progresoActual = await prisma.progreso.findUnique({
      where: { usuarioId_preguntaId: { usuarioId, preguntaId: pregunta.id } },
    });
    const calidad = calidadDesdeAcierto(esCorrecta);
    const base = progresoActual ?? {
      repeticiones: 0,
      factorFacilidad: 2.5,
      intervaloDias: 0,
    };
    const siguiente = siguienteEstadoSM2(base, calidad);

    await prisma.progreso.upsert({
      where: { usuarioId_preguntaId: { usuarioId, preguntaId: pregunta.id } },
      create: {
        usuarioId,
        preguntaId: pregunta.id,
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

  res.json({
    esCorrecta,
    respuestaCorrecta: pregunta.respuestaCorrecta,
    explicacion: pregunta.explicacion,
    explicacionGeneradaIA: pregunta.explicacionGeneradaIA,
    fuente: pregunta.fuente,
    fuenteUrl: pregunta.fuenteUrl,
  });
}));

preguntasRouter.get("/temas", asyncHandler(async (_req, res) => {
  const temas = await prisma.tema.findMany({
    orderBy: [{ bloque: "asc" }, { numero: "asc" }],
  });
  res.json({ temas });
}));
