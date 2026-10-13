"""City Hall (Prefeitura, #21) v2 reference + LODs.

Civic block: columned portico with pediment, central clock tower with dome,
symmetrical wings, front plaza with fountain and flagpoles, lawns and trees.
All three LODs share _city_hall(m, lod); lod 0 is the full reference (~2k tris),
lod 1 keeps the silhouette minus small props (~25%), lod 2 keeps masses only (~5%).
"""
from lib import Model
from registry import building


def _round_tree(m: Model, x, y, s=1.0, z0=0.03, mat="leaf_b", seed=1):
    m.cyl(x, y, z0, 0.012 * s, 0.09 * s, "bark", seg=5)
    m.blob(x, y, z0 + 0.12 * s, 0.06 * s, 0.06 * s, 0.05 * s, mat, subdiv=0, seed=seed)


def _flag(m: Model, x, y, z0, w, h, mat, flip=False):
    """Double-sided flag quad extending along +X (or -X when flipped) from a pole."""
    s = -1.0 if flip else 1.0
    x1 = x + s * w
    m._quad([(x, y - 0.002, z0), (x1, y - 0.002, z0), (x1, y - 0.002, z0 + h), (x, y - 0.002, z0 + h)], mat)
    m._quad([(x1, y + 0.002, z0), (x, y + 0.002, z0), (x, y + 0.002, z0 + h), (x1, y + 0.002, z0 + h)], mat)


def _clock_faces(m: Model, hands):
    """White clock plates on all four belfry sides; LOD0 also gets 9:00 hands."""
    z0, h = 0.73, 0.11
    m.box(0, 0.086, z0, 0.13, 0.008, h, "white")
    m.box(0, 0.294, z0, 0.13, 0.008, h, "white")
    m.box(0.104, 0.19, z0, 0.008, 0.13, h, "white")
    m.box(-0.104, 0.19, z0, 0.008, 0.13, h, "white")
    if not hands:
        return
    mh, hh = 0.042, 0.012  # minute hand (up) and hour hand (to 9) sizes
    m.box(0, 0.0805, 0.783, 0.012, 0.005, mh, "black")
    m.box(-0.022, 0.0795, 0.779, 0.044, 0.005, hh, "black")
    m.box(0, 0.2995, 0.783, 0.012, 0.005, mh, "black")
    m.box(0.022, 0.3005, 0.779, 0.044, 0.005, hh, "black")
    m.box(0.1095, 0.19, 0.783, 0.005, 0.012, mh, "black")
    m.box(0.1105, 0.168, 0.779, 0.005, 0.044, hh, "black")
    m.box(-0.1095, 0.19, 0.783, 0.005, 0.012, mh, "black")
    m.box(-0.1105, 0.212, 0.779, 0.005, 0.044, hh, "black")


