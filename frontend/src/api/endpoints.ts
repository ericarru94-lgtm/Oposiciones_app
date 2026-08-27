import { apiFetch } from "./client";
import type {
  Bloque,
  EstadoPregunta,
  EvolucionDia,
  Opcion,
  PreguntaAdmin,
  PreguntaParaResponder,
  ProgresoHoy,
  ProgresoPorTema,
  ProgresoResumen,
  ResumenTemaAdmin,
  RespuestaFeedback,
  Tema,
  TipoPregunta,
  Usuario,
} from "./types";

export function registrarUsuario(datos: {
  email: string;
  password: string;
  nivelInicial?: string;
  sesionAnonima?: string;
}) {
  return apiFetch<{ token: string; usuario: Usuario }>("/auth/registro", { method: "POST", body: datos });
}

export function iniciarSesion(datos: { email: string; password: string; sesionAnonima?: string }) {
  return apiFetch<{ token: string; usuario: Usuario }>("/auth/login", { method: "POST", body: datos });
}

export function obtenerUsuarioActual(token: string) {
  return apiFetch<Usuario>("/auth/me", { token });
}

export function obtenerTemas() {
  return apiFetch<{ temas: Tema[] }>("/preguntas/temas");
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
