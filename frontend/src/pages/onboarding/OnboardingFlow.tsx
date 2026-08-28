import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../../context/SessionContext";
import { Auth } from "../Auth";
import type { ResumenTest } from "../../components/TestRunner";
import { PasoMiniTest } from "./PasoMiniTest";
import { PasoNivel } from "./PasoNivel";
import { PasoPrimerTest } from "./PasoPrimerTest";

type Paso = "mini-test" | "nivel" | "primer-test" | "registro";

/**
 * Onboarding sin registro: mini-test de 5 preguntas -> nivel de partida ->
 * primer test corto ya armado sobre Constitución -> alta de cuenta para
 * guardar el progreso (Home y "repasar hoy" necesitan un usuario, ya que
 * Progreso.usuarioId no es opcional en el modelo de datos). Empieza
 * directamente en el mini-test: la propuesta de valor ya se muestra en la
 * landing pública, así que aquí repetirla sería un paso de más.
 */
export function OnboardingFlow() {
  const [paso, setPaso] = useState<Paso>("mini-test");
  const [resumenMiniTest, setResumenMiniTest] = useState<ResumenTest | null>(null);
  const [resumenPrimerTest, setResumenPrimerTest] = useState<ResumenTest | null>(null);
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
            setPaso("primer-test");
          }}
        />
      );
      break;

    case "primer-test":
      contenido = (
        <PasoPrimerTest
          onFinalizar={(resumen) => {
            setResumenPrimerTest(resumen);
            setPaso("registro");
          }}
          onLimiteAlcanzado={irAUpgrade}
        />
      );
      break;

    case "registro": {
      const totalAciertos = (resumenMiniTest?.aciertos ?? 0) + (resumenPrimerTest?.aciertos ?? 0);
      const totalPreguntas = (resumenMiniTest?.totalPreguntas ?? 0) + (resumenPrimerTest?.totalPreguntas ?? 0);
      contenido = (
        <Auth
          destino="/home"
          cabecera={
            <div className="mb-5 rounded-lg bg-indigo-50 p-4 text-center">
              <p className="text-sm text-indigo-900">
                Has acertado <span className="font-semibold">{totalAciertos} de {totalPreguntas}</span> preguntas.
              </p>
              <p className="mt-1 text-sm text-indigo-700">Crea tu cuenta gratis para guardar el progreso y seguir.</p>
            </div>
          }
        />
      );
      break;
    }
  }

  return <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">{contenido}</div>;
}
