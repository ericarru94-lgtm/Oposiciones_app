const { chromium } = require('/opt/node-tools/node_modules/playwright');
const O='#FF4B2B', N='#10151F', W='#FFFFFF', P='#F1F3EE';
const C={
 A:{name:'Ping (señal encendida)', icon:(t)=>`<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="22" fill="${O}"/><circle cx="100" cy="100" r="50" fill="none" stroke="${O}" stroke-width="10" opacity=".55"/><circle cx="100" cy="100" r="80" fill="none" stroke="${O}" stroke-width="7" opacity=".25"/></svg>`,
    word:(t)=>`<span style="font:700 96px 'Space Grotesk';letter-spacing:-4px;color:${t}">he<span style="color:${O}">.</span>signal</span>`},
 B:{name:'S de onda', icon:(t)=>`<svg viewBox="0 0 200 200"><path d="M150 62 A42 42 0 1 0 100 100 A42 42 0 1 1 50 138" stroke="${O}" stroke-width="26" fill="none" stroke-linecap="round"/><circle cx="150" cy="62" r="0" /><circle cx="50" cy="138" r="13" fill="${t}"/></svg>`,
    word:(t)=>`<span style="font:700 96px 'Space Grotesk';letter-spacing:-3px;color:${t}">HE <span style="color:${O}">Signal</span></span>`},
 C:{name:'Barras de cobertura', icon:(t)=>`<svg viewBox="0 0 200 200"><rect x="30" y="122" width="26" height="40" rx="7" fill="${t}"/><rect x="68" y="96" width="26" height="66" rx="7" fill="${t}"/><rect x="106" y="68" width="26" height="94" rx="7" fill="${t}"/><rect x="144" y="38" width="26" height="124" rx="7" fill="${O}"/></svg>`,
    word:(t)=>`<span style="font:700 96px 'Space Grotesk';letter-spacing:-3px;color:${t}">HE Signal</span>`},
 D:{name:'Pulso', icon:(t)=>`<svg viewBox="0 0 200 200"><rect x="10" y="10" width="180" height="180" rx="44" fill="${O}"/><path d="M34 104 H70 L84 70 L104 140 L120 88 L130 104 H166" stroke="${W}" stroke-width="13" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    word:(t)=>`<span style="font:600 96px 'Space Grotesk';letter-spacing:-3px;color:${t}">he signal</span>`}};
const html=`<html><head><meta charset="utf-8"><style>body{margin:0;background:#2a2f3a;width:1900px;color:#fff}
.prof,.small,.lock svg,.prof svg{flex-shrink:0}.lock span{white-space:nowrap}.row{flex-wrap:nowrap}
.row{display:flex;gap:28px;align-items:center;padding:24px 36px;border-bottom:1px solid #444}
.lab{font:700 54px 'Space Grotesk';width:50px}
.prof{width:240px;height:240px;border-radius:50%;background:${N};display:flex;align-items:center;justify-content:center}.prof svg{width:170px}
.small{width:56px;height:56px;border-radius:50%;background:${N};display:flex;align-items:center;justify-content:center}.small svg{width:40px}
.lock{display:flex;align-items:center;gap:26px;padding:24px 40px;border-radius:20px;height:190px;flex-shrink:0}.lock svg{width:130px}
</style></head><body>${Object.entries(C).map(([k,c])=>`<div class="row"><div class="lab">${k}</div><div class="prof">${c.icon(W)}</div><div class="small">${c.icon(W)}</div>
<div class="lock" style="background:${N}">${c.icon(W)}${c.word(W)}</div><div class="lock" style="background:${P}">${c.icon(N)}${c.word(N)}</div></div>`).join('')}</body></html>`;
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});const p=await b.newPage({viewport:{width:1900,height:800}});await p.setContent(html);await p.waitForTimeout(300);await p.screenshot({path:'direccion2.png',fullPage:true});await b.close();})();
