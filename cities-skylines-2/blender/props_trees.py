"""Trees, bushes and rocks. Each is centred on the origin, base at z = 0, and about one tile or less wide."""
import math

from registry import prop


def _trunk(m, h=0.16, r=0.022, r_top=0.014, mat="bark"):
    m.cyl(0, 0, 0, r, h, mat, seg=6, r_top=r_top)


@prop("tree_oak")
def tree_oak(m):
    _trunk(m, 0.2)
    m.blob(0, 0, 0.3, 0.17, 0.17, 0.15, "leaf_a", seed=1)
    m.blob(0.1, 0.04, 0.24, 0.12, 0.12, 0.11, "leaf_b", seed=2)
    m.blob(-0.09, -0.05, 0.26, 0.12, 0.12, 0.11, "leaf_c", seed=3)
    m.blob(0.02, 0.07, 0.4, 0.1, 0.1, 0.09, "leaf_c", seed=4)


@prop("tree_pine")
def tree_pine(m):
    _trunk(m, 0.12, 0.02, 0.016)
    for i, (r, z, h) in enumerate(((0.16, 0.08, 0.2), (0.125, 0.22, 0.19), (0.09, 0.35, 0.17), (0.055, 0.46, 0.15))):
        m.cyl(0, 0, z, r, h, "leaf_pine" if i % 2 == 0 else "leaf_pine_b", seg=7, r_top=0.004, cap=False)


@prop("tree_poplar")
def tree_poplar(m):
    _trunk(m, 0.14, 0.018, 0.012)
    m.blob(0, 0, 0.38, 0.085, 0.085, 0.27, "leaf_b", seed=7)
    m.blob(0.02, 0.01, 0.55, 0.06, 0.06, 0.14, "leaf_c", seed=8)


@prop("tree_cherry")
def tree_cherry(m):
    _trunk(m, 0.18, 0.02, 0.013)
    m.blob(0, 0, 0.3, 0.17, 0.17, 0.14, "leaf_pink", seed=11)
    m.blob(0.1, 0.05, 0.25, 0.11, 0.11, 0.1, "leaf_pink", seed=12)
    m.blob(-0.09, -0.04, 0.27, 0.11, 0.11, 0.1, "leaf_pink", seed=13)


@prop("tree_autumn")
def tree_autumn(m):
    _trunk(m, 0.2)
    m.blob(0, 0, 0.3, 0.17, 0.17, 0.15, "leaf_autumn", seed=21)
    m.blob(0.1, 0.03, 0.24, 0.11, 0.11, 0.1, "leaf_dry", seed=22)
    m.blob(-0.09, -0.05, 0.26, 0.11, 0.11, 0.1, "leaf_autumn", seed=23)


@prop("tree_palm")
def tree_palm(m):
    # a gently curved trunk in four segments, then a crown of fronds
    pts = [(0, 0, 0), (0.015, 0, 0.14), (0.04, 0.005, 0.27), (0.075, 0.01, 0.38)]
    for a, b in zip(pts, pts[1:]):
        m.cyl((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2], 0.018, b[2] - a[2], "bark", seg=5, r_top=0.014)
    cx, cy, cz = pts[-1]
    for k in range(7):
        ang = 2 * math.pi * k / 7
        dx, dy = math.cos(ang), math.sin(ang)
        tip = (cx + dx * 0.24, cy + dy * 0.24, cz - 0.05)
        mid = (cx + dx * 0.12, cy + dy * 0.12, cz + 0.06)
        w = 0.035
        px, py = -dy * w, dx * w
        m._quad([(cx - px * 0.3, cy - py * 0.3, cz), (cx + px * 0.3, cy + py * 0.3, cz), (mid[0] + px, mid[1] + py, mid[2]), (mid[0] - px, mid[1] - py, mid[2])], "palm_frond")
        m._tri([(mid[0] - px, mid[1] - py, mid[2]), (mid[0] + px, mid[1] + py, mid[2]), tip], "palm_frond")


@prop("bush")
def bush(m):
    m.blob(0, 0, 0.06, 0.1, 0.1, 0.07, "leaf_b", seed=31)
    m.blob(0.07, 0.03, 0.05, 0.07, 0.07, 0.05, "leaf_a", seed=32)
    m.blob(-0.06, -0.03, 0.05, 0.07, 0.07, 0.05, "leaf_c", seed=33)


@prop("bush_flowers")
def bush_flowers(m):
    m.blob(0, 0, 0.06, 0.1, 0.1, 0.06, "leaf_a", seed=41)
    for i, (x, y) in enumerate(((0.05, 0.02), (-0.04, 0.05), (0.0, -0.06), (0.07, -0.03))):
        m.blob(x, y, 0.1, 0.02, 0.02, 0.02, "flower_red" if i % 2 else "flower_yellow", subdiv=0, jitter=0.0, seed=42 + i)


@prop("rock")
def rock(m):
    m.blob(0, 0, 0.05, 0.13, 0.1, 0.08, "rock", jitter=0.25, seed=51)
    m.blob(0.1, 0.05, 0.03, 0.07, 0.06, 0.05, "rock", jitter=0.25, seed=52)
