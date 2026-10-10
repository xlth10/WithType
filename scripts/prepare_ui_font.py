"""Convert the pinned Noto Sans SC font to the committed offline WOFF2.

Only needed to reproduce the font asset, not for normal npm/Tauri builds.
Requires fonttools and brotli; source/license/hash are in public/fonts/manifest.json.
"""
import argparse
from pathlib import Path
from fontTools.ttLib import TTFont

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Original Sans2.004 NotoSansSC-VF.ttf')
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[1] / 'public/fonts/noto-sans-sc-variable.woff2'
    output.parent.mkdir(parents=True, exist_ok=True)
    font = TTFont(args.source, recalcTimestamp=False)
    font.flavor = 'woff2'
    font.save(output)
    print(output)
