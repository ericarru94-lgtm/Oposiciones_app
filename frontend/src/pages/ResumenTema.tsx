import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { obtenerTemas } from "../api/endpoints";
import { AppLayout } from "../components/AppLayout";
import { PageTitle } from "../components/PageTitle";
import { EsquemaResumen } from "../components/EsquemaResumen";
import { generarPdfResumen } from "../lib/generarPdfResumen";
import type { Tema } from "../api/types";

export function ResumenTema() {
  const { temaId } = useParams<{ temaId: string }>();
  const navigate = useNavigate();
  const [tema, setTema] = useState<Tema | null | undefined>(undefined);

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

  return (
    <AppLayout>
      <PageTitle icono="📖">{tema ? `Tema ${tema.numero}. ${tema.nombre}` : "Resumen del tema"}</PageTitle>

      {tema === undefined && <p className="text-sm text-muted">Cargando…</p>}
      {tema === null && <p className="text-sm text-muted">No se ha encontrado este tema.</p>}

      {tema && (
        <div className="rounded-2xl border border-line bg-card p-6">
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
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {tema && (
          <button
            onClick={() => navigate(`/practicar/${tema.id}`)}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Practicar este tema
          </button>
        )}
        {tema?.resumen && (
          <button
            onClick={() => generarPdfResumen(tema)}
            className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink hover:bg-canvas"
          >
            📄 Descargar PDF
          </button>
        )}
        <Link
          to="/progreso"
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-canvas"
        >
          Volver a Tests
        </Link>
      </div>
    </AppLayout>
  );
}
