import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Footer } from "./Footer";

/**
 * Mismo armazón visual que AppLayout (cabecera + main + Footer), pero para
 * páginas de contenido público (p.ej. resúmenes de tema) que un visitante
 * sin sesión puede ver directamente desde un resultado de búsqueda. La
 * cabecera de AppLayout asume sesión iniciada (enlaces a /home, /perfil,
 * "Salir"...) y bloquearía a ese visitante contra RutaProtegida al pulsar
 * cualquiera de ellos.
 */
export function PublicContentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4 lg:max-w-5xl xl:max-w-6xl">
          <Link to="/" className="inline-flex items-center gap-1.5 font-semibold text-ink">
            Aprobox
            <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
            <span className="sr-only">Servicio activo</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/login" className="text-muted hover:text-ink">
              Iniciar sesión
            </Link>
            <Link
              to="/registro"
              className="rounded-full bg-primary px-4 py-2 font-medium text-white hover:bg-primary-hover"
            >
              Regístrate gratis
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 lg:max-w-5xl xl:max-w-6xl">{children}</main>
      <Footer />
    </div>
  );
}
