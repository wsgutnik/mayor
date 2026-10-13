"""V2 reference buildings, group B: Premium Tower (#10) and Corporate Tower (#20).

Detailed LOD0 reference models plus simplified LOD1 (~25% of triangles) and
LOD2 (~5%, silhouette only) variants. All three LODs share one builder per
building through the `lod` parameter (0/1/2).
"""
from lib import Model
from registry import building

FH = 0.135  # residential/commercial floor height in tiles (~3 m at 22 m/tile)


# ---------------------------------------------------------------------------
# small shared helpers (single-sided quads with outward-facing windings)


def _qf(m, x0, x1, y, za, zb, mat):
    m._quad([(x0, y, za), (x1, y, za), (x1, y, zb), (x0, y, zb)], mat)


def _qb(m, x0, x1, y, za, zb, mat):
    m._quad([(x1, y, za), (x0, y, za), (x0, y, zb), (x1, y, zb)], mat)


def _qr(m, x, y0, y1, za, zb, mat):
    m._quad([(x, y0, za), (x, y1, za), (x, y1, zb), (x, y0, zb)], mat)


def _ql(m, x, y0, y1, za, zb, mat):
    m._quad([(x, y1, za), (x, y0, za), (x, y0, zb), (x, y1, zb)], mat)


def balcony(m: Model, cx, y_wall, z, w, depth=0.075, side="f", rails=True,
            slab="concrete", rail="glass_blue"):
    """Slab sticking out of a front (f) or back (b) wall, with glass rails."""
    s = -1 if side == "f" else 1
    m.box(cx, y_wall + s * depth / 2, z, w, depth, 0.014, slab, roof=slab)
    if not rails:
        return
    ye, za, zb = y_wall + s * depth, z + 0.014, z + 0.062
    if side == "f":
        _qf(m, cx - w / 2, cx + w / 2, ye, za, zb, rail)
    else:
        _qb(m, cx - w / 2, cx + w / 2, ye, za, zb, rail)
    _qr(m, cx + w / 2, min(y_wall, ye), max(y_wall, ye), za, zb, rail)
    _ql(m, cx - w / 2, min(y_wall, ye), max(y_wall, ye), za, zb, rail)


def lamp_post(m: Model, x, y, h=0.2):
    m.cyl(x, y, 0.03, 0.008, h, "lamp_pole", seg=5)
    m.box(x, y, 0.03 + h, 0.035, 0.035, 0.025, "glow_lamp")


def planter(m: Model, cx, cy, w=0.12, d=0.12, tree_s=0.0):
    m.box(cx, cy, 0.03, w, d, 0.06, "concrete", roof="concrete")
    m.box(cx, cy, 0.09, w - 0.02, d - 0.02, 0.02, "hedge", roof="hedge")
    if tree_s:
        m.tree(cx, cy, tree_s)


def flag_pole(m: Model, x, y, h=0.4, mat="sign_green"):
    m.cyl(x, y, 0.03, 0.007, h, "metal", seg=5)
    m.box(x + 0.035, y, 0.03 + h - 0.05, 0.07, 0.006, 0.045, mat)


def parapet(m: Model, cx, cy, z, w, d, h=0.05, t=0.02, mat="concrete"):
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
    m.box(cx, y0 + t / 2, z, w, t, h, mat)
    m.box(cx, y1 - t / 2, z, w, t, h, mat)
    m.box(x0 + t / 2, cy, z, t, d - 2 * t, h, mat)
    m.box(x1 - t / 2, cy, z, t, d - 2 * t, h, mat)


# ---------------------------------------------------------------------------
# #10 Premium Tower: stepped residential high-rise


# cx, cy, w, d, floors, wall material, front balconies (w, offset), back width, front cols
_PREMIUM_SECTIONS = [
    (0.00, 0.08, 0.56, 0.44, 6, "wall_cream", 0.18, 0.145, 0.24, 5),
    (0.02, 0.10, 0.46, 0.36, 4, "wall_white", 0.16, 0.120, 0.20, 4),
    (-0.02, 0.10, 0.36, 0.30, 3, "wall_beige", 0.13, 0.090, 0.16, 3),
]
_PREMIUM_BASE = 0.31  # top of the podium


