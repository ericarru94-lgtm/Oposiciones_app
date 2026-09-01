import { apiFetch } from "./client";
import type {
  Bloque,
  EstadoPregunta,
  EvolucionDia,
  Opcion,
  PreguntaAdmin,
  PreguntaParaResponder,
  ProgresoComunidad,
  ProgresoHoy,
  ProgresoPorTema,
  ProgresoResumen,
  ResumenTemaAdmin,
  RespuestaFeedback,
  TablaDatos,
  Tema,
  TipoPregunta,
  Usuario,
} from "./types";

/**
 * El alta/login los gestiona Clerk (`<SignUp/>`/`<SignIn/>` en las
 * páginas); esta fila de Usuario se crea sola en el primer login vía
 * `obtenerOCrearUsuarioDesdeClerk` (backend/src/lib/clerkSync.ts).
 */
export function obtenerUsuarioActual(token: string) {
  return apiFetch<Usuario>("/auth/me", { token });
}

export function actualizarOnboarding(token: string, nivelInicial: string) {
  return apiFetch<{ id: string; nivelInicial: string | null }>("/auth/me/onboarding", {
    method: "PATCH",
    body: { nivelInicial },
    token,
  });
}

/** Adopta como progreso del usuario los intentos respondidos como visitante anónimo durante el onboarding. */
export function reclamarSesionAnonima(token: string, sesionAnonima: string) {
  return apiFetch<void>("/auth/reclamar-sesion-anonima", { method: "POST", body: { sesionAnonima }, token });
}

/**
 * Solo existe en el backend cuando `AUTH_TEST_BYPASS_SECRET` está definido
 * (exclusivo del entorno E2E — ver backend/docs/clerk.md): permite iniciar
 * sesión sin pasar por Clerk cuando no hay `VITE_CLERK_PUBLISHABLE_KEY`
 * configurada, algo que solo ocurre en el modo E2E de Playwright.
 */
export function registrarOIniciarSesionBypass(email: string, secreto: string) {
  return apiFetch<{ usuarioId: string }>("/auth/registro-bypass", { method: "POST", body: { email, secreto } });
}

export function obtenerTemas() {
  return apiFetch<{ temas: Tema[] }>("/preguntas/temas");
}

/** Simulacro de examen: preguntas de todo el temario, repartidas proporcionalmente al peso de cada tema. */
export function obtenerPreguntasSimulacro(numPreguntas: number) {
  return apiFetch<{ preguntas: PreguntaParaResponder[] }>(`/preguntas/simulacro?numPreguntas=${numPreguntas}`);
}

export interface FaseExamenOficial {
  preguntas: PreguntaParaResponder[];
  tiempoLimiteMin: number;
}

/** Estructura fija del primer ejercicio real: Parte 1 (60 preg., 30 Bloque I + 30 psicotécnicas) y Parte 2 (50 preg. Bloque II). */
export function obtenerExamenOficial() {
  return apiFetch<{ parte1: FaseExamenOficial; parte2: FaseExamenOficial }>("/preguntas/examen-oficial");
}

export function obtenerPreguntasAleatorias(params: {
  limit?: number;
  tipo?: TipoPregunta;
  temaId?: number;
  bloque?: "I" | "II";
}) {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.tipo) query.set("tipo", params.tipo);
  if (params.temaId) query.set("temaId", String(params.temaId));
  if (params.bloque) query.set("bloque", params.bloque);
  return apiFetch<{ preguntas: PreguntaParaResponder[] }>(`/preguntas/aleatorias?${query.toString()}`);
}

export function responderPregunta(
  preguntaId: string,
  datos: { opcion: Opcion; sesionAnonima?: string; tiempoMs?: number },
  token?: string | null
) {
  return apiFetch<RespuestaFeedback>(`/preguntas/${preguntaId}/responder`, {
    method: "POST",
    body: datos,
    token,
  });
}

export function obtenerRepasoHoy(token: string, limit = 20) {
  return apiFetch<ProgresoHoy>(`/progreso/hoy?limit=${limit}`, { token });
}

export function obtenerResumenProgreso(token: string) {
  return apiFetch<ProgresoResumen>("/progreso/resumen", { token });
}

