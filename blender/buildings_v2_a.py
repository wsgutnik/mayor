"""
V2 reference buildings, group A: Starter House (#01) and Heavy Factory (#38).

Non-base variants (never replace production): "v2" (LOD0, full detail),
"v2_lod1" (~25% triangles, same silhouette/footprint, no small props) and
"v2_lod2" (~5%, silhouette only). LODs share builders through the `lod`
parameter. The house also takes a `style` parameter (colour/roof schemes);
only the default style is registered as v2.
"""
import math

from lib import Model
from registry import building


# ---------------------------------------------------------------------------
# local helpers (used by both buildings; lib.py untouched)
# ---------------------------------------------------------------------------

def framed_window(m: Model, u, plane, z, w=0.075, h=0.095, side="f", lit=True,
                  frame="white", sill="white", mullions=True, shutters=None):
    """Window with a frame box, glass quad, sill, cross mullions, optional shutters.

    `u` runs along the wall (x for f/b, y for r/l); `plane` is the wall plane
    coordinate (y for f/b, x for r/l); `z` is the glass centre height.
    """
    s = -1 if side in ("f", "l") else 1  # outward direction sign
    glass = "glow_window" if lit else "glass_dark"
    fw, fh = w + 0.024, h + 0.024
    u0, u1, z0, z1 = u - w / 2, u + w / 2, z - h / 2, z + h / 2
    if side in ("f", "b"):
        m.box(u, plane + s * 0.004, z - fh / 2, fw, 0.014, fh, frame)
        yp = plane + s * 0.012
        if side == "f":
            m._quad([(u0, yp, z0), (u1, yp, z0), (u1, yp, z1), (u0, yp, z1)], glass)
        else:
            m._quad([(u1, yp, z0), (u0, yp, z0), (u0, yp, z1), (u1, yp, z1)], glass)
        m.box(u, plane + s * 0.010, z - h / 2 - 0.015, w + 0.04, 0.024, 0.014, sill)
        if mullions:
            m.box(u, plane + s * 0.011, z0, 0.007, 0.005, h, frame)
            m.box(u, plane + s * 0.011, z - 0.0035, w, 0.005, 0.007, frame)
        if shutters:
            for sx in (u - w / 2 - 0.028, u + w / 2 + 0.028):
                m.box(sx, plane + s * 0.006, z - h / 2 - 0.005, 0.03, 0.008, h + 0.01, shutters)
    else:
        m.box(plane + s * 0.004, u, z - fh / 2, 0.014, fw, fh, frame)
        xp = plane + s * 0.012
        if side == "r":
            m._quad([(xp, u0, z0), (xp, u1, z0), (xp, u1, z1), (xp, u0, z1)], glass)
        else:
            m._quad([(xp, u1, z0), (xp, u0, z0), (xp, u0, z1), (xp, u1, z1)], glass)
        m.box(plane + s * 0.010, u, z - h / 2 - 0.015, 0.024, w + 0.04, 0.014, sill)
        if mullions:
            m.box(plane + s * 0.011, u, z0, 0.005, 0.007, h, frame)
            m.box(plane + s * 0.011, u, z - 0.0035, 0.005, w, 0.007, frame)
        if shutters:
            for sy in (u - w / 2 - 0.028, u + w / 2 + 0.028):
                m.box(plane + s * 0.006, sy, z - h / 2 - 0.005, 0.008, 0.03, h + 0.01, shutters)


def gable_ridge_cap(m: Model, cx, cy, zr, length, axis="y", mat="roof_dark"):
    """Ridge cap bar along a gable ridge (axis y = ridge runs north-south)."""
    if axis == "y":
        m.box(cx, cy, zr, 0.035, length, 0.014, mat)
    else:
        m.box(cx, cy, zr, length, 0.035, 0.014, mat)


def hip_ridge_cap(m: Model, cx, cy, zr, w, d, mat="roof_dark", ridge_frac=0.4):
    """Ridge cap for lib.hip (same ridge-length formula as the roof)."""
    if w >= d:
        rl = (w - d) * ridge_frac + 0.001
        m.box(cx, cy, zr, rl + 0.05, 0.035, 0.014, mat)
    else:
        rl = (d - w) * ridge_frac + 0.001
        m.box(cx, cy, zr, 0.035, rl + 0.05, 0.014, mat)


def stoop(m: Model, cx, y_wall, z_top, w=0.11, mat="concrete"):
    """Two stacked slabs forming steps up to a porch/deck at z_top."""
    h = z_top - 0.03
    m.box(cx, y_wall - 0.03, 0.03, w, 0.06, h * 0.55, mat, roof=mat)
    m.box(cx, y_wall - 0.015, 0.03, w, 0.03, h, mat, roof=mat)


def wheel_x(m: Model, cx, cy, cz, r, w, mat="tire", rim="rim", seg=8):
    """Wheel with its axle along X (for vehicles parked along Y). Correct outward caps."""
    x0, x1 = cx - w / 2, cx + w / 2
    for i in range(seg):
        a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
        y0, z0 = cy + math.cos(a0) * r, cz + math.sin(a0) * r
        y1, z1 = cy + math.cos(a1) * r, cz + math.sin(a1) * r
        m._quad([(x0, y0, z0), (x0, y1, z1), (x1, y1, z1), (x1, y0, z0)], mat)
        m._tri([(x1, cy, cz), (x1, y0, z0), (x1, y1, z1)], rim)
        m._tri([(x0, cy, cz), (x0, y1, z1), (x0, y0, z0)], rim)


