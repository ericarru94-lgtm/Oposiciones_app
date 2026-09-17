import { useEffect, useState } from "react";
import { actualizarConsentimiento, analyticsConfigurado } from "../lib/analytics";

const CLAVE_CONSENTIMIENTO = "aprobox-consentimiento-cookies";

/**
 * Banner de consentimiento de cookies analíticas (RGPD/AEPD: en España
 * hace falta opt-in previo, no basta con avisar). La etiqueta de Google
 * (lib/analytics.ts) se instala siempre vía Consent Mode, pero arranca en
 * "denied" — solo pasa a "granted" (y empieza a escribir cookies) si el
 * visitante pulsa "Aceptar" aquí. "Rechazar" o no decidir nada la deja
 * denegada. La decisión se guarda en localStorage para no volver a
 * preguntar en visitas siguientes.
 */
export function AvisoCookies() {
  const [decision, setDecision] = useState<string | null>(() => localStorage.getItem(CLAVE_CONSENTIMIENTO));

  useEffect(() => {
    if (decision) actualizarConsentimiento(decision === "aceptado");
  }, [decision]);

  if (!analyticsConfigurado() || decision) return null;

  function decidir(valor: "aceptado" | "rechazado") {
    localStorage.setItem(CLAVE_CONSENTIMIENTO, valor);
    setDecision(valor);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-card px-4 py-4 shadow-lg sm:px-6">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 text-sm text-ink sm:flex-row sm:justify-between lg:max-w-5xl xl:max-w-6xl">
        <p className="text-center sm:text-left">
          Usamos cookies analíticas para entender el uso de Aprobox y mejorarlo. Puedes aceptarlas o rechazarlas —
          ver{" "}
          <a href="/cookies" className="underline hover:text-primary">
            Política de cookies
          </a>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => decidir("rechazado")}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-muted hover:text-ink"
          >
            Rechazar
          </button>
          <button
            onClick={() => decidir("aceptado")}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
