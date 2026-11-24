// PI-16 · Política de dominios y configuración segura de las herramientas web
// de Anthropic (web_search_20250305 y web_fetch_20250910).
//
// Capas (cada una solo puede RESTRINGIR, nunca ampliar la anterior):
//   1. Consola de Anthropic (organización): fuera del código.
//   2. Bloqueo global (WEB_DOMAIN_POLICY.common.blocked).
//   3. Bloqueo por agente (WEB_DOMAIN_POLICY.agents[id].blocked).
//   4. Permitidos de un paso del plan (opcional): sustituyen a la lista de
//      bloqueo en ESA petición (la API no admite las dos a la vez) y solo se
//      aceptan si ninguno toca un dominio bloqueado en las capas 2 y 3.
//
// Las listas están VACÍAS a propósito: su contenido lo decide el
// administrador (no se inventan dominios). Con listas vacías la única
// restricción efectiva es url_sources (solo URLs de resultados de web_search).

import { SERVER_TOOLS, type ServerToolId } from "./config";

export interface DomainLists {
  blocked: readonly string[];
}

export const WEB_DOMAIN_POLICY: { common: DomainLists; agents: Readonly<Record<string, DomainLists>> } = {
  common: { blocked: [] },
  agents: { marcus: { blocked: [] } },
};

/**
 * Fuentes de las que web_fetch puede leer: SOLO resultados de web_search de la
 * misma conversación. Ni mensajes de usuario (encargo, tarea de Alex, fichas
 * del CRM), ni resultados de herramientas propias (crm.read…), ni enlaces de
 * páginas leídas con web_fetch.
 * Compatibilidad documentada con web_fetch_20250910; aceptación real con
 * anthropic-version 2023-06-01 PENDIENTE DE PRUEBA (staging).
 */
export const WEB_FETCH_URL_SOURCES = {
  user_input: { type: "none" },
  client_tool_results: { type: "none" },
  server_tool_results: { type: "only", tools: [{ type: "tool_reference", name: "web_search" }] },
} as const;

const RESERVED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".invalid", ".lan", ".home", ".corp"];

/** Motivo si la entrada de una lista de dominios no es válida; null si lo es. */
export function domainEntryError(entry: string): string | null {
  if (typeof entry !== "string" || entry.length === 0) return "entrada vacía";
  if (entry !== entry.trim() || entry !== entry.toLowerCase()) return `«${entry}»: solo minúsculas y sin espacios`;
  if (!/^[\x21-\x7e]+$/.test(entry)) return `«${entry}»: solo caracteres ASCII (riesgo de homógrafos)`;
  if (entry.includes("://")) return `«${entry}»: sin esquema`;
  if (/[/*?#:@\[\]]/.test(entry)) return `«${entry}»: solo el dominio (sin ruta, puerto, comodines ni credenciales)`;
  if (entry.length > 253) return `«${entry}»: demasiado largo`;
  if (!entry.includes(".")) return `«${entry}»: necesita un dominio con punto`;
  if (/^[\d.]+$/.test(entry)) return `«${entry}»: no se admiten direcciones IP`;
  if (entry === "localhost" || RESERVED_SUFFIXES.some((s) => entry.endsWith(s))) return `«${entry}»: dominio local o reservado`;
  const labels = entry.split(".");
  if (labels.some((l) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return `«${entry}»: etiqueta de dominio no válida`;
  return null;
}

/** ¿host coincide con la entrada (igual o subdominio)? Mismo criterio que la API. */
export function domainCovers(entry: string, host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === entry || h.endsWith(`.${entry}`);
}

function uniq(list: readonly string[]): string[] {
  return [...new Set(list)];
}

export type DomainFilter = { blocked_domains: string[] } | { allowed_domains: string[] } | Record<string, never>;

/**
 * Filtro de dominios de UNA petición. Lanza un error (fallo cerrado) si alguna
 * lista es inválida o si los permitidos del paso ampliarían lo bloqueado.
 */
export function domainFilterFor(agentId: string, stepAllowed?: readonly string[] | null,
  policy: typeof WEB_DOMAIN_POLICY = WEB_DOMAIN_POLICY): DomainFilter {
  const blocked = uniq([...policy.common.blocked, ...(policy.agents[agentId]?.blocked ?? [])]);
  for (const e of blocked) {
    const err = domainEntryError(e);
    if (err) throw new Error(`Lista de bloqueo no válida: ${err}.`);
  }
  if (stepAllowed && stepAllowed.length > 0) {
    const allowed = uniq(stepAllowed);
    for (const e of allowed) {
      const err = domainEntryError(e);
      if (err) throw new Error(`Dominios permitidos del paso no válidos: ${err}.`);
      // Un permitido no puede estar bloqueado ni CONTENER un dominio bloqueado
      // (permitir example.com abriría también bloqueado.example.com).
      const clash = blocked.find((b) => domainCovers(b, e) || domainCovers(e, b));
      if (clash) throw new Error(`El paso no puede permitir «${e}»: choca con el dominio bloqueado «${clash}».`);
    }
    return { allowed_domains: allowed };
  }
  return blocked.length > 0 ? { blocked_domains: blocked } : {};
}

export interface WebToolOptions {
  agentId: string;
  stepAllowedDomains?: readonly string[] | null;
  policy?: typeof WEB_DOMAIN_POLICY;
}

/**
 * Herramientas de servidor de una ejecución. Deterministas: la misma entrada da
 * siempre la misma lista (Sonnet 5.5 rechaza que cambie dentro de una ejecución).
 * Fallo cerrado: web.fetch sin web.search no se permite (url_sources nombra a
 * web_search y la API exige que esté en tools).
 */
export function secureServerTools(allowed: readonly ServerToolId[], opts: WebToolOptions) {
  const search = allowed.includes("web.search");
  const fetch = allowed.includes("web.fetch");
  if (fetch && !search) {
    throw new Error("web.fetch requiere web.search: la lectura solo puede usar URLs de resultados de búsqueda.");
  }
  if (!search && !fetch) return [];
  const filter = domainFilterFor(opts.agentId, opts.stepAllowedDomains, opts.policy);
  const tools: Record<string, unknown>[] = [{ ...SERVER_TOOLS["web.search"], ...filter }];
  if (fetch) tools.push({ ...SERVER_TOOLS["web.fetch"], ...filter, url_sources: WEB_FETCH_URL_SOURCES });
  assertSecureServerTools(tools);
  return tools;
}

/** Comprobación final de la petición: nunca se envía una lectura sin protección. */
export function assertSecureServerTools(tools: readonly Record<string, unknown>[]): void {
  const names = tools.map((t) => t.name);
  for (const t of tools) {
    if ("allowed_domains" in t && "blocked_domains" in t) throw new Error("allowed_domains y blocked_domains no se pueden combinar.");
    if (t.name === "web_fetch") {
      if (t.type !== "web_fetch_20250910") throw new Error("Versión de web_fetch no prevista.");
      if (JSON.stringify(t.url_sources) !== JSON.stringify(WEB_FETCH_URL_SOURCES)) {
        throw new Error("web_fetch sin la política url_sources: no se envía (fallo cerrado).");
      }
      if (!names.includes("web_search")) throw new Error("web_fetch sin web_search en la misma petición.");
    }
    if (t.name === "web_search" && t.type !== "web_search_20250305") throw new Error("Versión de web_search no prevista.");
  }
}
