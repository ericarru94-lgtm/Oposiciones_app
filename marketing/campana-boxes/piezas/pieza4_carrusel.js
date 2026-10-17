// Uso: node pieza4_carrusel.js  (genera pieza4_slideN.png, 1080x1350)
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const slides = [
 {cover:true, kicker:'Desliza →', title:"5 mensajes que llegan a tu box <span class='acc'>de noche</span>", body:'Y qué contestar para que acaben en clase de prueba.'},
 {n:'1', q:'¿Hacéis clase de prueba?', a:'¡Sí! La primera es gratis. ¿Martes 19:00 o jueves 20:00?', tip:'Ofrece dos horas. «¿Cuándo te va bien?» alarga la conversación.'},
 {n:'2', q:'¿Cuánto cuesta?', a:'Ilimitado 85 €/mes, con la primera clase gratis. ¿Te reservo una?', tip:'Precio, qué incluye y siguiente paso. Nada de «te lo paso por privado».'},
 {n:'3', q:'Nunca he hecho crossfit, ¿puedo?', a:'Claro, la mayoría empieza de cero. El coach adapta cada ejercicio a tu nivel.', tip:'Detrás de esta pregunta hay miedo. Quítalo antes de vender nada.'},
 {n:'4', q:'¿Qué horarios tenéis?', a:'Mañanas de 7 a 9 y tardes de 18 a 21. ¿Te va mejor mañana o tarde?', tip:'Termina con una pregunta fácil. La conversación sigue viva.'},
 {n:'5', q:'Tengo una lesión de hombro…', a:'Gracias por contarlo. Mañana a primera hora te escribe el coach.', tip:'Esta no la contesta un bot. Siempre una persona.'},
 {title:"Las 4 primeras se contestan <span class='acc'>casi igual siempre.</span>", body:'Un asistente puede hacerlo a las 22:47, reservar la clase y pasarte la quinta a ti.'},
 {end:true, title:'¿Cuánto tarda tu box en contestar de noche?', body:'Comenta <b class="acc">PRUEBA</b> y te hago el test gratis: te escribo como cliente y te paso el resultado.', url:'hesignalagency.com'}];
const css=`*{margin:0;box-sizing:border-box}body{width:1080px;height:1350px;background:#10151F;color:#fff;font-family:'Inter',sans-serif;position:relative;overflow:hidden}
.g1{position:absolute;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle,rgba(255,75,43,.20),transparent 65%);left:-260px;top:-300px}
.g2{position:absolute;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,rgba(255,75,43,.10),transparent 65%);right:-300px;bottom:-250px}
.acc{color:#FF4B2B}.wrap{position:absolute;left:96px;right:96px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
.n{font-family:'Space Grotesk';font-size:150px;font-weight:bold;color:#FF4B2B;line-height:1;margin-bottom:30px}
h1{font-family:'Space Grotesk';font-size:84px;line-height:1.1;letter-spacing:-1px}.cover h1{font-size:100px}
p{font-size:46px;line-height:1.4;color:#C9D2E0;margin-top:44px}
.q{align-self:flex-end;max-width:80%;background:#263142;border-radius:30px 30px 6px 30px;padding:26px 34px;font-size:44px;line-height:1.3}
.a{align-self:flex-start;max-width:85%;background:#FF4B2B;border-radius:30px 30px 30px 6px;padding:26px 34px;font-size:42px;line-height:1.3;margin-top:28px}
.tip{font-size:38px;line-height:1.4;color:#C9D2E0;margin-top:56px;border-left:6px solid #FF4B2B;padding-left:28px}
.foot{position:absolute;left:96px;right:96px;bottom:70px;display:flex;justify-content:space-between;font-size:30px;color:#7F8BA0;font-weight:bold}
.kick{display:inline-block;margin-top:60px;font-size:36px;font-weight:bold;color:#fff;background:#FF4B2B;padding:14px 32px;border-radius:40px;align-self:flex-start}
.url{display:inline-block;margin-top:60px;font-size:40px;font-weight:bold;border:3px solid #FF4B2B;padding:16px 36px;border-radius:50px;align-self:flex-start}`;
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1080,height:1350}});
for(const [i,s] of slides.entries()){
 const inner = s.q
  ? `<div class="n">${s.n}</div><div class="q">${s.q}</div><div class="a">${s.a}</div><div class="tip">${s.tip}</div>`
  : `<h1>${s.title}</h1><p>${s.body}</p>${s.kicker?`<span class="kick">${s.kicker}</span>`:''}${s.url?`<span class="url">${s.url}</span>`:''}`;
 const html=`<html><head><meta charset="utf-8"><style>${css}</style></head><body class="${s.cover?'cover':''}"><div class="g1"></div><div class="g2"></div>
 <div class="wrap">${inner}</div><div class="foot"><span>@hesignalagency</span><span>${i+1}/${slides.length}</span></div></body></html>`;
 await p.setContent(html); await p.screenshot({path:`pieza4_slide${i+1}.png`});}
await b.close();})();
