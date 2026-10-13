"""Detail helpers for det-b commercial building pass."""


def storefront_grid(m, cx, y, z, w, h, cols=3, mat="metal_dark"):
    """Chunky storefront mullions and a base rail, tuned to read at game zoom."""
    t = 0.012
    for i in range(cols + 1):
        x = cx - w / 2 + (w * i / cols)
        m.box(x, y, z, t, 0.01, h, mat)
    m.box(cx, y, z + h - t / 2, w, 0.01, t, mat)
    m.box(cx, y, z + t / 2, w, 0.01, t, mat)


def facade_trim(m, cx, y, z, w, mat="slab"):
    m.box(cx, y, z, w, 0.018, 0.018, mat, roof=mat)


def parapet_caps(m, cx, cy, w, d, z, mat="concrete"):
    t = 0.026
    m.box(cx, cy - d / 2, z, w + 0.035, t, 0.018, mat, roof=mat)
    m.box(cx, cy + d / 2, z, w + 0.035, t, 0.018, mat, roof=mat)
    m.box(cx - w / 2, cy, z, t, d + 0.035, 0.018, mat, roof=mat)
    m.box(cx + w / 2, cy, z, t, d + 0.035, 0.018, mat, roof=mat)


def roof_seams(m, cx, cy, z, w, d, count=5, mat="metal_dark"):
    for i in range(count):
        x = cx - w / 2 + (i + 1) * w / (count + 1)
        m.box(x, cy, z, 0.008, d * 0.82, 0.012, mat, roof=mat)


def parking_stripes(m, xs, y, length=0.16):
    for x in xs:
        m.box(x, y, 0.036, 0.01, length, 0.003, "white", roof="white")


def curb_blocks(m, y=-0.19, xs=(-0.3, 0.0, 0.3)):
    for x in xs:
        m.box(x, y, 0.033, 0.12, 0.018, 0.018, "concrete", roof="concrete")


def bollards(m, xs, y, h=0.065):
    for x in xs:
        m.cyl(x, y, 0.032, 0.01, h, "metal_dark", seg=6)


def planters(m, pts):
    for i, (x, y) in enumerate(pts):
        m.box(x, y, 0.033, 0.09, 0.045, 0.035, "wall_wood", roof="wall_wood")
        m.blob(x, y, 0.09, 0.045, 0.025, 0.025, "leaf_c" if i % 2 else "leaf_a", subdiv=1, jitter=0.05)


def gooseneck_lamps(m, xs, y, z):
    for x in xs:
        m.box(x, y, z, 0.012, 0.012, 0.06, "lamp_pole")
        m.box(x, y - 0.018, z + 0.055, 0.05, 0.018, 0.018, "glow_lamp", roof="glow_lamp")


def roof_dress(m, z, units):
    for x, y, w, d in units:
        m.ac_unit(x, y, z, w, d, 0.04)
        m.box(x, y + d * 0.52, z + 0.02, w * 0.8, 0.012, 0.018, "metal_dark")
