"""Generate independent Windows bundle icons; requires Pillow."""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "src-tauri" / "icons"


def render(size: int) -> Image.Image:
    scale = 4
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    s = size * scale / 128

    def box(coords):
        return tuple(round(value * s) for value in coords)

    draw.rounded_rectangle(box((0, 0, 128, 128)), radius=round(30 * s), fill="#102a35")
    draw.rounded_rectangle(box((27, 23, 101, 92)), radius=round(16 * s), fill="#48d4bb")
    draw.polygon([box((39, 87, 58, 87))[0:2], box((39, 106, 58, 106))[0:2], box((60, 88, 60, 88))[0:2]], fill="#48d4bb")
    for x, top, bottom in [(47, 60, 72), (58, 48, 81), (70, 38, 81), (81, 51, 72)]:
        draw.line(box((x, top, x, bottom)), fill="#102a35", width=max(2, round(7 * s)))
        draw.ellipse(box((x - 3.5, top - 3.5, x + 3.5, top + 3.5)), fill="#102a35")
        draw.ellipse(box((x - 3.5, bottom - 3.5, x + 3.5, bottom + 3.5)), fill="#102a35")
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    ICONS.mkdir(parents=True, exist_ok=True)
    for size, name in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png"), (512, "icon.png")]:
        render(size).save(ICONS / name)
    render(256).save(ICONS / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
