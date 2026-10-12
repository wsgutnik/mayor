"""
High-resolution tileable detail textures for Mayor (run with the system python: needs numpy + PIL).

    python3 blender/make_textures_hd.py

Writes seamless tileable PNGs to blender/textures_hd/:
  * 1024x1024 general textures (asphalt, concrete, brick, roofs, plaster, wood,
    metal, kerb, sidewalk, water maps, asphalt overlays)
  * 2048x2048 terrain textures (grass_macro, sand, rock, dirt)

Everything is greyscale RGB (colour comes from the material tint), except the
water maps: water_foam.png (white RGB + foam mask in alpha), water_ripples.png
(RGB tangent-space-ish normal map), water_caustics.png (greyscale).
Every file is kept under 1.5 MB (optimised PNG, restrained high-frequency noise).
"""
import os

import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures_hd")
N = 1024     # general textures
NL = 2048    # terrain textures
LIMIT = 1_500_000
rng = np.random.default_rng(20261012)


def tile_noise(n, cells, octaves=3):
    """Seamless value noise in [0, 1]."""
    out = np.zeros((n, n))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        c = cells * (2 ** o)
        lat = rng.random((c, c))
        ys, xs = np.mgrid[0:n, 0:n] / n * c
        x0, y0 = xs.astype(int) % c, ys.astype(int) % c
        x1, y1 = (x0 + 1) % c, (y0 + 1) % c
        fx, fy = xs - np.floor(xs), ys - np.floor(ys)
        sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        a, b, cc, d = lat[y0, x0], lat[y0, x1], lat[y1, x0], lat[y1, x1]
        out += amp * (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy)
        total += amp
        amp *= 0.5
    return out / total


def ridged(n, cells, octaves=3):
    """Seamless ridged noise in [0, 1]: 1.0 along thin web lines, 0.0 elsewhere."""
    v = tile_noise(n, cells, octaves)
    return 1.0 - np.abs(2.0 * v - 1.0)


def speckle(n, density, amp, bright=True, dark=True):
    """Sparse seamless-friendly aggregate dots (edges may clip a dot; at this
    density the seam is invisible at game scale)."""
    layer = np.zeros((n, n))
    m = rng.random((n, n)) < density
    vals = rng.random((n, n)) * 2 - 1
    vals[~((vals > 0) & bright) & ~((vals <= 0) & dark)] = 0.0
    layer[m] = vals[m] * amp
    return layer


def save_rgb(name, arr):
    arr = np.clip(arr, 0, 1)
    img = Image.fromarray((arr * 255).astype(np.uint8), "L").convert("RGB")
    img.save(os.path.join(OUT, name + ".png"), optimize=True)
    _check(name)


def save_rgba(name, rgb, alpha):
    rgb = np.clip(rgb, 0, 1)
    alpha = np.clip(alpha, 0, 1)
    out = np.zeros((rgb.shape[0], rgb.shape[1], 4), dtype=np.uint8)
    if rgb.ndim == 2:
        out[..., 0] = out[..., 1] = out[..., 2] = (rgb * 255).astype(np.uint8)
    else:
        out[..., :3] = (rgb * 255).astype(np.uint8)
    out[..., 3] = (alpha * 255).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(os.path.join(OUT, name + ".png"), optimize=True)
    _check(name)


def _check(name):
    p = os.path.join(OUT, name + ".png")
    s = os.path.getsize(p)
    flag = "OK " if s < LIMIT else "BIG"
    print(f"  [{flag}] {name}.png {s // 1024} KB")


# ---- road surfaces ----------------------------------------------------------

def asphalt(n=N):
    base = 0.62 + 0.16 * tile_noise(n, 8) + 0.06 * tile_noise(n, 48, 2)
    base += speckle(n, 0.030, 0.20)                       # aggregate stones
    crack = np.clip((ridged(n, 16, 3) - 0.982) / 0.018, 0, 1)  # hairline cracks
    crack += np.clip((ridged(n, 6, 2) - 0.975) / 0.025, 0, 1) * 0.7
    img = base * (1 - 0.35 * np.clip(crack, 0, 1))
    save_rgb("asphalt", img)


