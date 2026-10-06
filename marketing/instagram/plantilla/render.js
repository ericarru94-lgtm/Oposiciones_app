// Usage: node render.js scene.json out.mp4
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs'), { execFileSync } = require('child_process'), path = require('path');
const [,, sceneFile, out] = process.argv;
const S = JSON.parse(fs.readFileSync(sceneFile, 'utf8'));
const FPS = 30, W = 1080, H = 1920;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:${W}px;height:${H}px;background:#10151F;font-family:'Inter',sans-serif;color:#fff;overflow:hidden;position:relative}
.glow{position:absolute;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle,rgba(255,75,43,.18),transparent 65%);left:-200px;top:-250px}
.glow2{position:absolute;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle,rgba(255,75,43,.10),transparent 65%);right:-300px;bottom:-200px}
.el{position:absolute;left:80px;right:80px;opacity:0}
.big{font-family:'Space Grotesk';font-weight:bold;font-size:84px;line-height:1.12;letter-spacing:-1px}
.mid{font-family:'Space Grotesk';font-weight:bold;font-size:60px;line-height:1.18}
.step{font-family:'Space Grotesk';font-weight:bold;font-size:50px;line-height:1.25}
.small{font-size:42px;line-height:1.35;color:#C9D2E0}
.tag{display:inline-block;font-size:34px;font-weight:bold;color:#fff;background:#FF4B2B;padding:10px 24px;border-radius:40px}
.acc{color:#FF4B2B}
.phone{position:absolute;left:110px;right:110px;top:520px;bottom:300px;background:#0B141A;border-radius:56px;border:6px solid #263142;opacity:0;overflow:hidden}
.ph-head{background:#1F2C34;height:150px;display:flex;align-items:center;padding:0 40px;gap:26px}
.av{width:84px;height:84px;border-radius:50%;background:#FF4B2B;color:#fff;font-weight:bold;font-size:36px;display:flex;align-items:center;justify-content:center}
.ph-name{font-size:38px;font-weight:bold}.ph-sub{font-size:28px;color:#12B76A}
.msgs{position:absolute;left:30px;right:30px;top:180px;display:flex;flex-direction:column;gap:22px}
.b{max-width:80%;padding:22px 28px 16px;border-radius:26px;font-size:36px;line-height:1.3;opacity:0}
.b.in{align-self:flex-start;background:#FF4B2B;border-top-left-radius:6px}
.b.out{align-self:flex-end;background:#263142;border-top-right-radius:6px}
.b .t{display:block;text-align:right;font-size:24px;color:#9FB0BA;margin-top:6px}
.b.in .t{color:#FFD9CF}
.typing{align-self:flex-start;background:#FF4B2B;border-radius:26px;padding:24px 30px;font-size:40px;letter-spacing:6px;opacity:0}
.brand{position:absolute;bottom:90px;left:0;right:0;text-align:center;font-size:34px;color:#7F8BA0;font-weight:bold}
.bar{position:absolute;top:0;left:0;height:10px;background:#FF4B2B}
</style></head><body><div class="glow"></div><div class="glow2"></div><div class="bar" id="bar"></div>
<div id="root"></div><div class="brand">@hesignalagency</div>
<script>
const S=${JSON.stringify(S)};
const root=document.getElementById('root');
const els=[];
S.items.forEach((it,i)=>{
  let e;
  if(it.type==='phone'){e=document.createElement('div');e.className='phone';
    e.innerHTML='<div class="ph-head"><div class="av">'+it.initials+'</div><div><div class="ph-name">'+it.name+'</div><div class="ph-sub">en línea</div></div></div><div class="msgs" id="msgs"></div>';
    root.appendChild(e);}
  else if(it.type==='in'||it.type==='out'||it.type==='typing'){
    e=document.createElement('div');
    if(it.type==='typing'){e.className='typing';e.textContent='• • •';}
    else{e.className='b '+it.type;e.innerHTML=it.text+'<span class="t">'+(it.time||'')+'</span>';}
    document.getElementById('msgs').appendChild(e);}
  else{e=document.createElement('div');e.className='el '+(it.cls||'big');e.style.top=it.top+'px';e.innerHTML=it.text;root.appendChild(e);}
  els.push([it,e]);
});
const ease=x=>1-Math.pow(1-Math.min(Math.max(x,0),1),3);
window.render=t=>{
  document.getElementById('bar').style.width=(t/S.duration*100)+'%';
  for(const [it,e] of els){
    const a=ease((t-it.at)/0.45);
    const out=it.until!==undefined?ease((t-it.until)/0.35):0;
    const o=a*(1-out);
    e.style.opacity=o;
    e.style.display=(it.until!==undefined&&t>it.until+0.4)||(it.type==='typing'&&t<it.at)?'none':'';
    if(it.type!=='phone') e.style.transform='translateY('+((1-a)*40)+'px) scale('+(it.pop?(0.9+0.1*a):1)+')';
  }
};
</script></body></html>`;
(async () => {
  const dir = fs.mkdtempSync('/tmp/frames-');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  await p.setContent(html);
  const n = Math.round(S.duration * FPS);
  for (let i = 0; i < n; i++) {
    await p.evaluate(t => window.render(t), i / FPS);
    await p.screenshot({ path: path.join(dir, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  await b.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%05d.jpg'),
    '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`, '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', out]);
  // cover frame
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(S.cover ?? 1.5), '-i', out, '-frames:v', '1', out.replace('.mp4', '_portada.jpg')]);
  fs.rmSync(dir, { recursive: true });
  console.log('ok', out, n, 'frames');
})();
