// PI-16 · Auditoría de las herramientas web de Anthropic (se ejecutan fuera de
// nuestro gateway; solo podemos revisarlas DESPUÉS de cada llamada).
//
// Se registra lo mínimo para detectar abusos SIN guardar datos sensibles:
// nunca URLs completas, consultas ni valores de parámetros. Solo dominios,
// huellas HMAC (con clave del servidor), longitudes y recuentos.
//
// Gravedad: info (registro), alert (alerta visible) y stop (parada inmediata
// de la misión, aplicada por el motor).

import { createHmac } from "node:crypto";
import type { ContentBlock, Message } from "./types";
import { domainCovers, WEB_DOMAIN_POLICY } from "./web-policy";

export type WebSeverity = "info" | "alert" | "stop";

export interface WebToolEvent {
  tool: "search" | "fetch";
  call_index: number;
  /** Dominio pedido (fetch) o null (search). */
  domain: string | null;
  /** Dominio de la URL devuelta en el resultado (para detectar redirecciones). */
  result_domain: string | null;
  path_hmac: string | null;
  url_length: number | null;
  query_param_count: number | null;
  query_param_length: number | null;
  query_hmac: string | null;
  query_length: number | null;
  error_code: string | null;
  in_search_results: boolean | null;
  severity: WebSeverity;
  reasons: string[];
  key_id: string;
}

export interface WebAuditResult {
  events: WebToolEvent[];
  /** Intentos de lectura de ESTA respuesta (también los fallidos). */
  fetchAttempts: number;
  /** Errores de herramientas web de ESTA respuesta. */
  webErrors: number;
  /** Motivo de parada inmediata, si lo hay. */
  stop: string | null;
}

export interface AuditKey {
  id: string;
  secret: string;
}

export type AuditKeyStatus = { ok: true; key: AuditKey } | { ok: false; reason: "missing" | "malformed" };

/**
 * Clave HMAC del servidor (WEB_AUDIT_HMAC_KEY + WEB_AUDIT_HMAC_KEY_ID). Sin una
 * clave válida no se auditan las herramientas web y el motor no las ofrece
 * (fallo cerrado). Nunca se inventa una clave ni se registra su valor.
 * Válida: 32–256 caracteres ASCII visibles, sin espacios. Identificador: 1–20
 * caracteres [A-Za-z0-9_-] (el mismo formato que exige web_tool_events.key_id).
 */
export function auditKeyStatus(env: NodeJS.ProcessEnv = process.env): AuditKeyStatus {
  const secret = env.WEB_AUDIT_HMAC_KEY;
  if (secret === undefined || secret === "") return { ok: false, reason: "missing" };
  if (secret.length < 32 || secret.length > 256 || !/^[\x21-\x7e]+$/.test(secret)) return { ok: false, reason: "malformed" };
  const id = env.WEB_AUDIT_HMAC_KEY_ID ?? "k1";
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) return { ok: false, reason: "malformed" };
  return { ok: true, key: { id, secret } };
}

/** Atajo: la clave o null (sin decir por qué). */
export function auditKeyFromEnv(env: NodeJS.ProcessEnv = process.env): AuditKey | null {
  const s = auditKeyStatus(env);
  return s.ok ? s.key : null;
}

const hmac = (key: AuditKey, value: string) => createHmac("sha256", key.secret).update(value).digest("hex");

const STOP_ERRORS = new Set(["url_not_in_prior_context"]);
const ALERT_ERRORS = new Set(["url_not_allowed", "max_uses_exceeded", "too_many_requests", "invalid_tool_input", "url_too_long", "query_too_long"]);
const PRIVATE_HOST = /^(localhost|.*\.(localhost|local|internal|localdomain|invalid)|\d+(\.\d+){0,3}|\[.*\]|.*:.*)$/i;
const ENCODED = /[A-Za-z0-9+/_=-]{41,}|%[0-9a-f]{2}.*%[0-9a-f]{2}.*%[0-9a-f]{2}/i;

function parse(url: unknown): URL | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Forma comparable de una URL (dominio en minúsculas, sin fragmento ni barra final). */
export function comparableUrl(url: string): string {
  const u = parse(url);
  if (!u) return url;
  u.hash = "";
  return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
}

