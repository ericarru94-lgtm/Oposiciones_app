import { test, expect } from "@playwright/test";
import { API_URL, iniciarSesionEnNavegador, registrarUsuarioApi } from "./helpers.js";

/**
 * Bug reportado: un usuario del plan gratuito podía completar el examen
 * oficial cronometrado sin ningún bloqueo. Repite el fix end-to-end contra
 * un backend y un frontend reales (no mocks): un usuario recién creado por
 * la API (plan "free" por defecto, ver schema.prisma) nunca debe poder ni
 * ver ni usar el examen oficial, tanto si llega por la UI como si llama a
 * la API directamente saltándose el frontend.
 */
test("un usuario del plan gratuito no puede acceder al examen oficial (UI ni API)", async ({ page, request }) => {
  const { token } = await registrarUsuarioApi(request, "e2e-examen-premium-gate");

  // 1) API directa: incluso saltándose el frontend, el backend rechaza con 403.
  const resApi = await request.get(`${API_URL}/preguntas/examen-oficial`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(resApi.status()).toBe(403);

  // 2) UI: llegar directamente a la pantalla del examen oficial redirige a Upgrade
  // antes de mostrar el botón "Empezar Parte 1".
  await iniciarSesionEnNavegador(page, token);
  await page.goto("/simulacro/examen-oficial");

  await expect(page).toHaveURL(/\/upgrade\?motivo=examen-oficial/);
  await expect(page.getByRole("heading", { name: "El examen oficial es exclusivo de Premium" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Empezar Parte 1" })).not.toBeVisible();

  await page.screenshot({ path: "test-results/examen-oficial-gate-gratis.png", fullPage: true });
});
