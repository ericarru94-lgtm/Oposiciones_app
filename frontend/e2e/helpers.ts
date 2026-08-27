import type { APIRequestContext, Page } from "@playwright/test";

/**
 * Siempre la URL del backend de E2E (puerto 3002), nunca la del backend de
 * desarrollo (3001). Los helpers de API hablan directo con el backend,
 * independientemente del `baseURL` del frontend configurado en
 * playwright.config.ts.
 */
export const API_URL = "http://localhost:3002/api";

function emailUnico(prefijo: string): string {
  return `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export async function registrarUsuarioApi(request: APIRequestContext, prefijo: string) {
  const email = emailUnico(prefijo);
  const res = await request.post(`${API_URL}/auth/registro`, { data: { email, password: "password123" } });
  if (!res.ok()) throw new Error(`No se pudo registrar ${email}: ${res.status()} ${await res.text()}`);
  const body = await res.json();
  return { email, token: body.token as string, usuario: body.usuario };
}

/** El email admin del entorno E2E (ver backend/.env.e2e ADMIN_EMAILS); se registra o, si ya existe, inicia sesión. */
export async function loginComoAdminApi(request: APIRequestContext) {
  const email = "admin-e2e@example.com";
  const password = "password123";
  const registro = await request.post(`${API_URL}/auth/registro`, { data: { email, password } });
  if (registro.ok()) {
    const body = await registro.json();
    return { email, token: body.token as string };
  }
  const login = await request.post(`${API_URL}/auth/login`, { data: { email, password } });
  if (!login.ok()) throw new Error(`No se pudo autenticar como admin: ${login.status()}`);
  const body = await login.json();
  return { email, token: body.token as string };
}

/** Inyecta el token en localStorage antes de la primera carga, para saltarse login/onboarding en la UI. */
export async function iniciarSesionEnNavegador(page: Page, token: string) {
  await page.addInitScript((t) => {
    window.localStorage.setItem("oposiciones:token", t);
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