/** URLs devueltas por web_search en la conversación (mensajes anteriores + respuesta actual). */
export function searchResultUrls(messages: readonly Message[], current: readonly ContentBlock[]): Set<string> {
  const out = new Set<string>();
  const blocks = [...messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])), ...current];
  for (const b of blocks) {
    if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
    for (const r of b.content as Array<Record<string, unknown>>) {
      if (typeof r?.url === "string") out.add(comparableUrl(r.url));
    }
  }
  return out;
}

function priorServerUses(messages: readonly Message[]): ContentBlock[] {
  return messages.flatMap((m) => (m.role === "assistant" && Array.isArray(m.content) ? m.content : []))
    .filter((b) => b.type === "server_tool_use");
}

function priorFetchHosts(messages: readonly Message[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of priorServerUses(messages)) {
    if (b.name !== "web_fetch") continue;
    const u = parse((b.input as Record<string, unknown> | undefined)?.url);
    if (u) out.set(u.hostname.toLowerCase(), (out.get(u.hostname.toLowerCase()) ?? 0) + 1);
  }
  return out;
}

function priorQueryHashes(messages: readonly Message[], key: AuditKey): Set<string> {
  const out = new Set<string>();
  for (const b of priorServerUses(messages)) {
    const q = (b.input as Record<string, unknown> | undefined)?.query;
    if (b.name === "web_search" && typeof q === "string") out.add(hmac(key, q.trim().toLowerCase()));
  }
  return out;
}

const SAFE_DOMAIN = /^[a-z0-9.-]{1,253}$/;

function errorCodeOf(block: ContentBlock | undefined): string | null {
  if (!block) return null;
  const c = block.content as Record<string, unknown> | unknown[] | undefined;
  if (c && !Array.isArray(c) && typeof c === "object" && typeof (c as Record<string, unknown>).error_code === "string") {
    return (c as Record<string, unknown>).error_code as string;
  }
  return null;
}

/**
 * Revisa los bloques de herramientas web de una respuesta. Pura: no escribe nada.
 * `priorMessages` = conversación ANTES de esta respuesta; `domainCounts` acumula
 * lecturas por dominio en la ejecución (lo mantiene el llamador).
 */
