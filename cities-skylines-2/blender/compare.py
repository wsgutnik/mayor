"""Side-by-side sheet: kit thumbnail (left) vs the Blender preview (right).

    python3 blender/compare.py --previews /tmp/previews --out /tmp/compare.png 2 3 4
"""
import argparse
import os

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

ap = argparse.ArgumentParser()
ap.add_argument("--previews", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("numbers", nargs="+", type=int)
a = ap.parse_args()

tiles = []
for n in a.numbers:
    kit = Image.open(os.path.join(ROOT, "public/ui/buildings", f"{n:02d}.jpg")).convert("RGB")
    kit = kit.resize((360, int(360 * kit.height / kit.width)))
    p = os.path.join(a.previews, f"{n:02d}.png")
    mine = Image.open(p).convert("RGB").resize((360, 270)) if os.path.exists(p) else Image.new("RGB", (360, 270), (60, 20, 20))
    tiles.append((n, kit, mine))
h = sum(max(k.height, m.height) + 8 for _, k, m in tiles)
sheet = Image.new("RGB", (740, h), (10, 18, 30))
y = 0
for n, k, m in tiles:
    sheet.paste(k, (0, y))
    sheet.paste(m, (370, y))
    ImageDraw.Draw(sheet).text((6, y + 4), f"#{n}", fill=(255, 255, 255))
    y += max(k.height, m.height) + 8
sheet.save(a.out)
print("wrote", a.out)
