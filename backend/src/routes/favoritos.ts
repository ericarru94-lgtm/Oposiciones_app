import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authRequerido } from "../middleware/auth";
import { asyncHandler } from "../lib/asyncHandler";
import { EstadoPregunta } from "@prisma/client";
import { barajar, ocultarRespuesta } from "./preguntas";

export const favoritosRouter = Router();

/**
 * Lista solo los ids de las preguntas favoritas del usuario — deliberadamente
 * ligero (nada de enunciado/opciones) para que TestRunner pueda pedirlo una
 * vez al empezar cualquier test y saber qué estrella pintar rellena, sin
 * importar de qué endpoint vinieran esas preguntas (/aleatorias,
 * /simulacro, /progreso/hoy...).
 */
favoritosRouter.get(
  "/ids",
  authRequerido,
  asyncHandler(async (req, res) => {
    const favoritas = await prisma.preguntaFavorita.findMany({
      where: { usuarioId: req.auth!.usuarioId },
      select: { preguntaId: true },
    });
    res.json({ ids: favoritas.map((f) => f.preguntaId) });
  })
);

/** Preguntas favoritas completas, en el mismo formato que /preguntas/aleatorias, para practicarlas como test. */
favoritosRouter.get(
  "/",
  authRequerido,
  asyncHandler(async (req, res) => {
    const favoritas = await prisma.preguntaFavorita.findMany({
      where: { usuarioId: req.auth!.usuarioId },
      include: { pregunta: true },
    });
    const preguntas = favoritas
      .map((f) => f.pregunta)
      .filter((p) => p.estado === EstadoPregunta.verificada);
    res.json({ preguntas: barajar(preguntas).map(ocultarRespuesta) });
  })
);

/** Marca una pregunta como favorita. Idempotente: repetir la llamada no falla ni duplica. */
favoritosRouter.post(
  "/:preguntaId",
  authRequerido,
  asyncHandler(async (req, res) => {
    const pregunta = await prisma.pregunta.findUnique({ where: { id: req.params.preguntaId } });
    if (!pregunta || pregunta.estado !== EstadoPregunta.verificada) {
      return res.status(404).json({ error: "Pregunta no encontrada" });
    }
    await prisma.preguntaFavorita.upsert({
      where: { usuarioId_preguntaId: { usuarioId: req.auth!.usuarioId, preguntaId: req.params.preguntaId } },
      create: { usuarioId: req.auth!.usuarioId, preguntaId: req.params.preguntaId },
      update: {},
    });
    res.status(204).end();
  })
);

/** Desmarca una pregunta favorita. Idempotente: si no estaba marcada, también responde 204. */
favoritosRouter.delete(
  "/:preguntaId",
  authRequerido,
  asyncHandler(async (req, res) => {
    await prisma.preguntaFavorita.deleteMany({
      where: { usuarioId: req.auth!.usuarioId, preguntaId: req.params.preguntaId },
    });
    res.status(204).end();
  })
);
