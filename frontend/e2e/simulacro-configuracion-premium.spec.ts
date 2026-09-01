import { test, expect } from "@playwright/test";
import { API_URL, iniciarSesionEnNavegador, registrarUsuarioApi } from "./helpers.js";

/**
 * El simulacro libre sigue siendo gratis para todos, pero solo con su
 * configuración básica (10 preguntas, 15 min) — elegir otra opción es
 * premium (ver ComparativaPlanes y GET /preguntas/simulacro). Comprueba,
 * contra un backend y un frontend reales, que un usuario gratuito: (1) ve
 * las opciones bloqueadas con candado en vez de ocultas, (2) al pulsarlas
 * va a Upgrade sin llegar a generar el simulacro, y (3) la API rechaza con
 * 403 la misma petición si se salta el frontend.
 */
test("un usuario del plan gratuito no puede elegir otra configuración del simulacro libre (UI ni API)", async ({
  page,
  request,
}) => {
  const { token } = await registrarUsuarioApi(request, "e2e-simulacro-config-gate");

  // API directa: incluso saltándose el frontend, el backend rechaza con 403.
  const resApi = await request.get(`${API_URL}/preguntas/simulacro?numPreguntas=25`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(resApi.status()).toBe(403);

  await iniciarSesionEnNavegador(page, token);
  await page.goto("/simulacro");

  // La opción básica (10) no está bloqueada; el resto sí, con candado visible.
  await expect(page.getByRole("button", { name: "10" })).toBeVisible();
  const opcionBloqueada = page.getByRole("button", { name: "🔒 25" });
  await expect(opcionBloqueada).toBeVisible();

  await opcionBloqueada.click();

  await expect(page).toHaveURL(/\/upgrade\?motivo=simulacro-configuracion/);
  await expect(page.getByRole("heading", { name: "Más preguntas y más tiempo, con Premium" })).toBeVisible();
});
