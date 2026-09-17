/**
 * Integración con Google Analytics 4 + Google Ads (gtag.js), usando el
 * "Consent Mode" oficial de Google en vez de cargar el script solo tras
 * aceptar el banner — ver components/AvisoCookies.tsx. Sin
 * VITE_GA_MEASUREMENT_ID (dev/test no lo configuran) todo esto es un
 * no-op: no se inyecta ningún script ni se llama a gtag.
 *
 * Por qué Consent Mode y no "cargar el script solo si acepta": la
 * verificación automática de la etiqueta de conversión de Google Ads (y
 * cualquier crawler) visita la web sin pulsar el banner, así que un script
 * que solo aparece tras un clic real nunca se detecta. Con Consent Mode la
 * etiqueta se instala siempre, con el consentimiento en "denied" por
 * defecto — sin escribir cookies ni almacenar nada identificable, que es
 * lo que exige RGPD/AEPD — y solo pasa a "granted" cuando el usuario
 * acepta en AvisoCookies. Google detecta la etiqueta en ambos casos.
 *
 * La primera vista de página la manda gtag.js solo (`config` con su
 * comportamiento por defecto) — no se desactiva, porque en qué momento
 * exacto se llama a `inicializarAnalytics()` varía (al aceptar el banner,
 * o ya al cargar la página si el consentimiento venía de una visita
 * anterior) y un `useEffect` que dependa de la ruta actual podría
 * ejecutarse antes de que `gtag` exista todavía. Las vistas siguientes
 * (una por navegación de React Router, que gtag.js no puede ver por sí
 * solo al no recargar el documento) las manda `registrarVistaPagina` a
 * mano en cada cambio de ruta posterior al montaje inicial.
 */
const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
const ADS_ID = import.meta.env.VITE_GOOGLE_ADS_ID as string | undefined;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let inicializado = false;

/** true si hay un Measurement ID configurado (sin él, el resto de funciones no hacen nada). */
export function analyticsConfigurado(): boolean {
  return Boolean(MEASUREMENT_ID);
}

/**
 * Inyecta gtag.js, inicializa el dataLayer y fija el consentimiento por
 * defecto en "denied". Se llama siempre al arrancar la app (main.tsx),
 * independientemente de si el usuario ya decidió algo sobre el banner de
 * cookies.
 */
export function inicializarAnalytics() {
  if (inicializado || !MEASUREMENT_ID) return;
  inicializado = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
  };

  window.gtag("consent", "default", {
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });

  window.gtag("js", new Date());
  window.gtag("config", MEASUREMENT_ID);
  if (ADS_ID) window.gtag("config", ADS_ID);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

/** Actualiza el consentimiento tras la decisión del usuario en AvisoCookies. */
export function actualizarConsentimiento(otorgado: boolean) {
  if (!window.gtag) return;
  const estado = otorgado ? "granted" : "denied";
  window.gtag("consent", "update", {
    ad_storage: estado,
    analytics_storage: estado,
    ad_user_data: estado,
    ad_personalization: estado,
  });
}

/** Registra una vista de página. `ruta` incluye el path y la query (p.ej. "/upgrade?checkout=cancelado"). */
export function registrarVistaPagina(ruta: string) {
  if (!inicializado || !window.gtag) return;
  window.gtag("event", "page_view", { page_path: ruta });
}

/** Registra un evento propio (p.ej. "sign_up", "suscripcion_premium", "newsletter_alta"). */
export function registrarEvento(nombre: string, parametros?: Record<string, unknown>) {
  if (!inicializado || !window.gtag) return;
  window.gtag("event", nombre, parametros);
}
