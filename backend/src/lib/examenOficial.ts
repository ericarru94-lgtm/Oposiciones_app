import { Bloque, TipoPregunta } from "@prisma/client";

/**
 * Estructura fija del primer ejercicio real de la oposición de Auxiliar
 * Administrativo del Estado (convocatoria general): Parte 1, cuestionario
 * de 60 preguntas (30 de materias comunes del Bloque I + 30 psicotécnicas)
 * en 90 minutos; Parte 2, cuestionario de 50 preguntas de ofimática
 * (Bloque II) en 45 minutos. A diferencia del simulacro libre
 * (seleccionarProporcionalAlTemario), aquí los números por bloque son
 * fijos, no proporcionales al tamaño del banco.
 */
export const ESTRUCTURA_EXAMEN_OFICIAL = {
  parte1: { bloqueI: 30, psicotecnicas: 30, tiempoLimiteMin: 90 },
  parte2: { bloqueII: 50, tiempoLimiteMin: 45 },
} as const;

export interface PreguntaSeleccionable {
  temaId: number | null;
  tipo: TipoPregunta;
  bloque: Bloque | null;
}

function barajar<T>(arr: T[]): T[] {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * Reparte `disponibles` en los tres cupos fijos del examen oficial. Cada
 * cupo se recorta al número exacto de ESTRUCTURA_EXAMEN_OFICIAL aunque el
 * pool disponible sea mayor (nunca se sirven más preguntas de las que
 * marca la estructura real); si el pool es menor, se devuelven todas las
 * disponibles de ese cupo (menos de las exigidas) — quien llama a esta
 * función es responsable de comprobar que cada lista alcanza el mínimo
 * antes de servir el examen como completo (ver routes/preguntas.ts).
 */
export function seleccionarExamenOficial<T extends PreguntaSeleccionable>(
  disponibles: T[]
): { bloqueI: T[]; psicotecnicas: T[]; bloqueII: T[] } {
  const bloqueIPool = disponibles.filter((p) => p.bloque === Bloque.I && p.tipo === TipoPregunta.teorica);
  const psicotecnicasPool = disponibles.filter((p) => p.tipo === TipoPregunta.psicotecnica);
  const bloqueIIPool = disponibles.filter((p) => p.bloque === Bloque.II && p.tipo === TipoPregunta.teorica);

  return {
    bloqueI: barajar(bloqueIPool).slice(0, ESTRUCTURA_EXAMEN_OFICIAL.parte1.bloqueI),
    psicotecnicas: barajar(psicotecnicasPool).slice(0, ESTRUCTURA_EXAMEN_OFICIAL.parte1.psicotecnicas),
    bloqueII: barajar(bloqueIIPool).slice(0, ESTRUCTURA_EXAMEN_OFICIAL.parte2.bloqueII),
  };
}
