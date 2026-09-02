import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { PantallaCargando } from "./PantallaCargando";

export function RutaAdmin({ children }: { children: ReactNode }) {
  const { estaAutenticado, usuario, cargando } = useSession();

  if (cargando) {
    return <PantallaCargando />;
  }
  if (!estaAutenticado) {
    return <Navigate to="/" replace />;
  }
  if (!usuario?.esAdmin) {
    return <Navigate to="/home" replace />;
  }
  return <>{children}</>;
}
