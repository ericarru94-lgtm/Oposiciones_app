import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { Footer } from "./Footer";

export function AppLayout({ children }: { children: ReactNode }) {
  const { usuario, logout } = useSession();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link to="/home" className="inline-flex items-center gap-1.5 font-semibold text-ink">
            Aprobox
            <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
            <span className="sr-only">Servicio activo</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-muted">
            <Link to="/home" className="hover:text-ink">
              Inicio
            </Link>
            <Link to="/progreso" className="hover:text-ink">
              Tests
            </Link>
            {usuario?.esAdmin && (
              <Link to="/admin/revision" className="hover:text-ink">
                Revisión
              </Link>
            )}
            <Link to="/perfil" className="hover:text-ink">
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
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">{children}</main>
      <Footer />
    </div>
  );
}
