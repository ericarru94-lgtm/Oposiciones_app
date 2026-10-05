/**
 * Fisher-Yates in-place (sobre una copia): cada permutación de `arr` es
 * igual de probable. Única implementación compartida — antes había 4 copias
 * idénticas de este mismo algoritmo repartidas entre routes/preguntas.ts,
 * lib/seleccionProporcional.ts, lib/examenOficial.ts y
 * scripts/aleatorizar-respuestas.ts.
 */
export function barajar<T>(arr: T[]): T[] {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
