import { test, expect } from "@playwright/test";
import { iniciarSesionEnNavegador, registrarUsuarioApi } from "./helpers.js";

/**
 * Simulacro de examen: configuración (nº preguntas + tiempo) -> preguntas de
 * todo el temario sin feedback por pregunta -> pantalla de resultados. El
 * seed de E2E tiene 9 preguntas verificadas (6 + 3, ver seed-e2e.ts), pero
 * otras specs de esta misma tanda (p.ej. admin.spec.ts) pueden verificar
 * alguna pregunta más antes de que esta se ejecute, así que el total real
 * se lee de la propia pantalla en vez de asumir un número fijo.
 */
test("configurar, completar y ver resultados de un simulacro", async ({ page, request }) => {
  const { token } = await registrarUsuarioApi(request, "e2e-simulacro");

  await iniciarSesionEnNavegador(page, token);
  await page.goto("/simulacro");

  await expect(page.getByRole("heading", { name: "Simulacro de examen" })).toBeVisible();
  await page.getByRole("button", { name: "10" }).click();
  await page.getByRole("button", { name: "15 min" }).click();
  await page.getByTestId("empezar-simulacro").click();

  const cabecera = await page.getByText(/Pregunta 1 de \d+/).textContent();
  const total = Number(cabecera?.match(/de (\d+)/)?.[1]);
  expect(total).toBeGreaterThan(0);
  await expect(page.getByTestId("temporizador")).toBeVisible();

  // No debe revelar si la respuesta es correcta (simulacro, no práctica normal).
  await page.getByTestId("opcion-a").click();
  await expect(page.getByTestId("feedback")).toHaveCount(0);
  await expect(page.getByText(/¡Correcto!|Incorrecto/)).toHaveCount(0);

  // Completa el resto del simulacro: en cada vuelta se envía la pregunta
  // actual (ya con opción elegida) y, si no era la última, se elige opción
  // para la siguiente antes de repetir.
  for (let i = 1; i <= total; i++) {
    const boton = page.getByTestId("siguiente");
    const esUltima = (await boton.textContent()) === "Terminar simulacro";
    await boton.click();
    if (!esUltima) {
      await page.getByTestId("opcion-a").click();
    }
  }

  await expect(page.getByTestId("resultados-simulacro")).toBeVisible();
  await expect(page.getByText("Simulacro completado")).toBeVisible();
  await expect(page.getByText(`${total} de ${total} preguntas respondidas`)).toBeVisible();
  await expect(page.getByText(/Bloque I/)).toBeVisible();

  await page.getByRole("button", { name: "Volver a Tests" }).click();
  await expect(page).toHaveURL(/\/progreso$/);
});