export function obtenerProgresoPorTema(token: string) {
  return apiFetch<{ temas: ProgresoPorTema[] }>("/progreso/por-tema", { token });
}

export function obtenerEvolucion(token: string, dias = 14) {
  return apiFetch<{ serie: EvolucionDia[] }>(`/progreso/evolucion?dias=${dias}`, { token });
}

/** Comparativa anónima de racha y % de acierto con la media de los demás usuarios. */
export function obtenerProgresoComunidad(token: string) {
  return apiFetch<ProgresoComunidad>("/progreso/comunidad", { token });
}

// --- Herramienta de revisión editorial (admin) ---

export function obtenerColaRevision(
  token: string,
  params: { estado: EstadoPregunta; bloque?: Bloque; temaId?: number; sinTema?: boolean; limit?: number }
) {
  const query = new URLSearchParams({ estado: params.estado });
  if (params.bloque) query.set("bloque", params.bloque);
  if (params.temaId) query.set("temaId", String(params.temaId));
  if (params.sinTema) query.set("sinTema", "true");
  query.set("limit", String(params.limit ?? 100));
  return apiFetch<{ preguntas: PreguntaAdmin[] }>(`/admin/preguntas?${query.toString()}`, { token });
}

export function obtenerResumenTemasAdmin(token: string, estado: EstadoPregunta) {
  return apiFetch<{ temas: ResumenTemaAdmin[]; sinTema: { pendientes: number } }>(
    `/admin/resumen-temas?estado=${estado}`,
    { token }
  );
}

export interface CambiosPregunta {
  enunciado?: string;
  opciones?: string[];
  respuestaCorrecta?: Opcion | null;
  explicacion?: string | null;
  fuente?: string | null;
  fuenteUrl?: string | null;
  tablaDatos?: TablaDatos | null;
  estado?: EstadoPregunta;
}

export function actualizarPreguntaAdmin(token: string, id: string, cambios: CambiosPregunta) {
  return apiFetch<{ pregunta: PreguntaAdmin }>(`/admin/preguntas/${id}`, {
    method: "PATCH",
    body: cambios,
    token,
  });
}

// --- Stripe ---

/** Crea una Checkout Session de Stripe; redirigir el navegador a `url` (window.location.href). */
export function crearCheckoutSession(token: string) {
  return apiFetch<{ url: string }>("/stripe/crear-checkout-session", { method: "POST", token });
}

/** Crea una sesión del Billing Portal de Stripe (gestionar/cancelar la suscripción); redirigir a `url`. */
export function crearPortalSession(token: string) {
  return apiFetch<{ url: string }>("/stripe/crear-portal-session", { method: "POST", token });
}

// --- Newsletter ---

export type EstadoSuscripcionNewsletter = "pendiente" | "confirmado" | "baja";

/** Alta a la newsletter. `consentimiento` debe venir de un checkbox nunca premarcado (RGPD). */
export function suscribirseNewsletter(email: string, consentimiento: true) {
  return apiFetch<{ estado: EstadoSuscripcionNewsletter }>("/newsletter/suscribir", {
    method: "POST",
    body: { email, consentimiento },
  });
}

export function confirmarNewsletter(token: string) {
  return apiFetch<{ estado: EstadoSuscripcionNewsletter }>(
    `/newsletter/confirmar?token=${encodeURIComponent(token)}`
  );
}

export function darseDeBajaNewsletter(token: string) {
  return apiFetch<{ estado: EstadoSuscripcionNewsletter }>(
    `/newsletter/baja?token=${encodeURIComponent(token)}`,
    { method: "POST" }
  );
}

// --- Notificaciones push ---

/** Lanza ApiError(404) si el servidor no tiene VAPID configurado (notificaciones no disponibles). */
export function obtenerClavePublicaPush() {
  return apiFetch<{ clavePublica: string }>("/push/clave-publica");
}

export interface SuscripcionPushJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function suscribirPush(token: string, suscripcion: SuscripcionPushJSON) {
  return apiFetch<{ ok: true }>("/push/suscribir", { method: "POST", body: suscripcion, token });
}

export function desuscribirPush(token: string, endpoint: string) {
  return apiFetch<{ ok: true }>("/push/desuscribir", { method: "POST", body: { endpoint }, token });
}
