import { Link } from "react-router-dom";
import { obtenerTemas } from "../api/endpoints";
import { PublicContentLayout } from "../components/PublicContentLayout";
import { PageTitle } from "../components/PageTitle";
import { useSeo } from "../hooks/useSeo";
import { useApiData } from "../hooks/useApiData";
import type { Tema } from "../api/types";

const NOMBRE_BLOQUE = { I: "Bloque I. Organización pública", II: "Bloque II. Actividad administrativa y ofimática" };

/**
 * Índice público del temario completo, enlazando a cada resumen de tema
 * (ver ResumenTema.tsx). Es la pieza que le falta a esos 28 resúmenes para
 * ser indexables de verdad: sin una página pública que los enlace, Google
 * no tiene forma de descubrirlos aunque cada uno tenga su propia URL.
 */
export function Temario() {
  useSeo({
    titulo: "Temario completo de Auxiliar Administrativo del Estado",
    descripcion:
      "Los 28 temas oficiales de la oposición de Auxiliar Administrativo del Estado, con resumen de estudio y test de preguntas verificadas gratis en cada uno.",
    ruta: "/temario",
  });

  const { datos: temas } = useApiData<Tema[]>(async () => {
    const { temas } = await obtenerTemas();
    return temas;
  }, []);

  return (
    <PublicContentLayout>
      <PageTitle icono="📚">Temario completo</PageTitle>
      <p className="text-sm text-muted">
        Los 28 temas oficiales de la oposición de Auxiliar Administrativo del Estado. Entra en cualquiera para ver su
        resumen de estudio y practicar con preguntas verificadas.
      </p>

      {temas === null && <p className="mt-6 text-sm text-muted">Cargando…</p>}

      {temas &&
        (["I", "II"] as const).map((bloque) => (
          <section key={bloque} className="mt-8">
            <h2 className="text-sm font-semibold text-ink">{NOMBRE_BLOQUE[bloque]}</h2>
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {temas
                .filter((t) => t.bloque === bloque)
                .sort((a, b) => a.numero - b.numero)
                .map((tema) => (
                  <li key={tema.id}>
                    <Link
                      to={`/temas/${tema.id}/resumen`}
                      className="block rounded-xl border border-line bg-card px-4 py-3 text-sm text-ink hover:border-primary hover:bg-canvas"
                    >
                      <span className="font-medium">Tema {tema.numero}.</span> {tema.nombre}
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </PublicContentLayout>
  );
}
