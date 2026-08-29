import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";

export function RutaProtegida({ children }: { children: ReactNode }) {
  const { estaAutenticado, cargando } = useSession();

  if (cargando) {
    return <p className="mt-20 text-center text-muted">Cargando…</p>;
  }
  if (!estaAutenticado) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
