import { prisma } from "./prisma";
import { EstadoPregunta } from "@prisma/client";

export interface FilaProgresoPorTema {
  temaId: number;
  bloque: string;
  numero: number;
  nombre: string;
  totalPreguntas: number;
  preguntasContestadas: number;
  totalIntentos: number;
  aciertos: number;
  precision: number | null;
}

/**
 * Progreso por tema de un usuario (grid de Home, "puntos débiles" del panel
 * de Progreso): cuántas preguntas verificadas tiene cada tema, cuántas
 * distintas ha contestado el usuario y su precisión en ese tema.
 *
 * Antes hacía 2 consultas POR TEMA dentro de un bucle (2×N, N = nº de
 * temas) — aquí son solo 2 consultas en total: una agregada de preguntas
 * verificadas por tema, y una que trae de una vez todos los intentos del
 * usuario con el temaId de su pregunta, agrupados en JS. Mismo resultado,
 * independiente de cuántos temas tenga el temario.
 */
export async function calcularProgresoPorTema(usuarioId: string): Promise<FilaProgresoPorTema[]> {
  const temas = await prisma.tema.findMany({ orderBy: [{ bloque: "asc" }, { numero: "asc" }] });

  const [preguntasPorTema, intentos] = await Promise.all([
    prisma.pregunta.groupBy({
      by: ["temaId"],
      where: { estado: EstadoPregunta.verificada, temaId: { not: null } },
      _count: { _all: true },
    }),
    prisma.intento.findMany({
      where: { usuarioId },
      select: { preguntaId: true, esCorrecta: true, pregunta: { select: { temaId: true } } },
    }),
  ]);

  const totalPreguntasPorTema = new Map(preguntasPorTema.map((fila) => [fila.temaId, fila._count._all]));

  const intentosPorTema = new Map<number, { preguntaId: string; esCorrecta: boolean }[]>();
  for (const intento of intentos) {
    const temaId = intento.pregunta.temaId;
    if (temaId === null) continue;
    const lista = intentosPorTema.get(temaId);
    if (lista) lista.push(intento);
    else intentosPorTema.set(temaId, [intento]);
  }

  return temas.map((tema) => {
    const intentosTema = intentosPorTema.get(tema.id) ?? [];
    const totalIntentos = intentosTema.length;
    const aciertos = intentosTema.filter((i) => i.esCorrecta).length;
    const preguntasContestadas = new Set(intentosTema.map((i) => i.preguntaId)).size;

    return {
      temaId: tema.id,
      bloque: tema.bloque,
      numero: tema.numero,
      nombre: tema.nombre,
      totalPreguntas: totalPreguntasPorTema.get(tema.id) ?? 0,
      preguntasContestadas,
      totalIntentos,
      aciertos,
      precision: totalIntentos > 0 ? aciertos / totalIntentos : null,
    };
  });
}
