/**
 * Integración mínima con Google Analytics 4 (gtag.js), cargada solo tras
 * consentimiento explícito — ver components/AvisoCookies.tsx. Sin
 * VITE_GA_MEASUREMENT_ID (dev/test no lo configuran) todo esto es un
 * no-op: no se inyecta ningún script ni se llama a gtag.
 *
 * La primera vista de página la manda gtag.js solo (`config` con su
 * comportamiento por defecto) — no se desactiva, porque en qué momento
 * exacto se llama a `cargarAnalytics()` varía (al aceptar el banner, o
 * ya al cargar la página si el consentimiento venía de una visita
 * anterior) y un `useEffect` que dependa de la ruta actual podría
 * ejecutarse antes de que `gtag` exista todavía. Las vistas siguientes
 * (una por navegación de React Router, que gtag.js no puede ver por sí
 * solo al no recargar el documento) las manda `registrarVistaPagina` a
 * mano en cada cambio de ruta posterior al montaje inicial.
 */
const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let cargado = false;

/** true si hay un Measurement ID configurado (sin él, el resto de funciones no hacen nada). */
export function analyticsConfigurado(): boolean {
  return Boolean(MEASUREMENT_ID);
}

/** Inyecta gtag.js e inicializa el dataLayer. Llamar solo tras consentimiento. */
export function cargarAnalytics() {
  if (cargado || !MEASUREMENT_ID) return;
  cargado = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", MEASUREMENT_ID);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

/** Registra una vista de página. `ruta` incluye el path y la query (p.ej. "/upgrade?checkout=cancelado"). */
export function registrarVistaPagina(ruta: string) {
  if (!cargado || !window.gtag) return;
  window.gtag("event", "page_view", { page_path: ruta });
}

/** Registra un evento propio (p.ej. "sign_up", "suscripcion_premium", "newsletter_alta"). */
export function registrarEvento(nombre: string, parametros?: Record<string, unknown>) {
  if (!cargado || !window.gtag) return;
  window.gtag("event", nombre, parametros);
}
