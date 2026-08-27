import { obtenerPreguntasAleatorias, obtenerTemas } from "../../api/endpoints";
import { CargadorTest } from "../../components/CargadorTest";
import type { ResumenTest } from "../../components/TestRunner";

/**
 * Tema de arranque del onboarding: "La Constitución Española de 1978"
 * (bloque I, tema 1). Se fija a propósito en vez de calcularlo como "el
 * tema con más preguntas" del dataset actual, porque ese dataset todavía
 * está mayormente sin verificar y desequilibrado entre bloques (temas de
 * ofimática del bloque II tienen más preguntas en bruto que cualquier
 * tema jurídico); Constitución es, por estructura real del temario de
 * Auxiliar Administrativo del Estado, el tema clásico de arranque.
 */
const TEMA_ARRANQUE = { bloque: "I" as const, numero: 1 };

async function cargarPrimerTest() {
  const { temas } = await obtenerTemas();
  const tema = temas.find((t) => t.bloque === TEMA_ARRANQUE.bloque && t.numero === TEMA_ARRANQUE.numero);
  const { preguntas } = await obtenerPreguntasAleatorias({ limit: 5, temaId: tema?.id });
  return preguntas;
}

export function PasoPrimerTest({
  onFinalizar,
  onLimiteAlcanzado,
}: {
  onFinalizar: (resumen: ResumenTest) => void;
  onLimiteAlcanzado: () => void;
}) {
  return (
    <CargadorTest
      titulo="Tu primer test: La Constitución Española de 1978"
      cargar={cargarPrimerTest}
      onFinalizar={onFinalizar}
      onLimiteAlcanzado={onLimiteAlcanzado}
    />
  );
}
