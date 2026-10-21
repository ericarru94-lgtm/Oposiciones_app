// Portadas de reels 1080×1920 (serie «HE Signal»). Uso: node portadas.js [id]
// Lo importante va en la franja central 1080×1440 (lo que enseña la cuadrícula del perfil).
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, '..', 'portadas');
const LOGO = fs.readFileSync(path.join(__dirname, '../../marca/logo-final/general/icono-oscuro.svg'), 'utf8')
  .replace(/#10151F/g, '#FFFFFF').replace(/#F1F3EE/g, '#10151F');

const notif = (n, h, t, cls = '') => `<div class="nt ${cls}"><div class="nt-av">${n[0]}</div><div><b>${n}</b><i>${h}</i><p>${t}</p></div></div>`;

const P = {
  cuentas: { tag: 'Gimnasios · Números', num: '01',
    title: '¿Cuánto cuesta un <em>DM sin contestar?</em>',
    art: `<div class="ticket"><div class="tk-h">TICKET · 1 SOCIO</div>
      <div class="tk-r"><span>Cuota media</span><span>85 €/mes</span></div>
      <div class="tk-r"><span>Permanencia</span><span>× 6 meses</span></div>
      <div class="tk-sep"></div>
      <div class="tk-r tot"><span>Se va a otro box</span><span>510 €</span></div>
      <div class="tk-foot">Ejemplo con supuestos</div></div>` },
  academia: { tag: 'Academias', num: '02',
    title: 'Los mensajes <em>del finde</em> también cuentan',
    art: `<div class="stack">${notif('Laura','Sáb 21:14','¿Quedan plazas en el B2 de tarde?')}${notif('Ana','Dom 10:31','¿Hacéis prueba de nivel?')}${notif('Laura','Dom 20:47','Hola??','hot')}</div>
      <div class="badge">Sin leer</div>` },
  reto: { tag: 'Reto · 30 segundos', num: '03',
    title: '¿Cuánto tarda <em>tu gimnasio</em> en contestar?',
    art: `<div class="watch"><svg viewBox="0 0 400 400"><circle cx="200" cy="200" r="170" fill="none" stroke="#263142" stroke-width="22"/>
      <circle cx="200" cy="200" r="170" fill="none" stroke="#FF4B2B" stroke-width="22" stroke-linecap="round" stroke-dasharray="760 1069" transform="rotate(-90 200 200)"/></svg>
      <div class="w-btn"></div><div class="w-t">??:??</div><div class="w-s">Haz la prueba</div></div>` },
  demo: { tag: 'Demo real', num: '04',
    title: 'Clase reservada en <em>2 segundos</em>',
    art: `<div class="ph"><div class="ph-h"><div class="ph-av">BN</div><div>Box Norte<span>en línea</span></div></div>
      <div class="bb in">¿Precio? ¿Y hay clase de prueba?<i>23:58</i></div>
      <div class="bb out">65 €/mes y la primera es gratis. ¿Martes 19:00?<i>23:58</i></div>
      <div class="ok">✓ Clase de prueba reservada</div></div>` },
  respuesta: { tag: 'Atención al cliente', num: '05',
    title: 'La respuesta que <em>te hace perder clientes</em>',
    art: `<div class="vs"><div class="v bad"><span class="vi">✕</span>«Te paso la info por privado»</div>
      <div class="v good"><span class="vi">✓</span>«Son 65 €/mes y la primera clase es gratis. ¿Martes o jueves?»</div></div>` },
  lunes: { tag: 'Gimnasios', num: '06',
    title: '¿Cuántos se fueron <em>mientras esperaban?</em>',
    art: `<div class="clock">9<span>:</span>00</div>
      <div class="stack sm">${notif('Laura','sáb 22:14','¿Hay clase de prueba?')}${notif('Pablo','dom 21:30','Al final me apunto en otro sitio','hot')}</div>` },
};

const css = `*{box-sizing:border-box;margin:0;padding:0}
body{width:1080px;height:1920px;background:#10151F;color:#fff;font-family:Inter,sans-serif;overflow:hidden;position:relative}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 2px,transparent 2px),linear-gradient(90deg,rgba(255,255,255,.035) 2px,transparent 2px);background-size:90px 90px;mask-image:radial-gradient(ellipse at 50% 45%,#000 30%,transparent 75%)}
.orb{position:absolute;width:1300px;height:1300px;border-radius:50%;right:-560px;top:120px;background:radial-gradient(circle,rgba(255,75,43,.55),rgba(255,75,43,.12) 45%,transparent 68%)}
.orb2{position:absolute;width:900px;height:900px;border-radius:50%;left:-420px;bottom:-200px;background:radial-gradient(circle,rgba(255,138,112,.18),transparent 65%)}
.rings{position:absolute;right:-180px;top:330px;width:900px;height:900px}
.grain{position:absolute;inset:0;opacity:.09;mix-blend-mode:overlay}
.top{position:absolute;top:260px;left:90px;right:90px;display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:14px;font-family:'Space Grotesk';font-weight:700;font-size:30px;letter-spacing:4px}
.logo svg{width:74px;height:74px}
.tag{font-family:'Space Grotesk';font-weight:700;font-size:26px;letter-spacing:3px;text-transform:uppercase;color:#FF8A70;border:2px solid rgba(255,138,112,.5);padding:12px 22px;border-radius:40px}
h1{position:absolute;left:90px;right:90px;top:400px;font-family:'Space Grotesk';font-weight:700;font-size:112px;line-height:1.0;letter-spacing:-4px}
h1 em{font-style:normal;color:#FF4B2B}
.art{position:absolute;left:90px;right:90px;top:960px;height:600px}
.num{position:absolute;left:90px;bottom:262px;font-family:'Space Grotesk';font-weight:700;font-size:26px;letter-spacing:4px;color:#7F8BA0}
.num b{color:#FF4B2B}
.play{position:absolute;right:90px;bottom:248px;font-family:'Space Grotesk';font-weight:700;font-size:28px;display:flex;align-items:center;gap:14px}
.play span{width:60px;height:60px;border-radius:50%;background:#FF4B2B;display:flex;align-items:center;justify-content:center;font-size:24px}
/* ticket */
.ticket{margin-left:auto;width:640px;background:#F1F3EE;color:#10151F;border-radius:22px;padding:44px 50px 36px;transform:rotate(-3deg);box-shadow:0 40px 80px rgba(0,0,0,.45);
 -webkit-mask:radial-gradient(circle 18px at 0 62%,transparent 98%,#000) left/51% 100% no-repeat,radial-gradient(circle 18px at 100% 62%,transparent 98%,#000) right/51% 100% no-repeat}
.tk-h{font-family:'Space Grotesk';font-weight:700;letter-spacing:4px;font-size:24px;color:#E23B1C;margin-bottom:26px}
.tk-r{display:flex;justify-content:space-between;font-size:34px;padding:10px 0;font-weight:500}
.tk-sep{border-top:3px dashed #9AA3B0;margin:18px 0}
.tot{font-family:'Space Grotesk';font-weight:700;font-size:38px}.tot span:last-child{font-size:76px;color:#FF4B2B;letter-spacing:-2px}
.tk-foot{font-size:22px;color:#6B7585;margin-top:8px}
/* notificaciones */
.stack{display:flex;flex-direction:column;gap:22px;width:820px}
.stack.sm{position:absolute;right:0;top:250px;width:720px}
.nt{display:flex;gap:22px;background:rgba(27,34,48,.92);border:2px solid #2B3446;border-radius:30px;padding:24px 28px;box-shadow:0 24px 50px rgba(0,0,0,.35)}
.nt:nth-child(2){margin-left:60px}.nt:nth-child(3){margin-left:120px}
.stack.sm .nt:nth-child(2){margin-left:0}
.nt-av{flex:0 0 70px;height:70px;border-radius:50%;background:#263142;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk';font-weight:700;font-size:32px}
.nt b{font-family:'Space Grotesk';font-size:32px}.nt i{font-style:normal;color:#7F8BA0;font-size:24px;margin-left:14px}
.nt p{font-size:32px;color:#C9D2E0;margin-top:4px;line-height:1.25}
.nt.hot{border-color:#FF4B2B}.nt.hot .nt-av{background:#FF4B2B}
.badge{position:absolute;right:0;top:-34px;background:#FF4B2B;font-family:'Space Grotesk';font-weight:700;font-size:28px;padding:12px 24px;border-radius:30px;transform:rotate(4deg)}
/* cronómetro */
.watch{position:relative;width:520px;height:520px;margin:20px auto 0}
.watch svg{width:100%;height:100%}
.w-btn{position:absolute;left:50%;top:-34px;width:70px;height:40px;margin-left:-35px;background:#FF4B2B;border-radius:12px}
.w-t{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk';font-weight:700;font-size:120px;letter-spacing:-4px;padding-bottom:40px}
.w-s{position:absolute;left:0;right:0;top:330px;text-align:center;font-size:30px;color:#FF8A70;font-weight:600;letter-spacing:2px;text-transform:uppercase}
/* móvil */
.ph{margin-left:auto;width:680px;height:620px;background:#0B141A;border:6px solid #263142;border-bottom:none;border-radius:60px 60px 0 0;padding:0 0 0;overflow:hidden;box-shadow:0 40px 90px rgba(0,0,0,.5);position:relative}
.ph-h{display:flex;align-items:center;gap:22px;background:#1F2C34;padding:30px 36px;font-weight:700;font-size:32px}
.ph-h span{display:block;font-size:24px;color:#12B76A;font-weight:500}
.ph-av{width:72px;height:72px;border-radius:50%;background:#FF4B2B;display:flex;align-items:center;justify-content:center;font-size:30px}
.bb{max-width:78%;margin:24px 30px 0;padding:20px 26px;border-radius:26px;font-size:30px;line-height:1.3}
.bb i{display:block;text-align:right;font-style:normal;font-size:20px;opacity:.7;margin-top:4px}
.bb.in{background:#263142;border-top-left-radius:6px}
.bb.out{background:#FF4B2B;margin-left:auto;border-top-right-radius:6px}
.ok{position:absolute;left:30px;right:30px;bottom:34px;background:#F1F3EE;color:#10151F;border-radius:22px;padding:22px;text-align:center;font-family:'Space Grotesk';font-weight:700;font-size:32px}
/* versus */
.vs{display:flex;flex-direction:column;gap:30px}
.v{position:relative;border-radius:30px;padding:36px 40px 36px 120px;font-size:38px;line-height:1.3;font-weight:500}
.v .vi{position:absolute;left:34px;top:34px;width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:32px}
.bad{background:rgba(27,34,48,.9);border:2px solid #2B3446;color:#7F8BA0;width:760px}
.bad .vi{background:#2B3446;color:#C9D2E0}
.bad{text-decoration:line-through;text-decoration-color:#FF4B2B;text-decoration-thickness:4px}
.good{background:#F1F3EE;color:#10151F;margin-left:80px;box-shadow:0 30px 70px rgba(0,0,0,.4)}
.good .vi{background:#FF4B2B;color:#fff}
/* reloj */
.clock{font-family:'Space Grotesk';font-weight:700;font-size:330px;line-height:.9;letter-spacing:-14px;color:transparent;-webkit-text-stroke:4px rgba(255,255,255,.22)}
.clock span{-webkit-text-stroke:4px #FF4B2B}`;

const grainSvg = `<svg class="grain" width="1080" height="1920"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
const rings = `<svg class="rings" viewBox="0 0 900 900" fill="none" stroke="#FF4B2B" stroke-linecap="round"><path d="M450 150 A300 300 0 0 1 450 750" stroke-width="6" opacity=".35"/><path d="M450 40 A410 410 0 0 1 450 860" stroke-width="4" opacity=".2"/></svg>`;

const page = p => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="grid"></div><div class="orb"></div><div class="orb2"></div>${rings}${grainSvg}
<div class="top"><div class="logo">${LOGO}HE SIGNAL</div><div class="tag">${p.tag}</div></div>
<h1>${p.title}</h1><div class="art">${p.art}</div>
<div class="num"><b>●</b> CHATBOTS · Nº ${p.num}</div><div class="play">Ver reel <span>▶</span></div>
</body></html>`;

(async () => {
  const only = process.argv[2];
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const pg = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  for (const [id, p] of Object.entries(P)) {
    if (only && id !== only) continue;
    await pg.setContent(page(p)); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(200);
    await pg.screenshot({ path: path.join(OUT, `portada_${id}.jpg`), type: 'jpeg', quality: 92 });
    console.log('ok', id);
  }
  await b.close();
})();
