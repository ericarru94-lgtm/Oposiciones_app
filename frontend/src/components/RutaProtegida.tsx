import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";

export function RutaProtegida({ children }: { children: ReactNode }) {
  const { token, cargando } = useSession();

  if (cargando) {
    return <p className="mt-20 text-center text-slate-400">Cargando…</p>;
  }
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
