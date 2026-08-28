/**
 * Reparte `numPreguntas` entre los temas de `disponibles`, proporcionalmente
 * al peso de cada tema. No existe en el modelo de datos un "peso oficial"
 * del temario, así que se usa como proxy el nº de preguntas verificadas que
 * tiene cada tema en el banco (los temas con más peso real en la oposición
 * son, en la práctica, los que tienen más preguntas elaboradas). El reparto
 * usa el método del resto mayor para que la suma de cupos sea exacta sin
 * sesgar sistemáticamente a los temas grandes por redondeo hacia abajo.
 */
export function seleccionarProporcionalAlTemario<T extends { temaId: number | null }>(
  disponibles: T[],
  numPreguntas: number
): T[] {
  const porTema = new Map<number, T[]>();
  for (const p of disponibles) {
    if (p.temaId === null) continue;
    const lista = porTema.get(p.temaId);
    if (lista) lista.push(p);
    else porTema.set(p.temaId, [p]);
  }

  const totalDisponibles = disponibles.length;
  const objetivo = Math.min(numPreguntas, totalDisponibles);
  if (totalDisponibles === 0 || objetivo === 0) return [];

  const entradas = [...porTema.values()].map((lista) => {
    const exacta = (lista.length / totalDisponibles) * objetivo;
    return { lista, cupo: Math.floor(exacta), resto: exacta - Math.floor(exacta) };
  });

  let asignadas = entradas.reduce((suma, e) => suma + e.cupo, 0);
  const porResto = [...entradas].sort((a, b) => b.resto - a.resto);
  for (let i = 0; asignadas < objetivo && i < porResto.length; i++, asignadas++) {
    porResto[i].cupo += 1;
  }

  const seleccion: T[] = [];
  for (const e of entradas) {
    seleccion.push(...barajar(e.lista).slice(0, Math.min(e.cupo, e.lista.length)));
  }
  return barajar(seleccion).slice(0, objetivo);
}

function barajar<T>(arr: T[]): T[] {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
