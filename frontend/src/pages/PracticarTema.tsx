import { useNavigate, useParams } from "react-router-dom";
import { obtenerPreguntasAleatorias } from "../api/endpoints";
import { AppLayout } from "../components/AppLayout";
import { CargadorTest } from "../components/CargadorTest";

export function PracticarTema() {
  const { temaId } = useParams<{ temaId: string }>();
  const navigate = useNavigate();

  async function cargar() {
    const { preguntas } = await obtenerPreguntasAleatorias({ temaId: Number(temaId), limit: 10 });
    return preguntas;
  }

  return (
    <AppLayout>
      <CargadorTest
        titulo="Practicar tema"
        cargar={cargar}
        onFinalizar={() => navigate("/home")}
        onLimiteAlcanzado={() => navigate("/upgrade")}
      />
    </AppLayout>
  );
}
