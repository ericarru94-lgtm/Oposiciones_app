import { useEffect } from "react";

const SITIO = "https://aprobox.es";
const IMAGEN_POR_DEFECTO = `${SITIO}/og-image.png`;
const NOMBRE_SITIO = "Aprobox";

export interface SeoConfig {
  /** Título de la pestaña y de `og:title`/`twitter:title`. No incluyas " — Aprobox": se añade solo. */
  titulo: string;
  descripcion: string;
  /** Ruta con "/" inicial (p.ej. "/contacto"); se combina con el dominio para canonical/og:url. */
  ruta: string;
  /** URL absoluta de la imagen para compartir; por defecto la tarjeta de marca en /og-image.png. */
  imagen?: string;
  /** `og:type` — "website" para casi todo; "article" si algún día hay contenido tipo blog/post. */
  tipo?: "website" | "article";
  /** true para páginas transaccionales/de un solo uso (confirmar/baja de newsletter) que no deben indexarse. */
  noIndexar?: boolean;
}

function fijarMeta(selector: string, atributo: "name" | "property", valor: string, contenido: string) {
  let etiqueta = document.head.querySelector<HTMLMetaElement>(selector);
  if (!etiqueta) {
    etiqueta = document.createElement("meta");
    etiqueta.setAttribute(atributo, valor);
    document.head.appendChild(etiqueta);
  }
  etiqueta.setAttribute("content", contenido);
}

function fijarCanonical(url: string) {
  let enlace = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!enlace) {
    enlace = document.createElement("link");
    enlace.setAttribute("rel", "canonical");
    document.head.appendChild(enlace);
  }
  enlace.setAttribute("href", url);
}

/**
 * Actualiza título, meta description, canonical y las etiquetas Open
 * Graph/Twitter Card al montar cada página pública — no hay SSR/prerender
 * en este proyecto (Vite + React SPA servida como estática en Vercel), así
 * que esto es lo que ve Google al renderizar la página (sí ejecuta JS) y
 * lo que queda en el DOM en todo momento; un crawler de redes sociales que
 * NO ejecute JS (Facebook/Twitter/Slack al generar la vista previa de un
 * enlace) seguirá viendo los valores estáticos de `index.html` sea cual
 * sea la ruta — limitación conocida de una SPA sin prerender, fuera del
 * alcance de este encargo.
 */
export function useSeo({
  titulo,
  descripcion,
  ruta,
  imagen = IMAGEN_POR_DEFECTO,
  tipo = "website",
  noIndexar = false,
}: SeoConfig) {
  useEffect(() => {
    const tituloCompleto = `${titulo} | ${NOMBRE_SITIO}`;
    const url = `${SITIO}${ruta}`;

    document.title = tituloCompleto;
    fijarMeta('meta[name="description"]', "name", "description", descripcion);
    fijarMeta('meta[name="robots"]', "name", "robots", noIndexar ? "noindex" : "index, follow");
    fijarCanonical(url);

    fijarMeta('meta[property="og:type"]', "property", "og:type", tipo);
    fijarMeta('meta[property="og:site_name"]', "property", "og:site_name", NOMBRE_SITIO);
    fijarMeta('meta[property="og:title"]', "property", "og:title", tituloCompleto);
    fijarMeta('meta[property="og:description"]', "property", "og:description", descripcion);
    fijarMeta('meta[property="og:url"]', "property", "og:url", url);
    fijarMeta('meta[property="og:image"]', "property", "og:image", imagen);

    fijarMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
    fijarMeta('meta[name="twitter:title"]', "name", "twitter:title", tituloCompleto);
    fijarMeta('meta[name="twitter:description"]', "name", "twitter:description", descripcion);
    fijarMeta('meta[name="twitter:image"]', "name", "twitter:image", imagen);
  }, [titulo, descripcion, ruta, imagen, tipo, noIndexar]);
}
