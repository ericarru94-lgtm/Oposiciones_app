import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 30_000,
    // PI-16 · Clave HMAC SOLO de pruebas (la real vive en el servidor, nunca en el repositorio).
    env: { WEB_AUDIT_HMAC_KEY: "test-only-web-audit-key-0123456789abcdef", WEB_AUDIT_HMAC_KEY_ID: "test" },
  },
});
