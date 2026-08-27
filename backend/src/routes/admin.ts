import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authRequerido, requiereAdmin } from "../middleware/auth";
import { Bloque, EstadoPregunta, Opcion } from "@prisma/client";

export const adminRouter = Router();
adminRouter.use(authRequerido, requiereAdmin);

const listaQuerySchema = z.object({
  estado: z.enum(["borrador", "verificada", "anulada"]).default("borrador"),
  bloque: z.nativeEnum(Bloque).optional(),
  temaId: z.coerce.number().int().positive().optional(),
  /** Filtra a las preguntas sin tema (psicotécnicas). Tiene prioridad sobre bloque/temaId si se manda. */
  sinTema: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Cola de revisión editorial. A diferencia de /preguntas/aleatorias (que
 * oculta la respuesta y solo sirve estados aptos para usuarios finales),
 * este endpoint es solo para el admin y devuelve la pregunta completa,
 * ordenada por tema para poder revisar "de forma ordenada" en vez de al
 * azar.
 */
adminRouter.get("/preguntas", async (req, res) => {
  const parsed = listaQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { estado, bloque, temaId, sinTema, limit } = parsed.data;

  const preguntas = await prisma.pregunta.findMany({
    where: {
      estado,
      ...(sinTema ? { temaId: null } : temaId ? { temaId } : bloque ? { tema: { bloque } } : {}),
    },
    include: { tema: true },
    take: limit,
  });

  preguntas.sort((a, b) => {
    if (!a.tema && !b.tema) return a.id.localeCompare(b.id);
    if (!a.tema) return 1;
    if (!b.tema) return -1;
    if (a.tema.bloque !== b.tema.bloque) return a.tema.bloque.localeCompare(b.tema.bloque);
    if (a.tema.numero !== b.tema.numero) return a.tema.numero - b.tema.numero;
    return (a.numeroOriginalExamen ?? 0) - (b.numeroOriginalExamen ?? 0);
  });

  res.json({ preguntas });
});

/** Recuento por tema (y sin tema, para psicotécnicas) del estado pedido, para pintar el filtro con "cuántas quedan". */
adminRouter.get("/resumen-temas", async (req, res) => {
  const estadoParsed = z.enum(["borrador", "verificada", "anulada"]).default("borrador").safeParse(req.query.estado);
  if (!estadoParsed.success) return res.status(400).json({ error: estadoParsed.error.flatten() });
  const estado = estadoParsed.data;

  const [temas, preguntas] = await Promise.all([
    prisma.tema.findMany({ orderBy: [{ bloque: "asc" }, { numero: "asc" }] }),
    prisma.pregunta.findMany({ where: { estado }, select: { temaId: true } }),
  ]);

  const conteoPorTema = new Map<number, number>();
  let sinTema = 0;
  for (const p of preguntas) {
    if (p.temaId === null) sinTema++;
    else conteoPorTema.set(p.temaId, (conteoPorTema.get(p.temaId) ?? 0) + 1);
  }

  res.json({
    temas: temas.map((t) => ({ ...t, pendientes: conteoPorTema.get(t.id) ?? 0 })),
    sinTema: { pendientes: sinTema },
  });
});

const edicionSchema = z.object({
  enunciado: z.string().min(1).optional(),
  opciones: z.array(z.string().min(1)).length(4).optional(),
  respuestaCorrecta: z.nativeEnum(Opcion).nullable().optional(),
  explicacion: z.string().nullable().optional(),
  fuente: z.string().nullable().optional(),
  estado: z.nativeEnum(EstadoPregunta).optional(),
});

adminRouter.patch("/preguntas/:id", async (req, res) => {
  const parsed = edicionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const cambios = parsed.data;

  const actual = await prisma.pregunta.findUnique({ where: { id: req.params.id } });
  if (!actual) return res.status(404).json({ error: "Pregunta no encontrada" });

  const respuestaFinal =
    cambios.respuestaCorrecta !== undefined ? cambios.respuestaCorrecta : actual.respuestaCorrecta;
  if (cambios.estado === EstadoPregunta.verificada && !respuestaFinal) {
    return res
      .status(400)
      .json({ error: "No se puede marcar como verificada una pregunta sin respuesta correcta" });
  }

  const pregunta = await prisma.pregunta.update({
    where: { id: req.params.id },
    data: {
      ...cambios,
      fechaVerificacion:
        cambios.estado === undefined ? undefined : cambios.estado === EstadoPregunta.verificada ? new Date() : null,
    },
  });

  res.json({ pregunta });
});
