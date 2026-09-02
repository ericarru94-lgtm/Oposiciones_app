import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageTitle } from "./PageTitle";
import { Footer } from "./Footer";
import { useSeo } from "../hooks/useSeo";

const DESCRIPCION_POR_DEFECTO =
  "Aprobox, la plataforma de preparación para la oposición de Auxiliar Administrativo del Estado.";

interface PaginaEstaticaProps {
  icono: string;
  titulo: string;
  /** Ruta pública (con "/" inicial) para el canonical/og:url de esta página, p.ej. "/contacto". */
  ruta: string;
  descripcion?: string;
  /** true en páginas transaccionales/de un solo uso (confirmar/baja de newsletter) que no deben indexarse. */
  noIndexar?: boolean;
  children: ReactNode;
}

/** Layout compartido por las páginas legales y de contacto: accesible sin sesión. */
export function PaginaEstatica({
  icono,
  titulo,
  ruta,
  descripcion = DESCRIPCION_POR_DEFECTO,
  noIndexar = false,
  children,
}: PaginaEstaticaProps) {
  useSeo({ titulo, descripcion, ruta, noIndexar });

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-3xl items-center px-6 py-4">
          <Link to="/" className="inline-flex items-center gap-1.5 font-semibold text-ink">
            Aprobox
            <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
            <span className="sr-only">Servicio activo</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <PageTitle icono={icono}>{titulo}</PageTitle>
        <div className="space-y-4 rounded-2xl border border-line bg-card p-8 text-sm leading-relaxed text-ink">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}
