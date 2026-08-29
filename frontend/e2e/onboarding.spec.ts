import { test, expect } from "@playwright/test";

/**
 * Flujo de onboarding completo, tal como lo recorre un visitante real:
 * mini-test sin registro -> nivel de partida -> alta de cuenta -> Home.
 * Un único test (el mini-test de 5 preguntas) es suficiente: no se repite
 * ningún otro tras elegir el nivel ni después de crear la cuenta.
 */
test("mini-test -> nivel -> registro -> home", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Empezar test gratis" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  // El CTA de la landing lleva directo al mini-test, sin pantalla intermedia.
  // Mini-test: 5 preguntas de un pool mixto (Constitución + tema de
  // práctica), así que no forzamos el resultado, solo completamos el flujo.
  for (let i = 0; i < 5; i++) {
    await page.getByTestId("opcion-a").click();
    await page.getByTestId("siguiente").click();
  }
  await expect(page.getByTestId("resumen")).toBeVisible();
  const aciertosMiniTest = Number(await page.getByTestId("resumen-aciertos").textContent());
  const fallosMiniTest = Number(await page.getByTestId("resumen-fallos").textContent());
  expect(aciertosMiniTest + fallosMiniTest).toBe(5);
  await page.getByTestId("continuar").click();

  // Nivel de partida: tras elegir, debe ir directo a registro (sin repetir ningún test).
  await expect(page.getByRole("heading", { name: "¿Cómo empiezas?" })).toBeVisible();
  await page.getByRole("button", { name: /Ya llevo tiempo/ }).click();

  // Registro: el resumen mostrado es el del mini-test (el único que hubo).
  await expect(page.getByText(/Crea tu cuenta gratis para guardar el progreso/)).toBeVisible();
  await expect(page.getByText(`Has acertado ${aciertosMiniTest} de 5 preguntas.`)).toBeVisible();
  const email = `e2e-onboarding-${Date.now()}@example.com`;
  await page.getByPlaceholder("Email").fill(email);
  await page.getByRole("button", { name: "Crear cuenta gratis" }).click();

  await expect(page).toHaveURL(/\/home$/);

  // Home ya refleja lo practicado en el mini-test (gracias a
  // reclamarIntentosAnonimos: ver backend/src/lib/reclamarIntentosAnonimos.ts).
  // La racha es determinista (cualquier actividad de hoy cuenta 1 día),
  // independientemente de qué temas concretos tocara el mini-test al azar.
  await expect(page.getByText(/1 día seguidos/)).toBeVisible();
});
