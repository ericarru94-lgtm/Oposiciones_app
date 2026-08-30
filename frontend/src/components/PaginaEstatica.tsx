import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageTitle } from "./PageTitle";
import { Footer } from "./Footer";

/** Layout compartido por las páginas legales y de contacto: accesible sin sesión. */
export function PaginaEstatica({ icono, titulo, children }: { icono: string; titulo: string; children: ReactNode }) {
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