def _premium_tower(m: Model, lod: int):
    # ---- ground ----
    if lod == 0:
        m.plot()
        m.box(0.4525, 0.05, 0.03, 0.09, 0.62, 0.006, "asphalt", roof="asphalt")  # driveway
        m.parked_car(0.45, 0.20, "sign_blue", "y")
        m.parked_car(0.45, -0.10, "white", "y")
        m.tree(-0.38, -0.33, 1.0)
        m.tree(0.28, -0.36, 0.9, dark=True)
        m.tree(-0.40, 0.40, 0.9)
        lamp_post(m, -0.24, -0.44)
        lamp_post(m, 0.24, -0.44)
    else:
        m.box(0, 0, 0, 0.96, 0.96, 0.03, "paving", roof="paving")

    # ---- podium with lobby ----
    m.box(0, 0.06, 0.03, 0.80, 0.60, 0.28, "wall_grey", roof="roof_flat")
    if lod == 0:
        m.windows(0, 0.06, 0.03, 0.80, 0.60, 0.28, 1, cols=8, sides="frl", lit=0.6, slabs=False)
    if lod < 2:
        m.box(0, 0.06, 0.285, 0.84, 0.64, 0.03, "concrete")                      # crown band
        m.box(0, -0.245, 0.03, 0.42, 0.06, 0.24, "glass_blue")                   # lobby bay
        m.box(0, -0.33, 0.25, 0.46, 0.17, 0.025, "slab")                         # canopy
        m.box(-0.20, -0.38, 0.08, 0.025, 0.025, 0.17, "white")                   # columns
        m.box(0.20, -0.38, 0.08, 0.025, 0.025, 0.17, "white")
        m.box(0, -0.335, 0.03, 0.50, 0.19, 0.05, "paving", roof="paving")        # plinth
        m.steps(0, -0.425, 0.03, 0.34, n=2, depth=0.032, rise=0.025)
    if lod == 0:
        for x in (-0.15, -0.05, 0.05, 0.15):                                    # bay mullions
            m.box(x, -0.272, 0.03, 0.02, 0.02, 0.24, "metal_dark")
        m.door(-0.07, -0.275, 0.08, 0.06, 0.12, "glass_dark")
        m.door(0.07, -0.275, 0.08, 0.06, 0.12, "glass_dark")
        m.box(0, -0.40, 0.25, 0.40, 0.02, 0.05, "glow_sign")                     # canopy sign
        # podium roof terrace: parapet, pergola, tables, planters
        parapet(m, 0, 0.06, 0.31, 0.80, 0.60, h=0.05)
        for px in (0.315, 0.375):
            for py in (0.0, 0.12):
                m.box(px, py, 0.31, 0.02, 0.02, 0.12, "wall_wood")
        for py in (0.0, 0.04, 0.08, 0.12):
            m.box(0.345, py, 0.43, 0.10, 0.02, 0.015, "wall_wood")
        for tx, ty in ((0.345, -0.17), (-0.345, 0.20)):
            m.cyl(tx, ty, 0.31, 0.035, 0.025, "white", seg=6)
            m.cyl(tx, ty, 0.335, 0.006, 0.09, "metal", seg=4)
            m.cone(tx, ty, 0.42, 0.07, 0.04, "sign_orange", seg=6)
        m.box(-0.345, -0.17, 0.31, 0.07, 0.05, 0.05, "hedge", roof="hedge")
        m.box(-0.345, 0.02, 0.31, 0.07, 0.05, 0.05, "hedge", roof="hedge")

    # ---- stepped tower ----
    z0 = _PREMIUM_BASE
    for (cx, cy, w, d, floors, wall, bw, boff, bw_back, cols) in _PREMIUM_SECTIONS:
        h = floors * FH
        x0, y0, y1 = cx - w / 2, cy - d / 2, cy + d / 2
        m.box(cx, cy, z0, w, d, h, wall, roof="roof_flat")
        if lod < 2:
            m.box(cx, cy, z0, w + 0.03, d + 0.03, 0.025, "concrete")              # step band
        if lod == 0:
            m.windows(cx, cy, z0, w, d, h, floors, cols=cols, sides="fbrl", lit=0.6)
            for fx in (x0 + 0.013, cx, x0 + w - 0.013):                          # front fins
                m.box(fx, y0 - 0.005, z0, 0.022, 0.04, h, "concrete")
            n_side = 4 if w > 0.5 else (3 if w > 0.4 else 2)                    # side fins
            for sx in (x0 - 0.005, x0 + w + 0.005):
                for i in range(n_side):
                    fy = y0 + 0.06 + i * (d - 0.12) / max(1, n_side - 1)
                    m.box(sx, fy, z0, 0.04, 0.022, h, "concrete")
            for f in range(floors):
                zs = z0 + f * FH + 0.015
                balcony(m, cx - boff, y0, zs, bw, side="f")
                balcony(m, cx + boff, y0, zs, bw, side="f")
                balcony(m, cx, y1, zs, bw_back, depth=0.07, side="b")
                if f % 2 == 0:                                                  # balcony planter
                    m.box(cx + boff + 0.05, y0 - 0.045, zs + 0.014, 0.05, 0.03, 0.03,
                          "hedge", roof="hedge")
        elif lod == 1:
            m.windows(cx, cy, z0, w, d, h, floors, cols=max(2, cols - 2),
                      sides="fb", lit=0.5, slabs=False)
            for f in range(floors):                                             # strip slabs
                zs = z0 + f * FH + 0.015
                m.box(cx, y0 - 0.035, zs, w - 0.04, 0.07, 0.014, "concrete")
                m.box(cx, y1 + 0.035, zs, w - 0.04, 0.07, 0.014, "concrete")
        z0 += h
    roof_z = z0  # 2.065

    # terrace parapets on the two setbacks (LOD0)
    if lod == 0:
        parapet(m, 0.00, 0.08, 1.12, 0.56, 0.44, h=0.045)
        m.box(-0.15, -0.11, 1.12, 0.08, 0.04, 0.05, "hedge", roof="hedge")
        m.box(0.15, -0.11, 1.12, 0.08, 0.04, 0.05, "hedge", roof="hedge")
        parapet(m, 0.02, 0.10, 1.66, 0.46, 0.36, h=0.045)

    # ---- rooftop ----
    if lod == 0:
        parapet(m, -0.02, 0.10, roof_z, 0.36, 0.30, h=0.05)
    m.box(-0.06, 0.12, roof_z, 0.20, 0.16, 0.13, "wall_grey", roof="roof_dark")  # penthouse
    if lod == 0:
        m.box(-0.06, 0.035, roof_z, 0.07, 0.015, 0.10, "metal_dark")             # door
        m.cyl(-0.12, 0.16, roof_z + 0.13, 0.012, 0.06, "metal", seg=5)           # vents
        m.cyl(-0.02, 0.16, roof_z + 0.13, 0.012, 0.06, "metal", seg=5)
        for lx in (0.045, 0.115):                                               # tank legs
            for ly in (0.125, 0.195):
                m.box(lx, ly, roof_z, 0.018, 0.018, 0.06, "metal_dark")
        m.cyl(0.08, 0.16, roof_z + 0.06, 0.055, 0.12, "white", seg=8)            # tank
        m.cone(0.08, 0.16, roof_z + 0.18, 0.06, 0.04, "roof_dark", seg=8)
        m.ac_unit(-0.13, 0.02, roof_z)
        m.ac_unit(0.10, 0.03, roof_z)
        m.skylight(-0.02, 0.19, roof_z)
        m.cyl(-0.06, 0.12, roof_z + 0.13, 0.009, 0.03, "sign_red", seg=5)        # beacon base
    else:
        m.cyl(0.08, 0.16, roof_z, 0.055, 0.15, "white", seg=8)                   # tank mass
    m.cyl(-0.06, 0.12, roof_z + 0.13, 0.007, 0.36, "metal_dark", seg=5)          # antenna
    # antenna tip: 2.065 + 0.13 + 0.36 = 2.555 < 2.6


