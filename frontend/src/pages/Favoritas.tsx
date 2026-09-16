import { useNavigate } from "react-router-dom";
import { obtenerPreguntasFavoritas } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import { AppLayout } from "../components/AppLayout";
import { CargadorTest } from "../components/CargadorTest";

/** Practica solo las preguntas que has marcado con ★ desde cualquier test. */
export function Favoritas() {
  const { getToken } = useSession();
  const navigate = useNavigate();

  async function cargar() {
    const token = await getToken();
    const { preguntas } = await obtenerPreguntasFavoritas(token as string);
    return preguntas;
  }

  return (
    <AppLayout>
      <CargadorTest
        titulo="Favoritas"
        cargar={cargar}
        onFinalizar={() => navigate("/home")}
        onLimiteAlcanzado={() => navigate("/upgrade")}
      />
    </AppLayout>
  );
}
