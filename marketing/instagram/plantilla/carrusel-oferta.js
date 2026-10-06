const { chromium } = require('/opt/node-tools/node_modules/playwright');
const slides = [
 {cover:true, kicker:'Desliza →', title:"Buscamos <span class='acc'>3 centros</span>", body:'Academias, autoescuelas o gimnasios. Plazas limitadas este mes.'},
 {title:'Qué montamos', body:'Un chatbot de WhatsApp e Instagram que contesta horarios, precios y plazas al momento, y agenda clases de prueba. Con tus datos y tu tono.'},
 {title:'Cómo lo hacemos', body:"<span class='acc'><b>01</b></span> · Auditoría: vemos dónde se pierden consultas.<br><br><span class='acc'><b>02</b></span> · Puesta en marcha: en unos días.<br><br><span class='acc'><b>03</b></span> · Ajuste: revisamos conversaciones reales."},
 {title:"Qué te llevas por ser <span class='acc'>de los primeros</span>", body:'Precio de lanzamiento y prioridad en soporte durante el primer mes.'},
 {title:"Somos una agencia joven, <span class='acc'>y lo decimos claro.</span>", body:'Preferimos pocos centros bien atendidos que muchos a medias. Todo en remoto, para toda España.'},
 {end:true, title:"¿Quieres una de las <span class='acc'>3 plazas</span>?", body:'Escríbenos <b class="acc">PILOTO</b> por mensaje directo o reserva tu sesión gratuita de 30 min.', url:'hesignalagency.com'}];
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
 ${s.cover?'<div class="bub">Quiero una plaza 🙋</div><div class="bub2">¿Seguís teniendo hueco?</div>':''}
 <div class="wrap">${s.n?`<div class="n">${s.n}</div>`:''}<h1>${s.title}</h1><p>${s.body}</p>${s.kicker?`<span class="kick">${s.kicker}</span>`:''}${s.url?`<span class="url">${s.url}</span>`:''}</div>
 <div class="foot"><span>@hesignalagency</span><span>${i+1}/${slides.length}</span></div></body></html>`;
 await p.setContent(html); await p.screenshot({path:`oferta${i+1}.png`});}
await b.close();})();
