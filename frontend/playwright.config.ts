import { defineConfig } from "@playwright/test";

const FRONTEND_PORT = 5174;
const BACKEND_PORT = 3002;

/**
 * Tests E2E contra un backend + frontend dedicados a este propósito,
 * apuntando a la base de datos "oposiciones_e2e" (nunca a la de
 * desarrollo/producción). Puertos distintos de los de `npm run dev`
 * (3001/5173) para que nunca se reutilice por accidente un servidor de
 * desarrollo ya abierto y se rompa el aislamiento.
 *
 * `npm run e2e:reset` (migrar + reseed determinista) corre antes de
 * arrancar el backend en cada tanda de tests.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: "/opt/pw-browsers/chromium",
    },
  },
  webServer: [
    {
      command: "npm run e2e:reset && npm run e2e:serve",
      cwd: "../backend",
      port: BACKEND_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `npm run dev -- --mode e2e --port ${FRONTEND_PORT} --strictPort`,
      port: FRONTEND_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