export function auditWebResponse(input: {
  content: readonly ContentBlock[];
  priorMessages: readonly Message[];
  callIndex: number;
  agentId: string;
  key: AuditKey;
  domainCounts?: Map<string, number>;
  seenQueries?: Set<string>;
  usageFetchRequests?: number;
}): WebAuditResult {
  const { content, key } = input;
  const results = new Map(content.filter((b) => typeof b.tool_use_id === "string").map((b) => [b.tool_use_id as string, b]));
  const searchUrls = searchResultUrls(input.priorMessages, content);
  const blocked = [...WEB_DOMAIN_POLICY.common.blocked, ...(WEB_DOMAIN_POLICY.agents[input.agentId]?.blocked ?? [])];
  // Contadores de la ejecución reconstruidos desde la conversación guardada
  // (resisten reinicios del worker; no dependen de estado aparte).
  const domainCounts = input.domainCounts ?? priorFetchHosts(input.priorMessages);
  const seenQueries = input.seenQueries ?? priorQueryHashes(input.priorMessages, key);
  const events: WebToolEvent[] = [];
  let fetchAttempts = 0;
  let webErrors = 0;
  let stop: string | null = null;

  for (const b of content) {
    if (b.type !== "server_tool_use") continue;
    const name = b.name;
    const inputArgs = (b.input ?? {}) as Record<string, unknown>;
    const result = results.get(b.id as string);
    const error = errorCodeOf(result);
    if (error) webErrors += 1;
    const reasons: string[] = [];
    const level = { severity: "info" as WebSeverity, stopReason: null as string | null };
    const raise = (s: WebSeverity, why: string) => {
      reasons.push(why);
      if (s === "stop") {
        level.severity = "stop";
        level.stopReason ??= why;
      } else if (s === "alert" && level.severity === "info") {
        level.severity = "alert";
      }
    };

    if (name === "web_search") {
      const q = typeof inputArgs.query === "string" ? inputArgs.query : "";
      const qh = hmac(key, q.trim().toLowerCase());
      if (seenQueries.has(qh)) raise("alert", "consulta repetida");
      seenQueries.add(qh);
      if (q.length > 200) raise("alert", "consulta muy larga");
      if (ENCODED.test(q)) raise("alert", "consulta con aspecto de datos codificados");
      if (error && ALERT_ERRORS.has(error)) raise("alert", `error ${error}`);
      events.push({
        tool: "search", call_index: input.callIndex, domain: null, result_domain: null, path_hmac: null, url_length: null,
        query_param_count: null, query_param_length: null, query_hmac: qh, query_length: q.length,
        error_code: error, in_search_results: null, severity: level.severity, reasons, key_id: key.id,
      });
      continue;
    }
    if (name !== "web_fetch") continue;

    fetchAttempts += 1;
    const rawUrl = typeof inputArgs.url === "string" ? inputArgs.url : "";
    const u = parse(rawUrl);
    const rawHost = u ? u.hostname.toLowerCase() : null;
    // Solo se guarda un dominio con forma segura (nunca texto arbitrario).
    const host = rawHost && SAFE_DOMAIN.test(rawHost) ? rawHost : null;
    const params = u ? [...u.searchParams] : [];
    const paramLength = params.reduce((n, [k, v]) => n + k.length + v.length, 0);
    const inSearch = rawUrl.length > 0 && searchUrls.has(comparableUrl(rawUrl));
    const resultContent = result?.content as Record<string, unknown> | undefined;
    const resultUrl = parse(resultContent && !Array.isArray(resultContent) ? resultContent.url : undefined);
    const rawResultHost = resultUrl ? resultUrl.hostname.toLowerCase() : null;
    const resultHost = rawResultHost && SAFE_DOMAIN.test(rawResultHost) ? rawResultHost : null;

    if (!u || !host) raise("alert", "URL o dominio no interpretable");
    if (rawResultHost && !resultHost) raise("alert", "dominio final no interpretable");
    if (!inSearch) raise("stop", "lectura de una URL que no salió en los resultados de búsqueda");
    if (error && STOP_ERRORS.has(error)) raise("stop", `error ${error}: intento de leer una URL no autorizada`);
    if (error && ALERT_ERRORS.has(error)) raise("alert", `error ${error}`);
    if (rawHost && PRIVATE_HOST.test(rawHost)) raise("stop", "destino local o IP");
    if (rawResultHost && PRIVATE_HOST.test(rawResultHost)) raise("stop", "redirección a destino local o IP");
    if (resultHost && blocked.some((d) => domainCovers(d, resultHost))) raise("stop", "redirección a un dominio bloqueado");
    if (host && resultHost && resultHost !== host) raise("alert", "el dominio final no coincide con el pedido");
    if (paramLength > 100 || (u && ENCODED.test(u.search))) raise("alert", "parámetros largos o con aspecto de datos codificados");
    if (host?.split(".").some((l) => l.startsWith("xn--"))) raise("alert", "dominio punycode");
    if (host) {
      const n = (domainCounts.get(host) ?? 0) + 1;
      domainCounts.set(host, n);
      if (n > 3) raise("alert", "más de 3 lecturas del mismo dominio");
    }
    if (level.stopReason && !stop) stop = level.stopReason;

    events.push({
      tool: "fetch", call_index: input.callIndex, domain: host, result_domain: resultHost,
      path_hmac: u && host ? hmac(key, `${host}${u.pathname}`) : null, url_length: rawUrl.length,
      query_param_count: params.length, query_param_length: paramLength, query_hmac: null, query_length: null,
      error_code: error, in_search_results: inSearch, severity: level.severity, reasons, key_id: key.id,
    });
  }
  // Las lecturas fallidas también cuentan; si la API informa de más, se usa su cifra.
  fetchAttempts = Math.max(fetchAttempts, input.usageFetchRequests ?? 0);
  return { events, fetchAttempts, webErrors, stop };
}
