import { test, expect } from "@playwright/test";
import { iniciarSesionEnNavegador, obtenerTemaPorNumero, registrarUsuarioApi, responderPreguntaApi } from "./helpers.js";

/**
 * Límite diario del plan gratuito: en vez de bajar FREE_PLAN_DAILY_LIMIT a
 * un valor artificialmente pequeño (lo que rompería el test de onboarding,
 * que responde ~11 preguntas de un tirón), agotamos el límite por API con
 * un usuario dedicado y solo usamos la UI para la pregunta que lo dispara,
 * verificando que /responder devuelve 429 y la app navega a /upgrade.
 */
test("al agotar el límite diario, la app muestra la pantalla de upgrade", async ({ page, request }) => {
  const { token } = await registrarUsuarioApi(request, "e2e-daily-limit");
  const temaConstitucion = await obtenerTemaPorNumero(request, "I", 1);

  // FREE_PLAN_DAILY_LIMIT=20 en backend/.env.e2e: agotamos las 20 vía API.
  for (let i = 0; i < 20; i++) {
    const res = await responderPreguntaApi(request, "e2e-const-1", token, "a");
    expect(res.ok()).toBe(true);
  }

  await iniciarSesionEnNavegador(page, token);
  await page.goto(`/practicar/${temaConstitucion.id}`);

  await expect(page.getByTestId("opcion-a")).toBeVisible();
  await page.getByTestId("opcion-a").click();

  await expect(page).toHaveURL(/\/upgrade$/);
  await expect(page.getByText("Has llegado a tu límite diario gratuito")).toBeVisible();
  await expect(page.getByRole("button", { name: /Suscribirme/ })).toBeVisible();
});