def asphalt_wear(n=N):
    """Transparent overlay: two darker tyre-polish bands with a lighter centre."""
    ys = (np.arange(n)[:, None] % n) / n
    band = np.exp(-((ys - 0.30) ** 2) / 0.0016) + np.exp(-((ys - 0.70) ** 2) / 0.0016)
    band = np.clip(band, 0, 1) * (0.75 + 0.25 * tile_noise(n, 24, 2))
    rgb = np.full((n, n), 0.32)
    save_rgba("asphalt_wear", rgb, band * 0.55)


def asphalt_patch(n=N):
    """Transparent overlay: a repaired tarmac patch with tar seams."""
    v = tile_noise(n, 8)
    inside = v > 0.60
    seam = np.clip((np.abs(v - 0.60)) / 0.012, 0, 1)
    seam = (1 - seam).astype(float)                        # bright line on the edge
    base = 0.42 + 0.10 * tile_noise(n, 40, 2) + speckle(n, 0.02, 0.12)
    alpha = inside.astype(float) * 0.92
    rgb = np.where(inside, base, 0.0) + seam * 0.25
    save_rgba("asphalt_patch", rgb, np.clip(alpha + seam * 0.9, 0, 1))


def kerb_concrete(n=N):
    img = 0.80 + 0.08 * tile_noise(n, 10) + 0.03 * tile_noise(n, 64, 1)
    img += speckle(n, 0.015, 0.10)
    img[:, ::n // 4] *= 0.72                              # sawn joints
    img[:, 1 + np.arange(0, n, n // 4)] *= 0.8
    save_rgb("kerb_concrete", img)


def sidewalk_paving(n=N):
    img = np.ones((n, n))
    rows, cols, rh, cw = 6, 4, n // 6, n // 4
    for r in range(rows):
        off = (cw // 2) if r % 2 else 0
        for c in range(-1, cols + 1):
            x0 = c * cw + off
            a, b = max(0, x0 + 2), min(n, x0 + cw - 1)
            if b > a:
                img[r * rh + 2:(r + 1) * rh - 1, a:b] = 0.80 + rng.random() * 0.14
    img[img > 0.99] = 0.52                                # joints read dark
    img *= 0.95 + 0.05 * tile_noise(n, 48, 2)
    img += speckle(n, 0.012, 0.08)
    save_rgb("sidewalk_paving", img)


# ---- terrain (2048) -----------------------------------------------------------

def grass_macro(n=NL):
    macro = tile_noise(n, 6, 4)                            # large tonal patches
    img = 0.55 + 0.30 * macro
    streak = tile_noise(n, 128, 1)                         # fine blades
    img += (streak - 0.5) * 0.13
    img += speckle(n, 0.012, 0.09)                         # dry flecks
    lush = np.clip((tile_noise(n, 12, 3) - 0.55) * 2, 0, 1)
    img = img * (1 - lush * 0.25) + lush * 0.12            # lush dark pockets
    save_rgb("grass_macro", np.clip(img, 0, 1))


def sand(n=NL):
    img = 0.82 + 0.06 * tile_noise(n, 8, 3)
    ys = np.arange(n)[:, None]
    dunes = 0.03 * np.sin(ys / n * np.pi * 2 * 9 + 3 * tile_noise(n, 4, 2))
    img += dunes + (tile_noise(n, 200, 1) - 0.5) * 0.09   # fine grain
    save_rgb("sand", img)


def rock(n=NL):
    strata = tile_noise(n, 5, 3)
    img = 0.60 + 0.22 * strata
    crack = np.clip((ridged(n, 9, 4) - 0.93) / 0.07, 0, 1)
    img *= 1 - 0.45 * crack                                # fractured seams
    img += speckle(n, 0.025, 0.14)
    save_rgb("rock", img)


def dirt(n=NL):
    img = 0.58 + 0.20 * tile_noise(n, 7, 4)
    clod = np.clip((tile_noise(n, 90, 2) - 0.6) * 2.2, 0, 1)
    img += clod * 0.12                                     # dry clods
    img += speckle(n, 0.030, 0.13)                         # pebbles
    track = np.clip((ridged(n, 6, 2) - 0.97) / 0.03, 0, 1)
    img *= 1 - 0.18 * track
    save_rgb("dirt", img)


# ---- building surfaces (1024) ---------------------------------------------------

def concrete(n=N):
    img = 0.84 + 0.09 * tile_noise(n, 12, 3) + 0.03 * tile_noise(n, 96, 1)
    img += speckle(n, 0.012, 0.08)
    save_rgb("concrete", img)


def brick(n=N):
    img = np.ones((n, n))
    rows, cols, rh, cw = 24, 12, n // 24, n // 12
    for r in range(rows):
        off = (cw // 2) if r % 2 else 0
        for c in range(-1, cols + 1):
            x0 = c * cw + off
            a, b = max(0, x0 + 2), min(n, x0 + cw - 1)
            if b > a:
                img[r * rh + 2:(r + 1) * rh - 1, a:b] = 0.74 + rng.random() * 0.24
    img[img > 0.99] = 0.55
    img *= 0.92 + 0.08 * tile_noise(n, 32, 2)
    save_rgb("brick", img)


def roof_tile(n=N):
    rows, rh = 32, n // 32
    ys = np.arange(n)[:, None]
    xs = np.arange(n)[None, :]
    band = (ys % rh) / rh
    img = 0.60 + 0.40 * band                               # course shading
    cols, cw = 16, n // 16
    off = ((ys // rh) % 2) * (cw // 2)
    joint = ((xs + off) % cw) < 2
    img = np.where(joint, img * 0.68, img)
    img *= 0.90 + 0.10 * tile_noise(n, 32, 2)
    save_rgb("roof_tile", img)


def roof_slate(n=N):
    rows, cols, rh, cw = 20, 14, n // 20, n // 14
    img = np.ones((n, n))
    for r in range(rows):
        off = (cw // 2) if r % 2 else 0
        for c in range(-1, cols + 1):
            x0 = c * cw + off
            a, b = max(0, x0 + 1), min(n, x0 + cw)
            if b > a:
                img[r * rh + 1:(r + 1) * rh, a:b] = 0.72 + rng.random() * 0.22
    img[img > 0.99] = 0.45
    img *= 0.93 + 0.07 * tile_noise(n, 40, 2)
    save_rgb("roof_slate", img)


def plaster(n=N):
    img = 0.88 + 0.10 * tile_noise(n, 10, 3) - 0.03 * tile_noise(n, 80, 1)
    img += speckle(n, 0.006, 0.05)
    save_rgb("plaster", img)


def wood(n=N):
    xs = np.arange(n)[None, :]
    plank = (xs // (n // 8)) % 2
    grain = tile_noise(n, 6, 3)
    img = 0.68 + 0.22 * grain + 0.06 * plank
    for k in range(1, 8):
        img[:, k * (n // 8):k * (n // 8) + 2] *= 0.55      # plank gaps
    img *= 0.96 + 0.04 * tile_noise(n, 64, 1)
    save_rgb("wood", img)


def metal_panel(n=N):
    ys = np.arange(n)[:, None]
    xs = np.arange(n)[None, :]
    ribs = 0.86 + 0.14 * np.sin(ys / n * np.pi * 2 * 24)   # standing seams
    rivet = ((xs % (n // 8)) < 3) & ((ys % (n // 8)) < 3)
    img = np.broadcast_to(ribs, (n, n)).copy()
    img[rivet] *= 0.8                                      # rivet dots
    img *= 0.95 + 0.05 * tile_noise(n, 24, 2)
    save_rgb("metal_panel", img)


# ---- water ----------------------------------------------------------------------

def water_foam(n=N):
    """White RGB + foam coverage ramp in alpha (0 = open water, 1 = foam)."""
    lace = np.clip((ridged(n, 10, 4) - 0.72) / 0.28, 0, 1) ** 1.5
    blotch = np.clip((tile_noise(n, 6, 3) - 0.58) * 3.0, 0, 1)
    alpha = np.clip(lace * 0.65 + blotch * 0.55, 0, 1)
    rgb = np.full((n, n), 0.96)
    save_rgba("water_foam", rgb, alpha)


def water_ripples(n=N):
    """Tileable RGB normal map: R/U and G/V slope around 0.5, B/Up near 1."""
    ky = np.fft.fftfreq(n)[:, None] * 2 * np.pi
    kx = np.fft.fftfreq(n)[None, :] * 2 * np.pi
    spec = np.zeros((n, n), complex)
    for fx, fy, amp in ((3, 1, 1.0), (5, -2, 0.6), (-2, 6, 0.5), (8, 4, 0.3),
                        (1, -7, 0.35), (11, -5, 0.2), (-6, -3, 0.25)):
        spec[fy % n, fx % n] = amp * np.exp(2j * np.pi * rng.random())
    h = np.real(np.fft.ifft2(spec))
    h += (tile_noise(n, 16, 2) - 0.5) * 0.35
    gx = np.real(np.fft.ifft2(1j * kx * np.fft.fft2(h)))
    gy = np.real(np.fft.ifft2(1j * ky * np.fft.fft2(h)))
    strength = 2.2
    nx, ny = -gx * strength, -gy * strength
    nz = np.sqrt(np.clip(1.0 - np.clip(nx ** 2 + ny ** 2, 0, 0.9), 0.05, 1.0))
    rgb = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz], axis=-1)
    arr = np.clip(rgb, 0, 1)
    Image.fromarray((arr * 255).astype(np.uint8), "RGB").save(
        os.path.join(OUT, "water_ripples.png"), optimize=True)
    _check("water_ripples")


def water_caustics(n=N):
    """Greyscale caustic web: bright filaments on dark water."""
    web = ridged(n, 8, 4)
    web = np.clip((web - 0.80) / 0.20, 0, 1) ** 2.0
    web *= 0.55 + 0.45 * tile_noise(n, 4, 2)               # large-scale fade
    save_rgb("water_caustics", web)


USES = {
    "asphalt": "Road / lot asphalt base; multiply by the asphalt tint.",
    "asphalt_wear": "RGBA overlay: tyre-polish lanes, drawn over asphalt.",
    "asphalt_patch": "RGBA overlay: repaired tarmac patch with tar seams.",
    "kerb_concrete": "Kerbs, edging stones, junction corners.",
    "sidewalk_paving": "Sidewalks, plazas (rectangular slabs with joints).",
    "grass_macro": "Terrain grass at 2048 (large tonal patches + blades).",
    "sand": "Terrain sand at 2048 (dunes + grain).",
    "rock": "Terrain rock / cliffs at 2048 (strata + fractures).",
    "dirt": "Terrain dirt / construction ground at 2048.",
    "concrete": "Concrete walls, slabs, brutalist surfaces.",
    "brick": "Brick walls (running bond).",
    "roof_tile": "Pitched clay/concrete tile roofs.",
    "roof_slate": "Slate roofs (offset rectangular slates).",
    "plaster": "Plastered / painted walls.",
    "wood": "Timber cladding, sheds, boardwalks.",
    "metal_panel": "Standing-seam metal roofs and cladding.",
    "water_foam": "Water shader: white RGB, foam coverage ramp in alpha.",
    "water_ripples": "Water shader: tileable RGB normal map.",
    "water_caustics": "Water shader: greyscale caustic light web.",
}

if __name__ == "__main__":
    import io
    os.makedirs(OUT, exist_ok=True)
    order = ["asphalt", "asphalt_wear", "asphalt_patch", "kerb_concrete",
             "sidewalk_paving", "grass_macro", "sand", "rock", "dirt",
             "concrete", "brick", "roof_tile", "roof_slate", "plaster",
             "wood", "metal_panel", "water_foam", "water_ripples",
             "water_caustics"]
    for fn in (asphalt, asphalt_wear, asphalt_patch, kerb_concrete,
               sidewalk_paving, grass_macro, sand, rock, dirt, concrete,
               brick, roof_tile, roof_slate, plaster, wood, metal_panel,
               water_foam, water_ripples, water_caustics):
        fn()
    buf = io.StringIO()
    buf.write("Mayor HD textures (blender/textures_hd/) — seamless tileable PNGs.\n")
    buf.write("Greyscale RGB, colour comes from the material tint (except water maps).\n\n")
    for name in order:
        p = os.path.join(OUT, name + ".png")
        with Image.open(p) as im:
            w, h = im.size
        buf.write(f"{name}.png  {w}x{h}  {os.path.getsize(p) // 1024} KB  —  {USES[name]}\n")
    with open(os.path.join(OUT, "README.txt"), "w") as fh:
        fh.write(buf.getvalue())
    print("wrote README.txt")
