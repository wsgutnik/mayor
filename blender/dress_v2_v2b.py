"""Local helpers for v2b commercial reference buildings."""


def qf(m, x0, x1, y, z0, z1, mat):
    m._quad([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], mat)


def qb(m, x0, x1, y, z0, z1, mat):
    m._quad([(x1, y, z0), (x0, y, z0), (x0, y, z1), (x1, y, z1)], mat)


def qr(m, x, y0, y1, z0, z1, mat):
    m._quad([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], mat)


def ql(m, x, y0, y1, z0, z1, mat):
    m._quad([(x, y1, z0), (x, y0, z0), (x, y0, z1), (x, y1, z1)], mat)


def ground(m, lawn=False):
    m.box(0, 0, 0, 0.96, 0.96, 0.03, "paving", roof="paving")
    m.box(0, -0.455, 0.031, 0.96, 0.05, 0.006, "concrete", roof="concrete")
    if lawn:
        m.box(-0.40, 0.18, 0.032, 0.08, 0.48, 0.004, "grass", roof="grass")
        m.box(0.40, 0.18, 0.032, 0.08, 0.48, 0.004, "grass", roof="grass")


def parapet(m, cx, cy, w, d, z, h=0.055, mat="concrete"):
    t = 0.024
    m.box(cx, cy - d / 2 + t / 2, z, w, t, h, mat)
    m.box(cx, cy + d / 2 - t / 2, z, w, t, h, mat)
    m.box(cx - w / 2 + t / 2, cy, z, t, d - 2 * t, h, mat)
    m.box(cx + w / 2 - t / 2, cy, z, t, d - 2 * t, h, mat)
    m.box(cx, cy - d / 2, z + h, w + 0.035, 0.022, 0.014, mat, roof=mat)
    m.box(cx, cy + d / 2, z + h, w + 0.035, 0.022, 0.014, mat, roof=mat)


def storefront(m, cx, y, z, w, h, cols=4, glass="glass_blue", frame="metal_dark", door_x=None):
    qf(m, cx - w / 2, cx + w / 2, y - 0.004, z, z + h, glass)
    t = 0.010
    for i in range(cols + 1):
        x = cx - w / 2 + w * i / cols
        m.box(x, y - 0.010, z, t, 0.012, h, frame)
    m.box(cx, y - 0.010, z + h - t / 2, w, 0.012, t, frame)
    m.box(cx, y - 0.010, z + t / 2, w, 0.012, t, frame)
    if door_x is not None:
        m.door(door_x, y - 0.004, z, 0.080, h * 0.78, "glass_dark", frame)


def window_grid(m, cx, cy, z0, w, d, floors, cols, sides="fbrl", lit=0.55):
    h = floors * 0.145
    m.windows(cx, cy, z0, w, d, h, floors, cols=cols, sides=sides, lit=lit, slabs=False)
    if "f" in sides:
        for fl in range(1, floors + 1):
            m.box(cx, cy - d / 2 - 0.010, z0 + fl * 0.145, w + 0.025, 0.018, 0.012, "slab")


def awning_with_ribs(m, cx, y, z, w, mat, ribs=4, depth=0.10):
    m.awning(cx, y, z, w, depth, mat)
    for i in range(ribs):
        x = cx - w * 0.42 + i * (w * 0.84 / max(1, ribs - 1))
        m.box(x, y - depth * 0.48, z - 0.030, 0.010, depth, 0.010, "metal_dark")


def sign_band(m, cx, y, z, w, h, mat="glow_sign", trim="concrete"):
    m.box(cx, y - 0.006, z, w + 0.030, 0.014, h + 0.018, trim)
    m.box(cx, y - 0.014, z + 0.004, w, 0.012, h, mat, roof=mat)


def roof_kit(m, z, items=2):
    for i in range(items):
        x = -0.16 + i * 0.16
        m.ac_unit(x, 0.08 + (i % 2) * 0.10, z, 0.07, 0.05, 0.035)
    m.cyl(0.22, 0.12, z, 0.015, 0.08, "metal", seg=6)
    m.box(0.22, 0.12, z + 0.08, 0.055, 0.055, 0.012, "metal_dark")


def planter(m, x, y, w=0.10, d=0.05, flowers=False):
    m.box(x, y, 0.033, w, d, 0.035, "wall_wood", roof="wall_wood")
    m.box(x, y, 0.068, w - 0.018, d - 0.014, 0.018, "flower_red" if flowers else "hedge", roof="hedge")


def lamp(m, x, y, h=0.18):
    m.cyl(x, y, 0.032, 0.008, h, "lamp_pole", seg=5)
    m.box(x, y - 0.006, 0.032 + h, 0.034, 0.024, 0.024, "glow_lamp", roof="glow_lamp")


def bollards(m, xs, y):
    for x in xs:
        m.cyl(x, y, 0.032, 0.009, 0.065, "metal_dark", seg=5)


def parking(m, y=-0.34, xs=(-0.32, -0.10, 0.12, 0.34)):
    m.box(0, y, 0.032, 0.86, 0.20, 0.005, "asphalt", roof="asphalt")
    for x in xs:
        m.box(x, y, 0.038, 0.010, 0.15, 0.003, "white", roof="white")


def loading_dock(m, cx, y, w=0.28):
    m.box(cx, y + 0.055, 0.032, w, 0.11, 0.018, "concrete", roof="concrete")
    m.box(cx - w * 0.18, y, 0.055, w * 0.32, 0.012, 0.13, "metal")
    m.box(cx + w * 0.18, y, 0.055, w * 0.32, 0.012, 0.13, "metal_dark")


def crate_stack(m, x, y):
    m.box(x, y, 0.033, 0.065, 0.045, 0.035, "wall_wood")
    m.box(x + 0.025, y + 0.015, 0.068, 0.055, 0.040, 0.030, "wall_wood")


def patio_table(m, x, y, umbrella="sign_red"):
    m.cyl(x, y, 0.032, 0.038, 0.018, "wall_wood", seg=6)
    m.cyl(x, y, 0.050, 0.006, 0.105, "metal", seg=4)
    m.cone(x, y, 0.155, 0.080, 0.045, umbrella, seg=6)


def side_projecting_sign(m, x, y, z, mat="glow_sign"):
    m.box(x, y, z, 0.014, 0.070, 0.050, mat, roof=mat)
    m.box(x, y + 0.040, z + 0.030, 0.012, 0.018, 0.012, "metal_dark")


def simple_lod_ground(m):
    m.box(0, 0, 0, 0.94, 0.94, 0.03, "paving", roof="paving")
