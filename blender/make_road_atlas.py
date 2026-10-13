"""
High-resolution road cross-section atlas for Mayor (system python3: PIL + numpy).

    python3 blender/make_road_atlas.py

Writes tileable-along-V cross-section strips (512 wide x 1024 along the road)
to blender/textures_road/ and copies them to public/textures/road/:

  * road_street / road_avenue / road_oneway_street / road_oneway_avenue /
    road_highway -- u across the full drawn width (kerb + sidewalk included),
    v along the length; one tile = TILE_WORLD world units at runtime.
  * junction_asphalt.png -- seamless 1024 asphalt for node discs (world UV).
  * crosswalk.png (512x256), stop_bar.png, arrow_oneway.png -- RGBA markings.

Lane markings, edge lines, crosswalk stripes, stop bars, arrows and wear live
in the textures; geometry stays a single strip per segment. Every file is
kept under 400 KB, the set under 2 MB.
"""
import os
import shutil

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "textures_road")
PUB = os.path.join(HERE, "..", "public", "textures", "road")
W, H = 512, 1024
LIMIT = 400_000
rng = np.random.default_rng(20261013)


def tile_noise(w, h, cells_x, cells_y, octaves=3):
    """Seamless value noise in [0, 1] (periodic in both axes)."""
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        cx, cy = cells_x * (2 ** o), cells_y * (2 ** o)
        lat = rng.random((cy, cx))
        ys, xs = np.mgrid[0:h, 0:w]
        xs = xs / w * cx
        ys = ys / h * cy
        x0, y0 = xs.astype(int) % cx, ys.astype(int) % cy
        x1, y1 = (x0 + 1) % cx, (y0 + 1) % cy
        fx, fy = xs - np.floor(xs), ys - np.floor(ys)
        sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        a, b, cc, d = lat[y0, x0], lat[y0, x1], lat[y1, x0], lat[y1, x1]
        out += amp * (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy)
        total += amp
        amp *= 0.5
    return out / total


def speckle(w, h, density, amp):
    layer = np.zeros((h, w))
    m = rng.random((h, w)) < density
    layer[m] = (rng.random(int(m.sum())) * 2 - 1) * amp
    return layer


def asphalt_base(w=W, h=H, tone=0.30):
    """Dark asphalt with grain, hairline cracks and patch variation."""
    img = np.full((h, w), tone)
    img += (tile_noise(w, h, 6, 12, 3) - 0.5) * 0.10
    img += (tile_noise(w, h, 48, 96, 2) - 0.5) * 0.05
    img += speckle(w, h, 0.02, 0.05)
    # Hairline cracks: ridged noise thresholded thin, tileable.
    v = tile_noise(w, h, 10, 20, 3)
    crack = np.clip((np.abs(2 * v - 1) - 0.965) / 0.035, 0, 1)
    img *= 1 - 0.35 * crack
    # A repaired patch: slightly darker rectangle, kept off the seams.
    img[int(h * 0.58):int(h * 0.74), int(w * 0.15):int(w * 0.45)] *= 0.90
    return img


def wear_bands(img, centres_u, strength=0.16):
    """Tyre-polish darkening at lane wheel tracks (u positions)."""
    xs = np.arange(img.shape[1])[None, :] / img.shape[1]
    for c in centres_u:
        for off in (-0.055, 0.055):
            img -= np.exp(-((xs - (c + off)) ** 2) / 0.00045) * strength * img
    return img


def to_rgb(img):
    g = np.clip(img, 0, 1)
    return np.stack([g * 0.96, g * 0.99, g * 1.06], axis=-1)  # faint cool tint


def save(name, arr, palette=False):
    img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8),
                          "RGBA" if arr.shape[-1] == 4 else "RGB")
    if palette and img.mode == "RGB":
        img = img.quantize(colors=256, method=Image.MEDIANCUT).convert("RGB")
    for d in (OUT, PUB):
        os.makedirs(d, exist_ok=True)
        img.save(os.path.join(d, name + ".png"), optimize=True)
    p = os.path.join(OUT, name + ".png")
    s = os.path.getsize(p)
    print(f"  [{'OK ' if s < LIMIT else 'BIG'}] {name}.png {s // 1024} KB")
    return s


def v_dash(draw, x, wpx, color, dash=128, gap=128):
    """Tileable dashed line along V: pattern divides H exactly."""
    for y in range(0, H, dash + gap):
        draw.rectangle([x - wpx / 2, y, x + wpx / 2, y + dash], fill=color)


WHITE = (216, 214, 196, 255)
CREAM = (232, 228, 200, 255)


