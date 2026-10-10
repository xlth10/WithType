"""Export the selected ink-path v2 geometry as SVG, PNG and Windows ICO.

Requires Pillow. Reconstructs authored vector geometry, never modifies the
reference or generated concept images. Legacy icons and generator are retained.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / 'src-tauri' / 'icons' / 'ink-v2'
PAPER, EDGE, INK, BRUSH = '#f1f4eb', '#d3d6cb', '#282c27', '#52564e'
# Each command uses the same 128-unit geometry for SVG and raster exports.
RIBBON = [
    ('M', (63, 112)),
    ('C', (22, 106), (24, 94), (47, 90)),
    ('C', (82, 84), (113, 74), (93, 64)),
    ('C', (70, 55), (68, 56), (94, 45)),
    ('C', (112, 37), (111, 34), (100, 33)),
    ('C', (123, 34), (119, 43), (92, 53)),
    ('C', (81, 57), (82, 58), (99, 63)),
    ('C', (129, 76), (103, 92), (61, 99)),
    ('C', (40, 103), (42, 108), (63, 112)),
    ('Z',),
]
CRESCENT = [
    ('M', (31, 72)),
    ('C', (26, 61), (31, 51), (46, 49)),
    ('C', (36, 54), (31, 62), (31, 72)),
    ('Z',),
]
BEADS = [(46, 66, 20), (78, 38.5, 9.5), (101, 26.5, 5.2)]


def path_data(commands):
    return ' '.join(command[0] + ' '.join(f'{x:g},{y:g}' for x, y in command[1:]) for command in commands)


def polygon(commands):
    """Sample cubic curves for supersampled raster output."""
    points = []
    for command in commands:
        if command[0] == 'M':
            current = command[1]
            points.append(current)
        elif command[0] == 'C':
            p0, p1, p2, p3 = current, *command[1:]
            for step in range(1, 65):
                t = step / 64
                u = 1 - t
                points.append(tuple(u**3*p0[i] + 3*u*u*t*p1[i] + 3*u*t*t*p2[i] + t**3*p3[i] for i in (0, 1)))
            current = p3
    return points


def svg():
    beads = '\n'.join(f'  <circle cx="{x:g}" cy="{y:g}" r="{radius:g}" fill="{INK}"/>' for x, y, radius in BEADS)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect x="1" y="1" width="126" height="126" rx="29" fill="{PAPER}" stroke="{EDGE}" stroke-width="1"/>
  <path d="{path_data(RIBBON)}" fill="{BRUSH}"/>
{beads}
  <path d="{path_data(CRESCENT)}" fill="{PAPER}"/>
</svg>
'''


def render(size):
    factor = 4
    unit = size * factor / 128
    canvas = Image.new('RGBA', (size * factor, size * factor), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    def box(values):
        return tuple(round(v * unit) for v in values)
    draw.rounded_rectangle(box((0.5, 0.5, 127.5, 127.5)), radius=round(29.5*unit), fill=EDGE)
    draw.rounded_rectangle(box((1.5, 1.5, 126.5, 126.5)), radius=round(28.5*unit), fill=PAPER)
    draw.polygon([(x*unit, y*unit) for x, y in polygon(RIBBON)], fill=BRUSH)
    for x, y, radius in BEADS:
        draw.ellipse(box((x-radius, y-radius, x+radius, y+radius)), fill=INK)
    draw.polygon([(x*unit, y*unit) for x, y in polygon(CRESCENT)], fill=PAPER)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == '__main__':
    ICONS.mkdir(parents=True, exist_ok=True)
    assets = ROOT / 'public' / 'assets'
    assets.mkdir(parents=True, exist_ok=True)
    (assets / 'typefree-ink-v2.svg').write_text(svg(), encoding='utf-8')
    for size, name in [(16, '16x16.png'), (20, '20x20.png'), (24, '24x24.png'), (32, '32x32.png'), (48, '48x48.png'), (64, '64x64.png'), (128, '128x128.png'), (256, '128x128@2x.png'), (512, 'icon.png')]:
        render(size).save(ICONS / name)
    render(256).save(ICONS / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    selected = ROOT / 'icon-design' / 'selected'
    selected.mkdir(parents=True, exist_ok=True)
    render(1024).save(selected / 'typefree-ink-v2-master.png')
    (selected / 'typefree-ink-v2.svg').write_text(svg(), encoding='utf-8')
    print('Exported ink-v2: SVG, 1024px master, nine Windows PNG sizes and seven-frame ICO.')
