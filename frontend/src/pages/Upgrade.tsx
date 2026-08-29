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
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="max-w-md overflow-hidden rounded-3xl bg-card text-center shadow-sm">
        <div className="bg-primary px-8 pb-7 pt-9 text-white">
          <p className="text-4xl">⏳</p>
          <h1 className="mt-3 text-xl font-bold">Has llegado a tu límite diario gratuito</h1>
        </div>
        <div className="p-8">
          <p className="text-sm text-muted">
            El plan gratuito incluye un número limitado de preguntas al día. Hazte premium para practicar sin
            límites, con estadísticas avanzadas y repaso ilimitado.
          </p>

          <div className="mt-6 rounded-xl border border-accent/30 bg-accent/10 p-4 text-left">
            <p className="font-semibold text-ink">⭐ Premium mensual</p>
            <p className="text-sm text-muted">Preguntas ilimitadas · Repaso espaciado sin restricciones</p>
          </div>

          {error && <p className="mt-4 text-sm text-error">{error}</p>}

          <button
            onClick={alPulsarSuscribirme}
            disabled={procesando || cargando}
            className="mt-6 w-full rounded-xl bg-primary px-4 py-3 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {procesando ? "Redirigiendo a Stripe…" : "Suscribirme"}
          </button>

          {!cargando && !estaAutenticado && (
            <p className="mt-3 text-sm text-muted">
              ¿Ya tienes cuenta?{" "}
              <button
                onClick={() => navigate(`/login?destino=${encodeURIComponent(DESTINO_TRAS_AUTH)}`)}
                className="font-medium text-primary hover:underline"
              >
                Inicia sesión
              </button>
            </p>
          )}

          <button
            onClick={() => navigate(estaAutenticado ? "/home" : "/")}
            className="mt-3 w-full rounded-xl border border-line px-4 py-3 font-medium text-muted hover:bg-canvas"
          >
            Volver mañana
          </button>
        </div>
      </div>
    </div>
  );
}