def cross_section(kind):
    """RGB float array for one road class. u: 0..1 across, v: 0..1 along."""
    if kind == "highway":
        img = asphalt_base(tone=0.34)
        img = wear_bands(img, [0.22, 0.5, 0.78], 0.13)
        rgb = to_rgb(img)
        im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB").convert("RGBA")
        d = ImageDraw.Draw(im)
        for x in (int(W * 0.045), int(W * 0.955)):  # edge lines
            d.rectangle([x - 3, 0, x + 3, H], fill=WHITE)
        for u in (1 / 3, 2 / 3):  # lane dashes
            v_dash(d, int(W * u), 5, WHITE)
        return np.asarray(im.convert("RGB")).astype(float) / 255

    img = asphalt_base()
    # Kerb + sidewalk edge bands.
    kerb_u = 0.078 if "avenue" not in kind else 0.05
    grass_median = kind in ("road_avenue", "road_oneway_avenue")
    med_u = 0.089  # median half-width as fraction of full width
    rgb = to_rgb(img)
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB").convert("RGBA")
    d = ImageDraw.Draw(im)
    for side in (0, 1):
        x0 = 0 if side == 0 else int(W * (1 - kerb_u))
        x1 = int(W * kerb_u) if side == 0 else W
        d.rectangle([x0, 0, x1, H], fill=(168, 172, 178, 255))  # kerb/sidewalk
        kx = int(W * kerb_u) if side == 0 else int(W * (1 - kerb_u))
        d.rectangle([kx - 2, 0, kx + 2, H], fill=(226, 229, 233, 255))  # kerb highlight
        for y in range(0, H, 128):  # sidewalk paving joints
            d.rectangle([x0, y, x1, y + 2], fill=(128, 132, 138, 255))
    if grass_median:
        cx = W // 2
        mw = int(W * med_u)
        d.rectangle([cx - mw, 0, cx + mw, H], fill=(86, 122, 66, 255))
        for kx in (cx - mw, cx + mw):  # median kerb highlights
            d.rectangle([kx - 2, 0, kx + 2, H], fill=(226, 229, 233, 255))
    if kind == "road_street":
        v_dash(d, W // 2, 5, CREAM)
    elif kind == "road_oneway_street":
        v_dash(d, W // 2, 5, (245, 197, 66, 255))  # amber one-way centre dashes
    elif kind in ("road_avenue", "road_oneway_avenue"):
        for u in (0.25, 0.75):
            v_dash(d, int(W * u), 5, CREAM)
    out = np.asarray(im.convert("RGB")).astype(float) / 255
    if grass_median:  # grass grain on the median band
        cx, mw = W // 2, int(W * med_u)
        band = out[:, cx - mw:cx + mw]
        grain = (tile_noise(band.shape[1], H, 16, 32, 2) - 0.5) * 0.16
        out[:, cx - mw:cx + mw] = np.clip(band + grain[..., None], 0, 1)
    factor = wear_bands(np.ones((H, W)), [0.25, 0.75] if "avenue" in kind else [0.5], 0.35)
    return np.clip(out * (1 - 0.10 * (1 - factor))[..., None], 0, 1)


def junction():
    img = asphalt_base(tone=0.31)
    img = wear_bands(img, [0.3, 0.7], 0.08)
    return to_rgb(img)


def crosswalk():
    w, h = 512, 256
    arr = np.zeros((h, w, 4))
    n = 7
    for k in range(n):
        x0 = int((k + 0.18) / n * w)
        x1 = int((k + 0.82) / n * w)
        arr[14:h - 14, x0:x1] = (0.94, 0.94, 0.90, 0.92)
    arr[..., 3] *= 0.9 + 0.1 * tile_noise(w, h, 24, 12, 2)
    return arr


def stop_bar():
    w, h = 512, 128
    arr = np.zeros((h, w, 4))
    arr[34:94, 10:w - 10] = (0.94, 0.94, 0.90, 0.95)
    return arr


def arrow():
    w, h = 256, 512
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = w // 2
    d.polygon([(cx, 26), (cx + 74, 196), (cx + 30, 196), (cx + 30, 470),
               (cx - 30, 470), (cx - 30, 196), (cx - 74, 196)],
              fill=(245, 197, 66, 235))  # amber, matching one-way chevrons
    return np.asarray(im).astype(float) / 255


if __name__ == "__main__":
    total = 0
    for name in ("road_street", "road_avenue", "road_oneway_street",
                 "road_oneway_avenue", "road_highway"):
        kind = name if name != "road_highway" else "highway"
        total += save(name, cross_section(kind), palette=True)
    total += save("junction_asphalt", junction(), palette=True)
    total += save("crosswalk", crosswalk(), palette=True)
    total += save("stop_bar", stop_bar(), palette=True)
    total += save("arrow_oneway", arrow(), palette=True)
    print(f"total {total // 1024} KB (limit 2048 KB)")
    # Contact sheet for a visual pass.
    names = ["road_street", "road_avenue", "road_oneway_street",
             "road_oneway_avenue", "road_highway", "junction_asphalt",
             "crosswalk", "stop_bar", "arrow_oneway"]
    thumbs = []
    for n in names:
        im = Image.open(os.path.join(OUT, n + ".png")).convert("RGBA")
        im.thumbnail((256, 256))
        thumbs.append(im)
    sheet = Image.new("RGBA", (256 * 3, 256 * 3), (40, 40, 44, 255))
    for i, im in enumerate(thumbs):
        sheet.paste(im, ((i % 3) * 256, (i // 3) * 256), im)
    sheet.convert("RGB").save("/tmp/road-atlas-sheet.png", optimize=True)
    print("wrote /tmp/road-atlas-sheet.png")
