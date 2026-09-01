import { useNavigate } from "react-router-dom";
import { obtenerRepasoHoy } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import { AppLayout } from "../components/AppLayout";
import { CargadorTest } from "../components/CargadorTest";
import type { PreguntaParaResponder } from "../api/types";

export function RepasarHoy() {
  const { getToken } = useSession();
  const navigate = useNavigate();

  async function cargar(): Promise<PreguntaParaResponder[]> {
    const token = await getToken();
    const { repaso, nuevas } = await obtenerRepasoHoy(token as string);
    return [...repaso, ...nuevas].map((p) => ({
      id: p.preguntaId,
      enunciado: p.enunciado,
      opciones: p.opciones,
      tipo: p.tipo,
      temaId: null,
      tablaDatos: p.tablaDatos,
    }));
  }

  return (
    <AppLayout>
      <CargadorTest
        titulo="Repasar hoy"
        cargar={cargar}
        onFinalizar={() => navigate("/home")}
        onLimiteAlcanzado={() => navigate("/upgrade")}
      />
    </AppLayout>
  );
}
