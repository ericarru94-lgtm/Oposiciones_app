const { chromium } = require('/opt/node-tools/node_modules/playwright');
const O='#FF4B2B', N='#10151F', W='#FFFFFF', P='#F1F3EE';
// 1 Constellation bubble
const pts=[[40,52],[100,36],[160,52],[174,104],[150,148],[96,156],[58,186],[62,150],[28,108]];
const c1=(t)=>{const C=[100,100];let s=`<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><g stroke="${t}" stroke-width="2.4" opacity=".55" fill="none">`;
 for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];s+=`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;}
 for(const i of [1,3,5,8]){s+=`<line x1="${C[0]}" y1="${C[1]}" x2="${pts[i][0]}" y2="${pts[i][1]}"/>`;}
 s+=`<line x1="${pts[0][0]}" y1="${pts[0][1]}" x2="${pts[2][0]}" y2="${pts[2][1]}" opacity=".5"/></g>`;
 pts.forEach((p,i)=>{s+=`<circle cx="${p[0]}" cy="${p[1]}" r="${i==3?7:5}" fill="${i==3?O:t}"/>`});
 return s+`<circle cx="100" cy="100" r="11" fill="${O}"/><circle cx="100" cy="100" r="19" fill="none" stroke="${O}" stroke-width="2" opacity=".5"/></svg>`;};
// 2 Circuit monogram
const c2=(t)=>`<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><g stroke="${t}" stroke-width="6" stroke-linecap="round" fill="none">
<path d="M40 61 V139 M85 61 V139 M40 100 H85 M115 61 V139 M115 55 H159 M115 145 H159 M115 100 H150"/></g>
<g fill="${N}" stroke="${t}" stroke-width="4"><circle cx="40" cy="55" r="6"/><circle cx="40" cy="145" r="6"/><circle cx="85" cy="55" r="6"/><circle cx="85" cy="145" r="6"/><circle cx="165" cy="55" r="6"/><circle cx="165" cy="145" r="6"/></g>
<path d="M150 100 H160" stroke="${O}" stroke-width="6" stroke-linecap="round"/><circle cx="170" cy="100" r="9" fill="${O}"/><circle cx="170" cy="100" r="17" fill="none" stroke="${O}" stroke-width="2" opacity=".5"/></svg>`;
// 3 Waveform bubble
const c3=(t)=>{let s=`<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><g stroke-width="5.5" stroke-linecap="round">`;
 for(let x=32;x<=168;x+=8.5){const r=(x-100)/74;let h=Math.sqrt(Math.max(0,1-r*r))*52;const mod=0.55+0.45*Math.abs(Math.sin(x*0.21));h=Math.max(4,h*mod);
  let y1=95-h,y2=95+h; if(x>50&&x<70){y2=Math.max(y2,95+h+ (x<60?34:22));}
  const col=(x>86&&x<118)?O:t; s+=`<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${col}"/>`;}
 return s+`</g></svg>`;};
// 4 Dialogue (two interlocking thin bubbles)
const c4=(t)=>`<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke-width="6" stroke-linejoin="round" stroke-linecap="round">
<path d="M48 36 H112 a20 20 0 0 1 20 20 V92 a20 20 0 0 1 -20 20 H60 L40 130 V112 a20 20 0 0 1 -12 -18 V56 a20 20 0 0 1 20 -20Z" stroke="${t}"/>
<path d="M88 88 H152 a20 20 0 0 1 20 20 V146 a20 20 0 0 1 -12 18 V182 L140 164 H88 a20 20 0 0 1 -20 -20 V108 a20 20 0 0 1 20 -20Z" stroke="${O}"/></g>
<g fill="${O}"><circle cx="102" cy="126" r="5"/><circle cx="120" cy="126" r="5"/><circle cx="138" cy="126" r="5"/></g></svg>`;
const word=(t)=>`<div style="display:flex;flex-direction:column;gap:6px"><span style="font:500 78px 'Space Grotesk';letter-spacing:10px;color:${t};white-space:nowrap">HE SIGNAL</span><span style="font:400 24px 'Inter';letter-spacing:7px;color:${O};white-space:nowrap">AI · CHATBOTS · MARKETING</span></div>`;
const L=[['1','Constelación',c1],['2','Monograma circuito',c2],['3','Onda de voz',c3],['4','Diálogo',c4]];
const html=`<html><head><meta charset="utf-8"><style>body{margin:0;background:#2a2f3a;width:2150px;color:#fff}
.row{display:flex;gap:28px;align-items:center;padding:24px 36px;border-bottom:1px solid #444}
.lab{font:700 54px 'Space Grotesk';width:50px;flex-shrink:0}
.prof{width:240px;height:240px;border-radius:50%;background:${N};display:flex;align-items:center;justify-content:center;flex-shrink:0}.prof svg{width:180px}
.small{width:56px;height:56px;border-radius:50%;background:${N};display:flex;align-items:center;justify-content:center;flex-shrink:0}.small svg{width:44px}
.lock{display:flex;align-items:center;gap:30px;padding:24px 44px;border-radius:20px;height:190px;flex-shrink:0}.lock svg{width:140px;flex-shrink:0}
</style></head><body>${L.map(([k,n,f])=>`<div class="row"><div class="lab">${k}</div><div class="prof">${f(W)}</div><div class="small">${f(W)}</div>
<div class="lock" style="background:${N}">${f(W)}${word(W)}</div><div class="lock" style="background:${P}">${f(N)}${word(N)}</div></div>`).join('')}</body></html>`;
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});const p=await b.newPage({viewport:{width:2150,height:800}});await p.setContent(html);await p.waitForTimeout(300);await p.screenshot({path:'direccion3.png',fullPage:true});await b.close();})();
