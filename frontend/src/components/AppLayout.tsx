import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";

export function AppLayout({ children }: { children: ReactNode }) {
  const { usuario, logout } = useSession();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/home" className="font-semibold text-slate-900">
            Oposiciones App
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/home" className="text-slate-600 hover:text-slate-900">
              Inicio
            </Link>
            <Link to="/progreso" className="text-slate-600 hover:text-slate-900">
              Progreso
            </Link>
            {usuario?.esAdmin && (
              <Link to="/admin/revision" className="text-slate-600 hover:text-slate-900">
                Revisión
              </Link>
            )}
            <span className="text-slate-300">|</span>
            <span className="text-slate-500">{usuario?.email}</span>
            <button
              onClick={() => {
                logout();
                navigate("/login");
              }}
              className="text-slate-400 hover:text-rose-600"
            >
              Salir
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
