"""Local helpers for v2c civic reference buildings."""


def qf(m, x0, x1, y, z0, z1, mat):
    m._quad([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], mat)


def qb(m, x0, x1, y, z0, z1, mat):
    m._quad([(x1, y, z0), (x0, y, z0), (x0, y, z1), (x1, y, z1)], mat)


def qr(m, x, y0, y1, z0, z1, mat):
    m._quad([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], mat)


def ql(m, x, y0, y1, z0, z1, mat):
    m._quad([(x, y1, z0), (x, y0, z0), (x, y0, z1), (x, y1, z1)], mat)


def window(m, u, plane, z, w=0.065, h=0.09, side="f", pane="glow_window", frame="white"):
    """Small framed opening on any vertical wall."""
    s = -1 if side in ("f", "l") else 1
    if side in ("f", "b"):
        m.box(u, plane + s * 0.005, z - h / 2 - 0.01, w + 0.022, 0.012, h + 0.02, frame)
        if side == "f":
            qf(m, u - w / 2, u + w / 2, plane + s * 0.012, z - h / 2, z + h / 2, pane)
        else:
            qb(m, u - w / 2, u + w / 2, plane + s * 0.012, z - h / 2, z + h / 2, pane)
        m.box(u, plane + s * 0.012, z - h / 2 - 0.018, w + 0.04, 0.024, 0.012, "concrete")
        m.box(u, plane + s * 0.013, z - h / 2, 0.007, 0.006, h, frame)
    else:
        m.box(plane + s * 0.005, u, z - h / 2 - 0.01, 0.012, w + 0.022, h + 0.02, frame)
        if side == "r":
            qr(m, plane + s * 0.012, u - w / 2, u + w / 2, z - h / 2, z + h / 2, pane)
        else:
            ql(m, plane + s * 0.012, u - w / 2, u + w / 2, z - h / 2, z + h / 2, pane)
        m.box(plane + s * 0.012, u, z - h / 2 - 0.018, 0.024, w + 0.04, 0.012, "concrete")


def parapet(m, cx, cy, z, w, d, h=0.045, mat="concrete"):
    t = 0.022
    m.box(cx, cy - d / 2 + t / 2, z, w, t, h, mat)
    m.box(cx, cy + d / 2 - t / 2, z, w, t, h, mat)
    m.box(cx - w / 2 + t / 2, cy, z, t, d - 2 * t, h, mat)
    m.box(cx + w / 2 - t / 2, cy, z, t, d - 2 * t, h, mat)


def cornice(m, cx, cy, w, d, z, mat="slab"):
    m.box(cx, cy - d / 2 - 0.006, z, w + 0.035, 0.018, 0.018, mat)
    m.box(cx, cy + d / 2 + 0.006, z, w + 0.035, 0.018, 0.018, mat)
    m.box(cx - w / 2 - 0.006, cy, z, 0.018, d + 0.035, 0.018, mat)
    m.box(cx + w / 2 + 0.006, cy, z, 0.018, d + 0.035, 0.018, mat)


def lamp(m, x, y, h=0.18):
    m.cyl(x, y, 0.03, 0.007, h, "lamp_pole", seg=5)
    m.box(x, y, 0.03 + h, 0.033, 0.033, 0.026, "glow_lamp", roof="glow_lamp")


def flag(m, x, y, mat="sign_green", flip=False):
    m.cyl(x, y, 0.03, 0.006, 0.32, "metal", seg=5)
    s = -1 if flip else 1
    m._quad([(x, y - 0.003, 0.30), (x + s * 0.075, y - 0.003, 0.30),
             (x + s * 0.075, y - 0.003, 0.36), (x, y - 0.003, 0.36)], mat)


def bollards(m, xs, y, mat="metal_dark"):
    for x in xs:
        m.cyl(x, y, 0.03, 0.009, 0.055, mat, seg=5)


def ground(m, lawn=True, driveway=False):
    m.box(0, 0, 0, 0.96, 0.96, 0.03, "paving", roof="paving")
    m.box(0, -0.455, 0.03, 0.96, 0.05, 0.006, "concrete", roof="concrete")
    if lawn:
        m.box(-0.36, -0.20, 0.031, 0.16, 0.35, 0.004, "grass", roof="grass")
        m.box(0.36, -0.20, 0.031, 0.16, 0.35, 0.004, "grass", roof="grass")
        m.box(0, 0.41, 0.031, 0.86, 0.10, 0.004, "grass", roof="grass")
    if driveway:
        m.box(0, -0.33, 0.031, 0.70, 0.22, 0.006, "asphalt", roof="asphalt")


def rooftop_bits(m, z, cy=0.12):
    m.ac_unit(-0.18, cy, z)
    m.ac_unit(0.16, cy + 0.06, z)
    m.skylight(0.02, cy - 0.06, z, 0.11, 0.07)
    m.cyl(0.25, cy, z, 0.012, 0.09, "metal", seg=6)


def side_windows(m, cx, cy, w, d, z0, rows=1):
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
    for r in range(rows):
        z = z0 + 0.08 + r * 0.12
        for x in (x0 + w * 0.28, cx, x1 - w * 0.28):
            window(m, x, y0, z, side="f")
        for y in (y0 + d * 0.30, y1 - d * 0.30):
            window(m, y, x1, z, side="r", pane="glass_dark")
            window(m, y, x0, z, side="l", pane="glass_dark")
