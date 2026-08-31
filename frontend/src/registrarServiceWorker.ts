/**
 * Registra el service worker (public/service-worker.js) solo en build de
 * producción: en desarrollo interferiría con el hot module reload de Vite
 * (serviría JS cacheado en vez del último cambio), y en el modo E2E de
 * Playwright se sirve con `vite dev`, así que tampoco se registra ahí — ver
 * playwright.config.ts, que arranca el frontend con `--mode e2e` sobre el
 * servidor de desarrollo, nunca sobre un build.
 */
export function registrarServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => {
      console.error("No se pudo registrar el service worker de Aprobox:", err);
    });
  });
}
