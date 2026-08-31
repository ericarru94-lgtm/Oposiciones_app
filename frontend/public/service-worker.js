/**
 * Service worker mínimo para Aprobox: no pretende un funcionamiento offline
 * completo (los datos de tests/progreso siempre vienen del backend, que no
 * es cacheable de forma sensata), pero garantiza que la aplicación en sí
 * (el "shell": HTML, JS, CSS, iconos) siga cargando sin conexión una vez que
 * el usuario la ha visitado al menos una vez con red, con una pantalla de
 * aviso simple (`offline.html`) como último recurso si ni eso está en caché.
 *
 * Estrategias:
 * - Navegación (cargar una URL de la SPA): red primero, caché de la propia
 *   página si falla, y si tampoco está en caché, `offline.html`.
 * - Resto de peticiones GET del mismo origen (JS/CSS/iconos/manifest):
 *   stale-while-revalidate — se sirve caché al instante si existe y se
 *   actualiza en segundo plano; si no hay caché, se pide a red y se guarda.
 * - Peticiones a otro origen (la API del backend en Render): nunca se
 *   interceptan ni se cachean, se dejan pasar tal cual a la red.
 *
 * Subir CACHE_VERSION invalida toda la caché anterior en el siguiente
 * despliegue (el activate de abajo borra las cachés con nombre distinto).
 */
const CACHE_VERSION = "v1";
const CACHE_NAME = `aprobox-shell-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

const RUTAS_INICIALES = ["/", "/offline.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(RUTAS_INICIALES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

async function guardarEnCache(request, respuesta) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, respuesta.clone());
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // llamadas a la API: sin interceptar

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const respuesta = await fetch(request);
          // Se espera a que termine de escribirse en caché ANTES de responder:
          // si no, la promesa de respondWith podría resolverse (y el SW
          // quedar libre para que el navegador lo mate) sin que cache.put
          // haya terminado, dejando el asset sin cachear pese a haberse
          // descargado con éxito.
          await guardarEnCache(request, respuesta);
          return respuesta;
        } catch {
          return (await caches.match(request)) || (await caches.match("/")) || caches.match(OFFLINE_URL);
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cacheada = await caches.match(request);
      if (cacheada) {
        // Revalidación en segundo plano: no bloquea la respuesta (se sirve
        // la caché al instante), pero se registra con waitUntil para que el
        // navegador no mate el service worker antes de que cache.put acabe.
        event.waitUntil(
          fetch(request)
            .then((respuesta) => (respuesta.ok ? guardarEnCache(request, respuesta) : undefined))
            .catch(() => undefined)
        );
        return cacheada;
      }
      const respuesta = await fetch(request);
      if (respuesta.ok) await guardarEnCache(request, respuesta);
      return respuesta;
    })()
  );
});
