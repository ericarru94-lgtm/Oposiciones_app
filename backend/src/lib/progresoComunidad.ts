import { prisma } from "./prisma";

interface FilaPrecisionOtroUsuario {
  usuarioId: string;
  total: number;
  aciertos: number;
}

interface FilaDiaActivoOtroUsuario {
  usuarioId: string;
  dia: Date;
}

export interface EstadisticasOtroUsuario {
  total: number;
  aciertos: number;
  /** Claves de día (AAAA-MM-DD, día civil en Madrid) con al menos un intento — mismo formato que claveDiaMadrid, ver lib/fechaLocal.ts. */
  dias: Set<string>;
}

/** "AAAA-MM-DD" a partir de un `date` de Postgres sin componente de hora (node-postgres lo da como medianoche UTC de ese día: tomar los getters UTC es exacto, sin reinterpretar por zona horaria). */
function claveDesdeFechaSql(fecha: Date): string {
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getUTCDate()).padStart(2, "0");
  return `${fecha.getUTCFullYear()}-${mes}-${dia}`;
}

/**
 * Estadísticas en bruto (total de intentos, aciertos y días con actividad)
 * de todos los usuarios DISTINTOS de `usuarioId`, una entrada por usuario.
 *
 * Antes esto se calculaba trayendo a memoria del proceso CADA intento de
 * TODOS los demás usuarios (`prisma.intento.findMany({ where: { usuarioId:
 * { not } } })`, sin ningún límite) y agrupando en JavaScript. `Intento` es
 * la tabla de mayor volumen de todo el esquema — una fila por cada
 * pregunta respondida, por cada usuario, para siempre — así que esa
 * consulta transfería y procesaba en memoria una cantidad de datos que
 * crece con TODA la actividad histórica de TODOS los usuarios, en cada
 * visita de cada usuario individual a su propio Progreso. A escala (miles
 * de usuarios activos, cientos de miles de intentos) esto es el cuello de
 * botella más severo de todo el backend: no escala con "cuánto usa la app
 * una persona", escala con "cuánto la ha usado todo el mundo, siempre".
 *
 * Ahora la agregación ocurre DENTRO de Postgres, en dos consultas que solo
 * transfieren una fila por usuario (recuento total/aciertos) y una fila
 * por cada combinación (usuario, día con actividad) — nunca una fila por
 * intento. `AT TIME ZONE 'Europe/Madrid'` reproduce en SQL exactamente el
 * mismo día civil que `claveDiaMadrid` calcula en JS (ver
 * lib/fechaLocal.ts): Postgres conoce las mismas reglas de huso horario,
 * cambio de horario incluido, a través de su propio tzdata.
 */
export async function obtenerEstadisticasOtrosUsuarios(
  usuarioId: string
): Promise<Map<string, EstadisticasOtroUsuario>> {
  const [filasPrecision, filasDias] = await Promise.all([
    prisma.$queryRaw<FilaPrecisionOtroUsuario[]>`
      SELECT "usuarioId" AS "usuarioId",
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "esCorrecta")::int AS aciertos
      FROM "Intento"
      WHERE "usuarioId" IS NOT NULL AND "usuarioId" != ${usuarioId}
      GROUP BY "usuarioId"
    `,
    prisma.$queryRaw<FilaDiaActivoOtroUsuario[]>`
      SELECT "usuarioId" AS "usuarioId",
             ("createdAt" AT TIME ZONE 'Europe/Madrid')::date AS dia
      FROM "Intento"
      WHERE "usuarioId" IS NOT NULL AND "usuarioId" != ${usuarioId}
      GROUP BY "usuarioId", dia
    `,
  ]);

  const porUsuario = new Map<string, EstadisticasOtroUsuario>();
  for (const fila of filasPrecision) {
    porUsuario.set(fila.usuarioId, { total: fila.total, aciertos: fila.aciertos, dias: new Set() });
  }
  for (const fila of filasDias) {
    // Toda fila de filasDias corresponde a un usuario con al menos un
    // intento, así que su entrada en filasPrecision siempre existe ya.
    porUsuario.get(fila.usuarioId)!.dias.add(claveDesdeFechaSql(fila.dia));
  }
  return porUsuario;
}
