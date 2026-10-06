const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs=require('fs');
const O='#FF4B2B', N='#10151F', W='#FFFFFF', P='#F1F3EE';
const icon=(b,t,a)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><path d="M38 40 H142 a26 26 0 0 1 26 26 V122 a26 26 0 0 1 -26 26 H82 L50 174 V148 H38 a26 26 0 0 1 -26 -26 V66 a26 26 0 0 1 26 -26Z" fill="${b}"/><text x="90" y="118" text-anchor="middle" font-family="Space Grotesk" font-weight="700" font-size="62" fill="${t}" letter-spacing="-2">HE</text><path d="M158 30 a22 22 0 0 1 22 22" stroke="${a}" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M160 10 a40 40 0 0 1 32 32" stroke="${a}" stroke-width="7" fill="none" stroke-linecap="round"/></svg>`;
const pages={
 'perfil-instagram.png':[1080,1080,`<div style="width:1080px;height:1080px;background:${N};display:flex;align-items:center;justify-content:center"><div style="width:720px;margin:40px 0 0 -20px">${icon(O,W,O)}</div></div>`],
 'perfil-naranja.png':[1080,1080,`<div style="width:1080px;height:1080px;background:${O};display:flex;align-items:center;justify-content:center"><div style="width:720px;margin:40px 0 0 -20px">${icon(N,W,N)}</div></div>`],
 'favicon-512.png':[512,512,`<div style="width:512px;height:512px;background:transparent;display:flex;align-items:center;justify-content:center"><div style="width:500px">${icon(O,W,O)}</div></div>`],
 'logo-horizontal-oscuro.png':[1600,500,`<div style="width:1600px;height:500px;background:${N};display:flex;align-items:center;justify-content:center;gap:40px"><div style="width:260px">${icon(O,W,O)}</div><span style="font-family:'Space Grotesk';font-weight:700;font-size:190px;color:${W};letter-spacing:-5px">HE <span style="color:${O}">Signal</span></span></div>`],
 'logo-horizontal-claro.png':[1600,500,`<div style="width:1600px;height:500px;background:${P};display:flex;align-items:center;justify-content:center;gap:40px"><div style="width:260px">${icon(O,W,O)}</div><span style="font-family:'Space Grotesk';font-weight:700;font-size:190px;color:${N};letter-spacing:-5px">HE <span style="color:${O}">Signal</span></span></div>`]};
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
for(const [f,[w,h,body]] of Object.entries(pages)){const p=await b.newPage({viewport:{width:w,height:h}});await p.setContent(`<html><head><meta charset="utf-8"><style>body{margin:0;background:transparent}</style></head><body>${body}</body></html>`);await p.waitForTimeout(200);await p.screenshot({path:f,omitBackground:f.startsWith('favicon')});await p.close();}
await b.close();
fs.writeFileSync('icono.svg',icon(O,W,O));})();
