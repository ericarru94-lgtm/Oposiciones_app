import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { crearCheckoutSession } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import { ComparativaPlanes } from "../components/ComparativaPlanes";

/** A dónde volver tras el login/registro de Clerk disparado desde "Suscribirme". */
const DESTINO_TRAS_AUTH = "/upgrade?continuar=1";

/** Copy contextual según qué gate te trajo a Upgrade (ver `motivo` en la URL). */
const MOTIVOS: Record<string, { icono: string; titulo: string; texto: string; volverTexto: string }> = {
  "examen-oficial": {
    icono: "🏛️",
    titulo: "El examen oficial es exclusivo de Premium",
    texto:
      "El simulacro con la estructura y el tiempo real del examen oficial solo está disponible en el plan premium. Hazte premium para practicarlo.",
    volverTexto: "Seguir practicando",
  },
  "simulacro-configuracion": {
    icono: "🎓",
    titulo: "Más preguntas y más tiempo, con Premium",
    texto:
      "El simulacro libre es gratis para todos con su configuración básica (10 preguntas, 15 min). Elegir un número de preguntas o un tiempo distinto es exclusivo del plan premium.",
    volverTexto: "Seguir con la configuración básica",
  },
};
const MOTIVO_POR_DEFECTO = {
  icono: "⏳",
  titulo: "Has llegado a tu límite diario gratuito",
  texto:
    "El plan gratuito incluye 2 tests al día (Practicar tema o Repasar hoy, en total). Hazte premium para practicar sin límites.",
  volverTexto: "Volver mañana",
};

export function Upgrade() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { estaAutenticado, cargando, getToken, usuario } = useSession();
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const yaContinuado = useRef(false);
  const { icono, titulo, texto, volverTexto } = MOTIVOS[searchParams.get("motivo") ?? ""] ?? MOTIVO_POR_DEFECTO;

  async function suscribirse() {
    setError(null);
    setProcesando(true);
    try {
      const token = await getToken();
      const respuesta = await crearCheckoutSession(token as string);
      if ("yaActivo" in respuesta) {
        // El backend detectó una suscripción activa preexistente para este
        // email (p.ej. tras el bug de cuenta duplicada al migrar Clerk) y
        // la adoptó sin cobrar de nuevo. Recarga a Home para que la sesión
        // recoja el plan premium ya activo.
        window.location.href = "/home?checkout=success";
        return;
      }
      window.location.href = respuesta.url;
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
    <div className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto max-w-md overflow-hidden rounded-3xl bg-card text-center shadow-sm">
        <div className="bg-primary px-8 pb-7 pt-9 text-white">
          <p className="text-4xl">{icono}</p>
          <h1 className="mt-3 text-xl font-bold">{titulo}</h1>
        </div>
        <div className="p-8">
          <p className="text-sm text-muted">{texto}</p>

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
            {volverTexto}
          </button>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-3xl">
        <ComparativaPlanes />
      </div>
    </div>
  );
}
