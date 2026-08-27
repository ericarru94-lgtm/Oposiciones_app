import { Navigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";

/** Punto de entrada "/": decide a dónde mandar según el estado de sesión. */
export function Inicio() {
  const { estaAutenticado, cargando, onboardingCompleto } = useSession();

  if (cargando) return <p className="mt-20 text-center text-slate-400">Cargando…</p>;
  if (estaAutenticado) return <Navigate to="/home" replace />;
  if (onboardingCompleto) return <Navigate to="/login" replace />;
  return <Navigate to="/onboarding" replace />;
}
