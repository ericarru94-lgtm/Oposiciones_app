import { obtenerPreguntasAleatorias } from "../../api/endpoints";
import { CargadorTest } from "../../components/CargadorTest";
import type { ResumenTest } from "../../components/TestRunner";

async function cargarMiniTest() {
  const { preguntas } = await obtenerPreguntasAleatorias({ limit: 5 });
  return preguntas;
}

export function PasoMiniTest({
  onFinalizar,
  onLimiteAlcanzado,
}: {
  onFinalizar: (resumen: ResumenTest) => void;
  onLimiteAlcanzado: () => void;
}) {
  return (
    <CargadorTest
      titulo="Mini-test de bienvenida"
      cargar={cargarMiniTest}
      onFinalizar={onFinalizar}
      onLimiteAlcanzado={onLimiteAlcanzado}
    />
  );
}
