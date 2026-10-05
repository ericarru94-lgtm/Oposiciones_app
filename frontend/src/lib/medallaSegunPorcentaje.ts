export interface Medalla {
  icono: string;
  mensaje: string;
}

const BANDAS: { minimo: number; icono: string; mensaje: string }[] = [
  { minimo: 90, icono: "🏆", mensaje: "¡Excelente! Dominas este bloque de preguntas." },
  { minimo: 70, icono: "🎉", mensaje: "¡Muy bien! Vas por buen camino." },
  { minimo: 40, icono: "💪", mensaje: "Buen esfuerzo, sigue practicando." },
  { minimo: 0, icono: "📚", mensaje: "Repasa este tema y vuelve a intentarlo." },
];

/**
 * Icono + mensaje motivacional según el % de acierto (bandas ≥90/≥70/≥40).
 * Único punto para esto — antes reimplementado por separado en
 * TestRunner, Simulacro y ExamenOficial.
 */
export function medallaSegunPorcentaje(porcentaje: number): Medalla {
  const banda = BANDAS.find((b) => porcentaje >= b.minimo) ?? BANDAS[BANDAS.length - 1];
  return { icono: banda.icono, mensaje: banda.mensaje };
}
