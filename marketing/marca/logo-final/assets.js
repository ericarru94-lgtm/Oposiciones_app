const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs=require('fs'); const mark=require('./mark.js');
const O='#FF4B2B', N='#10151F', W='#FFFFFF', P='#F1F3EE';
const TAG='IA · CHATBOTS · MARKETING';
const bold={sw:10,tr:8,tw:6}; // heavier version for small sizes
const sq=(s,bg,t,scale,opt)=>[s,s,`<div style="width:${s}px;height:${s}px;background:${bg};display:flex;align-items:center;justify-content:center"><div style="width:${s*scale}px">${mark(t,bg,opt)}</div></div>`];
const lock=(w,h,bg,t,iconW,fs,ts)=>[w,h,`<div style="width:${w}px;height:${h}px;background:${bg};display:flex;align-items:center;justify-content:center;gap:${fs*0.35}px">
<div style="width:${iconW}px">${mark(t,bg)}</div><div style="display:flex;flex-direction:column;gap:${fs*0.12}px">
<span style="font:500 ${fs}px 'Space Grotesk';letter-spacing:${fs*0.13}px;color:${t};white-space:nowrap">HE SIGNAL</span>
<span style="font:500 ${ts}px 'Inter';letter-spacing:${ts*0.32}px;color:${O};white-space:nowrap">${TAG}</span></div></div>`];
const out={
 'instagram/perfil-instagram-1080.png':sq(1080,N,W,0.76,bold),
 'whatsapp/perfil-whatsapp-640.png':sq(640,N,W,0.76,bold),
 'linkedin/logo-linkedin-400.png':sq(400,N,W,0.76,bold),
 'linkedin/portada-linkedin-1128x191.png':lock(1128,191,N,W,120,52,15),
 'web/logo-icon.png':sq(512,N,W,0.72,bold),
 'web/favicon.png':sq(64,N,W,0.86,{sw:13,tr:9,tw:8}),
 'web/apple-touch-icon.png':sq(180,N,W,0.74,bold),
 'web/og-image.png':[1200,630,`<div style="width:1200px;height:630px;background:${N};display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box;gap:40px">
<div style="display:flex;align-items:center;gap:34px"><div style="width:150px">${mark(W,N)}</div><div style="display:flex;flex-direction:column;gap:10px"><span style="font:500 76px 'Space Grotesk';letter-spacing:10px;color:${W}">HE SIGNAL</span><span style="font:500 22px Inter;letter-spacing:7px;color:${O}">${TAG}</span></div></div>
<div style="font:600 46px 'Space Grotesk';color:${W};line-height:1.2;max-width:950px">Chatbots de WhatsApp e Instagram que responden al instante y agendan clases de prueba.</div>
<div style="font:500 26px Inter;color:#B7BCC9">Academias · Autoescuelas · Gimnasios · Barcelona y toda España</div></div>`],
 'general/logo-horizontal-oscuro.png':lock(1800,560,N,W,260,120,34),
 'general/logo-horizontal-claro.png':lock(1800,560,P,N,260,120,34),
 'general/logo-horizontal-transparente-blanco.png':lock(1800,560,'transparent',W,260,120,34),
 'general/logo-horizontal-transparente-oscuro.png':lock(1800,560,'transparent',N,260,120,34),
 'general/icono-transparente-blanco.png':sq(1024,'transparent',W,0.9),
 'general/icono-transparente-oscuro.png':sq(1024,'transparent',N,0.9),
};
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
for(const [f,[w,h,body]] of Object.entries(out)){fs.mkdirSync(require('path').dirname('out/'+f),{recursive:true});
 const p=await b.newPage({viewport:{width:w,height:h}});await p.setContent(`<html><head><meta charset="utf-8"><style>body{margin:0;background:transparent}</style></head><body>${body}</body></html>`);await p.waitForTimeout(150);
 await p.screenshot({path:'out/'+f,omitBackground:f.includes('transparente')});await p.close();}
await b.close();
fs.mkdirSync('out/general',{recursive:true});
fs.writeFileSync('out/general/icono-blanco.svg',mark(W,N)); fs.writeFileSync('out/general/icono-oscuro.svg',mark(N,P));
})();
