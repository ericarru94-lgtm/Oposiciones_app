import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../../context/SessionContext";
import { Auth } from "../Auth";
import type { ResumenTest } from "../../components/TestRunner";
import { PasoMiniTest } from "./PasoMiniTest";
import { PasoNivel } from "./PasoNivel";

type Paso = "mini-test" | "nivel" | "registro";

/**
 * Onboarding sin registro: mini-test de 5 preguntas -> nivel de partida ->
 * alta de cuenta para guardar el progreso (Home y "repasar hoy" necesitan
 * un usuario, ya que Progreso.usuarioId no es opcional en el modelo de
 * datos). Empieza directamente en el mini-test: la propuesta de valor ya se
 * muestra en la landing pública, así que repetirla aquí sería un paso de
 * más. Un único test (el mini-test) es suficiente para el registro: no se
 * repite otro tras elegir el nivel ni después de crear la cuenta.
 */
export function OnboardingFlow() {
  const [paso, setPaso] = useState<Paso>("mini-test");
  const [resumenMiniTest, setResumenMiniTest] = useState<ResumenTest | null>(null);
  const { setNivelInicialPendiente } = useSession();
  const navigate = useNavigate();

  const irAUpgrade = () => navigate("/upgrade");

  let contenido: ReactNode;
  switch (paso) {
    case "mini-test":
      contenido = (
        <PasoMiniTest
          onFinalizar={(resumen) => {
            setResumenMiniTest(resumen);
            setPaso("nivel");
          }}
          onLimiteAlcanzado={irAUpgrade}
        />
      );
      break;

    case "nivel":
      contenido = (
        <PasoNivel
          onElegir={(nivel) => {
            setNivelInicialPendiente(nivel);
            setPaso("registro");
          }}
        />
      );
      break;

    case "registro": {
      const totalAciertos = resumenMiniTest?.aciertos ?? 0;
      const totalPreguntas = resumenMiniTest?.totalPreguntas ?? 0;
      contenido = (
        <Auth
          destino="/home"
          cabecera={
            <div className="mb-5 rounded-lg bg-primary/10 p-4 text-center">
              <p className="text-sm text-ink">
                Has acertado <span className="font-semibold">{totalAciertos} de {totalPreguntas}</span> preguntas.
              </p>
              <p className="mt-1 text-sm text-primary">Crea tu cuenta gratis para guardar el progreso y seguir.</p>
            </div>
          }
        />
      );
      break;
    }
  }

  return <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">{contenido}</div>;
}
