import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";

export function RutaAdmin({ children }: { children: ReactNode }) {
  const { estaAutenticado, usuario, cargando } = useSession();

  if (cargando) {
    return <p className="mt-20 text-center text-slate-400">Cargando…</p>;
  }
  if (!estaAutenticado) {
    return <Navigate to="/" replace />;
  }
  if (!usuario?.esAdmin) {
    return <Navigate to="/home" replace />;
  }
  return <>{children}</>;
}
