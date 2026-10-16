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
  * markings.png -- the three markings stacked in one 512x896 atlas (the
    shader samples this; the individual files remain for tests/inspection).

Lane markings, edge lines, crosswalk stripes, stop bars, arrows and wear live
in the textures; geometry stays a single strip per segment. Every file is
kept under 400 KB, the set under 2 MB.
"""
import json
import os
import shutil

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "textures_road")
PUB = os.path.join(HERE, "..", "public", "textures", "road")
PROFILES = json.load(open(os.path.join(PUB, "profiles.json")))
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
    """Dark asphalt with grain, hairline cracks and soft tonal patches."""
    img = np.full((h, w), tone)
    img += (tile_noise(w, h, 6, 12, 3) - 0.5) * 0.08
    img += (tile_noise(w, h, 48, 96, 2) - 0.5) * 0.05
    img += speckle(w, h, 0.02, 0.05)
    # Hairline cracks: ridged noise thresholded thin, tileable. Kept faint
    # so a crack crossing one 8x8 block never steps like a patch edge.
    v = tile_noise(w, h, 10, 20, 3)
    crack = np.clip((np.abs(2 * v - 1) - 0.972) / 0.028, 0, 1)
    img *= 1 - 0.25 * crack
    # Old repairs read as soft large-scale tonal drift (tileable, no hard
    # edges): the previous dark rectangle showed as a plate on pads.
    img *= 1 + (tile_noise(w, h, 2, 3, 2) - 0.5) * 0.06
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


def u_of(p, off):
    """Texture u for signed tile offset across the strip spanning ±sidewalkEdge."""
    return 0.5 + off / (2 * p["sidewalkEdge"])


def px(u):
    return int(round(u * (W - 1)))


def cross_section(kind):
    """RGB float array for one road class. u: 0..1 across, v: 0..1 along."""
    p = PROFILES[kind if kind in PROFILES else "road_" + kind]
    # One asphalt tone for every strip: the old lighter highway base made the
    # gore pads read as dark plates against the highway ribbon.
    img = asphalt_base(tone=0.30)
    img = wear_bands(img, [u_of(p, c) for c in p["laneCentres"]], 0.13)
    rgb = to_rgb(img)
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB").convert("RGBA")
    d = ImageDraw.Draw(im)
    ah, se = p["asphaltHalf"], p["sidewalkEdge"]
    for side in (-1, 1):
        if p["kerb"] > 0 or p["sidewalk"] > 0:
            a, b = sorted((px(u_of(p, side * ah)), px(u_of(p, side * se))))
            d.rectangle([a, 0, b, H], fill=(168, 172, 178, 255))
            k = px(u_of(p, side * ah))
            d.rectangle([k - 2, 0, k + 2, H], fill=(226, 229, 233, 255))
            for y in range(0, H, 128): d.rectangle([a, y, b, y + 2], fill=(128, 132, 138, 255))
        if p["shoulder"] > 0:
            e = px(u_of(p, side * (ah - p["shoulder"])))
            d.rectangle([e - 3, 0, e + 3, H], fill=WHITE)
    mh = p["medianHalf"]
    if p["median"] == "planted":
        a, b = px(u_of(p, -mh)), px(u_of(p, mh))
        d.rectangle([a, 0, b, H], fill=(86, 122, 66, 255))
        for k in (a, b): d.rectangle([k - 2, 0, k + 2, H], fill=(226, 229, 233, 255))
    elif p["median"] == "barrier":
        a, b = px(u_of(p, -mh)), px(u_of(p, mh))
        # Plain concrete matching the 3D Jersey barrier (CONCRETE #a8adb5 in
        # src/render/roads.ts) with thin yellow edge lines only: the old wide
        # yellow bands read as a yellow strip from game zoom.
        d.rectangle([a, 0, b, H], fill=(168, 173, 181, 255))
        for k in (a, b): d.rectangle([k - 1, 0, k + 1, H], fill=(236, 200, 70, 255))
    elif p["median"] == "paint":
        v_dash(d, px(0.5), 5, CREAM)
    c = p["laneCentres"]
    for i in range(len(c) - 1):
        mid = (c[i] + c[i + 1]) / 2
        same_dir = p["oneWay"] or (c[i] > 0) == (c[i + 1] > 0)
        if same_dir: v_dash(d, px(u_of(p, mid)), 5, WHITE)
    return np.asarray(im.convert("RGB")).astype(float) / 255


# Pad base tone: the shader darkens the pad by JUNCTION_TONE (0.963), so the
# PNG runs ~3.8% lighter than the ribbon lanes to render at the same tone.
JUNCTION_TONE = 0.30


def junction():
    # No wear bands: on world-UV pads they would repeat as stripes every tile
    # instead of following lanes.
    return to_rgb(asphalt_base(tone=JUNCTION_TONE))


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


MARK_W, MARK_H = 512, 896


def markings_atlas(cw, sb, ar):
    """Stack the three RGBA marking decals into one 512x896 atlas.

    Layout (top-down PNG rows): crosswalk [0,256) full width, stop_bar
    [256,384) full width, arrow [384,896) left-aligned (the arrow source is
    256x512; the right half stays transparent). One sampler instead of
    three keeps the road shader under MAX_TEXTURE_IMAGE_UNITS. Must match
    MARKING_SLICES in src/render/road-material.ts.
    """
    atlas = np.zeros((MARK_H, MARK_W, 4))
    atlas[0:256, 0:512] = cw
    atlas[256:384, 0:512] = sb
    atlas[384:896, 0:256] = ar
    return atlas


if __name__ == "__main__":
    total = 0
    for name in ("road_street", "road_avenue", "road_oneway_street",
                 "road_oneway_avenue", "road_highway"):
        kind = name if name != "road_highway" else "highway"
        total += save(name, cross_section(kind), palette=True)
    total += save("junction_asphalt", junction(), palette=True)
    # The arrays are reused for the atlas below. Note: every texture draws
    # from one shared rng stream, so changing any generator reshuffles the
    # noise in the textures generated after it; that is accepted (all PNGs
    # regenerate together) — keep this call order stable anyway.
    cw, sb, ar = crosswalk(), stop_bar(), arrow()
    total += save("crosswalk", cw, palette=True)
    total += save("stop_bar", sb, palette=True)
    total += save("arrow_oneway", ar, palette=True)
    total += save("road_ramp", cross_section("road_ramp"), palette=True)
    total += save("markings", markings_atlas(cw, sb, ar))
    print(f"total {total // 1024} KB (limit 2048 KB)")
    # Contact sheet for a visual pass.
    names = ["road_street", "road_avenue", "road_oneway_street",
             "road_oneway_avenue", "road_highway", "road_ramp", "junction_asphalt",
             "crosswalk", "stop_bar", "arrow_oneway", "markings"]
    thumbs = []
    for n in names:
        im = Image.open(os.path.join(OUT, n + ".png")).convert("RGBA")
        im.thumbnail((256, 256))
        thumbs.append(im)
    cols = 3
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGBA", (256 * cols, 256 * rows), (40, 40, 44, 255))
    for i, im in enumerate(thumbs):
        sheet.paste(im, ((i % cols) * 256, (i // cols) * 256), im)
    sheet.convert("RGB").save("/tmp/road-atlas-sheet.png", optimize=True)
    print("wrote /tmp/road-atlas-sheet.png")
