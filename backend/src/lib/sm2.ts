/**
 * Algoritmo SM-2 (SuperMemo 2) para repetición espaciada.
 * Referencia: https://super-memo.com/english/ol/sm2.htm
 *
 * `calidad` es un entero 0-5:
 *   0-2 = fallo (se resetea el intervalo)
 *   3-5 = acierto, con distinto grado de facilidad
 */

export interface EstadoSM2 {
  repeticiones: number;
  factorFacilidad: number;
  intervaloDias: number;
}

/**
 * Tope al intervalo en días (~10 años). Sin este límite, repasar la misma
 * pregunta con "acierto" muchas veces seguidas hace crecer el intervalo
 * exponencialmente (intervalo *= factorFacilidad en cada acierto) hasta
 * desbordar el rango válido de `Date`, lo que revienta la query de Prisma
 * al guardar `proximaRevision` (visto en producción: ~17 aciertos seguidos
 * a la misma pregunta ya generan una fecha inválida).
 */
const INTERVALO_MAXIMO_DIAS = 3650;

export function siguienteEstadoSM2(
  estado: EstadoSM2,
  calidad: number
): EstadoSM2 & { proximaRevision: Date } {
  if (calidad < 0 || calidad > 5 || !Number.isInteger(calidad)) {
    throw new Error("calidad debe ser un entero entre 0 y 5");
  }

  let { repeticiones, factorFacilidad, intervaloDias } = estado;

  if (calidad < 3) {
    repeticiones = 0;
    intervaloDias = 1;
  } else {
    if (repeticiones === 0) {
      intervaloDias = 1;
    } else if (repeticiones === 1) {
      intervaloDias = 6;
    } else {
      intervaloDias = Math.round(intervaloDias * factorFacilidad);
    }
    repeticiones += 1;
  }
  intervaloDias = Math.min(intervaloDias, INTERVALO_MAXIMO_DIAS);

  factorFacilidad =
    factorFacilidad + (0.1 - (5 - calidad) * (0.08 + (5 - calidad) * 0.02));
  if (factorFacilidad < 1.3) factorFacilidad = 1.3;

  const proximaRevision = new Date();
  proximaRevision.setDate(proximaRevision.getDate() + intervaloDias);

  return { repeticiones, factorFacilidad, intervaloDias, proximaRevision };
}

/** Convierte un acierto/fallo simple (mini-test rápido) en una calidad SM-2. */
export function calidadDesdeAcierto(esCorrecta: boolean): number {
  return esCorrecta ? 4 : 1;
}
