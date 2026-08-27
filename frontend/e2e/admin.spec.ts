import { test, expect } from "@playwright/test";
import { iniciarSesionEnNavegador, loginComoAdminApi } from "./helpers.js";

/**
 * Herramienta de revisión editorial: filtrar por bloque/tema, verificar
 * una pregunta y anular otra. Usa el tema "revisión" del seed (3 preguntas
 * en borrador, exclusivo de este spec para no pisarse con otros).
 */
test("filtra por tema, verifica una pregunta y anula otra", async ({ page, request }) => {
  const { token } = await loginComoAdminApi(request);
  await iniciarSesionEnNavegador(page, token);

  await page.goto("/admin/revision");
  await expect(page.getByRole("heading", { name: "Revisión editorial" })).toBeVisible();

  // Filtra a Bloque I y localiza el tema "revisión" por su nombre. El
  // <option> incluye el nº de pendientes en la etiqueta (cambia con cada
  // acción), así que leemos su `value` en vez de hacer match exacto del texto.
  await page.getByRole("combobox").nth(1).selectOption("I");
  const selectTema = page.getByRole("combobox").nth(2);
  const opcionTemaRevision = selectTema.locator("option", { hasText: "Tema de prueba E2E — revisión" });
  await selectTema.selectOption((await opcionTemaRevision.getAttribute("value")) as string);

  await expect(page.getByText("3 en esta cola")).toBeVisible();

  // Verifica la primera pregunta de la cola (ya trae respuesta correcta del seed).
  await expect(page.getByRole("button", { name: "Verificar", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Verificar", exact: true }).click();
  await expect(page.getByText("2 en esta cola")).toBeVisible();

  // Anula la siguiente (confirmación del navegador incluida).
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Anular" }).click();
  await expect(page.getByText("1 en esta cola")).toBeVisible();

  // Cambia el filtro de estado a "Verificadas": debe aparecer la que acabamos de verificar.
  await page.getByRole("combobox").nth(0).selectOption("verificada");
  await expect(page.getByText("1 en esta cola")).toBeVisible();

  // Y en "Anuladas" debe aparecer la que anulamos.
  await page.getByRole("combobox").nth(0).selectOption("anulada");
  await expect(page.getByText("1 en esta cola")).toBeVisible();
});
