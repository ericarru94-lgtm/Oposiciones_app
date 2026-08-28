import { test, expect } from "@playwright/test";
import { iniciarSesionEnNavegador, registrarUsuarioApi } from "./helpers.js";

/**
 * Pantalla de perfil: combina datos de identidad (nombre/email — en modo
 * bypass de E2E, solo el email, ver context/SessionContext.tsx) con datos
 * propios (plan, progreso, racha).
 */
test("muestra el email, el plan y el resumen de progreso del usuario", async ({ page, request }) => {
  const { email, token } = await registrarUsuarioApi(request, "e2e-perfil");

  await iniciarSesionEnNavegador(page, token);
  await page.goto("/perfil");

  await expect(page.getByRole("heading", { name: "Tu perfil" })).toBeVisible();
  await expect(page.getByText(email).first()).toBeVisible();
  await expect(page.getByText("Plan gratuito")).toBeVisible();
  await expect(page.getByText("Preguntas respondidas")).toBeVisible();
});

test("'Salir' cierra sesión y lleva a la landing pública, no a la pantalla de login", async ({ page, request }) => {
  const { token } = await registrarUsuarioApi(request, "e2e-logout");

  await iniciarSesionEnNavegador(page, token);
  await page.goto("/perfil");
  await expect(page.getByRole("heading", { name: "Tu perfil" })).toBeVisible();

  await page.getByRole("button", { name: "Salir" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Aprobox" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Empezar test gratis" })).toBeVisible();
});
