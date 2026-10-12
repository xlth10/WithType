"""Export the selected rice-paper bouncing-bead geometry as SVG/PNG/ICO.

The generated raster concepts are provenance, not edited by this exporter.
Ink-v2 assets are retained. Target platform is Windows, with transparent corners.
"""
from pathlib import Path
import argparse, json, math
from PIL import Image, ImageDraw

PAPER, EDGE, INK, CONTACT = '#f5f5ed', '#d9dacf', '#282c27', '#94978b'
BEADS = [(69.5, 51.5, 21.5), (36.5, 83.5, 14.0), (95.0, 88.5, 8.5)]
FIBERS = [(18,25,30,23), (54,17,67,18), (89,26,106,23), (17,62,28,65), (105,56,112,61), (51,108,64,106), (84,113,96,111)]

def svg():
    fibers = '\n'.join(f'<path d="M{x},{y}l{xx-x},{yy-y}"/>' for x,y,xx,yy in FIBERS)
    beads = '\n'.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{INK}"/>' for x,y,r in BEADS)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<title>墨珠在宣纸上跳动</title>
<rect x="1" y="1" width="126" height="126" rx="28" fill="{PAPER}" stroke="{EDGE}" stroke-width=".65"/>
<g stroke="#d3d4c6" stroke-width=".15" opacity=".2">{fibers}</g>
<g fill="{CONTACT}" opacity=".5"><ellipse cx="36.5" cy="98" rx="12" ry=".8"/><ellipse cx="95" cy="99" rx="7" ry=".65"/></g>
{beads}
</svg>
'''

def render(size):
    scale = size * 4 / 128
    canvas = Image.new('RGBA',(size*4,size*4),(0,0,0,0))
    draw = ImageDraw.Draw(canvas)
    box = lambda values: tuple(v*scale for v in values)
    draw.rounded_rectangle(box((.675,.675,127.325,127.325)),radius=28.325*scale,fill=EDGE)
    draw.rounded_rectangle(box((1.325,1.325,126.675,126.675)),radius=27.675*scale,fill=PAPER)
    if size >= 128:
        # Very low contrast paper fibers; they never support the core silhouette.
        for x,y,xx,yy in FIBERS:
            draw.line(box((x,y,xx,yy)),fill='#eeeede',width=max(1,round(.15*scale)))
    if size >= 48:
        draw.ellipse(box((24.5,97.2,48.5,98.8)),fill='#c5c6ba')
        draw.ellipse(box((88,98.35,102,99.65)),fill='#c5c6ba')
    for x,y,r in BEADS:
        draw.ellipse(box((x-r,y-r,x+r,y+r)),fill=INK)
    return canvas.resize((size,size),Image.Resampling.LANCZOS)

def export(root):
    icons=root/'src-tauri/icons/ink-v3'
    selected=root/'icon-design/ink-v3/selected'
    assets=root/'public/assets'
    for directory in (icons,selected,assets): directory.mkdir(parents=True,exist_ok=True)
    (assets/'typefree-ink-v3.svg').write_text(svg(),encoding='utf-8')
    (selected/'typefree-ink-v3.svg').write_text(svg(),encoding='utf-8')
    master=render(1024)
    master.save(selected/'typefree-ink-v3-master.png')
    sizes=[16,20,24,32,48,64,128,256,512]
    for size in sizes: render(size).save(icons/f'{size}x{size}.png')
    render(512).save(icons/'icon.png')
    render(256).save(icons/'icon.ico',sizes=[(16,16),(20,20),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
    ico=Image.open(icons/'icon.ico')
    assert ico.ico.sizes()=={(x,x) for x in [16,20,24,32,48,64,128,256]}
    assert master.size==(1024,1024) and master.mode=='RGBA'
    assert master.getpixel((0,0))[3]==0 and master.getpixel((64,64))[3]==0
    assert master.getpixel((512,512))[3]==255
    (selected/'asset-validation.json').write_text(json.dumps({'master':[1024,1024],'mode':'RGBA','transparentCorners':True,'icoSizes':sorted(ico.ico.sizes()),'pngSizes':sizes,'smallSizePolicy':'At 16–32px remove paper fibers and contact impressions; retain all three beads.'},indent=2)+'\n')
    print('Exported ink-v3: SVG, 1024px master, nine PNG sizes and eight-frame ICO.')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    export(p.parse_args().root)
