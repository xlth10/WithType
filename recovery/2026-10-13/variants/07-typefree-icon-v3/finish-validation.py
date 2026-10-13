from pathlib import Path
from PIL import Image
import shutil,json
root=Path('/Users/outsider/SEVB/Type')
icons=root/'src-tauri/icons/ink-v3'
corners={}
for n in [16,20,24,32,48,64,128,256,512]:
    p=icons/f'{n}x{n}.png'
    assert p.read_bytes()[:8]==b'\x89PNG\r\n\x1a\n'
    im=Image.open(p)
    assert im.size==(n,n) and im.mode=='RGBA'
    corners[n]=max(im.getpixel(x)[3] for x in [(0,0),(n-1,0),(0,n-1),(n-1,n-1)])
    assert corners[n]<=3, (n,corners[n])
ico=Image.open(icons/'icon.ico')
assert ico.ico.sizes()=={(n,n) for n in [16,20,24,32,48,64,128,256]}
master=Image.open(root/'icon-design/ink-v3/selected/typefree-ink-v3-master.png')
assert master.size==(1024,1024) and master.mode=='RGBA' and master.getpixel((0,0))[3]==0
p=root/'icon-design/ink-v3/selected/asset-validation.json'
d=json.loads(p.read_text());d['cornerAlphaMaxBySize']=corners;d['antiAliasTolerance']='0–3 / 255 at tiny corners from Lanczos; 1024px master corners fully transparent.'
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
shutil.copy2(root/'icon-design/ink-v3/exploration/rice-paper-review.md',root/'icon-design/ink-v3/visual-review.md')
print('All PNG/ICO asset checks passed; tiny antialias alpha recorded.')
