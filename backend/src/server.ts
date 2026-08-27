import { crearApp } from "./app";

/**
 * Este archivo no carga ningún `.env`: en producción (Render) las
 * variables las inyecta la plataforma directamente en `process.env`, y en
 * local/test/E2E cada script (`dev`, `test`, `e2e:serve`... en
 * package.json) ya arranca envuelto en `dotenv -e <archivo>` con el
 * `.env*` que corresponda. Cargar aquí además el `.env` por defecto (como
 * hacía antes `import "dotenv/config"`) rellenaría con valores reales
 * cualquier variable que un `.env.test`/`.env.e2e` deje sin definir a
 * propósito (p.ej. CLERK_SECRET_KEY, para que esos entornos usen el
 * paso-a-través o el bypass en vez de Clerk/Stripe de verdad) — rompiendo
 * el aislamiento que esos entornos existen para garantizar.
 */
const app = crearApp();

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`Backend escuchando en http://localhost:${PORT}`);
});
