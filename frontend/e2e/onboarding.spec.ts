import { test, expect } from "@playwright/test";

/**
 * Flujo de onboarding completo, tal como lo recorre un visitante real:
 * mini-test sin registro -> nivel de partida -> primer test corto
 * automático sobre Constitución (Tema I.1, fijado en
 * pages/onboarding/PasoPrimerTest.tsx) -> alta de cuenta -> Home refleja
 * lo practicado.
 *
 * Usa el tema "Constitución" del seed de E2E (backend/src/scripts/seed-e2e.ts),
 * donde las 6 preguntas verificadas tienen todas respuesta correcta "a" —
 * así el resultado del primer test es determinista aunque el mini-test
 * (que mezcla temas) no lo sea.
 */
test("mini-test -> nivel -> primer test -> registro -> home", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByRole("button", { name: "Empezar mini-test" }).click();

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

  // Nivel de partida.
  await expect(page.getByRole("heading", { name: "¿Cómo empiezas?" })).toBeVisible();
  await page.getByRole("button", { name: /Ya llevo tiempo/ }).click();

  // Primer test: siempre sobre Constitución, siempre respuesta "a" -> 100% determinista.
  await expect(page.getByText(/Tu primer test: La Constitución/)).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.getByTestId("opcion-a").click();
    await page.getByTestId("siguiente").click();
  }
  await expect(page.getByTestId("resumen")).toBeVisible();
  await expect(page.getByTestId("resumen-aciertos")).toHaveText("5");
  await expect(page.getByTestId("resumen-fallos")).toHaveText("0");
  await page.getByTestId("continuar").click();

  // Registro.
  await expect(page.getByText(/Crea tu cuenta gratis para guardar el progreso/)).toBeVisible();
  const email = `e2e-onboarding-${Date.now()}@example.com`;
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/Contraseña/).fill("password123");
  await page.getByRole("button", { name: "Crear cuenta gratis" }).click();

  await expect(page).toHaveURL(/\/home$/);

  // Home ya refleja lo practicado en el primer test sobre Constitución
  // (gracias a reclamarIntentosAnonimos: ver backend/src/lib/reclamarIntentosAnonimos.ts).
  // El primer test siempre contesta 5 de las 6 preguntas de Constitución,
  // pero el mini-test previo (pool mixto) a veces también toca alguna de
  // Constitución al azar, así que el total puede ser 5/6 o 6/6 — nunca menos
  // de 5. La precisión, en cambio, sí es 100% siempre: toda respuesta a una
  // pregunta de Constitución en este test es "a", que es la correcta.
  const tarjetaConstitucion = page.getByRole("button", { name: /La Constitución Española de 1978/ });
  await expect(tarjetaConstitucion.getByText(/^[56]\/6 preguntas practicadas$/)).toBeVisible();
  await expect(tarjetaConstitucion.getByText("100%")).toBeVisible();
  await expect(page.getByText(/1 día seguidos/)).toBeVisible();
});
