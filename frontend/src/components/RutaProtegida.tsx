import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { PantallaCargando } from "./PantallaCargando";

export function RutaProtegida({ children }: { children: ReactNode }) {
  const { estaAutenticado, cargando } = useSession();

  if (cargando) {
    return <PantallaCargando />;
  }
  if (!estaAutenticado) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
