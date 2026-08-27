import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";

export function Upgrade() {
  const navigate = useNavigate();
  const { token } = useSession();

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

        <button
          disabled
          title="La suscripción de pago llega en una fase posterior"
          className="mt-6 w-full cursor-not-allowed rounded-lg bg-indigo-300 px-4 py-3 font-medium text-white"
        >
          Suscribirme (próximamente)
        </button>

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