@building(10, "Premium Tower", variant="v2", version=1)
def premium_tower_v2(m: Model):
    _premium_tower(m, 0)


@building(10, "Premium Tower", variant="v2_lod1", version=1)
def premium_tower_v2_lod1(m: Model):
    _premium_tower(m, 1)


@building(10, "Premium Tower", variant="v2_lod2", version=1)
def premium_tower_v2_lod2(m: Model):
    _premium_tower(m, 2)


# ---------------------------------------------------------------------------
# #20 Corporate Tower: curtain-wall commercial tower


_CORP_FLOORS = 14
_CORP_BASE = 0.35   # top of the lobby slab
_CORP_W, _CORP_D = 0.46, 0.38
_CORP_CX, _CORP_CY = 0.0, 0.08


def _curtain_wall(m: Model, z0, fh, floors, nx, ny, per_bay: bool):
    """Glass grid between the spandrel bands; per_bay=False draws one band per face."""
    w, d, cx, cy = _CORP_W, _CORP_D, _CORP_CX, _CORP_CY
    x0, y0, y1 = cx - w / 2, cy - d / 2, cy + d / 2
    off = 0.005
    for f in range(floors):
        za, zb = z0 + f * fh + 0.04, z0 + (f + 1) * fh
        if per_bay:
            for i in range(nx):
                u0 = x0 + (i + 0.12) * w / nx
                u1 = x0 + (i + 0.88) * w / nx
                _qf(m, u0, u1, y0 - off, za, zb,
                    "glow_window" if m.rng.random() < 0.5 else "glass_dark")
                _qb(m, u0, u1, y1 + off, za, zb,
                    "glow_window" if m.rng.random() < 0.5 else "glass_dark")
            for j in range(ny):
                v0 = y0 + (j + 0.12) * d / ny
                v1 = y0 + (j + 0.88) * d / ny
                _qr(m, x0 + w + off, v0, v1, za, zb,
                    "glow_window" if m.rng.random() < 0.5 else "glass_dark")
                _ql(m, x0 - off, v0, v1, za, zb,
                    "glow_window" if m.rng.random() < 0.5 else "glass_dark")
        else:
            for quad, a0, a1, fixed in ((_qf, x0, x0 + w, y0 - off), (_qb, x0, x0 + w, y1 + off),
                                       (_qr, y0, y0 + d, x0 + w + off), (_ql, y0, y0 + d, x0 - off)):
                quad(m, a0 + 0.015, a1 - 0.015, fixed, za, zb,
                     "glow_window" if m.rng.random() < 0.5 else "glass_dark")


