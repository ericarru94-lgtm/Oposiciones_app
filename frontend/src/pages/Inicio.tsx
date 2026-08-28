import { Navigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { Landing } from "./Landing";

/** Punto de entrada "/": si hay sesión va al panel; si no, landing pública. */
export function Inicio() {
  const { estaAutenticado, cargando } = useSession();

  if (cargando) return <p className="mt-20 text-center text-slate-400">Cargando…</p>;
  if (estaAutenticado) return <Navigate to="/home" replace />;
  return <Landing />;
}
