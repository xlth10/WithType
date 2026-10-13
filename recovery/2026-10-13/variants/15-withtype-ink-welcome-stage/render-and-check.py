from pathlib import Path
import ast, hashlib, json, subprocess, time
import numpy as np
from PIL import Image, ImageChops

native=Path('/private/tmp/withtype-ink-welcome-frames')
source=Path('/private/tmp/withtype-ink-welcome-draft-samples')
target=Path('/private/tmp/withtype-ink-welcome-draft')
frames=target/'frames';frames.mkdir(parents=True,exist_ok=True)
plan=json.loads((source/'render-plan.json').read_text())
start=time.monotonic()
srgb=np.arange(256,dtype=np.float32)/255
lut=np.where(srgb<=.04045,srgb/12.92,((srgb+.055)/1.055)**2.4)
for f in plan['frames']:
    images=[source/f"{f['frame']:04}-{j}.jpg" for j in range(f['count'])]
    if f['count']==1:
        result=Image.open(images[0]).convert('RGB')
        assert result.size==(1920,1080)
    else:
        total=np.zeros((1080,1920,3),dtype=np.float32)
        for p in images:
            im=Image.open(p).convert('RGB');assert im.size==(1920,1080)
            total+=lut[np.asarray(im)]
        linear=total/f['count']
        out=np.where(linear<=.0031308,12.92*linear,1.055*np.maximum(linear,0)**(1/2.4)-.055)
        result=Image.fromarray(np.round(np.clip(out,0,1)*255).astype(np.uint8))
    result.save(frames/f"{f['frame']:04}.png")
subprocess.run(['/opt/homebrew/bin/ffmpeg','-y','-loglevel','error','-framerate','30','-i',str(frames/'%04d.png'),'-c:v','libx264','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',str(target/'draft.mp4')],check=True)
info={**plan,'renderer':'CUA keyboard-accessible deterministic frame viewer, 4 midpoint samples per moving shutter, averaged in linear light','stillFrameCount':sum(f['count']==1 for f in plan['frames']),'audio':False,'captureSize':[1920,1080],'encodedSize':[1920,1080],'normalization':'None. Explicit screenshot rectangle captures the whole frame.','integrationAndEncodeSeconds':round(time.monotonic()-start,2)}
(target/'draft.render.json').write_text(json.dumps(info,indent=2)+'\n')

ims=[Image.open(native/f'{i:04}.jpg').convert('RGB') for i in range(97)]
durations=[(round((i+1)/30*100)-round(i/30*100))*10 for i in range(96)]+[1200]
ims[0].save(native/'opening-ink-welcome.gif',save_all=True,append_images=ims[1:],duration=durations,loop=0,optimize=True)
def same(a,b):
    a,b=Image.open(native/a).convert('RGB'),Image.open(native/b).convert('RGB')
    return a.size==b.size and ImageChops.difference(a,b).getbbox() is None
data=json.loads((native/'dom-samples.json').read_text())
checks={
    'nativeFrameCount':len(data['samples']),
    'noOverflow':all(not s['overflow'] for s in data['samples']),
    'inkWithinFrame':all(s['inkBox']['x']>=-.01 and s['inkBox']['y']>=-.01 and s['inkBox']['x']+s['inkBox']['w']<=s['W']+.01 and s['inkBox']['y']+s['inkBox']['h']<=s['H']+.01 for s in data['samples'] if s['inkOpacity']>.05),
    'deterministic0600':same('0018.jpg','determinism-0600.jpg'),
    'welcomeRestPixelIdentical':all(same('0049.jpg',f'{i:04}.jpg') for i in range(50,70)),
    'restSampleWindowSeconds':[49/30,69/30],
    'finalMatchesHydratedVersionA':same('0096.jpg','version-a-ready.jpg'),
    'gifAnimationDurationMs':sum(durations[:-1]),
    'gifFinalHoldMs':durations[-1],
    'draftFrames':97,'draftCaptures':plan['captures'],
    'browser':json.loads((native/'browser-checks.json').read_text()),
}
assert checks['noOverflow'] and checks['inkWithinFrame'] and checks['deterministic0600']
assert checks['welcomeRestPixelIdentical'] and checks['finalMatchesHydratedVersionA']
assert checks['gifAnimationDurationMs']==3200
assert checks['browser']['click']['finished']=='true'
assert checks['browser']['keyboard']=={'finished':'true','focus':'开始','inert':False}
assert checks['browser']['reduced']['finished']=='true'
assert checks['browser']['normalPreview']['finished']=='true'

# Original OneTake numerical routines on current CUA DOM observations; no second browser.
probe=Path('/Users/outsider/.codex/skills/onetake/scripts/probe.py')
tree=ast.parse(probe.read_text())
tree.body=[n for n in tree.body if not(isinstance(n,ast.ImportFrom) and n.module=='playwright.async_api')]
ns={'__name__':'onetake_offline','__file__':str(probe)}
exec(compile(tree,str(probe),'exec'),ns)
samples=[]
for s in data['samples']:
    r=s['inkBox'];items=[]
    if s['inkOpacity']>=.05:
        items.append({'id':'ink','x':r['x']+r['w']/2,'y':r['y']+r['h']/2,'w':r['w'],'h':r['h'],'op':s['inkOpacity'],'vis':1})
    samples.append([s['t'],items])
observed={'comp':'comp.html','W':1060,'H':720,'fps':30,'dur':3.2,'samples':samples,'annotated':True,'failed':[],'errors':[],'meta':{'cuts':[],'beats':data['beats'],'inFrame':{'ink':[0,2.76,'whole']}}}
continuity,curves=ns['continuity'](observed),ns['curves'](observed)
checks['continuity']=continuity
checks['curves']={k:v for k,v in curves.items() if k!='tracks'}
checks['oracleLimits']='The film oracle exempts the last 1.2 seconds and tracks the ink canvas bounding box, not every glyph or material boundary. Rest/framing/pixel checks and the authored script remain necessary.'
checks['curvesPlot']='Not generated: optional matplotlib is unavailable; original numerical curves and continuity functions ran successfully.'
(native/'checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:checks[k] for k in ['nativeFrameCount','noOverflow','inkWithinFrame','deterministic0600','welcomeRestPixelIdentical','finalMatchesHydratedVersionA','gifAnimationDurationMs','draftFrames','draftCaptures']},indent=2),flush=True)
