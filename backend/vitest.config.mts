import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Los tests de integración golpean una base de datos real: no tiene
    // sentido paralelizarlos entre sí (comparten tablas / límite diario).
    fileParallelism: false,
    hookTimeout: 20000,
    testTimeout: 20000,
  },
});
