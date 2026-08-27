import { test, expect } from "@playwright/test";

/**
 * Flujo real de "Suscribirme sin sesión": /upgrade -> registro (Clerk, o su
 * bypass en E2E, ver context/SessionContext.tsx) -> vuelta a /upgrade con
 * la sesión ya creada, continuando el pago automáticamente (sin tener que
 * pulsar "Suscribirme" otra vez). backend/.env.e2e deja STRIPE_PRICE_ID
 * vacío a propósito (nunca se ejercita Stripe de verdad aquí, ver
 * backend/docs/stripe.md), así que el checkout automático falla con el 500
 * controlado de esa validación — lo que de todas formas confirma que se
 * intentó, que es lo único que le corresponde probar a este spec sobre el
 * checkout en sí.
 */
test("suscribirse sin sesión lleva al registro y, al volver, continúa el pago solo", async ({ page }) => {
  await page.goto("/upgrade");
  await expect(page.getByRole("heading", { name: "Has llegado a tu límite diario gratuito" })).toBeVisible();

  await page.getByRole("button", { name: "Suscribirme" }).click();
  await expect(page).toHaveURL(/\/registro\?destino=/);

  const email = `e2e-upgrade-${Date.now()}@example.com`;
  await page.getByPlaceholder("Email").fill(email);
  await page.getByRole("button", { name: "Crear cuenta gratis" }).click();

  // Vuelve a /upgrade ya autenticado y dispara el checkout sin más clics.
  await expect(page).toHaveURL(/\/upgrade$/);
  await expect(page.getByText("STRIPE_PRICE_ID no está configurado en el servidor")).toBeVisible();
});

test("el enlace 'Inicia sesión' de /upgrade lleva al login, no al registro", async ({ page }) => {
  await page.goto("/upgrade");
  await page.getByRole("button", { name: "Inicia sesión" }).click();
  await expect(page).toHaveURL(/\/login\?destino=/);
});
