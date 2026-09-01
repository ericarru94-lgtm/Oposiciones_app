import { test, expect } from "@playwright/test";
import { API_URL, iniciarSesionEnNavegador, obtenerTemaPorNumero, registrarUsuarioApi } from "./helpers.js";

/**
 * Límite diario del plan gratuito: 2 tests empezados al día (Practicar tema
 * o Repasar hoy), en total, sin importar el bloque — ver backend/src/lib/dailyLimit.ts.
 * Agotamos las FREE_PLAN_DAILY_TEST_SESSIONS=2 sesiones por API con un
 * usuario dedicado (cada llamada a GET /aleatorias con temaId cuenta como
 * un test empezado) y solo usamos la UI para la tercera, verificando que
 * la carga del test devuelve 429 y la app navega a /upgrade.
 */
test("al agotar el límite diario de tests, la app muestra la pantalla de upgrade", async ({ page, request }) => {
  const { token } = await registrarUsuarioApi(request, "e2e-daily-limit");
  const temaConstitucion = await obtenerTemaPorNumero(request, "I", 1);

  // FREE_PLAN_DAILY_TEST_SESSIONS=2 en backend/.env.e2e: agotamos las 2 vía API.
  for (let i = 0; i < 2; i++) {
    const res = await request.get(`${API_URL}/preguntas/aleatorias?temaId=${temaConstitucion.id}&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
  }

  await iniciarSesionEnNavegador(page, token);
  await page.goto(`/practicar/${temaConstitucion.id}`);

  await expect(page).toHaveURL(/\/upgrade$/);
  await expect(page.getByText("Has llegado a tu límite diario gratuito")).toBeVisible();
  await expect(page.getByRole("button", { name: /Suscribirme/ })).toBeVisible();
});
