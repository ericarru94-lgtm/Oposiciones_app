import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { Footer } from "./Footer";

/**
 * Rutas que cuentan como parte de cada sección de la barra de navegación,
 * más allá de la propia ruta del enlace (p.ej. practicar un tema o ver su
 * resumen siguen siendo "Tests" a efectos de qué se marca en negrita).
 */
function seccionActiva(pathname: string, prefijos: string[]): boolean {
  return prefijos.some((prefijo) => pathname === prefijo || pathname.startsWith(`${prefijo}/`));
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { usuario, logout } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const claseEnlace = (activo: boolean) => (activo ? "font-bold text-ink" : "hover:text-ink");

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4 lg:max-w-5xl xl:max-w-6xl">
          <Link to="/home" className="inline-flex items-center gap-1.5 font-semibold text-ink">
            Aprobox
            <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
            <span className="sr-only">Servicio activo</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-muted">
            <Link to="/home" className={claseEnlace(seccionActiva(pathname, ["/home"]))}>
              Inicio
            </Link>
            <Link
              to="/progreso"
              className={claseEnlace(
                seccionActiva(pathname, ["/progreso", "/practicar", "/temas", "/simulacro", "/repasar-hoy"])
              )}
            >
              Tests
            </Link>
            {usuario?.esAdmin && (
              <Link to="/admin/revision" className={claseEnlace(seccionActiva(pathname, ["/admin"]))}>
                Revisión
              </Link>
            )}
            <Link to="/perfil" className={claseEnlace(seccionActiva(pathname, ["/perfil"]))}>
              Perfil
            </Link>
            <button
              onClick={() => {
                logout();
                navigate("/");
              }}
              className="text-muted hover:text-error"
            >
              Salir
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 lg:max-w-5xl xl:max-w-6xl">{children}</main>
      <Footer />
    </div>
  );
}
