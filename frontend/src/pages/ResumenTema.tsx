import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { obtenerTemas } from "../api/endpoints";
import { AppLayout } from "../components/AppLayout";
import { PublicContentLayout } from "../components/PublicContentLayout";
import { Card } from "../components/Card";
import { PageTitle } from "../components/PageTitle";
import { EsquemaResumen } from "../components/EsquemaResumen";
import { useSession } from "../context/SessionContext";
import { useSeo } from "../hooks/useSeo";
import type { Tema } from "../api/types";

/**
 * Página pública a propósito (ver App.tsx: no lleva RutaProtegida): es
 * contenido de estudio real indexable por Google — quien llega desde una
 * búsqueda ("resumen tema constitución auxiliar administrativo", etc.) ve
 * el resumen igual que un usuario registrado, con una llamada a la acción
 * para crear cuenta en vez del botón "Practicar" (que exige sesión).
 */
export function ResumenTema() {
  const { temaId } = useParams<{ temaId: string }>();
  const navigate = useNavigate();
  const { estaAutenticado } = useSession();
  const [tema, setTema] = useState<Tema | null | undefined>(undefined);
  const [generandoPdf, setGenerandoPdf] = useState(false);

  useSeo({
    titulo: tema
      ? `Tema ${tema.numero}. ${tema.nombre} — Resumen y test`
      : "Resumen de tema — Auxiliar Administrativo del Estado",
    descripcion: tema
      ? `Resumen de estudio del Tema ${tema.numero} (${tema.nombre}) del temario de Auxiliar Administrativo del Estado, con test de preguntas verificadas para practicar gratis.`
      : "Resúmenes de estudio y tests verificados del temario de Auxiliar Administrativo del Estado.",
    ruta: `/temas/${temaId}/resumen`,
    tipo: "article",
  });

  /**
   * jsPDF arrastra consigo html2canvas y dompurify aunque no se use su
   * método `.html()` — entre los tres suman más de 350kB minificados. Con
   * un import estático, ese peso viajaba en el chunk principal para
   * cualquiera que visitara la app, aunque nunca pulsara "Descargar PDF".
   * El import dinámico solo lo descarga la primera vez que se pulsa.
   */
  async function descargarPdf(temaActual: Tema) {
    setGenerandoPdf(true);
    try {
      const { generarPdfResumen } = await import("../lib/generarPdfResumen");
      generarPdfResumen(temaActual);
    } finally {
      setGenerandoPdf(false);
    }
  }

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { temas } = await obtenerTemas();
      if (cancelado) return;
      setTema(temas.find((t) => t.id === Number(temaId)) ?? null);
    })();
    return () => {
      cancelado = true;
    };
  }, [temaId]);

  const Layout = estaAutenticado ? AppLayout : PublicContentLayout;

  return (
    <Layout>
      <PageTitle icono="📖">{tema ? `Tema ${tema.numero}. ${tema.nombre}` : "Resumen del tema"}</PageTitle>

      {tema === undefined && <p className="text-sm text-muted">Cargando…</p>}
      {tema === null && <p className="text-sm text-muted">No se ha encontrado este tema.</p>}

      {tema && (
        <Card>
          {tema.resumen ? (
            <>
              <EsquemaResumen texto={tema.resumen} />
              {tema.resumenGeneradoIA && (
                <p className="mt-6 text-xs italic text-muted/80">
                  Resumen generado automáticamente — verifica siempre el contenido con otras fuentes.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">
              Todavía no hay un resumen de estudio para este tema. Estamos ampliándolos progresivamente — mientras
              tanto, puedes practicar directamente con las preguntas.
            </p>
          )}
        </Card>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {tema && estaAutenticado && (
          <button
            onClick={() => navigate(`/practicar/${tema.id}`)}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Practicar este tema
          </button>
        )}
        {tema && !estaAutenticado && (
          <Link
            to="/onboarding"
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Practicar este tema gratis
          </Link>
        )}
        {tema?.resumen && (
          <button
            onClick={() => descargarPdf(tema)}
            disabled={generandoPdf}
            className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generandoPdf ? "Generando…" : "📄 Descargar PDF"}
          </button>
        )}
        <Link
          to={estaAutenticado ? "/progreso" : "/"}
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-canvas"
        >
          {estaAutenticado ? "Volver a Tests" : "Ver todos los temas"}
        </Link>
      </div>
    </Layout>
  );
}
