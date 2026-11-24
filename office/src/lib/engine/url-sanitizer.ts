// PI-16 · Saneador de URLs del CRM.
//
// Acciones: R = rechazar (no se guarda nada), N = normalizar, M = marcar para
// revisión (se guarda y se avisa). El histórico NUNCA se modifica: para mostrar
// registros antiguos al modelo se usa displayUrl/displayText (recorte en la
// presentación, sin tocar la base de datos).
//
// Ninguna URL del CRM ni del texto libre es una fuente de lectura: web_fetch
// solo lee resultados de web_search (url_sources). El saneador es una capa
// adicional de higiene y defensa en profundidad.

export type UrlKind = "website" | "source" | "text";

export type UrlVerdict =
  | { ok: true; url: string; flags: string[] }
  | { ok: false; reason: string };

const LIMITS: Record<UrlKind, number> = { website: 200, source: 300, text: 300 };
const RESERVED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".invalid", ".lan", ".home", ".corp"];
// Segmento de ruta con aspecto de datos codificados (base64/base64url/hex largos).
const ENCODED_SEGMENT = /^(?:[A-Za-z0-9+/_=-]{41,}|[0-9a-fA-F]{41,})$/;

function isIpHost(host: string): boolean {
  return host.startsWith("[") || host.includes(":") || /^\d+(?:\.\d+){0,3}$/.test(host) || /^0x[0-9a-f]+$/i.test(host);
}

function looksEncoded(segment: string): boolean {
  let s = segment;
  try {
    s = decodeURIComponent(segment);
  } catch {
    return true; // codificación rota: sospechosa
  }
  if (!ENCODED_SEGMENT.test(s)) return false;
  // Palabras normales con guiones (slugs) no cuentan: exige mezcla de clases.
  const classes = [/[a-z]/, /[A-Z]/, /\d/].filter((r) => r.test(s)).length;
  return classes >= 2 || /^[0-9a-fA-F]+$/.test(s);
}

/** Valida y normaliza una URL según su campo. */
export function sanitizeUrl(raw: string, kind: UrlKind): UrlVerdict {
  const flags: string[] = [];
  if (typeof raw !== "string" || raw.trim().length === 0) return { ok: false, reason: "URL vacía" };
  if (/[^\x21-\x7e]/.test(raw.trim())) flags.push("no_ascii");
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "URL mal formada" };
  }
  if (kind === "website" ? u.protocol !== "https:" : u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, reason: kind === "website" ? "la web debe usar https" : "solo se admiten http y https" };
  }
  if (u.username || u.password) return { ok: false, reason: "la URL contiene credenciales" };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || isIpHost(host)) return { ok: false, reason: "no se admiten direcciones IP" };
  if (host === "localhost" || RESERVED_SUFFIXES.some((s) => host.endsWith(s)) || !host.includes(".")) {
    return { ok: false, reason: "dominio local o reservado" };
  }
  const allowedPorts = kind === "website" ? [""] : ["", "80"]; // 443 y 80 por defecto ya llegan vacíos
  if (!allowedPorts.includes(u.port)) return { ok: false, reason: `puerto no permitido (${u.port})` };
  if (host.split(".").some((l) => l.startsWith("xn--"))) flags.push("punycode");
  if (host.split(".").length > 4) flags.push("subdominio_profundo");

  if (u.hash) {
    u.hash = "";
  }
  if (u.search) {
    u.search = "";
    if (kind !== "website") flags.push("parametros_eliminados");
  }
  const segments = u.pathname.split("/").filter(Boolean);
  if (segments.some(looksEncoded)) {
    if (kind === "source") flags.push("ruta_codificada");
    else return { ok: false, reason: "la ruta contiene datos codificados" };
  }
  // Se conserva la ruta tal cual (la comparación de duplicados usa dedupeKey).
  const url = `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  if (url.length > LIMITS[kind]) return { ok: false, reason: `URL demasiado larga (máximo ${LIMITS[kind]})` };
  return { ok: true, url, flags };
}

/** Clave para detectar duplicados: dominio sin «www.» y ruta sin barra final. */
export function dedupeKey(url: string): string {
  const u = new URL(url);
  return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;

export type TextVerdict = { ok: true; text: string; flags: string[] } | { ok: false; reason: string };

/** Valida las URLs dentro de un texto libre y las normaliza (sin parámetros ni fragmentos). */
export function sanitizeText(text: string): TextVerdict {
  const flags = new Set<string>();
  let error: string | null = null;
  const out = text.replace(URL_IN_TEXT, (m) => {
    const trail = /[.,;:!?]+$/.exec(m)?.[0] ?? "";
    const candidate = trail ? m.slice(0, -trail.length) : m;
    const v = sanitizeUrl(candidate, "text");
    if (!v.ok) {
      error ??= `${v.reason} (${candidate.slice(0, 60)}${candidate.length > 60 ? "…" : ""})`;
      return m;
    }
    v.flags.forEach((f) => flags.add(f));
    return v.url + trail;
  });
  return error ? { ok: false, reason: error } : { ok: true, text: out, flags: [...flags] };
}

/** Presentación al modelo de una URL guardada (histórico intacto en la base de datos). */
export function displayUrl(raw: string | null | undefined, kind: UrlKind = "source"): string {
  if (!raw) return "—";
  const v = sanitizeUrl(raw, kind === "website" ? "source" : kind);
  return v.ok ? v.url : "[URL retirada]";
}

/** Presentación de un texto guardado: URLs recortadas o retiradas. */
export function displayText(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(URL_IN_TEXT, (m) => {
    const trail = /[.,;:!?]+$/.exec(m)?.[0] ?? "";
    const candidate = trail ? m.slice(0, -trail.length) : m;
    const v = sanitizeUrl(candidate, "text");
    return (v.ok ? v.url : "[URL retirada]") + trail;
  });
}

/** Lista de fuentes guardada como «a | b | c». */
export function displaySources(joined: string | null | undefined): string {
  if (!joined) return "—";
  return joined.split(" | ").map((s) => (/^https?:\/\//i.test(s.trim()) ? displayUrl(s.trim()) : displayText(s))).join(" | ");
}
