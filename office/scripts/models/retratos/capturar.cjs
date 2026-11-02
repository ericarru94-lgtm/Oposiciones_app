// Captura los retratos desde los modelos aprobados (fase 4.3.2).
// Uso: con office/ servida en http://localhost:8090, `node capturar.cjs carpeta-salida alex marcus sofia`.
// Después: `node a-webp.mjs salida/ID.png ../../../public/avatars/equipo/ID.webp` (sharp instalado aparte).
const { chromium } = require('playwright');
(async () => {
  const [out, ...ids] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 768, height: 768 } });
  for (const id of ids) {
    await p.goto(`http://localhost:8090/scripts/models/retratos/retrato.html?m=/public/models/equipo/${id}-realista.glb`);
    await p.waitForFunction(() => window.__done, null, { timeout: 120000 });
    await p.locator('canvas').screenshot({ path: `${out}/${id}.png`, omitBackground: true });
  }
  await b.close();
})();
