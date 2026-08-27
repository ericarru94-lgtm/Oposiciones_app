import { test, expect } from "@playwright/test";
import { iniciarSesionEnNavegador, obtenerTemaPorNumero, registrarUsuarioApi } from "./helpers.js";

/**
 * Pantalla de test vía "practicar tema": responder, ver feedback
 * (correcto/incorrecto), y resumen final. Usa el tema "práctica" del seed
 * (3 preguntas verificadas, todas con respuesta correcta "b"), así que el
 * resultado es 100% determinista.
 */
test("responder preguntas, ver feedback y llegar al resumen final", async ({ page, request }) => {
  const { token } = await registrarUsuarioApi(request, "e2e-test-screen");
  const temaPractica = await obtenerTemaPorNumero(request, "I", 2);

  await iniciarSesionEnNavegador(page, token);
  await page.goto(`/practicar/${temaPractica.id}`);

  await expect(page.getByText("Pregunta 1 de 3")).toBeVisible();

  // Pregunta 1: respondemos "a" (incorrecta, la correcta es "b").
  await page.getByTestId("opcion-a").click();
  await expect(page.getByTestId("feedback")).toBeVisible();
  await expect(page.getByText(/Incorrecto\. La respuesta correcta es la b\./)).toBeVisible();
  await expect(
    page.getByText("Esta pregunta todavía no tiene explicación ni fuente legal añadidas.")
  ).toBeVisible();
  await page.getByTestId("siguiente").click();

  // Pregunta 2: respondemos "b" (correcta).
  await expect(page.getByText("Pregunta 2 de 3")).toBeVisible();
  await page.getByTestId("opcion-b").click();
  await expect(page.getByText("¡Correcto!")).toBeVisible();
  await page.getByTestId("siguiente").click();

  // Pregunta 3: también "b" (correcta).
  await expect(page.getByText("Pregunta 3 de 3")).toBeVisible();
  await page.getByTestId("opcion-b").click();
  await expect(page.getByText("¡Correcto!")).toBeVisible();
  await page.getByTestId("siguiente").click();

  await expect(page.getByTestId("resumen")).toBeVisible();
  await expect(page.getByTestId("resumen-aciertos")).toHaveText("2");
  await expect(page.getByTestId("resumen-fallos")).toHaveText("1");

  await page.getByTestId("continuar").click();
  await expect(page).toHaveURL(/\/home$/);
});
