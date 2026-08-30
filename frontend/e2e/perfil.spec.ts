import { test, expect } from "@playwright/test";
import { iniciarSesionEnNavegador, registrarUsuarioApi } from "./helpers.js";

/**
 * Pantalla de perfil: combina datos de identidad (nombre/email — en modo
 * bypass de E2E, solo el email, ver context/SessionContext.tsx) con datos
 * propios de cuenta (plan, fecha de alta, logros) — las métricas de estudio
 * viven en Tests/Progreso, no se duplican aquí.
 */
test("muestra el email, el plan, la fecha de alta y los logros del usuario", async ({ page, request }) => {
  const { email, token } = await registrarUsuarioApi(request, "e2e-perfil");

  await iniciarSesionEnNavegador(page, token);
  await page.goto("/perfil");

  await expect(page.getByRole("heading", { name: "Tu perfil" })).toBeVisible();
  await expect(page.getByText(email).first()).toBeVisible();
  await expect(page.getByText("Plan gratuito")).toBeVisible();
  await expect(page.getByText(/Opositando desde/)).toBeVisible();
  await expect(page.getByText(/Aún no tienes temas dominados/)).toBeVisible();
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
