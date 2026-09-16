import { test, expect } from "@playwright/test";
import { iniciarSesionEnNavegador, obtenerTemaPorNumero, registrarUsuarioApi } from "./helpers.js";

/**
 * Marcar/desmarcar una pregunta como favorita desde TestRunner (estrella),
 * y practicarlas aparte desde /favoritas. Usa el tema "práctica" del seed
 * (3 preguntas verificadas) — ver test-screen.spec.ts.
 */
test("marcar una pregunta como favorita y volver a practicarla desde /favoritas", async ({ page, request }) => {
  const { token } = await registrarUsuarioApi(request, "e2e-favoritos");
  const temaPractica = await obtenerTemaPorNumero(request, "I", 2);

  await iniciarSesionEnNavegador(page, token);
  await page.goto(`/practicar/${temaPractica.id}`);

  await expect(page.getByText("Pregunta 1 de 3")).toBeVisible();
  const estrella = page.getByTestId("alternar-favorita");
  await expect(estrella).toBeVisible();
  await expect(estrella).toHaveAttribute("aria-pressed", "false");

  const enunciadoFavorita = await page.locator("p.text-xl.font-semibold").textContent();

  await estrella.click();
  await expect(estrella).toHaveAttribute("aria-pressed", "true");

  // Termina el test normal sin desmarcarla.
  await page.getByTestId("opcion-a").click();
  await page.getByTestId("siguiente").click();
  await page.getByTestId("opcion-b").click();
  await page.getByTestId("siguiente").click();
  await page.getByTestId("opcion-b").click();
  await page.getByTestId("siguiente").click();
  await page.getByTestId("continuar").click();
  await expect(page).toHaveURL(/\/home$/);

  // /favoritas: debe traer solo esa pregunta, con la estrella ya rellena.
  await page.goto("/favoritas");
  await expect(page.getByText("Pregunta 1 de 1")).toBeVisible();
  await expect(page.locator("p.text-xl.font-semibold")).toHaveText(enunciadoFavorita ?? "");
  await expect(page.getByTestId("alternar-favorita")).toHaveAttribute("aria-pressed", "true");

  // Desmarcarla aquí mismo y volver a entrar: ya no debe haber nada que practicar.
  await page.getByTestId("alternar-favorita").click();
  await expect(page.getByTestId("alternar-favorita")).toHaveAttribute("aria-pressed", "false");
  await page.goto("/favoritas");
  await expect(page.getByText(/No hay preguntas disponibles/)).toBeVisible();
});
