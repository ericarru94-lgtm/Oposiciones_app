const { chromium } = require('playwright');
const out = process.argv[2]; const URL = 'http://localhost:3123';
const GPU = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'OK  ' : 'FALLA'} ${name} ${extra}`); };
const countDraws = () => {
  window.__draws = 0;
  for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
    for (const m of ['drawElements', 'drawArrays']) { const o = C.prototype[m]; C.prototype[m] = function (...a) { window.__draws++; return o.apply(this, a); }; }
  }
};
(async () => {
  const b = await chromium.launch({ args: GPU });
  // Escritorio: 3D
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(countDraws);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const t0 = Date.now();
  await p.goto(URL + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-testid=office-3d] canvas', { timeout: 30000 });
  await p.waitForFunction(() => window.__draws > 0);
  ok('escritorio abre en 3D', true, `(lienzo con dibujo en ${Date.now() - t0} ms, modo desarrollo)`);
  // La calidad se mide una sola vez al abrir (3 dibujos); el reposo se cuenta después.
  await p.waitForSelector('[data-quality-ready]', { timeout: 30000 });
  await p.waitForTimeout(1500);
  const d1 = await p.evaluate(() => window.__draws); await p.waitForTimeout(3000); const d2 = await p.evaluate(() => window.__draws);
  ok('sin actividad real no se redibuja (frameloop demand)', d2 === d1, `(llamadas de dibujo en 3 s en reposo: ${d2 - d1})`);
  const labels = await p.locator('[data-testid=office-3d] button').allTextContents();
  ok('9 agentes en la escena', labels.length === 9, `(${labels.length})`);
  ok('6 inactivos fuera del piloto', labels.filter(l => /Inactivo/.test(l)).length === 6);
  ok('Alex, Marcus y Sofia con estado real', ['Alex', 'Marcus', 'Sofia'].every(n => labels.some(l => l.startsWith(n) && /Disponible/.test(l))));
  // FPS al girar la cámara
  const box = await p.locator('[data-testid=office-3d] canvas').boundingBox();
  await p.evaluate(() => { window.__f = 0; const loop = () => { window.__f++; window.__raf = requestAnimationFrame(loop); }; loop(); });
  const dd = await p.evaluate(() => window.__draws);
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down();
  const s = Date.now();
  for (let i = 0; i < 60; i++) { await p.mouse.move(box.x + box.width / 2 + i * 4, box.y + box.height / 2 + Math.sin(i / 5) * 20); }
  await p.mouse.up(); const secs = (Date.now() - s) / 1000;
  const f = await p.evaluate(() => window.__f); const de = await p.evaluate(() => window.__draws);
  ok('girar la cámara redibuja', de > dd, `(${f} frames de página en ${secs.toFixed(1)} s ≈ ${(f / secs).toFixed(0)} fps con GPU por software)`);
  await p.screenshot({ path: out + '/01-escritorio-3d.png' });
  // Teclado: las etiquetas son botones enfocables
  await p.locator('[data-testid=office-3d] button', { hasText: 'Sofia' }).focus(); await p.keyboard.press('Enter');
  await p.waitForSelector('[data-testid=agent-panel]');
  ok('ficha por teclado', (await p.locator('[data-testid=agent-panel]').textContent()).includes('Sofia'));
  await p.screenshot({ path: out + '/02-escritorio-ficha.png' });
  await p.getByRole('button', { name: 'Cerrar ficha' }).click();
  await p.locator('[data-testid=office-3d] button', { hasText: 'Daniel' }).click();
  ok('ficha de agente inactivo', /Inactivo · fuera del piloto/.test(await p.locator('[data-testid=agent-panel]').textContent()));
  // Lista y preferencia guardada
  await p.getByRole('button', { name: 'Lista', exact: true }).click();
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  ok('la preferencia «Lista» se recuerda', await p.locator('[data-testid=office-list]').count() === 1);
  await p.screenshot({ path: out + '/03-escritorio-lista.png' });
  const mem = await p.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  ok('memoria JS', true, `(${mem} MB, modo desarrollo)`);
  ok('sin errores de página', errs.length === 0, errs.slice(0, 2).join(' | '));
  // Móvil
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  await mp.goto(URL + '/', { waitUntil: 'networkidle' }); await mp.waitForTimeout(500);
  ok('móvil abre en lista', await mp.locator('[data-testid=office-list]').count() === 1);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok('móvil sin scroll horizontal', !overflow);
  await mp.getByRole('button', { name: 'Marcus', exact: false }).first().tap();
  await mp.waitForSelector('[data-testid=agent-panel]');
  await mp.screenshot({ path: out + '/04-movil-lista-ficha.png' });
  await mp.getByRole('button', { name: 'Cerrar ficha' }).tap();
  await mp.getByRole('button', { name: '3D', exact: true }).tap();
  await mp.waitForSelector('[data-testid=office-3d] canvas', { timeout: 30000 }); await mp.waitForTimeout(1500);
  ok('móvil puede elegir 3D', true);
  await mp.screenshot({ path: out + '/05-movil-3d.png' });
  await mp.goto(URL + '/centro', { waitUntil: 'networkidle' });
  await mp.screenshot({ path: out + '/06-movil-centro.png' });
  ok('centro de mando carga', /Centro de mando/.test(await mp.textContent('main')));
  // Reducir movimiento → lista
  const r = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const rp = await r.newPage(); await rp.goto(URL + '/', { waitUntil: 'networkidle' }); await rp.waitForTimeout(400);
  ok('«reducir movimiento» abre en lista', await rp.locator('[data-testid=office-list]').count() === 1);
  await b.close();
  // Sin WebGL
  const b2 = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
  const np = await b2.newPage({ viewport: { width: 1440, height: 900 } });
  await np.goto(URL + '/', { waitUntil: 'networkidle' }); await np.waitForTimeout(400);
  ok('sin WebGL: lista y botón 3D desactivado', await np.locator('[data-testid=office-list]').count() === 1 && await np.getByRole('button', { name: '3D', exact: true }).isDisabled());
  await b2.close();
  console.log(results.join('\n'));
})().catch(e => { console.log(results.join('\n')); console.error(e); process.exit(1); });
