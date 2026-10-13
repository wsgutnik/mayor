"""Extra civic-building dressing for det-c models."""
from lib import Model


def framed_window(m: Model, x, y, z, w=0.065, h=0.09, mat="glow_window", frame="white"):
    m.box(x, y - 0.003, z - 0.006, w + 0.022, 0.006, h + 0.018, frame)
    m._quad([(x - w / 2, y - 0.008, z), (x + w / 2, y - 0.008, z),
             (x + w / 2, y - 0.008, z + h), (x - w / 2, y - 0.008, z + h)], mat)
    m.box(x, y - 0.01, z + h * 0.48, w + 0.012, 0.006, 0.006, frame)
    m.box(x, y - 0.011, z - 0.014, w + 0.034, 0.018, 0.008, "slab")


def side_window(m: Model, x, y, z, h=0.085, mat="glow_window", side="r", frame="white"):
    w = 0.055
    off = 0.008 if side == "r" else -0.008
    m.box(x + off * 0.35, y, z - 0.006, 0.006, w + 0.022, h + 0.018, frame)
    if side == "r":
        m._quad([(x + off, y - w / 2, z), (x + off, y + w / 2, z),
                 (x + off, y + w / 2, z + h), (x + off, y - w / 2, z + h)], mat)
    else:
        m._quad([(x + off, y + w / 2, z), (x + off, y - w / 2, z),
                 (x + off, y - w / 2, z + h), (x + off, y + w / 2, z + h)], mat)


def cornice(m: Model, cx, cy, w, d, z, mat="slab"):
    m.box(cx, cy - d / 2 - 0.006, z, w + 0.035, 0.018, 0.018, mat)
    m.box(cx, cy + d / 2 + 0.006, z, w + 0.035, 0.018, 0.018, mat)
    m.box(cx - w / 2 - 0.006, cy, z, 0.018, d + 0.035, 0.018, mat)
    m.box(cx + w / 2 + 0.006, cy, z, 0.018, d + 0.035, 0.018, mat)


def paving_lines(m: Model, y=-0.34, xs=(-0.36, -0.18, 0.0, 0.18, 0.36), mat="concrete"):
    for x in xs:
        m.box(x, y, 0.034, 0.01, 0.2, 0.004, mat)
    m.box(0, y - 0.1, 0.034, 0.75, 0.01, 0.004, mat)
    m.box(0, y + 0.1, 0.034, 0.75, 0.01, 0.004, mat)


def bollards(m: Model, xs, y, mat="metal_dark"):
    for x in xs:
        m.cyl(x, y, 0.03, 0.01, 0.07, mat, seg=6)


def roof_seams(m: Model, cx, cy, w, d, z, n=4, mat="metal_dark"):
    for i in range(1, n):
        x = cx - w / 2 + w * i / n
        m.box(x, cy, z, 0.008, d * 0.86, 0.006, mat)


def rail(m: Model, x0, x1, y, z, h=0.06, mat="metal_dark", posts=5):
    m.box((x0 + x1) / 2, y, z + h, x1 - x0, 0.008, 0.008, mat)
    for i in range(posts):
        t = i / max(1, posts - 1)
        m.box(x0 + (x1 - x0) * t, y, z, 0.008, 0.008, h, mat)