def _corporate_tower(m: Model, lod: int):
    # ---- setback plaza ----
    if lod == 0:
        m.plot(lawn=False)
        m.box(0, -0.44, 0.03, 0.60, 0.07, 0.006, "asphalt", roof="asphalt")      # drop-off
        m.parked_car(-0.15, -0.44, "white", "x")
        planter(m, -0.39, -0.37, tree_s=0.85)
        planter(m, 0.39, -0.37, tree_s=0.85)
        planter(m, -0.39, 0.39, tree_s=0.85)
        planter(m, 0.39, 0.39, tree_s=0.85)
        flag_pole(m, -0.12, -0.38)
        flag_pole(m, 0.12, -0.38, mat="sign_blue")
        for bx in (-0.25, 0.25):                                                # benches
            m.box(bx, -0.33, 0.03, 0.12, 0.035, 0.035, "bench_wood")
            m.box(bx - 0.045, -0.33, 0.03, 0.015, 0.035, 0.02, "metal_dark")
            m.box(bx + 0.045, -0.33, 0.03, 0.015, 0.035, 0.02, "metal_dark")
        lamp_post(m, -0.30, -0.28)
        lamp_post(m, 0.30, -0.28)
    else:
        m.box(0, 0, 0, 0.96, 0.96, 0.03, "paving", roof="paving")

    # ---- double-height lobby ----
    m.box(0, 0.05, 0.03, 0.74, 0.52, 0.28, "glass_blue", roof="roof_flat")
    if lod < 2:
        for ccx in (-0.34, 0.34):                                               # corner columns
            for ccy in (-0.18, 0.28):
                m.box(ccx, ccy, 0.03, 0.06, 0.06, 0.28, "concrete")
        m.box(0, 0.05, 0.31, 0.78, 0.56, 0.04, "concrete")                       # roof slab
        m.box(0, -0.30, 0.24, 0.44, 0.20, 0.025, "metal_dark")                   # canopy
        for ccx in (-0.19, 0.19):
            for ccy in (-0.37, -0.23):
                m.box(ccx, ccy, 0.03, 0.025, 0.025, 0.21, "metal")
        m.box(0, -0.30, 0.03, 0.48, 0.22, 0.02, "paving", roof="paving")         # threshold
    if lod == 0:
        for i in range(6):                                                      # lobby mullions
            m.box(-0.30 + i * 0.12, -0.215, 0.03, 0.018, 0.02, 0.28, "metal_dark")
        m.box(0, -0.215, 0.20, 0.74, 0.02, 0.03, "metal_dark")                   # transom
        for dx in (-0.09, 0.0, 0.09):                                           # entrance doors
            m.box(dx, -0.222, 0.03, 0.07, 0.015, 0.14, "glass_dark")
        m.box(0, -0.395, 0.24, 0.30, 0.02, 0.045, "glow_sign")                   # fascia sign

    # ---- curtain-wall shaft ----
    z0, h = _CORP_BASE, _CORP_FLOORS * FH
    m.box(_CORP_CX, _CORP_CY, z0, _CORP_W, _CORP_D, h, "glass_dark", roof="roof_flat")
    if lod == 0:
        for f in range(_CORP_FLOORS):
            m.box(_CORP_CX, _CORP_CY, z0 + f * FH, _CORP_W + 0.02, _CORP_D + 0.02, 0.04, "concrete")
        _curtain_wall(m, z0, FH, _CORP_FLOORS, 7, 5, per_bay=True)
        for i in range(1, 7):                                                   # mullions f/b
            jx = _CORP_CX - _CORP_W / 2 + i * _CORP_W / 7
            m.box(jx, _CORP_CY - _CORP_D / 2 - 0.005, z0, 0.018, 0.018, h, "metal_dark")
            m.box(jx, _CORP_CY + _CORP_D / 2 + 0.005, z0, 0.018, 0.018, h, "metal_dark")
        for j in range(1, 5):                                                   # mullions sides
            jy = _CORP_CY - _CORP_D / 2 + j * _CORP_D / 5
            m.box(_CORP_CX - _CORP_W / 2 - 0.005, jy, z0, 0.018, 0.018, h, "metal_dark")
            m.box(_CORP_CX + _CORP_W / 2 + 0.005, jy, z0, 0.018, 0.018, h, "metal_dark")
    elif lod == 1:
        for f in range(_CORP_FLOORS):
            m.box(_CORP_CX, _CORP_CY, z0 + f * FH, _CORP_W + 0.02, _CORP_D + 0.02, 0.04, "concrete")
        _curtain_wall(m, z0, FH, _CORP_FLOORS, 7, 5, per_bay=False)
    if lod < 2:
        for ccx in (_CORP_CX - _CORP_W / 2, _CORP_CX + _CORP_W / 2):             # corners
            for ccy in (_CORP_CY - _CORP_D / 2, _CORP_CY + _CORP_D / 2):
                m.box(ccx, ccy, z0, 0.03, 0.03, h, "concrete")
        m.box(0.10, 0.26, z0, 0.20, 0.12, h, "concrete")                         # core
    if lod == 0:
        for s in range(4):                                                      # core slits
            _qb(m, 0.07, 0.13, 0.325, z0 + 0.3 + s * 0.4, z0 + 0.55 + s * 0.4, "glow_window")
    top = z0 + h  # 2.24

    # ---- rooftop crown ----
    if lod == 0:
        parapet(m, _CORP_CX, _CORP_CY, top, _CORP_W, _CORP_D, h=0.05)
    m.box(_CORP_CX, _CORP_CY, top, 0.34, 0.26, 0.12, "glass_blue")               # crown
    if lod == 0:
        m.box(_CORP_CX, _CORP_CY, top + 0.06, 0.345, 0.265, 0.03, "glow_sign")   # crown band
        m.ac_unit(-0.15, -0.06, top)
        m.ac_unit(0.16, 0.22, top)
        m.box(-0.16, 0.20, top, 0.09, 0.08, 0.07, "metal", roof="metal_dark")    # vent
    if lod < 2:
        m.box(_CORP_CX, _CORP_CY, top + 0.12, 0.38, 0.30, 0.025, "metal_dark")   # cap
        m.cyl(_CORP_CX, _CORP_CY, top + 0.145, 0.008, 0.165, "metal_dark", seg=5)  # mast
    if lod == 0:
        m.box(_CORP_CX, _CORP_CY, top + 0.29, 0.02, 0.02, 0.02, "glow_sign")     # beacon
    # mast tip: 2.24 + 0.145 + 0.165 = 2.55 < 2.6


@building(20, "Corporate Tower", variant="v2", version=1)
def corporate_tower_v2(m: Model):
    _corporate_tower(m, 0)


@building(20, "Corporate Tower", variant="v2_lod1", version=1)
def corporate_tower_v2_lod1(m: Model):
    _corporate_tower(m, 1)


@building(20, "Corporate Tower", variant="v2_lod2", version=1)
def corporate_tower_v2_lod2(m: Model):
    _corporate_tower(m, 2)
