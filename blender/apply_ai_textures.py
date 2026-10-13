"""
Turn AI-generated texture swatches (Higgsfield, GPT Image 2.5, generated on the project owner's account) into
the game's HD pattern textures.

  python3 blender/apply_ai_textures.py --src /path/to/swatches [--only brick,wood]

For every <name>.png in --src (names match blender/lib.py PATTERN texture names) it
  1. fixes the tiling seam on an axis only when the wrap seam is clearly rougher than the image itself
     (narrow cross-fade, then resize back),
  2. keeps a fraction of the colour (the game multiplies by the palette tint),
  3. rescales brightness to the mean of the texture it replaces, so buildings keep their overall brightness,
  4. writes <name>_hd.png to blender/textures/ and public/textures/ (downscaled until under the 1.5 MB test limit).
Provenance is recorded in NOTICE.md; the swatches themselves are not stored in the repository.
"""
import argparse
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIRS = [os.path.join(HERE, "textures"), os.path.join(HERE, "..", "public", "textures")]
LIMIT = 1_500_000
KEEP_COLOUR = {"roof_tile": 0.35, "brick": 0.3, "wood": 0.3, "plot": 1.0}   # default 0.15


def seam_ratio(a, axis):
    g = a.mean(2)
    if axis == 0:
        wrap = np.abs(g[0] - g[-1]).mean(); step = np.abs(g[1:] - g[:-1]).mean()
    else:
        wrap = np.abs(g[:, 0] - g[:, -1]).mean(); step = np.abs(g[:, 1:] - g[:, :-1]).mean()
    return wrap / max(step, 1e-6)


def fix_axis(a, axis, band=0.06):
    """Cross-fade the last `band` of the image into its first `band`, drop it, resize back."""
    if axis == 0:
        return fix_axis(a.transpose(1, 0, 2), 1, band).transpose(1, 0, 2)
    h, w, _ = a.shape
    b = int(w * band)
    t = (np.arange(b) / b)[None, :, None]
    head = a[:, :b] * t + a[:, w - b:] * (1 - t)
    out = np.concatenate([head, a[:, b:w - b]], axis=1)          # width w - b, wraps cleanly
    im = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)
    return np.asarray(im).astype(np.float64) / 255


def process(name, src):
    a = np.asarray(Image.open(src).convert("RGB")).astype(np.float64) / 255
    for axis in (0, 1):
        if seam_ratio(a, axis) > 1.4:
            a = fix_axis(a, axis)
    lum = (a * np.array([0.2126, 0.7152, 0.0722])).sum(2, keepdims=True)
    keep = KEEP_COLOUR.get(name, 0.15)
    a = lum + (a - lum) * keep
    target = None
    for d in OUT_DIRS:
        p = os.path.join(d, f"{name}_hd.png")
        if os.path.exists(p):
            target = float(np.asarray(Image.open(p).convert("L")).mean() / 255)
            break
    if target:
        a = np.clip(a * (target / max(a.mean(), 1e-6)), 0, 1)
    return a


def existing_size(name):
    for d in OUT_DIRS:
        p = os.path.join(d, f"{name}_hd.png")
        if os.path.exists(p):
            return Image.open(p).size[0]
    return 1024


def save(a, name):
    """Keep the replaced texture's resolution (tests and the renderer expect it); store near-grey ones as 8-bit grey."""
    size = existing_size(name)
    grey = float((a.max(2) - a.min(2)).mean()) < 0.03
    while True:
        im = Image.fromarray((a * 255 + 0.5).astype(np.uint8))
        if grey:
            im = im.convert("L")
        if size != a.shape[0]:
            im = im.resize((size, size), Image.LANCZOS)
        tmp = os.path.join(OUT_DIRS[0], f"{name}_hd.png")
        im.save(tmp, optimize=True)
        if os.path.getsize(tmp) > LIMIT and im.mode == "RGB":
            # Tinted terrain textures are low-chroma: a 256-colour palette is visually lossless and 3x smaller.
            im = im.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
            im.save(tmp, optimize=True)
        if os.path.getsize(tmp) <= LIMIT or size <= 512:
            break
        size = int(size * 0.75)
    for d in OUT_DIRS[1:]:
        im.save(os.path.join(d, f"{name}_hd.png"), optimize=True)
    return size, os.path.getsize(tmp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--only")
    args = ap.parse_args()
    only = set(args.only.split(",")) if args.only else None
    for f in sorted(os.listdir(args.src)):
        if not f.endswith(".png"):
            continue
        name = f[:-4]
        if only and name not in only:
            continue
        a = process(name, os.path.join(args.src, f))
        size, nbytes = save(a, name)
        print(f"{name}: {size}px {nbytes // 1024} KiB")


if __name__ == "__main__":
    main()
