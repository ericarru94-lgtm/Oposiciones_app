import { Navigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { Landing } from "./Landing";
import { PantallaCargando } from "../components/PantallaCargando";

/** Punto de entrada "/": si hay sesión va al panel; si no, landing pública. */
export function Inicio() {
  const { estaAutenticado, cargando } = useSession();

  if (cargando) return <PantallaCargando />;
  if (estaAutenticado) return <Navigate to="/home" replace />;
  return <Landing />;
}
