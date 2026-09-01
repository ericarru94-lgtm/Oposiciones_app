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
// v2: forzado tras el bug donde un usuario del plan gratuito completó el
// examen oficial — la caché stale-while-revalidate podía servir de
// inmediato una pestaña/PWA que llevaba abierta desde antes del gate de
// premium, sin la comprobación nueva. La lógica de gate en sí vive en el
// backend (rechaza con 403 con o sin este cambio); esto es defensa en
// profundidad para que las pestañas ya abiertas recojan el shell nuevo en
// su próxima navegación en vez de quedarse indefinidamente en el antiguo.
const CACHE_VERSION = "v2";
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

/**
 * Recordatorio diario de repaso (Web Push). El payload lo manda el backend
 * como JSON (ver lib/enviarRecordatorios.ts): { title, body, url }. Si el
 * evento no trae datos parseables, se usa un aviso genérico en vez de
 * fallar silenciosamente sin mostrar nada.
 */
self.addEventListener("push", (event) => {
  let datos = { title: "Aprobox", body: "Tienes repaso pendiente hoy.", url: "/repasar-hoy" };
  try {
    if (event.data) datos = { ...datos, ...event.data.json() };
  } catch {
    // payload no-JSON: se mantiene el aviso genérico de arriba.
  }

  event.waitUntil(
    self.registration.showNotification(datos.title, {
      body: datos.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: datos.url },
    })
  );
});

/** Al pulsar la notificación: enfoca una pestaña de Aprobox ya abierta si existe, o abre una nueva en la URL del aviso. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/repasar-hoy";

  event.waitUntil(
    (async () => {
      const clientesAbiertos = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const yaAbierto = clientesAbiertos.find((c) => new URL(c.url).origin === self.location.origin);
      if (yaAbierto) {
        await yaAbierto.focus();
        if ("navigate" in yaAbierto) await yaAbierto.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })()
  );
});
