const { chromium } = require('/opt/node-tools/node_modules/playwright');
const slides = [
 {cover:true, kicker:'Desliza →', title:"Las <span class='acc'>5 preguntas</span> que tu centro contesta cada día", body:'(y que podrías dejar de contestar tú)'},
 {n:'1', title:'¿Cuánto cuesta?', body:'Si respondes «te lo paso por privado», mucha gente no vuelve a preguntar. Precio claro y qué incluye.'},
 {n:'2', title:'¿Qué horarios tenéis?', body:'Llega a las 23:00, con el centro cerrado. Quien contesta primero se queda con el alumno.'},
 {n:'3', title:'¿Quedan plazas?', body:'La respuesta cambia cada semana. La pregunta es siempre la misma.'},
 {n:'4', title:'¿Hay clase de prueba?', body:'Es la pregunta más cerca de una matrícula. No debería esperar hasta mañana.'},
 {n:'5', title:'¿Dónde estáis y cómo me apunto?', body:'Ubicación, enlace y siguiente paso. En un solo mensaje.'},
 {title:"Estas 5 respuestas <span class='acc'>casi no cambian.</span>", body:'Un chatbot las contesta al momento, 24/7, agenda la clase de prueba y avisa a tu equipo solo cuando hace falta una persona.'},
 {end:true, title:'¿Cómo respondéis hoy?', body:'Comenta <b class="acc">CHATBOT</b> y te mandamos una auditoría gratuita de tu WhatsApp e Instagram.', url:'hesignalagency.com'}];
const css=`*{margin:0;box-sizing:border-box}body{width:1080px;height:1350px;background:#10151F;color:#fff;font-family:'Inter',sans-serif;position:relative;overflow:hidden}
.g1{position:absolute;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle,rgba(255,75,43,.20),transparent 65%);left:-260px;top:-300px}
.g2{position:absolute;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,rgba(255,75,43,.10),transparent 65%);right:-300px;bottom:-250px}
.acc{color:#FF4B2B}.wrap{position:absolute;left:96px;right:96px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
.n{font-family:'Space Grotesk';font-size:220px;font-weight:bold;color:#FF4B2B;line-height:1;margin-bottom:20px}
h1{font-family:'Space Grotesk';font-size:84px;line-height:1.1;letter-spacing:-1px}.cover h1{font-size:104px}
p{font-size:46px;line-height:1.4;color:#C9D2E0;margin-top:44px}
.bub{position:absolute;right:96px;top:110px;background:#FF4B2B;border-radius:30px 30px 6px 30px;padding:22px 30px;font-size:34px}
.bub2{position:absolute;right:220px;top:210px;background:#202C33;border-radius:30px 30px 30px 6px;padding:22px 30px;font-size:34px;color:#C9D2E0}
.foot{position:absolute;left:96px;right:96px;bottom:70px;display:flex;justify-content:space-between;font-size:30px;color:#7F8BA0;font-weight:bold}
.kick{display:inline-block;margin-top:60px;font-size:36px;font-weight:bold;color:#fff;background:#FF4B2B;padding:14px 32px;border-radius:40px;align-self:flex-start}
.url{display:inline-block;margin-top:60px;font-size:40px;font-weight:bold;border:3px solid #FF4B2B;padding:16px 36px;border-radius:50px;align-self:flex-start}`;
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1080,height:1350}});
for(const [i,s] of slides.entries()){
 const html=`<html><head><meta charset="utf-8"><style>${css}</style></head><body class="${s.cover?'cover':''}"><div class="g1"></div><div class="g2"></div>
 ${s.cover?'<div class="bub">¿Horarios? 🕘</div><div class="bub2">¿Precio?</div>':''}
 <div class="wrap">${s.n?`<div class="n">${s.n}</div>`:''}<h1>${s.title}</h1><p>${s.body}</p>${s.kicker?`<span class="kick">${s.kicker}</span>`:''}${s.url?`<span class="url">${s.url}</span>`:''}</div>
 <div class="foot"><span>@hesignalagency</span><span>${i+1}/${slides.length}</span></div></body></html>`;
 await p.setContent(html); await p.screenshot({path:`slide${i+1}.png`});}
await b.close();})();