def _city_hall(m: Model, lod: int):
    full = lod == 0
    # -- ground ---------------------------------------------------------
    m.box(0, 0, 0, 0.96, 0.96, 0.03, "paving", roof="paving")
    m.box(0, -0.29, 0.03, 0.62, 0.32, 0.008, "paving", roof="paving")      # plaza slab
    if full:
        m.box(0, -0.475, 0.03, 0.96, 0.05, 0.006, "concrete", roof="concrete")  # front sidewalk
        m.box(-0.305, -0.29, 0.038, 0.012, 0.32, 0.004, "concrete", roof="concrete")
        m.box(0.305, -0.29, 0.038, 0.012, 0.32, 0.004, "concrete", roof="concrete")
    if lod < 2:
        for sx in (-1, 1):  # front lawns flanking the plaza + side strips + back lawn
            m._quad([(sx * 0.33, -0.45, 0.031), (sx * 0.47, -0.45, 0.031),
                     (sx * 0.47, -0.13, 0.031), (sx * 0.33, -0.13, 0.031)], "grass")
        m._quad([(-0.47, 0.40, 0.031), (0.47, 0.40, 0.031), (0.47, 0.47, 0.031), (-0.47, 0.47, 0.031)], "grass")
        if full:
            for sx in (-1, 1):
                m._quad([(sx * 0.42, -0.13, 0.031), (sx * 0.47, -0.13, 0.031),
                         (sx * 0.47, 0.40, 0.031), (sx * 0.42, 0.40, 0.031)], "grass")
            m._quad([(-0.06, 0.40, 0.031), (0.06, 0.40, 0.031), (0.06, 0.475, 0.031), (-0.06, 0.475, 0.031)], "concrete")
    # hedges
    if full:
        m.box(0, -0.455, 0.03, 0.9, 0.03, 0.035, "hedge", roof="hedge")
        m.box(0, 0.44, 0.03, 0.9, 0.03, 0.035, "hedge", roof="hedge")
        for sx in (-1, 1):
            m.box(sx * 0.325, -0.29, 0.038, 0.03, 0.30, 0.035, "hedge", roof="hedge")
            m.box(sx * 0.445, 0.13, 0.03, 0.03, 0.5, 0.035, "hedge", roof="hedge")
    elif lod == 1:
        for sx in (-1, 1):
            m.box(sx * 0.325, -0.29, 0.038, 0.03, 0.30, 0.035, "hedge", roof="hedge")

    # -- main masses ----------------------------------------------------
    m.box(0, 0.19, 0.03, 0.84, 0.42, 0.05, "concrete", roof="concrete")   # plinth
    if full:
        m.box(0, 0.19, 0.075, 0.86, 0.44, 0.012, "white")                 # plinth cap trim
    m.box(0, 0.19, 0.08, 0.52, 0.34, 0.30, "wall_cream")                  # main block
    for sx in (-1, 1):
        m.box(sx * 0.335, 0.19, 0.08, 0.15, 0.34, 0.24, "wall_beige")     # wings
    m.box(0, 0.19, 0.38, 0.56, 0.38, 0.025, "white")                      # cornices
    for sx in (-1, 1):
        m.box(sx * 0.335, 0.19, 0.32, 0.19, 0.38, 0.025, "white")
        m.hip(sx * 0.335, 0.19, 0.345, 0.19, 0.38, 0.10, "roof_slate")     # wing roofs
    m.box(0, 0.19, 0.405, 0.52, 0.34, 0.02, "roof_flat")                  # main roof deck
    m.box(0, 0.03, 0.425, 0.52, 0.025, 0.04, "wall_cream")                # parapet
    m.box(0, 0.35, 0.425, 0.52, 0.025, 0.04, "wall_cream")
    for sx in (-1, 1):
        m.box(sx * 0.2475, 0.19, 0.425, 0.025, 0.295, 0.04, "wall_cream")
    if full:
        m.box(0, 0.03, 0.465, 0.54, 0.035, 0.012, "white")                # parapet caps
        m.box(0, 0.35, 0.465, 0.54, 0.035, 0.012, "white")
        for x in (-0.20, -0.10, 0.10, 0.20):                             # pilasters
            m.box(x, 0.015, 0.08, 0.035, 0.02, 0.30, "white")
        for sx in (-1, 1):                                                # quoins, wing front corners
            for i in range(3):
                m.box(sx * 0.405, 0.02, 0.10 + i * 0.07, 0.03, 0.03, 0.035, "white")

    # -- windows --------------------------------------------------------
    if lod == 0:
        m.windows(0, 0.19, 0.08, 0.52, 0.34, 0.30, 2, cols=6, sides="f", lit=0.6)
        m.windows(0, 0.19, 0.08, 0.52, 0.34, 0.30, 2, cols=6, sides="b", lit=0.55)
        for sx in (-1, 1):
            m.windows(sx * 0.335, 0.19, 0.08, 0.15, 0.34, 0.24, 2, cols=2, sides="f", lit=0.55)
            m.windows(sx * 0.335, 0.19, 0.08, 0.15, 0.34, 0.24, 2, cols=3, sides="r" if sx > 0 else "l", lit=0.5)
            m.windows(sx * 0.335, 0.19, 0.08, 0.15, 0.34, 0.24, 1, cols=2, sides="b", lit=0.5)
        for c in range(6):                                                # ground-floor sills
            m.box(-0.175 + c * 0.07, 0.015, 0.10, 0.06, 0.025, 0.015, "white")
    elif lod == 1:
        m.windows(0, 0.19, 0.08, 0.52, 0.34, 0.30, 2, cols=4, sides="fb", lit=0.55, slabs=False)
        for sx in (-1, 1):
            m.windows(sx * 0.335, 0.19, 0.08, 0.15, 0.34, 0.24, 1, cols=2, sides="f", lit=0.5, slabs=False)
            m.windows(sx * 0.335, 0.19, 0.08, 0.15, 0.34, 0.24, 1, cols=2, sides="r" if sx > 0 else "l", lit=0.5, slabs=False)

    # -- main door + rear door ------------------------------------------
    if lod < 2:
        m.box(0, 0.015, 0.08, 0.13, 0.02, 0.19, "white")
        m.box(-0.028, 0.004, 0.08, 0.05, 0.008, 0.15, "wall_wood")
        m.box(0.028, 0.004, 0.08, 0.05, 0.008, 0.15, "wall_wood")
        m.box(0, 0.004, 0.23, 0.11, 0.008, 0.035, "glow_window")
        if full:
            m.box(-0.09, 0.005, 0.20, 0.02, 0.02, 0.035, "glow_lamp")
            m.box(0.09, 0.005, 0.20, 0.02, 0.02, 0.035, "glow_lamp")
            m.box(0, 0.38, 0.03, 0.14, 0.04, 0.05, "concrete")             # rear stoop + door
            m.box(0, 0.362, 0.08, 0.10, 0.02, 0.14, "wall_wood")

    # -- portico ---------------------------------------------------------
    m.box(0, -0.08, 0.03, 0.44, 0.12, 0.05, "concrete", roof="concrete")  # deck
    if full:
        for x in (-0.175, -0.105, -0.035, 0.035, 0.105, 0.175):
            m.box(x, -0.11, 0.08, 0.05, 0.05, 0.03, "white")
            m.cyl(x, -0.11, 0.11, 0.018, 0.21, "wall_white", seg=8)
            m.box(x, -0.11, 0.32, 0.05, 0.05, 0.03, "white")
    elif lod == 1:
        for x in (-0.15, -0.05, 0.05, 0.15):
            m.box(x, -0.11, 0.08, 0.04, 0.04, 0.27, "wall_white")
    m.box(0, -0.08, 0.35, 0.46, 0.16, 0.045, "white")                     # entablature
    m.gable(0, -0.08, 0.395, 0.46, 0.16, 0.10, "roof_slate", end="wall_cream", ridge="x")
    if full:
        m.box(0, -0.162, 0.358, 0.30, 0.008, 0.028, "glow_sign")          # PREFEITURA band
        m.box(0, -0.163, 0.415, 0.05, 0.008, 0.05, "white")               # oculus
        m.box(0, -0.166, 0.422, 0.032, 0.008, 0.032, "glow_window")
        m._quad([(-0.23, 0.0, 0.35), (0.23, 0.0, 0.35), (0.23, -0.16, 0.35), (-0.23, -0.16, 0.35)], "white")
    # steps down to the plaza
    if full:
        for i in range(3):
            top = 0.08 - 0.0125 * (i + 1)
            m.box(0, -0.14 - 0.028 * (i + 0.5), 0.03, 0.46, 0.028, top - 0.03, "concrete", roof="concrete")
        for sx in (-1, 1):                                                # cheek walls + urns
            m.box(sx * 0.245, -0.18, 0.03, 0.03, 0.12, 0.09, "concrete")
            m.cyl(sx * 0.245, -0.20, 0.12, 0.02, 0.035, "white", seg=6)
            m.blob(sx * 0.245, -0.20, 0.17, 0.025, 0.025, 0.02, "leaf_c", subdiv=0, seed=11 if sx < 0 else 12)
    elif lod == 1:
        m.box(0, -0.154, 0.03, 0.46, 0.028, 0.0375, "concrete", roof="concrete")
        m.box(0, -0.182, 0.03, 0.46, 0.028, 0.025, "concrete", roof="concrete")
    else:
        m.box(0, -0.168, 0.03, 0.46, 0.056, 0.05, "concrete", roof="concrete")

    # -- clock tower ------------------------------------------------------
    m.box(0, 0.19, 0.425, 0.17, 0.17, 0.24, "wall_cream")                 # shaft
    m.box(0, 0.19, 0.665, 0.20, 0.20, 0.20, "wall_white")                 # belfry
    if full:
        for sx in (-1, 1):
            for sy in (-1, 1):
                m.box(sx * 0.075, 0.19 + sy * 0.075, 0.425, 0.04, 0.04, 0.24, "white")
        m.box(0, 0.101, 0.50, 0.05, 0.008, 0.12, "glow_window")           # shaft slits
        m.box(0, 0.279, 0.50, 0.05, 0.008, 0.12, "glow_window")
        m.box(0, 0.086, 0.678, 0.07, 0.008, 0.042, "glass_dark")          # belfry openings
        m.box(0, 0.294, 0.678, 0.07, 0.008, 0.042, "glass_dark")
        m.box(0, 0.085, 0.668, 0.09, 0.025, 0.012, "white")
        m.box(0, 0.295, 0.668, 0.09, 0.025, 0.012, "white")
        m.box(0, 0.085, 0.720, 0.09, 0.025, 0.012, "white")
        m.box(0, 0.295, 0.720, 0.09, 0.025, 0.012, "white")
    if lod == 0:
        _clock_faces(m, hands=True)
    elif lod == 1:
        m.box(0, 0.086, 0.73, 0.13, 0.008, 0.11, "white")
        m.box(0, 0.294, 0.73, 0.13, 0.008, 0.11, "white")
    if lod == 0:
        m.box(0, 0.19, 0.865, 0.24, 0.24, 0.025, "white")
        m.cyl(0, 0.19, 0.89, 0.085, 0.07, "wall_white", seg=12)
        m.cyl(0, 0.19, 0.955, 0.095, 0.015, "white", seg=12)
        m.blob(0, 0.19, 0.99, 0.095, 0.095, 0.09, "roof_green", subdiv=1, jitter=0.03, seed=7)
        m.cyl(0, 0.19, 1.06, 0.016, 0.05, "white", seg=6)
        m.cone(0, 0.19, 1.11, 0.024, 0.035, "roof_green", seg=6)
        m.blob(0, 0.19, 1.16, 0.008, 0.008, 0.012, "glow_sign", subdiv=0, seed=9)
    elif lod == 1:
        m.box(0, 0.19, 0.865, 0.24, 0.24, 0.025, "white")
        m.cyl(0, 0.19, 0.89, 0.085, 0.07, "wall_white", seg=8)
        m.blob(0, 0.19, 0.99, 0.095, 0.095, 0.09, "roof_green", subdiv=0, seed=7)
        m.cone(0, 0.19, 1.06, 0.024, 0.05, "roof_green", seg=6)
    else:
        m.pyramid(0, 0.19, 0.865, 0.22, 0.22, 0.13, "roof_green")

    # -- rooftop equipment (LOD0 only) ------------------------------------
    if full:
        m.ac_unit(-0.15, 0.28, 0.425)
        m.ac_unit(0.15, 0.28, 0.425)
        m.skylight(-0.17, 0.10, 0.425)
        m.box(0.17, 0.10, 0.425, 0.10, 0.09, 0.07, "wall_cream")          # stair bulkhead
        m.box(0.17, 0.10, 0.495, 0.12, 0.11, 0.015, "slab")

    # -- fountain ----------------------------------------------------------
    if full:
        m.cyl(0, -0.36, 0.038, 0.135, 0.005, "concrete", seg=14)
        m.cyl(0, -0.36, 0.043, 0.10, 0.045, "slab", seg=12)
        m.cyl(0, -0.36, 0.088, 0.11, 0.015, "white", seg=12)
        m.cyl(0, -0.36, 0.075, 0.092, 0.008, "water", seg=12)
        m.cyl(0, -0.36, 0.083, 0.018, 0.10, "white", seg=6)
        m.cyl(0, -0.36, 0.183, 0.045, 0.02, "white", seg=8)
        m.cyl(0, -0.36, 0.196, 0.038, 0.006, "water", seg=8)
        m.cyl(0, -0.36, 0.20, 0.006, 0.09, "water", seg=5, r_top=0.002)
        m.blob(0, -0.36, 0.27, 0.03, 0.03, 0.02, "glass_blue", subdiv=0, seed=3)
    elif lod == 1:
        m.cyl(0, -0.36, 0.038, 0.10, 0.05, "slab", seg=8)
        m.cyl(0, -0.36, 0.075, 0.092, 0.008, "water", seg=8)
        m.cyl(0, -0.36, 0.083, 0.018, 0.10, "white", seg=5)
        m.cyl(0, -0.36, 0.183, 0.045, 0.02, "white", seg=6)

    # -- flagpoles, furniture, planting ------------------------------------
    if full:
        for sx, mat in ((-1, "sign_green"), (1, "wall_yellow")):
            m.cyl(sx * 0.25, -0.40, 0.038, 0.02, 0.03, "concrete", seg=6)
            m.cyl(sx * 0.25, -0.40, 0.068, 0.005, 0.32, "metal", seg=5)
            m.cone(sx * 0.25, -0.40, 0.388, 0.01, 0.02, "glow_sign", seg=5)
            _flag(m, sx * 0.25, -0.40, 0.33, 0.07, 0.045, mat, flip=sx > 0)
        for sx in (-1, 1):                                                # benches face the fountain
            m.box(sx * 0.20, -0.28, 0.063, 0.11, 0.04, 0.015, "bench_wood")
            m.box(sx * 0.20, -0.258, 0.078, 0.11, 0.015, 0.05, "bench_wood")
            m.box(sx * 0.20 - 0.045, -0.28, 0.038, 0.015, 0.035, 0.025, "metal_dark")
            m.box(sx * 0.20 + 0.045, -0.28, 0.038, 0.015, 0.035, 0.025, "metal_dark")
        for sx in (-1, 1):                                                # flower planters by the steps
            m.box(sx * 0.26, -0.17, 0.038, 0.07, 0.05, 0.02, "wall_brick")
            m.box(sx * 0.26, -0.17, 0.058, 0.06, 0.04, 0.015, "flower_red" if sx < 0 else "flower_yellow")
        for sx in (-1, 1):                                                # lamps at the plaza corners
            for y in (-0.15, -0.43):
                m.cyl(sx * 0.28, y, 0.038, 0.008, 0.15, "lamp_pole", seg=4)
                m.box(sx * 0.28, y, 0.188, 0.035, 0.035, 0.03, "glow_lamp")
                m.box(sx * 0.28, y, 0.218, 0.045, 0.045, 0.012, "lamp_pole")
        _round_tree(m, -0.40, -0.36, 1.1, mat="leaf_b", seed=21)
        m.tree(0.40, -0.36, 1.0)
        m.tree(-0.40, -0.18, 0.9, dark=True)
        _round_tree(m, 0.40, -0.18, 1.0, mat="leaf_a", seed=22)
        _round_tree(m, -0.38, 0.435, 0.9, mat="leaf_c", seed=23)
        m.tree(0.38, 0.435, 0.8)
        m.box(0.25, 0.44, 0.03, 0.2, 0.06, 0.01, "concrete", roof="concrete")  # service pad
        m.ac_unit(0.22, 0.44, 0.04)
        m.box(0.31, 0.44, 0.04, 0.05, 0.05, 0.07, "sign_green")
    elif lod == 1:
        for sx in (-1, 1):
            m.cyl(sx * 0.25, -0.40, 0.038, 0.005, 0.35, "metal", seg=4)
            _flag(m, sx * 0.25, -0.40, 0.33, 0.07, 0.045, "sign_green" if sx < 0 else "wall_yellow", flip=sx > 0)
        m.tree(-0.40, -0.36, 1.0)
        m.tree(0.40, -0.18, 1.0)


@building(21, "Prefeitura", variant="v2", version=1)
def prefeitura_v2(m: Model):
    _city_hall(m, 0)


@building(21, "Prefeitura", variant="v2_lod1", version=1)
def prefeitura_v2_lod1(m: Model):
    _city_hall(m, 1)


@building(21, "Prefeitura", variant="v2_lod2", version=1)
def prefeitura_v2_lod2(m: Model):
    _city_hall(m, 2)