def wheel_y(m: Model, cx, cy, cz, r, w, mat="tire", rim="rim", seg=8):
    """Wheel with its axle along Y (for vehicles parked along X). Correct outward caps."""
    y0, y1 = cy - w / 2, cy + w / 2
    for i in range(seg):
        a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
        x0, z0 = cx + math.cos(a0) * r, cz + math.sin(a0) * r
        x1, z1 = cx + math.cos(a1) * r, cz + math.sin(a1) * r
        m._quad([(x0, y0, z0), (x1, y0, z1), (x1, y1, z1), (x0, y1, z0)], mat)
        m._tri([(cx, y1, cz), (x1, y1, z1), (x0, y1, z0)], rim)
        m._tri([(cx, y0, cz), (x0, y0, z0), (x1, y0, z1)], rim)


def hpipe(m: Model, cx, cy, z, length, r, axis="x", mat="metal", seg=6):
    """Horizontal pipe (open ends, hidden inside equipment)."""
    for i in range(seg):
        a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
        c0, s0 = math.cos(a0) * r, math.sin(a0) * r
        c1, s1 = math.cos(a1) * r, math.sin(a1) * r
        if axis == "x":
            x0, x1 = cx - length / 2, cx + length / 2
            m._quad([(x0, cy + c0, z + s0), (x0, cy + c1, z + s1),
                     (x1, cy + c1, z + s1), (x1, cy + c0, z + s0)], mat)
        else:
            y0, y1 = cy - length / 2, cy + length / 2
            m._quad([(cx + c0, y0, z + s0), (cx + c0, y1, z + s0),
                     (cx + c1, y1, z + s1), (cx + c1, y0, z + s1)], mat)


def lamp_post(m: Model, x, y, h=0.30, head="glow_lamp"):
    """Street lamp: pole, arm over the road (-Y side), glowing head."""
    m.cyl(x, y, 0.03, 0.010, h, "lamp_pole", seg=5)
    m.box(x, y - 0.03, 0.03 + h, 0.016, 0.07, 0.014, "lamp_pole")
    m.box(x, y - 0.06, 0.03 + h - 0.012, 0.035, 0.03, 0.012, "metal_dark")
    m._quad([(x - 0.014, y - 0.073, 0.03 + h - 0.012), (x - 0.014, y - 0.047, 0.03 + h - 0.012),
             (x + 0.014, y - 0.047, 0.03 + h - 0.012), (x + 0.014, y - 0.073, 0.03 + h - 0.012)], head)


