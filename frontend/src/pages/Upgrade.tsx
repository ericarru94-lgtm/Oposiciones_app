import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { crearCheckoutSession } from "../api/endpoints";
import { useSession } from "../context/SessionContext";

export function Upgrade() {
  const navigate = useNavigate();
  const { token } = useSession();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function suscribirse() {
    setError(null);
    setCargando(true);
    try {
      const { url } = await crearCheckoutSession(token as string);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar el pago. Inténtalo de nuevo.");
      setCargando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Has llegado a tu límite diario gratuito</h1>
        <p className="mt-3 text-sm text-slate-600">
          El plan gratuito incluye un número limitado de preguntas al día. Hazte premium para practicar sin límites,
          con estadísticas avanzadas y repaso ilimitado.
        </p>

        <div className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-left">
          <p className="font-semibold text-indigo-900">Premium mensual</p>
          <p className="text-sm text-indigo-700">Preguntas ilimitadas · Repaso espaciado sin restricciones</p>
        </div>

        {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

        {token ? (
          <button
            onClick={suscribirse}
            disabled={cargando}
            className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {cargando ? "Redirigiendo a Stripe…" : "Suscribirme"}
          </button>
        ) : (
          <>
            <p className="mt-6 text-sm text-slate-500">Necesitas una cuenta para suscribirte.</p>
            <button
              onClick={() => navigate("/login")}
              className="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700"
            >
              Crear cuenta gratis
            </button>
          </>
        )}

        <button
          onClick={() => navigate(token ? "/home" : "/")}
          className="mt-3 w-full rounded-lg border border-slate-200 px-4 py-3 font-medium text-slate-600 hover:bg-slate-50"
        >
          Volver mañana
        </button>
      </div>
    </div>
  );
}
