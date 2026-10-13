import json,subprocess,sys
scene,video,out=sys.argv[1:4]
S=json.load(open(scene)); d=S['duration']
ev=[it['at'] for it in S['items'] if it.get('type') in ('in','out','text','phone')]
pops='+'.join(f"sin(2*PI*{(660 if i%2 else 880)}*t)*exp(-28*(t-{a+0.05:.2f}))*between(t,{a+0.05:.2f},{a+0.35:.2f})" for i,a in enumerate(ev))
# soft pad: A minor 9 chord with slow tremolo
pad="0.5*(sin(2*PI*110*t)+0.7*sin(2*PI*164.8*t)+0.6*sin(2*PI*220*t)+0.4*sin(2*PI*261.6*t)+0.3*sin(2*PI*329.6*t))*(0.75+0.25*sin(2*PI*0.25*t))"
# soft pulse every 0.5s
pulse="sin(2*PI*55*t)*exp(-12*mod(t,0.5))"
expr=f"0.05*({pad})+0.10*({pulse})+0.22*({pops})"
subprocess.run(['ffmpeg','-y','-loglevel','error','-i',video,'-f','lavfi','-i',f"aevalsrc='{expr}':s=44100:d={d}",
 '-filter_complex','[1:a]afade=t=in:d=0.8,afade=t=out:st=%.2f:d=1.2,lowpass=f=4000,volume=3.2[a]'%(d-1.2),
 '-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','160k','-shortest',out],check=True)
print('ok',out)