def flat_quad(m: Model, x0, y0, x1, y1, z, mat, facing="up"):
    """Ground marking quad (no z-fighting: caller picks z above the surface)."""
    if facing == "up":
        m._quad([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat)
    else:
        m._quad([(x0, y0, z), (x0, y1, z), (x1, y1, z), (x1, y0, z)], mat)


# ---------------------------------------------------------------------------
# #01 Starter House
# ---------------------------------------------------------------------------

# 5 colour/roof schemes; only style 0 is registered as v2.
HOUSE_STYLES = [
    {"wall": "wall_cream", "roof": "roof_slate", "trim": "white",
     "shutter": "wall_navy", "door": "wall_red", "garage": "wall_grey"},
    {"wall": "wall_brick", "roof": "roof_dark", "trim": "white",
     "shutter": "wall_cream", "door": "wall_wood", "garage": "wall_cream"},
    {"wall": "wall_beige", "roof": "roof_red", "trim": "white",
     "shutter": "wall_green", "door": "wall_green", "garage": "white"},
    {"wall": "wall_white", "roof": "roof_dark", "trim": "white",
     "shutter": "black", "door": "black", "garage": "wall_grey"},
    {"wall": "wall_wood", "roof": "roof_green", "trim": "wall_cream",
     "shutter": "wall_cream", "door": "wall_navy", "garage": "wall_cream"},
]

HX, HY = -0.10, 0.10       # main house centre
GX, GY = 0.30, 0.10        # garage centre


def build_starter(m: Model, style=0, lod=0):
    st = HOUSE_STYLES[style % len(HOUSE_STYLES)]
    wall, roof, trim = st["wall"], st["roof"], st["trim"]
    full = lod == 0

    # -- ground ----------------------------------------------------------
    m.box(0, 0, 0, 0.96, 0.96, 0.03, "paving", roof="paving")
    if lod <= 1:
        # lawns (thin slabs over the paving)
        m.box(-0.20, -0.30, 0.03, 0.52, 0.28, 0.004, "grass", roof="grass")
        m.box(-0.40, 0.10, 0.03, 0.12, 0.56, 0.004, "grass", roof="grass")
        m.box(-0.10, 0.40, 0.03, 0.72, 0.16, 0.004, "grass", roof="grass")
        # driveway (east) with control joints, sidewalk, walkway pavers
        m.box(0.30, -0.26, 0.03, 0.20, 0.44, 0.008, "concrete", roof="concrete")
        if full:
            for y in (-0.36, -0.25, -0.14):
                m.box(0.30, y, 0.038, 0.20, 0.008, 0.002, "slab")
        m.box(0, -0.455, 0.03, 0.96, 0.05, 0.006, "concrete", roof="concrete")
        for i, y in enumerate((-0.415, -0.375, -0.335)):
            m.box(-0.10, y, 0.03, 0.10, 0.032 if full else 0.036, 0.006, "paving", roof="paving")
    else:
        m.box(0.30, -0.26, 0.03, 0.20, 0.44, 0.008, "concrete", roof="concrete")

    # -- main house mass -------------------------------------------------
    m.box(HX, HY, 0.03, 0.54, 0.42, 0.07, "concrete")                       # plinth
    m.box(HX, HY, 0.10, 0.52, 0.40, 0.23, wall)                             # walls
    if full:  # water table + corner boards
        m.box(HX, HY, 0.093, 0.545, 0.425, 0.014, trim)
        for cx in (HX - 0.255, HX + 0.255):
            for cy in (HY - 0.195, HY + 0.195):
                m.box(cx, cy, 0.10, 0.024, 0.024, 0.23, trim)
    # hip roof with eaves slab + ridge cap
    if lod <= 1:
        m.box(HX, HY, 0.322, 0.62, 0.50, 0.016, trim)                       # eaves/soffit
    m.hip(HX, HY, 0.33, 0.62, 0.50, 0.20, roof)
    if full:
        hip_ridge_cap(m, HX, HY, 0.53, 0.62, 0.50)
    # front dormer with its own gable roof + window
    if lod <= 1:
        m.box(HX, -0.06, 0.34, 0.14, 0.12, 0.18, wall)
        m.gable(HX, -0.06, 0.52, 0.18, 0.16, 0.07, roof, end=wall)
        if full:
            gable_ridge_cap(m, HX, -0.06, 0.59, 0.14)
        framed_window(m, HX, -0.12, 0.44, w=0.06, h=0.07, side="f",
                      lit=m.rng.random() < 0.6, frame=trim, mullions=full)
    # chimney with cap
    if lod <= 1:
        m.box(-0.02, 0.16, 0.44, 0.05, 0.05, 0.18, "wall_brick")
        m.box(-0.02, 0.16, 0.62, 0.066, 0.066, 0.014, "concrete")
        if full:
            m.box(-0.02, 0.16, 0.634, 0.03, 0.03, 0.02, "metal_dark")
    else:
        m.box(-0.02, 0.16, 0.44, 0.05, 0.05, 0.18, "wall_brick")

    # -- garage wing -----------------------------------------------------
    m.box(GX, GY, 0.03, 0.26, 0.36, 0.07, "concrete")
    m.box(GX, GY, 0.10, 0.24, 0.34, 0.16, wall)
    if lod <= 1:
        m.box(GX, GY, 0.252, 0.32, 0.42, 0.016, trim)                       # eaves
    m.gable(GX, GY, 0.26, 0.32, 0.42, 0.13, roof, end=wall)
    if full:
        gable_ridge_cap(m, GX, GY, 0.39, 0.30)
        # gable vent + downspouts
        m.box(GX, -0.115, 0.30, 0.06, 0.012, 0.06, trim)
        m.box(GX, -0.118, 0.30, 0.04, 0.012, 0.04, "metal_dark")
        m.box(HX - 0.27, -0.115, 0.03, 0.014, 0.014, 0.30, trim)
        m.box(0.425, 0.0, 0.03, 0.014, 0.014, 0.23, trim)
    # garage door: recess, panel grooves, top glazing, coach lamps
    if lod <= 1:
        m.box(GX, -0.072, 0.10, 0.18, 0.008, 0.13, trim)
        m.box(GX, -0.077, 0.105, 0.16, 0.006, 0.12, st["garage"])
        if full:
            for z in (0.135, 0.16, 0.185):
                m.box(GX, -0.081, z - 0.004, 0.16, 0.004, 0.008, trim)
            for i in range(4):
                m.box(GX - 0.06 + i * 0.04, -0.081, 0.198, 0.026, 0.004, 0.02, "glass_dark")
            for lx in (GX - 0.115, GX + 0.115):
                m.box(lx, -0.075, 0.20, 0.014, 0.01, 0.024, "glow_lamp")

    # -- porch -----------------------------------------------------------
    if lod <= 1:
        m.box(HX, -0.155, 0.03, 0.24, 0.11, 0.05, "concrete", roof="concrete")
        m.box(HX - 0.10, -0.19, 0.08, 0.022, 0.022, 0.21, trim)              # columns
        m.box(HX + 0.10, -0.19, 0.08, 0.022, 0.022, 0.21, trim)
        m.gable(HX, -0.155, 0.29, 0.30, 0.17, 0.08, roof, end=trim, ridge="x")
        if full:
            gable_ridge_cap(m, HX, -0.155, 0.37, 0.24, axis="x")
            for rx in (HX - 0.10, HX + 0.10):                               # side railings
                m.box(rx, -0.155, 0.155, 0.012, 0.09, 0.012, trim)
                m.box(rx, -0.155, 0.115, 0.012, 0.09, 0.010, trim)
            m.door(HX, -0.10, 0.08, 0.07, 0.13, st["door"], trim)
            m.box(HX + 0.065, -0.104, 0.17, 0.014, 0.01, 0.024, "glow_lamp")  # porch lamp
            stoop(m, HX, -0.21, 0.08)
        else:
            m.door(HX, -0.10, 0.08, 0.07, 0.13, st["door"], trim)
    else:
        m.box(HX, -0.155, 0.03, 0.24, 0.11, 0.05, "concrete", roof="concrete")
        m.gable(HX, -0.155, 0.08, 0.30, 0.17, 0.10, roof, end=roof, ridge="x")

    # -- windows ---------------------------------------------------------
    if lod == 2:
        return
    lit = lambda p=0.6: m.rng.random() < p
    shut = st["shutter"] if full else None
    framed_window(m, HX - 0.16, -0.10, 0.21, w=0.10, h=0.11, side="f",
                  lit=lit(), frame=trim, mullions=full, shutters=shut)
    framed_window(m, HX + 0.13, -0.10, 0.21, w=0.07, h=0.11, side="f",
                  lit=lit(), frame=trim, mullions=full, shutters=shut)
    framed_window(m, 0.10, 0.42, 0.18, w=0.07, h=0.08, side="r",
                  lit=lit(), frame=trim, mullions=full)
    for i, wy in enumerate((0.0, 0.20)):
        framed_window(m, wy, -0.36, 0.21, w=0.08, h=0.11, side="l",
                      lit=lit(), frame=trim, mullions=full)
    for i, wx in enumerate((-0.24, -0.06, 0.10)):
        framed_window(m, wx, 0.30, 0.21, w=0.08, h=0.11, side="b",
                      lit=lit(), frame=trim, mullions=full)
    if full:
        m.door(-0.10, 0.30, 0.10, 0.06, 0.11, st["door"], trim)              # back door
        m.box(-0.10, 0.345, 0.03, 0.12, 0.09, 0.07, "concrete", roof="concrete")  # stoop

    # -- garden ----------------------------------------------------------
    if lod == 1:
        m.box(-0.28, -0.40, 0.034, 0.30, 0.035, 0.05, "hedge", roof="hedge")
        m.box(0.08, -0.40, 0.034, 0.16, 0.035, 0.05, "hedge", roof="hedge")
        m.tree(-0.36, -0.30, 1.0)
        return
    # hedges + foundation bushes + flower bed
    m.box(-0.28, -0.40, 0.034, 0.30, 0.035, 0.05, "hedge", roof="hedge")
    m.box(0.08, -0.40, 0.034, 0.16, 0.035, 0.05, "hedge", roof="hedge")
    m.box(HX, -0.225, 0.034, 0.26, 0.05, 0.02, "bark", roof="bark")
    for bx in (HX - 0.10, HX - 0.03, HX + 0.04, HX + 0.10):
        m.box(bx, -0.225, 0.054, 0.022, 0.022, 0.022,
              "flower_red" if int(bx * 100) % 2 else "flower_yellow")
    for bx, bz in ((HX - 0.155, 0), (HX + 0.155, 0)):
        m.blob(bx, -0.19, 0.09, 0.035, 0.035, 0.035, "leaf_b", subdiv=0, seed=7 + int(bx * 50))
    # mailbox
    m.box(-0.19, -0.41, 0.036, 0.014, 0.014, 0.10, "trunk")
    m.box(-0.19, -0.41, 0.136, 0.05, 0.028, 0.032, "metal_dark")
    m.box(-0.162, -0.41, 0.15, 0.006, 0.02, 0.03, "sign_red")
    # ornamental tree + back pine + parked car
    m.cyl(-0.36, -0.30, 0.034, 0.012, 0.08, "trunk", seg=5)
    m.blob(-0.36, -0.30, 0.15, 0.07, 0.07, 0.06, "leaf_c", subdiv=1, seed=3)
    m.blob(-0.30, -0.27, 0.11, 0.04, 0.04, 0.035, "leaf_b", subdiv=0, seed=4)
    m.tree(0.40, 0.38, 0.9, dark=True)
    m.parked_car(0.30, -0.30, "sign_blue", "y")
    # back patio with table + umbrella
    m.box(-0.16, 0.39, 0.034, 0.24, 0.12, 0.006, "paving", roof="paving")
    m.cyl(-0.16, 0.39, 0.04, 0.04, 0.018, "wall_wood", seg=8)
    m.cyl(-0.16, 0.39, 0.058, 0.006, 0.09, "metal", seg=5)
    m.cone(-0.16, 0.39, 0.148, 0.075, 0.04, "sign_red", seg=8)
    m.cyl(-0.23, 0.39, 0.04, 0.018, 0.025, "bench_wood", seg=6)
    m.cyl(-0.09, 0.39, 0.04, 0.018, 0.025, "bench_wood", seg=6)
    # side + back fences
    m.fence(-0.46, -0.10, -0.46, 0.46, 0.055, "wall_wood", 6)
    m.fence(-0.46, 0.46, 0.46, 0.46, 0.055, "wall_wood", 9)


@building(1, "Casa Inicial", variant="v2", version=1)
def starter_house_v2(m: Model):
    build_starter(m, style=0, lod=0)


@building(1, "Casa Inicial", variant="v2_lod1", version=1)
def starter_house_v2_lod1(m: Model):
    build_starter(m, style=0, lod=1)


@building(1, "Casa Inicial", variant="v2_lod2", version=1)
def starter_house_v2_lod2(m: Model):
    build_starter(m, style=0, lod=2)


# ---------------------------------------------------------------------------
# #38 Heavy Factory
# ---------------------------------------------------------------------------

def sawtooth(m: Model, x0, x1, y0, y1, z0, h, roof="roof_slate", glass="glass_dark"):
    """One sawtooth bay: sloped roof panel up to x0, vertical glazing at x1."""
    zh = z0 + h
    m._quad([(x0, y0, zh), (x1, y0, z0), (x1, y1, z0), (x0, y1, zh)], roof)
    zc = z0 + 0.02
    m._quad([(x1, y0, zc), (x1, y1, zc), (x1, y1, zh), (x1, y0, zh)], glass)


def tank_h(m: Model, cx, cy, z, length, r, mat="metal", seg=10):
    """Horizontal tank along Y with capped ends."""
    hpipe(m, cx, cy, z, length, r, axis="y", mat=mat, seg=seg)
    y0, y1 = cy - length / 2, cy + length / 2
    for i in range(seg):
        a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
        x0, z0 = cx + math.cos(a0) * r, z + math.sin(a0) * r
        x1, z1 = cx + math.cos(a1) * r, z + math.sin(a1) * r
        m._tri([(cx, y0, z), (x0, y0, z0), (x1, y0, z1)], mat)
        m._tri([(cx, y1, z), (x1, y1, z1), (x0, y1, z0)], mat)


def dropped_trailer(m: Model, cx, cy, length=0.24, full=True):
    """Semi trailer spotted at a dock (no cab): box, gear, wheels, lights."""
    w, z0, h = 0.11, 0.075, 0.125
    m.box(cx, cy, z0, w, length, h, "white", roof="white")
    y_door = cy + length / 2  # door end faces the dock (+Y here)
    if not full:
        for sx in (cx - 0.045, cx + 0.045):
            m.box(sx, cy - length / 2 + 0.045, 0.03, 0.02, 0.09, 0.05, "tire")
        m.box(cx, y_door - 0.01, 0.03, w - 0.01, 0.012, 0.05, "metal_dark")
        return
    for sx in (cx - w / 2 + 0.004, cx + w / 2 - 0.004):                      # side stripe
        m.box(sx, cy, z0 + 0.02, 0.003, length - 0.02, 0.014, "sign_blue")
    m.box(cx, y_door + 0.001, z0 + 0.01, 0.006, 0.006, h - 0.02, "metal_dark")  # door stile
    m.box(cx, y_door + 0.001, z0 + h / 2, w - 0.02, 0.006, 0.008, "metal_dark")  # mid rail
    for gx in (cx - 0.035, cx + 0.035):                                     # landing gear
        m.box(gx, y_door - 0.05, 0.03, 0.016, 0.016, z0 - 0.03, "metal_dark")
    for wy in (cy - length / 2 + 0.03, cy - length / 2 + 0.065):            # tandem axles
        for sx in (cx - 0.048, cx + 0.048):
            wheel_x(m, sx, wy, 0.054, 0.024, 0.02, seg=8)
    m.box(cx, y_door - 0.008, 0.03, w - 0.01, 0.012, 0.05, "metal_dark")    # underrun
    for sx in (cx - 0.04, cx + 0.04):                                       # tail lights
        m.box(sx, y_door + 0.001, z0 + h - 0.02, 0.014, 0.006, 0.012, "glow_tail")


def day_cab(m: Model, cx, cy, full=True):
    """Day-cab tractor parked along X."""
    cab = "wall_red"
    m.box(cx, cy, 0.05, 0.16, 0.09, 0.03, "metal_dark")                      # chassis
    m.box(cx + 0.055, cy, 0.08, 0.05, 0.085, 0.05, cab)                     # hood
    m.box(cx - 0.005, cy, 0.08, 0.06, 0.095, 0.10, cab)                     # cab
    m.box(cx + 0.026, cy, 0.12, 0.004, 0.08, 0.05, "glass_dark")            # windshield
    m.box(cx + 0.085, cy, 0.05, 0.015, 0.095, 0.03, "metal")                # bumper
    if not full:
        for wx in (cx + 0.055, cx - 0.035):
            for sy in (cy - 0.045, cy + 0.045):
                m.box(wx, sy, 0.03, 0.03, 0.02, 0.05, "tire")
        return
    for wx in (cx + 0.055, cx - 0.035):
        for sy in (cy - 0.045, cy + 0.045):
            wheel_y(m, wx, sy, 0.056, 0.026, 0.02, seg=8)
    m.cyl(cx - 0.038, cy - 0.035, 0.08, 0.008, 0.12, "metal", seg=5)        # stack
    m.box(cx - 0.01, cy + 0.02, 0.055, 0.05, 0.03, 0.03, "metal")           # fuel tank
    for sy in (cy - 0.03, cy + 0.03):
        m.box(cx + 0.093, sy, 0.065, 0.004, 0.018, 0.014, "glow_head")      # headlights


def build_factory(m: Model, lod=0):
    full = lod == 0
    HX, HY = -0.08, 0.14   # main hall centre

    # -- ground: concrete base + asphalt yard --------------------------------
    m.box(0, 0, 0, 0.96, 0.96, 0.03, "concrete", roof="concrete")
    if lod <= 1:
        m.box(0.0, -0.28, 0.03, 0.90, 0.36, 0.004, "asphalt", roof="asphalt")
        # service road markings
        for i in range(12):
            x = -0.40 + i * 0.072
            flat_quad(m, x, -0.384, x + 0.035, -0.376, 0.035, "white")
        flat_quad(m, -0.44, -0.319, 0.44, -0.311, 0.035, "white")
        flat_quad(m, -0.44, -0.449, 0.44, -0.441, 0.035, "white")
        if full:
            flat_quad(m, 0.06, -0.435, 0.18, -0.415, 0.035, "white")        # stop bar
            for i in range(5):                                             # crosswalk
                flat_quad(m, -0.375, -0.44 + i * 0.026, -0.265, -0.424 + i * 0.026, 0.035, "white")
    else:
        m.box(0.0, -0.28, 0.03, 0.90, 0.36, 0.004, "asphalt", roof="asphalt")

    # -- main hall ---------------------------------------------------------
    m.box(HX, HY, 0.03, 0.54, 0.46, 0.06, "concrete")                       # plinth
    m.box(HX, HY, 0.09, 0.52, 0.44, 0.28, "wall_brick")                     # walls
    m.box(HX, HY, 0.37, 0.54, 0.46, 0.02, "roof_flat")                      # roof deck
    if lod == 2:
        m.box(HX, HY, 0.39, 0.52, 0.44, 0.10, "roof_slate")                 # teeth mass
    else:
        tw = 0.52 / 3
        for i in range(3):
            x0 = HX - 0.26 + i * tw
            glass = "glow_window" if i == 1 else "glass_dark"
            sawtooth(m, x0, x0 + tw, -0.08, 0.36, 0.39, 0.10, glass=glass)
            m.box(x0 + tw - 0.008, HY, 0.39, 0.016, 0.44, 0.02, "concrete")  # curb
            if full:
                m.box(x0, HY, 0.49, 0.02, 0.46, 0.012, "roof_dark")         # top flashing
        m.box(HX, -0.09, 0.39, 0.54, 0.02, 0.12, "wall_brick")              # parapet ends
        m.box(HX, 0.37, 0.39, 0.54, 0.02, 0.12, "wall_brick")
    # pilasters + high windows
    if lod == 2:
        pass
    elif full:
        for px in (-0.30, -0.212, -0.124, -0.036, 0.052, 0.14):
            m.box(px, -0.085, 0.09, 0.035, 0.03, 0.28, "concrete")
        for py in (-0.02, 0.08, 0.18, 0.28):
            m.box(-0.345, py, 0.09, 0.03, 0.035, 0.28, "concrete")
            m.box(0.185, py, 0.09, 0.03, 0.035, 0.28, "concrete")
        lit = lambda: m.rng.random() < 0.6
        for wx in (-0.256, -0.168, -0.08, 0.008, 0.096):
            framed_window(m, wx, -0.08, 0.27, w=0.055, h=0.08, side="f",
                          lit=lit(), frame="concrete", sill="concrete", mullions=False)
        for wy in (0.03, 0.14, 0.25):
            framed_window(m, wy, -0.34, 0.27, w=0.055, h=0.08, side="l",
                          lit=lit(), frame="concrete", sill="concrete", mullions=False)
            framed_window(m, wy, 0.18, 0.27, w=0.055, h=0.08, side="r",
                          lit=lit(), frame="concrete", sill="concrete", mullions=False)
        for wx in (-0.21, -0.08, 0.05):
            framed_window(m, wx, 0.36, 0.27, w=0.055, h=0.08, side="b",
                          lit=lit(), frame="concrete", sill="concrete", mullions=False)
        for wx in (-0.168, -0.08, 0.008):                                   # louver vents
            m.box(wx, -0.082, 0.15, 0.05, 0.012, 0.04, "metal_dark")
    else:
        for px in (-0.30, -0.212, -0.124, -0.036, 0.052, 0.14):
            m.box(px, -0.085, 0.09, 0.035, 0.03, 0.28, "concrete")
        m.windows(HX, HY, 0.20, 0.52, 0.44, 0.14, 1, cols=5, sides="fbrl",
                  lit=0.6, slabs=False, off=0.004)
    # freight door (west of dock) + lamp
    if lod <= 1:
        m.box(-0.26, -0.082, 0.09, 0.14, 0.012, 0.15, "concrete")
        m.box(-0.26, -0.086, 0.095, 0.12, 0.008, 0.13, "metal_dark")
        m.box(-0.26, -0.088, 0.245, 0.22, 0.01, 0.015, "metal_dark")
        m.box(-0.26, -0.09, 0.27, 0.03, 0.012, 0.02, "glow_lamp")

    # -- chimneys ----------------------------------------------------------
    for i, chx in enumerate((-0.29, 0.05)):
        seg = 8 if full else (6 if lod == 1 else 5)
        z0 = 0.40 if lod <= 1 else 0.39
        h = 0.55 if lod <= 1 else 0.56
        m.cyl(chx, 0.30, z0, 0.032, h, "wall_grey", seg=seg, r_top=0.026)
        if lod <= 1:
            m.cyl(chx, 0.30, z0 + h * 0.72, 0.0285, 0.06, "sign_red", seg=seg)
            if full:
                m.cyl(chx, 0.30, z0 + h * 0.88, 0.0272, 0.035, "sign_red", seg=seg)
                m.cyl(chx, 0.30, z0 + h, 0.030, 0.015, "metal_dark", seg=seg)
                m.box(chx, 0.30, 0.44, 0.09, 0.09, 0.03, "concrete")

    # -- east block (flat roof, parapet, roof plant) ------------------------
    EX, EY = 0.33, 0.16
    m.box(EX, EY, 0.03, 0.24, 0.42, 0.06, "concrete")
    m.box(EX, EY, 0.09, 0.22, 0.40, 0.18, "wall_grey")
    if lod == 2:
        m.box(EX, EY, 0.27, 0.24, 0.42, 0.02, "roof_flat")
    else:
        m.box(EX, -0.04, 0.27, 0.24, 0.02, 0.05, "wall_grey")
        m.box(EX, 0.36, 0.27, 0.24, 0.02, 0.05, "wall_grey")
        m.box(0.22, EY, 0.27, 0.02, 0.42, 0.05, "wall_grey")
        m.box(0.44, EY, 0.27, 0.02, 0.42, 0.05, "wall_grey")
        m.box(EX, EY, 0.265, 0.22, 0.40, 0.012, "roof_flat")
        m.ac_unit(EX - 0.05, EY + 0.08, 0.277)
        if full:
            m.ac_unit(EX + 0.05, EY - 0.06, 0.277)
            m.cyl(EX + 0.04, EY + 0.10, 0.277, 0.022, 0.06, "metal", seg=6)
            m.cone(EX + 0.04, EY + 0.10, 0.337, 0.03, 0.025, "metal_dark", seg=6)
        m.skylight(EX - 0.04, EY - 0.08, 0.277, 0.09, 0.07)
        m.cyl(EX + 0.06, EY - 0.02, 0.277, 0.018, 0.20, "metal", seg=6)      # steel stack
        # roller door + canopy + windows
        m.box(EX, -0.042, 0.09, 0.14, 0.012, 0.14, "concrete")
        m.box(EX, -0.046, 0.095, 0.12, 0.008, 0.12, "metal")
        m.box(EX, -0.09, 0.235, 0.18, 0.10, 0.015, "roof_dark", roof="roof_dark")
        m.box(EX - 0.09, -0.20, 0.095, 0.03, 0.012, 0.02, "glow_lamp")
        if full:
            lit = lambda: m.rng.random() < 0.6
            for wx in (EX - 0.07, EX + 0.07):
                framed_window(m, wx, -0.04, 0.225, w=0.045, h=0.05, side="f",
                              lit=lit(), frame="concrete", sill="concrete", mullions=False)
            for wy in (0.06, 0.26):
                framed_window(m, wy, 0.44, 0.225, w=0.05, h=0.05, side="r",
                              lit=lit(), frame="concrete", sill="concrete", mullions=False)
        else:
            m.windows(EX, EY, 0.16, 0.22, 0.40, 0.09, 1, cols=2, sides="fr",
                      lit=0.6, slabs=False, off=0.004)

    # -- office annex ------------------------------------------------------
    OX, OY = -0.32, -0.20
    m.box(OX, OY, 0.03, 0.20, 0.16, 0.11, "wall_cream")
    if lod <= 1:
        m.box(OX, -0.28, 0.14, 0.22, 0.02, 0.035, "wall_cream")
        m.box(OX, -0.12, 0.14, 0.22, 0.02, 0.035, "wall_cream")
        m.box(OX - 0.10, OY, 0.14, 0.02, 0.18, 0.035, "wall_cream")
        m.box(OX + 0.10, OY, 0.14, 0.02, 0.18, 0.035, "wall_cream")
        m.box(OX, OY, 0.138, 0.20, 0.16, 0.012, "roof_flat")
        m.door(OX, -0.28, 0.03, 0.06, 0.10, "glass_dark", "white")
        m.box(OX, -0.315, 0.135, 0.12, 0.07, 0.012, "roof_dark", roof="roof_dark")  # canopy
        m.box(OX, -0.283, 0.115, 0.16, 0.008, 0.028, "glow_sign")            # sign band
        if full:
            m.ac_unit(OX + 0.05, OY + 0.03, 0.15, w=0.05, d=0.04, h=0.03)
            for wx in (OX - 0.065, OX + 0.065):
                framed_window(m, wx, -0.28, 0.095, w=0.045, h=0.055, side="f",
                              lit=m.rng.random() < 0.7, frame="white", mullions=False)
            framed_window(m, OY, OX - 0.10, 0.095, w=0.05, h=0.055, side="l",
                          lit=True, frame="white", mullions=False)
            m.box(OX, -0.30, 0.034, 0.08, 0.05, 0.004, "paving", roof="paving")  # walkway
        else:
            m.windows(OX, OY, 0.05, 0.20, 0.16, 0.07, 1, cols=3, sides="f",
                      lit=0.7, slabs=False, off=0.004)
    else:
        m.box(OX, OY, 0.14, 0.20, 0.16, 0.02, "roof_flat")

    # -- loading dock ------------------------------------------------------
    m.box(-0.02, -0.14, 0.03, 0.30, 0.12, 0.07, "concrete", roof="concrete")
    if lod <= 1:
        if full:
            for i in range(5):                                               # edge stripes
                m.box(-0.14 + i * 0.06, -0.195, 0.10, 0.03, 0.01, 0.004, "wall_yellow")
        for dx in (-0.09, 0.05):
            m.box(dx, -0.082, 0.10, 0.11, 0.012, 0.13, "metal")
            m.box(dx, -0.086, 0.105, 0.09, 0.008, 0.11, "metal_dark")
            if full:
                for bx in (dx - 0.04, dx + 0.04):
                    m.box(bx, -0.09, 0.10, 0.02, 0.02, 0.06, "black")        # bumpers
                m.box(dx, -0.09, 0.245, 0.024, 0.012, 0.018, "glow_lamp")
        m.box(-0.02, -0.14, 0.30, 0.34, 0.16, 0.02, "roof_dark")             # canopy
        for px in (-0.17, 0.13):
            m.box(px, -0.20, 0.10, 0.02, 0.02, 0.20, "metal_dark")
        if full:
            m.box(-0.20, -0.14, 0.03, 0.06, 0.12, 0.025, "concrete", roof="concrete")  # dock steps
            m.box(-0.185, -0.14, 0.03, 0.03, 0.12, 0.05, "concrete", roof="concrete")
            for bx in (-0.13, -0.05, 0.03, 0.11):
                m.cyl(bx, -0.235, 0.034, 0.012, 0.05, "wall_yellow", seg=6)  # bollards

    # -- vehicles ----------------------------------------------------------
    if lod <= 1:
        dropped_trailer(m, 0.05, -0.33, full=full)
    else:
        m.box(0.05, -0.33, 0.075, 0.11, 0.24, 0.125, "white", roof="white")
    if lod <= 1:
        day_cab(m, -0.12, -0.38, full=full)

    # -- silos + horizontal tank (west) -------------------------------------
    if lod == 2:
        for sy in (0.28, 0.40):
            m.cyl(-0.41, sy, 0.03, 0.042, 0.32, "concrete", seg=5)
            m.cone(-0.41, sy, 0.35, 0.046, 0.06, "metal_dark", seg=5)
        m.box(-0.40, -0.02, 0.05, 0.10, 0.16, 0.10, "metal")
    else:
        seg = 8 if full else 6
        for sy in (0.28, 0.40):
            m.cyl(-0.41, sy, 0.03, 0.042, 0.32, "concrete", seg=seg)
            m.cone(-0.41, sy, 0.35, 0.046, 0.06, "metal_dark", seg=seg)
            if full:
                m.box(-0.41, sy, 0.41, 0.03, 0.03, 0.02, "metal_dark")       # hatch
        hpipe(m, -0.41, 0.34, 0.365, 0.12, 0.015, axis="y", mat="metal")     # connector
        if full:                                                            # ladder up south silo
            m.box(-0.452, 0.28, 0.03, 0.012, 0.012, 0.34, "metal_dark")
            m.box(-0.428, 0.28, 0.03, 0.012, 0.012, 0.34, "metal_dark")
            for i in range(5):
                m.box(-0.44, 0.28, 0.06 + i * 0.06, 0.036, 0.008, 0.008, "metal_dark")
        tank_h(m, -0.40, -0.02, 0.10, 0.16, 0.05, mat="metal" if full else "metal")
        for sz in (-0.07, 0.03):
            m.box(-0.40, sz, 0.03, 0.11, 0.02, 0.055, "concrete")            # saddles
        if full:
            m.cyl(-0.40, -0.02, 0.15, 0.012, 0.02, "metal_dark", seg=6)      # manway
            m.box(-0.40, -0.02, 0.03, 0.15, 0.21, 0.035, "concrete")         # bund pad
            # (bund walls)
            m.box(-0.40, -0.125, 0.03, 0.15, 0.015, 0.05, "concrete")
            m.box(-0.40, 0.085, 0.03, 0.15, 0.015, 0.05, "concrete")
            m.box(-0.475, -0.02, 0.03, 0.015, 0.21, 0.05, "concrete")

    # -- vertical tank (south-east) -----------------------------------------
    if lod == 2:
        m.cyl(0.36, -0.16, 0.034, 0.065, 0.17, "metal", seg=5)
    else:
        seg = 10 if full else 6
        m.cyl(0.36, -0.16, 0.034, 0.065, 0.17, "metal", seg=seg)
        m.cone(0.36, -0.16, 0.204, 0.068, 0.03, "metal_dark", seg=seg)
        hpipe(m, 0.255, -0.16, 0.12, 0.15, 0.015, axis="x", mat="metal")     # feed to block
        m.box(0.30, -0.16, 0.10, 0.03, 0.03, 0.04, "sign_red")               # valve
        if full:
            m.box(0.36, -0.228, 0.06, 0.015, 0.006, 0.12, "white")           # gauge strip
            m.box(0.292, -0.16, 0.034, 0.008, 0.008, 0.17, "metal_dark")     # ladder rails
            m.box(0.292, -0.13, 0.034, 0.008, 0.008, 0.17, "metal_dark")
            for i in range(4):
                m.box(0.292, -0.145, 0.05 + i * 0.04, 0.006, 0.038, 0.006, "metal_dark")

    # -- pipe rack (west) ----------------------------------------------------
    if lod <= 1:
        for py in (-0.06, 0.08, 0.22, 0.36):
            m.box(-0.375, py, 0.03, 0.03, 0.03, 0.24, "metal_dark")
            m.box(-0.375, py, 0.26, 0.09, 0.03, 0.02, "metal_dark")
        hpipe(m, -0.375, 0.15, 0.285, 0.46, 0.016, axis="y", mat="metal")
        if full:
            hpipe(m, -0.345, 0.15, 0.285, 0.46, 0.011, axis="y", mat="wall_yellow")
            m.box(-0.40, 0.15, 0.225, 0.06, 0.46, 0.05, "metal_dark")        # cable duct
            m.cyl(-0.375, -0.06, 0.03, 0.016, 0.24, "metal", seg=6)          # drop legs
            m.cyl(-0.375, 0.36, 0.03, 0.016, 0.24, "metal", seg=6)
            hpipe(m, -0.355, 0.14, 0.285, 0.09, 0.016, axis="x", mat="metal")  # into hall

    # -- yard dressing -------------------------------------------------------
    if full:
        for i, (bx, by, bc) in enumerate(((-0.225, -0.25, "sign_blue"), (-0.19, -0.25, "sign_red"),
                                          (-0.207, -0.22, "metal"), (-0.225, -0.285, "sign_red"),
                                          (-0.19, -0.285, "sign_blue"))):
            m.cyl(bx, by, 0.034, 0.016, 0.04, bc, seg=6)                     # barrels
        m.box(0.24, -0.10, 0.034, 0.09, 0.07, 0.015, "bench_wood")           # pallets + crates
        m.box(0.22, -0.10, 0.049, 0.035, 0.05, 0.035, "wall_wood")
        m.box(0.265, -0.10, 0.049, 0.03, 0.045, 0.028, "concrete")
        m.box(0.19, -0.24, 0.034, 0.07, 0.04, 0.045, "wall_green")           # dumpster
        m.box(0.19, -0.24, 0.079, 0.074, 0.044, 0.008, "metal_dark")
        lamp_post(m, -0.44, -0.30, 0.26)
        lamp_post(m, 0.26, -0.30, 0.26)
        lamp_post(m, -0.10, 0.42, 0.26)
    elif lod == 1:
        lamp_post(m, -0.44, -0.30, 0.26)
        m.box(0.19, -0.24, 0.034, 0.07, 0.04, 0.045, "wall_green")
        m.box(0.19, -0.24, 0.079, 0.074, 0.044, 0.008, "metal_dark")

    # -- fence + gate + pylon sign --------------------------------------------
    if lod == 2:
        return
    fh = 0.06
    if full:
        posts = (7, 4, 8, 8, 8)
    else:
        posts = (4, 3, 4, 4, 0)
    m.fence(-0.46, -0.46, 0.0, -0.46, fh, "metal_dark", posts[0])
    m.fence(0.24, -0.46, 0.46, -0.46, fh, "metal_dark", posts[1])
    m.fence(-0.46, -0.46, -0.46, 0.46, fh, "metal_dark", posts[2])
    m.fence(0.46, -0.46, 0.46, 0.46, fh, "metal_dark", posts[3])
    if posts[4]:
        m.fence(-0.46, 0.46, 0.46, 0.46, fh, "metal_dark", posts[4])
    if full:
        m.box(0.0, -0.46, 0.03, 0.025, 0.025, 0.09, "metal_dark")            # gate posts
        m.box(0.24, -0.46, 0.03, 0.025, 0.025, 0.09, "metal_dark")
        m.box(0.36, -0.452, 0.03, 0.22, 0.012, 0.055, "metal_dark")          # sliding leaf
        m.cyl(0.28, -0.40, 0.03, 0.012, 0.21, "metal", seg=6)                # pylon sign
        m.box(0.28, -0.40, 0.24, 0.11, 0.015, 0.06, "glow_sign")
    else:
        m.box(0.0, -0.46, 0.03, 0.025, 0.025, 0.09, "metal_dark")
        m.box(0.24, -0.46, 0.03, 0.025, 0.025, 0.09, "metal_dark")


@building(38, "Fábrica Pesada", variant="v2", version=1)
def heavy_factory_v2(m: Model):
    build_factory(m, lod=0)


@building(38, "Fábrica Pesada", variant="v2_lod1", version=1)
def heavy_factory_v2_lod1(m: Model):
    build_factory(m, lod=1)


@building(38, "Fábrica Pesada", variant="v2_lod2", version=1)
def heavy_factory_v2_lod2(m: Model):
    build_factory(m, lod=2)
