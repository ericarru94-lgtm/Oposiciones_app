import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { crearCheckoutSession } from "../api/endpoints";
import { useSession } from "../context/SessionContext";

/** A dónde volver tras el login/registro de Clerk disparado desde "Suscribirme". */
const DESTINO_TRAS_AUTH = "/upgrade?continuar=1";

export function Upgrade() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { estaAutenticado, cargando, getToken, usuario } = useSession();
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const yaContinuado = useRef(false);

  async function suscribirse() {
    setError(null);
    setProcesando(true);
    try {
      const token = await getToken();
      const { url } = await crearCheckoutSession(token as string);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar el pago. Inténtalo de nuevo.");
      setProcesando(false);
    }
  }

  // Al volver del login/registro de Clerk (disparado por "Suscribirme" sin
  // sesión, ver alPulsarSuscribirme), continúa el pago automáticamente en
  // vez de obligar a pulsar el botón otra vez.
  useEffect(() => {
    if (cargando || yaContinuado.current) return;
    if (estaAutenticado && searchParams.get("continuar") === "1") {
      yaContinuado.current = true;
      setSearchParams({}, { replace: true });
      void suscribirse();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargando, estaAutenticado, searchParams]);

  // Quien ya es premium no debe ver la oferta de pago (evita una segunda
  // suscripción/cargo): si llega aquí por un enlace viejo o directamente
  // por URL, lo mandamos a Home.
  useEffect(() => {
    if (cargando || usuario?.plan !== "premium") return;
    navigate("/home", { replace: true });
  }, [cargando, usuario, navigate]);

  function alPulsarSuscribirme() {
    if (!estaAutenticado) {
      navigate(`/registro?destino=${encodeURIComponent(DESTINO_TRAS_AUTH)}`);
      return;
    }
    void suscribirse();
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

        <button
          onClick={alPulsarSuscribirme}
          disabled={procesando || cargando}
          className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {procesando ? "Redirigiendo a Stripe…" : "Suscribirme"}
        </button>

        {!cargando && !estaAutenticado && (
          <p className="mt-3 text-sm text-slate-500">
            ¿Ya tienes cuenta?{" "}
            <button
              onClick={() => navigate(`/login?destino=${encodeURIComponent(DESTINO_TRAS_AUTH)}`)}
              className="font-medium text-indigo-600 hover:underline"
            >
              Inicia sesión
            </button>
          </p>
        )}

        <button
          onClick={() => navigate(estaAutenticado ? "/home" : "/")}
          className="mt-3 w-full rounded-lg border border-slate-200 px-4 py-3 font-medium text-slate-600 hover:bg-slate-50"
        >
          Volver mañana
        </button>
      </div>
    </div>
  );
}
