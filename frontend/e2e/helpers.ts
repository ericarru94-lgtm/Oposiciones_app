import type { APIRequestContext, Page } from "@playwright/test";

/**
 * Siempre la URL del backend de E2E (puerto 3002), nunca la del backend de
 * desarrollo (3001). Los helpers de API hablan directo con el backend,
 * independientemente del `baseURL` del frontend configurado en
 * playwright.config.ts.
 */
export const API_URL = "http://localhost:3002/api";

/**
 * Debe coincidir con backend/.env.e2e#AUTH_TEST_BYPASS_SECRET y con
 * frontend/.env.e2e#VITE_E2E_AUTH_BYPASS_SECRET. Playwright no puede
 * completar un login real de Clerk (requiere red hacia clerk.com, bloqueada
 * en el sandbox de desarrollo de este proyecto), así que tanto el backend
 * como el frontend de E2E usan este bypass de autenticación en vez de
 * Clerk — ver backend/docs/clerk.md.
 */
const SECRETO_BYPASS = "e2e-solo-para-tests";

function emailUnico(prefijo: string): string {
  return `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Crea (o reutiliza) un Usuario por email y devuelve el token de bypass listo para usar como Bearer. */
async function iniciarSesionBypassApi(request: APIRequestContext, email: string) {
  const res = await request.post(`${API_URL}/auth/registro-bypass`, {
    data: { email, secreto: SECRETO_BYPASS },
  });
  if (!res.ok()) throw new Error(`No se pudo autenticar (bypass) a ${email}: ${res.status()} ${await res.text()}`);
  const { usuarioId } = await res.json();
  return { email, usuarioId, token: `e2e-bypass:${SECRETO_BYPASS}:${usuarioId}` };
}

export async function registrarUsuarioApi(request: APIRequestContext, prefijo: string) {
  const email = emailUnico(prefijo);
  const { usuarioId, token } = await iniciarSesionBypassApi(request, email);
  return { email, token, usuario: { id: usuarioId, email } };
}

/** El email admin del entorno E2E (ver backend/.env.e2e ADMIN_EMAILS). */
export async function loginComoAdminApi(request: APIRequestContext) {
  const { token } = await iniciarSesionBypassApi(request, "admin-e2e@example.com");
  return { email: "admin-e2e@example.com", token };
}

/** Inyecta el token de bypass en localStorage antes de la primera carga, para saltarse login/onboarding en la UI. */
export async function iniciarSesionEnNavegador(page: Page, token: string) {
  await page.addInitScript((t) => {
    window.localStorage.setItem("oposiciones:e2eBypassToken", t);
  }, token);
}

export async function obtenerTemaPorNumero(request: APIRequestContext, bloque: "I" | "II", numero: number) {
  const res = await request.get(`${API_URL}/preguntas/temas`);
  const body = await res.json();
  const tema = body.temas.find((t: { bloque: string; numero: number }) => t.bloque === bloque && t.numero === numero);
  if (!tema) throw new Error(`No se encontró el tema bloque=${bloque} numero=${numero}`);
  return tema as { id: number; bloque: string; numero: number; nombre: string };
}

export async function responderPreguntaApi(
  request: APIRequestContext,
  preguntaId: string,
  token: string,
  opcion: "a" | "b" | "c" | "d" = "a"
) {
  return request.post(`${API_URL}/preguntas/${preguntaId}/responder`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { opcion },
  });
}
