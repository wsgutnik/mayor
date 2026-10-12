"""
Generates the tileable detail textures the kit materials use (run with the system python: needs numpy + PIL).
Everything is greyscale (colour comes from the material tint) except the window cells.

    python3 blender/make_textures.py
"""
import os

import numpy as np
from PIL import Image, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures")
rng = np.random.default_rng(7)


def save(name, arr):
    arr = np.clip(arr, 0, 1)
    if arr.ndim == 2:
        img = Image.fromarray((arr * 255).astype(np.uint8), "L").convert("RGB")
    else:
        img = Image.fromarray((arr * 255).astype(np.uint8), "RGB")
    img.save(os.path.join(OUT, name + ".png"))


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


def brick(n=256):
    img = np.ones((n, n))
    rows, cols = 12, 6
    rh, cw = n // rows, n // cols
    for r in range(rows):
        off = (cw // 2) if r % 2 else 0
        for c in range(-1, cols + 1):
            x0, y0 = c * cw + off, r * rh
            shade = 0.78 + rng.random() * 0.22
            img[y0 + 2:y0 + rh, max(0, x0 + 2):max(0, min(n, x0 + cw))] = shade
    # mortar reads darker; mortar mask is wherever we did not paint a brick
    mortar = np.ones((n, n), bool)
    for r in range(rows):
        off = (cw // 2) if r % 2 else 0
        for c in range(-1, cols + 1):
            x0, y0 = c * cw + off, r * rh
            mortar[y0 + 2:y0 + rh, max(0, x0 + 2):max(0, min(n, x0 + cw))] = False
    img[mortar] = 0.55
    img *= 0.92 + 0.08 * tile_noise(n, 16)
    save("brick", img)


def plaster(n=128):
    save("plaster", 0.88 + 0.12 * tile_noise(n, 6) - 0.04 * tile_noise(n, 24, 1))


def roof_tile(n=256):
    img = np.ones((n, n))
    rows = 16
    rh = n // rows
    ys = np.arange(n)[:, None]
    xs = np.arange(n)[None, :]
    band = (ys % rh) / rh
    img = 0.62 + 0.38 * band          # each course shades from dark (top edge) to light
    cols = 8
    cw = n // cols
    off = ((ys // rh) % 2) * (cw // 2)
    joint = ((xs + off) % cw) < 2
    img = np.where(joint, img * 0.7, img)
    img *= 0.9 + 0.1 * tile_noise(n, 12)
    save("roof_tile", img)


def gravel(n=128):
    img = 0.78 + 0.14 * rng.random((n, n)) + 0.08 * tile_noise(n, 8)
    save("gravel", img)


def concrete(n=128):
    img = 0.86 + 0.1 * tile_noise(n, 10) + 0.03 * rng.random((n, n))
    img[:, :2] *= 0.8
    img[:2, :] *= 0.8
    save("concrete", img)


def paving(n=128):
    img = np.ones((n, n))
    cell = n // 4
    for r in range(4):
        for c in range(4):
            img[r * cell + 2:(r + 1) * cell, c * cell + 2:(c + 1) * cell] = 0.82 + rng.random() * 0.18
    mask = img == 1.0
    img[mask] = 0.55
    img *= 0.94 + 0.06 * tile_noise(n, 12)
    save("paving", img)


def asphalt(n=128):
    save("asphalt", 0.7 + 0.18 * rng.random((n, n)) + 0.12 * tile_noise(n, 10))


def grass(n=128):
    blades = rng.random((n, n))
    img = 0.62 + 0.25 * tile_noise(n, 14) + 0.13 * blades
    save("grass", img)


def wood(n=128):
    xs = np.arange(n)[None, :]
    plank = (xs // (n // 6)) % 2
    grain = tile_noise(n, 3, 2)
    stretched = np.repeat(grain[:1, :], n, axis=0) * 0 + grain
    img = 0.7 + 0.2 * stretched + 0.08 * plank
    img[:, (n // 6) * np.arange(1, 6)] *= 0.6
    save("wood", img)


def metal(n=128):
    ys = np.arange(n)[:, None]
    ribs = 0.8 + 0.2 * np.sin(ys / n * np.pi * 2 * 12)
    save("metal", np.broadcast_to(ribs, (n, n)) * (0.95 + 0.05 * rng.random((n, n))))


def glass_curtain(n=128):
    img = np.ones((n, n)) * 0.92
    for k in (0, n // 2):
        img[k:k + 3, :] = 0.55
        img[:, k:k + 3] = 0.55
    gy, gx = np.mgrid[0:n, 0:n] / n
    img *= 0.85 + 0.15 * np.clip(1.0 - np.abs((gx + gy) % 1.0 - 0.5) * 3, 0, 1)
    save("glass_curtain", img)


def leaf(n=128):
    save("leaf", 0.7 + 0.3 * tile_noise(n, 10) * (0.85 + 0.15 * rng.random((n, n))))


def window(n=128, lit=False):
    """One window per cell: frame, mullion cross, sill. Lit variant is the emission mask (white pane on black)."""
    rgb = np.zeros((n, n, 3))
    m = n // 10
    frame = np.array([0.86, 0.87, 0.9])
    pane_top = np.array([0.30, 0.46, 0.66])
    pane_bot = np.array([0.16, 0.26, 0.42])
    rgb[:] = frame
    ys = np.linspace(0, 1, n - 2 * m)[:, None, None]
    pane = pane_top * (1 - ys) + pane_bot * ys
    rgb[m:n - m, m:n - m] = pane
    # diagonal sky reflection
    gy, gx = np.mgrid[0:n - 2 * m, 0:n - 2 * m] / (n - 2 * m)
    refl = np.clip(1.0 - np.abs(gx - gy - 0.35) * 5, 0, 1) * 0.18
    rgb[m:n - m, m:n - m] += refl[..., None]
    mid = n // 2
    rgb[m:n - m, mid - 2:mid + 2] = frame
    rgb[mid - 2:mid + 2, m:n - m] = frame
    rgb[n - m:, :] = frame * 0.7                     # sill
    if lit:
        out = np.zeros((n, n, 3))
        warm = np.array([1.0, 0.82, 0.48])
        glow = np.ones((n - 2 * m, n - 2 * m))
        glow[:, (n - 2 * m) // 2 - 2:(n - 2 * m) // 2 + 2] = 0.35
        glow[(n - 2 * m) // 2 - 2:(n - 2 * m) // 2 + 2, :] = 0.35
        out[m:n - m, m:n - m] = glow[..., None] * warm
        save("window_glow", out)
    else:
        save("window", rgb)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for fn in (brick, plaster, roof_tile, gravel, concrete, paving, asphalt, grass, wood, metal, glass_curtain, leaf):
        fn()
    window(lit=False)
    window(lit=True)
    print("textures:", sorted(os.listdir(OUT)))
