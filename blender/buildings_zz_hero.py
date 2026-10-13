"""
Richer versions of the buildings players see most. Loaded last, so these replace the simpler ones in
buildings_res_com.py / buildings_civic_ind.py. Same footprint and front-faces--Y rules as every model.
"""
from lib import Model
from registry import building
from dress_det_a import balcony_rail_posts, cornice, front_frame, lamp, pavers, planter, roof_seams, side_frame
from dress_det_b import bollards, curb_blocks, facade_trim, gooseneck_lamps, parapet_caps, parking_stripes, planters, roof_dress, storefront_grid
from dress_det_c import bollards as c_bollards, cornice as c_cornice, framed_window, paving_lines, rail, roof_seams as c_roof_seams, side_window
from dress_det_d import bollards as d_bollards, guard_rail, pipe_run, roof_seams as d_roof_seams, tank_ladder, thin_frame


def _back_door(m: Model, x, y_back, z=0.03, w=0.07, h=0.12, mat="metal_dark"):
    m.box(x, y_back + 0.004, z, w + 0.016, 0.008, h + 0.01, "white")
    m._quad([(x + w / 2, y_back + 0.009, z), (x - w / 2, y_back + 0.009, z),
             (x - w / 2, y_back + 0.009, z + h), (x + w / 2, y_back + 0.009, z + h)], mat)


def _rear_pipes(m: Model, y_back, x0, x1, z0, h):
    for x in (x0, x1):
        m.box(x, y_back + 0.006, z0, 0.014, 0.012, h, "metal_dark")


def _louver(m: Model, x, y_back, z, w=0.09, h=0.055):
    m.box(x, y_back + 0.006, z, w, 0.01, h, "metal_dark")


def _downpipes(m: Model, cx, y_back, z0, h, w):
    for sx in (-1, 1):
        m.box(cx + sx * (w / 2 - 0.03), y_back + 0.008, z0, 0.014, 0.012, h, "metal_dark")


def _roof_vent(m: Model, x, y, z):
    m.cyl(x, y, z, 0.018, 0.08, "metal", seg=6)
    m.box(x, y, z + 0.08, 0.05, 0.05, 0.014, "metal_dark")


@building(1, "Casa Inicial")
def casa_inicial(m: Model):
    m.plot()
    m.box(-0.04, 0.06, 0.03, 0.46, 0.34, 0.27, "wall_cream")
    m.box(0.23, 0.05, 0.03, 0.18, 0.28, 0.2, "wall_wood")                          # side annex in timber
    m.gable(-0.04, 0.06, 0.3, 0.52, 0.4, 0.21, "roof_blue", end="wall_cream")
    m.gable(0.23, 0.05, 0.23, 0.22, 0.32, 0.1, "roof_slate", end="wall_wood")
    m.chimney(0.12, 0.12, 0.38, 0.14)
    m.windows(-0.04, 0.06, 0.03, 0.46, 0.34, 0.27, 1, cols=3, sides="fl", lit=0.7)
    m.windows(0.23, 0.05, 0.03, 0.18, 0.28, 0.2, 1, cols=1, sides="fr", lit=0.7)
    m.door(-0.1, -0.11, 0.03, 0.065, 0.12)
    m.steps(-0.1, -0.115, 0.03, 0.12, 2)
    m.box(-0.1, -0.16, 0.3, 0.2, 0.1, 0.016, "roof_slate", roof="roof_slate")       # porch canopy
    m.box(-0.19, -0.19, 0.03, 0.016, 0.016, 0.27, "white")
    m.box(-0.01, -0.19, 0.03, 0.016, 0.016, 0.27, "white")
    m.fence(-0.44, -0.4, 0.44, -0.4, posts=9)
    m.tree(0.34, -0.26, 1.2)
    m.tree(-0.38, 0.3, 1.0, dark=True)
    m.tree(0.38, 0.34, 0.9)
    m.parked_car(0.3, -0.18, "sign_red", "x")


@building(2, "Casa Familiar")
def casa_familiar(m: Model):
    m.plot()
    m.box(0.0, 0.05, 0.03, 0.62, 0.4, 0.26, "wall_beige")
    m.hip(0.0, 0.05, 0.29, 0.68, 0.46, 0.2, "roof_slate")
    m.box(-0.22, -0.18, 0.03, 0.18, 0.1, 0.26, "wall_wood")                       # entrance bay
    m.gable(-0.22, -0.18, 0.29, 0.22, 0.14, 0.12, "roof_blue", end="wall_wood", ridge="x")
    m.skylight(0.14, 0.04, 0.4)
    m.chimney(0.22, 0.14, 0.38, 0.12)
    m.windows(0.0, 0.05, 0.03, 0.62, 0.4, 0.26, 1, cols=4, sides="fbrl", lit=0.65)
    for x in (-0.14, 0.02, 0.18):
        front_frame(m, x, -0.15, 0.12, 0.08, 0.1)
    side_frame(m, 0.31, 0.05, 0.12, 1, 0.075, 0.095)
    roof_seams(m, 0.0, 0.05, 0.41, 0.58, 0.38, 5, mat="roof_dark")
    m.door(-0.22, -0.234, 0.03, 0.07, 0.13, "wall_navy")
    m.steps(-0.22, -0.24, 0.03, 0.13, 2)
    pavers(m, -0.28, -0.42, -0.16, -0.25, 3)
    m.box(0.26, -0.24, 0.03, 0.16, 0.06, 0.02, "concrete", roof="concrete")       # driveway apron
    m.parked_car(0.26, -0.28, "sign_blue", "x")
    planter(m, 0.05, -0.36)
    lamp(m, -0.36, -0.34)
    m.fence(-0.44, -0.42, 0.44, -0.42, posts=9)
    m.tree(-0.38, 0.32, 1.1)
    m.tree(0.38, 0.33, 1.0, dark=True)
    m.tree(0.4, -0.05, 0.9)


@building(3, "Sobrado Moderno")
def sobrado_moderno(m: Model):
    m.plot()
    m.box(-0.04, 0.05, 0.03, 0.5, 0.36, 0.46, "wall_white", roof="roof_flat")
    m.box(0.12, 0.0, 0.2, 0.34, 0.32, 0.29, "wall_wood", roof="roof_flat")        # upper volume in timber
    m.box(-0.04, -0.18, 0.03, 0.5, 0.06, 0.012, "concrete", roof="concrete")
    m.windows(-0.04, 0.05, 0.03, 0.5, 0.36, 0.2, 1, cols=3, sides="fr", lit=0.7)
    m.windows(0.12, 0.0, 0.2, 0.34, 0.32, 0.29, 1, cols=2, sides="fr", lit=0.7, slabs=False)
    for x in (-0.17, -0.04, 0.1):
        front_frame(m, x, -0.13, 0.09, 0.075, 0.09)
    for x in (0.04, 0.18):
        front_frame(m, x, -0.16, 0.29, 0.08, 0.11, frame="wall_cream")
    m.balcony(-0.06, -0.14, 0.23, 0.3, depth=0.1)
    balcony_rail_posts(m, -0.06, -0.24, 0.242, 0.3)
    m.door(-0.2, -0.134, 0.03, 0.065, 0.13, "wall_navy")
    m.box(0.0, 0.05, 0.49, 0.54, 0.4, 0.014, "slab")                               # roof edge
    cornice(m, -0.04, 0.05, 0.5, 0.36, 0.49)
    m.ac_unit(-0.12, 0.1, 0.5)
    m.skylight(0.08, 0.02, 0.5)
    m.hedge_row = None
    m.box(0.0, -0.4, 0.03, 0.8, 0.04, 0.045, "hedge", roof="hedge")
    planter(m, -0.33, -0.34, 0.1, 0.04)
    lamp(m, 0.1, -0.34)
    m.tree(-0.38, 0.32, 1.1)
    m.tree(0.38, -0.3, 1.0)
    m.tree(0.38, 0.34, 0.9, dark=True)
    m.parked_car(0.3, 0.3, "sign_orange", "x")


@building(4, "Vila Geminada")
def vila_geminada(m: Model):
    m.plot()
    for sx in (-1, 1):
        cx = sx * 0.2
        m.box(cx, 0.04, 0.03, 0.36, 0.38, 0.4, "wall_white", roof="roof_flat")
        m.box(cx, 0.04, 0.43, 0.38, 0.4, 0.014, "slab")
        m.windows(cx, 0.04, 0.03, 0.36, 0.38, 0.4, 2, cols=2, sides="fr", lit=0.65)
        for z in (0.12, 0.3):
            front_frame(m, cx + sx * 0.055, -0.15, z, 0.075, 0.085)
        m.door(cx - sx * 0.08, -0.152, 0.03, 0.065, 0.13, "wall_navy")
        m.box(cx - sx * 0.08, -0.19, 0.2, 0.14, 0.07, 0.014, "roof_dark", roof="roof_dark")  # canopy
        m.box(cx - sx * 0.08, -0.205, 0.03, 0.11, 0.035, 0.012, "concrete", roof="concrete")
        m.ac_unit(cx + sx * 0.05, 0.1, 0.44)
        cornice(m, cx, 0.04, 0.36, 0.38, 0.43)
    m.box(0.0, 0.04, 0.03, 0.025, 0.4, 0.42, "wall_wood")                          # party wall
    m.box(0.0, -0.4, 0.03, 0.8, 0.04, 0.045, "hedge", roof="hedge")
    planter(m, -0.34, -0.34, 0.09, 0.04)
    planter(m, 0.34, -0.34, 0.09, 0.04)
    m.tree(-0.38, 0.33, 1.1)
    m.tree(0.38, 0.33, 1.1, dark=True)
    m.tree(0.0, -0.3, 0.9)


@building(11, "Loja de Conveniência")
def loja_conveniencia(m: Model):
    m.plot()
    m.box(-0.04, 0.08, 0.03, 0.66, 0.36, 0.2, "wall_white", roof="roof_flat")
    m.box(-0.04, 0.08, 0.23, 0.7, 0.4, 0.016, "slab")
    facade_trim(m, -0.04, -0.104, 0.225, 0.7, "concrete")
    parapet_caps(m, -0.04, 0.08, 0.7, 0.4, 0.246, "concrete")
    roof_seams(m, -0.04, 0.08, 0.251, 0.62, 0.31, 4)
    m.box(-0.04, -0.12, 0.03, 0.62, 0.012, 0.15, "glass_blue")                      # shop front
    storefront_grid(m, -0.04, -0.13, 0.035, 0.62, 0.14, 5)
    m.awning(-0.04, -0.12, 0.2, 0.66, 0.1, "sign_red")
    for x in (-0.32, -0.16, 0.0, 0.16, 0.32):
        m.box(x, -0.17, 0.165, 0.01, 0.08, 0.012, "metal_dark")
    m.sign(-0.04, -0.12, 0.2, 0.34, 0.05, "glow_sign")
    gooseneck_lamps(m, (-0.22, 0.14), -0.136, 0.235)
    m.door(0.14, -0.126, 0.03, 0.09, 0.12, "glass_dark")
    m.windows(-0.04, 0.08, 0.03, 0.66, 0.36, 0.2, 1, cols=5, sides="brl", lit=0.6, slabs=False)
    m.box(-0.2, 0.264, 0.03, 0.086, 0.008, 0.14, "white")  # rear service door
    m.box(-0.2, 0.267, 0.03, 0.07, 0.006, 0.13, "metal_dark")
    m.box(0.08, 0.262, 0.1, 0.09, 0.008, 0.06, "metal_dark")  # rear louver vents
    m.box(0.2, 0.262, 0.1, 0.09, 0.008, 0.06, "metal_dark")
    m.box(-0.34, 0.268, 0.03, 0.016, 0.014, 0.2, "metal_dark")  # downpipes
    m.box(0.26, 0.268, 0.03, 0.016, 0.014, 0.2, "metal_dark")
    m.box(0.3, 0.37, 0.03, 0.13, 0.08, 0.075, "metal_dark", roof="metal")  # dumpster
    m.ac_unit(0.1, 0.12, 0.24)
    m.ac_unit(-0.18, 0.1, 0.24)
    roof_dress(m, 0.25, [(0.24, 0.02, 0.08, 0.05)])
    # forecourt and two parked cars
    m.box(0.0, -0.3, 0.03, 0.9, 0.2, 0.004, "asphalt", roof="asphalt")
    parking_stripes(m, (-0.39, -0.16, 0.06, 0.39), -0.3)
    curb_blocks(m, -0.19, (-0.32, 0.0, 0.32))
    bollards(m, (-0.24, -0.12, 0.0, 0.26), -0.165)
    m.parked_car(-0.28, -0.3, "sign_blue", "y")
    m.parked_car(0.28, -0.3, "sign_orange", "y")
    m.cyl(0.4, -0.12, 0.03, 0.012, 0.18, "metal", seg=5)
    m.box(0.4, -0.12, 0.21, 0.07, 0.014, 0.05, "glow_sign")                         # pylon sign
    m.tree(-0.42, 0.36, 1.0)
    m.tree(0.42, 0.34, 1.0, dark=True)


@building(12, "Café de Esquina")
def cafe_esquina(m: Model):
    m.plot()
    m.box(0.0, 0.1, 0.03, 0.62, 0.34, 0.22, "wall_brick", roof="roof_flat")
    m.box(0.0, 0.1, 0.25, 0.66, 0.38, 0.016, "slab")
    parapet_caps(m, 0.0, 0.1, 0.66, 0.38, 0.267, "concrete")
    facade_trim(m, 0.0, -0.076, 0.232, 0.62, "slab")
    m.box(0.0, -0.075, 0.03, 0.5, 0.012, 0.14, "glass_blue")
    storefront_grid(m, 0.0, -0.085, 0.035, 0.5, 0.13, 4)
    m.awning(-0.13, -0.075, 0.18, 0.24, 0.1, "roof_dark")
    m.awning(0.13, -0.075, 0.18, 0.24, 0.1, "roof_dark")
    for x in (-0.25, -0.01, 0.01, 0.25):
        m.box(x, -0.125, 0.145, 0.01, 0.075, 0.012, "metal_dark")
    m.sign(0.0, -0.075, 0.2, 0.3, 0.05, "glow_sign")
    gooseneck_lamps(m, (-0.18, 0.18), -0.09, 0.235)
    m.door(0.0, -0.081, 0.03, 0.08, 0.12, "glass_dark")
    # terrace: tables with umbrellas
    for x in (-0.24, 0.0, 0.24):
        m.cyl(x, -0.24, 0.03, 0.045, 0.02, "wall_wood", seg=6)
        m.cyl(x, -0.24, 0.05, 0.007, 0.1, "metal", seg=4)
        m.cone(x, -0.24, 0.14, 0.085, 0.045, "sign_red" if x else "wall_cream", seg=6)
    m.fence(-0.36, -0.4, 0.36, -0.4, 0.04, "metal_dark", 6)
    m.fence(-0.36, -0.4, -0.36, -0.18, 0.04, "metal_dark", 4)
    m.fence(0.36, -0.4, 0.36, -0.18, 0.04, "metal_dark", 4)
    planters(m, [(-0.34, -0.16), (0.34, -0.16)])
    m.ac_unit(0.12, 0.14, 0.27)
    roof_dress(m, 0.27, [(-0.12, 0.02, 0.07, 0.05)])
    m.tree(-0.4, 0.36, 1.0)
    m.tree(0.4, 0.34, 1.1, dark=True)
    m.tree(-0.42, -0.1, 0.8)


@building(13, "Mercado Local")
def mercado_local(m: Model):
    m.plot()
    m.box(0.0, 0.1, 0.03, 0.7, 0.36, 0.22, "wall_white", roof="roof_flat")
    m.box(0.0, 0.1, 0.25, 0.74, 0.4, 0.016, "slab")
    parapet_caps(m, 0.0, 0.1, 0.74, 0.4, 0.267, "concrete")
    roof_seams(m, 0.0, 0.1, 0.272, 0.64, 0.32, 5)
    m.box(0.0, -0.08, 0.03, 0.6, 0.012, 0.14, "glass_blue")
    storefront_grid(m, 0.0, -0.09, 0.035, 0.6, 0.13, 5)
    m.awning(0.0, -0.08, 0.2, 0.62, 0.1, "sign_green")
    for x in (-0.28, -0.14, 0.0, 0.14, 0.28):
        m.box(x, -0.13, 0.165, 0.01, 0.075, 0.012, "metal_dark")
    m.sign(0.0, -0.08, 0.215, 0.4, 0.05, "sign_green")
    gooseneck_lamps(m, (-0.24, 0.24), -0.095, 0.24)
    m.door(-0.2, -0.086, 0.03, 0.09, 0.12, "glass_dark")
    # produce crates under the awning and a delivery van at the side
    for i, x in enumerate((0.08, 0.17, 0.26)):
        m.box(x, -0.14, 0.03, 0.07, 0.05, 0.035, "wall_wood")
        m.box(x, -0.14, 0.065, 0.06, 0.04, 0.012, "flower_red" if i % 2 else "leaf_c")
    m.box(0.3, 0.22, 0.03, 0.2, 0.1, 0.08, "wall_white", roof="wall_white")
    m.box(0.37, 0.22, 0.03, 0.06, 0.09, 0.06, "glass_dark")
    m.windows(0.0, 0.1, 0.03, 0.7, 0.36, 0.22, 1, cols=5, sides="brl", lit=0.6, slabs=False)
    m.box(-0.12, 0.36, 0.03, 0.26, 0.15, 0.025, "concrete", roof="concrete")  # loading bay
    m.box(-0.12, 0.282, 0.03, 0.15, 0.012, 0.14, "metal")  # dock door
    m.box(-0.2, 0.4, 0.055, 0.07, 0.06, 0.05, "wall_wood")  # crates on the bay
    m.box(-0.04, 0.4, 0.055, 0.07, 0.06, 0.05, "wall_wood")
    m.box(0.18, 0.284, 0.03, 0.086, 0.008, 0.14, "white")  # rear service door
    m.box(0.18, 0.287, 0.03, 0.07, 0.006, 0.13, "metal_dark")
    m.box(-0.32, 0.288, 0.03, 0.016, 0.014, 0.22, "metal_dark")  # downpipes
    m.box(0.32, 0.288, 0.03, 0.016, 0.014, 0.22, "metal_dark")
    m.ac_unit(-0.2, 0.15, 0.27)
    m.ac_unit(0.2, 0.15, 0.27)
    planters(m, [(-0.34, -0.12), (0.34, -0.12)])
    bollards(m, (-0.04, 0.08, 0.2), -0.145)
    m.tree(-0.42, -0.3, 1.0)
    m.tree(0.42, -0.34, 1.0, dark=True)


@building(36, "Armazém Logístico")
def armazem_logistico(m: Model):
    m.plot(lawn=False)
    m.box(0.0, 0.1, 0.03, 0.76, 0.5, 0.26, "wall_grey", roof="roof_flat")
    m.gable(0.0, 0.1, 0.29, 0.76, 0.5, 0.07, "roof_slate", end="wall_grey", ridge="x")
    for i in range(4):
        x = -0.27 + i * 0.18
        m.box(x, -0.157, 0.03, 0.13, 0.012, 0.13, "metal")                           # dock doors
        m.box(x, -0.2, 0.03, 0.15, 0.08, 0.012, "concrete", roof="concrete")        # dock apron
        m.box(x, -0.166, 0.095, 0.145, 0.008, 0.012, "metal_dark")
        d_bollards(m, (x - 0.072, x + 0.072), -0.215)
    m.windows(0.0, 0.1, 0.18, 0.76, 0.5, 0.09, 1, cols=6, sides="f", lit=0.5, slabs=False)
    m.windows(0.0, 0.1, 0.18, 0.76, 0.5, 0.09, 1, cols=6, sides="brl", lit=0.45, slabs=False)
    m.box(0.0, 0.36, 0.03, 0.2, 0.03, 0.2, "wall_blue")                            # office bay
    m.box(-0.25, 0.357, 0.03, 0.16, 0.012, 0.14, "metal_dark")                       # rear loading door
    m.box(-0.25, 0.41, 0.03, 0.18, 0.08, 0.012, "concrete", roof="concrete")
    _back_door(m, 0.1, 0.36, w=0.055, h=0.11)
    _downpipes(m, 0.0, 0.35, 0.03, 0.26, 0.76)
    for x in (-0.3, 0.1):
        m.skylight(x, 0.12, 0.34, 0.12, 0.08)
    d_roof_seams(m, 0.0, 0.1, 0.363, 0.74, 0.48, along="x", count=6)
    m.ac_unit(0.28, 0.12, 0.34, 0.07, 0.05, 0.03)
    _roof_vent(m, -0.05, 0.24, 0.34)
    # a truck backed into a bay, and a trailer in the yard
    m.box(-0.1, -0.3, 0.05, 0.32, 0.12, 0.13, "white", roof="white")
    m.box(0.1, -0.3, 0.05, 0.1, 0.1, 0.08, "sign_blue")
    m.box(0.3, -0.34, 0.04, 0.26, 0.11, 0.12, "white", roof="white")
    guard_rail(m, -0.38, 0.42, -0.245, z=0.085, posts=8)
    thin_frame(m, 0.1, 0.36, 0.03, 0.055, 0.11, front=False)
    m.fence(-0.46, -0.46, 0.46, -0.46, 0.06, "metal_dark", 12)
    m.tree(-0.4, 0.4, 0.8)


@building(37, "Fábrica Leve")
def fabrica_leve(m: Model):
    m.plot(lawn=False)
    m.box(-0.08, 0.06, 0.03, 0.6, 0.46, 0.26, "wall_grey", roof="roof_flat")
    for i in range(3):                                                              # sawtooth roof
        m.gable(-0.08 - 0.2 + i * 0.2, 0.06, 0.29, 0.2, 0.46, 0.09, "roof_slate", end="wall_grey")
    d_roof_seams(m, -0.08, 0.06, 0.382, 0.58, 0.44, along="x", count=5)
    m.windows(-0.08, 0.06, 0.03, 0.6, 0.46, 0.26, 1, cols=6, sides="fbrl", lit=0.55)
    m.door(-0.2, -0.174, 0.03, 0.14, 0.13, "metal")
    m.box(-0.32, 0.293, 0.03, 0.13, 0.012, 0.13, "metal_dark")
    _back_door(m, -0.08, 0.29, w=0.055, h=0.11)
    _downpipes(m, -0.08, 0.29, 0.03, 0.26, 0.6)
    m.chimney(0.15, 0.2, 0.3, 0.45, 0.06, "wall_brick")
    tank_ladder(m, 0.15, 0.168, 0.36, 0.28)
    m.cyl(0.36, -0.12, 0.03, 0.07, 0.26, "metal", seg=8)                           # silo
    m.cone(0.36, -0.12, 0.29, 0.075, 0.05, "metal_dark", seg=8)
    tank_ladder(m, 0.36, -0.19, 0.07, 0.22)
    pipe_run(m, 0.18, (-0.28, -0.08, 0.12, 0.28), 0.18, 0.26)
    m.box(0.3, 0.24, 0.03, 0.2, 0.14, 0.1, "wall_beige", roof="roof_dark")        # annex
    m.windows(0.3, 0.24, 0.05, 0.2, 0.14, 0.08, 1, cols=1, sides="br", lit=0.45, slabs=False)
    m.ac_unit(0.08, 0.0, 0.38, 0.07, 0.05, 0.03)
    _roof_vent(m, -0.26, 0.0, 0.38)
    m.parked_car(0.3, -0.38, "sign_red", "x")
    m.parked_car(0.0, -0.38, "white", "x")
    d_bollards(m, (-0.32, -0.18, 0.18, 0.32), -0.31)
    m.fence(-0.46, -0.46, 0.46, -0.46, 0.06, "metal_dark", 12)
    m.tree(-0.42, 0.42, 0.9, dark=True)


@building(38, "Fábrica Pesada")
def fabrica_pesada(m: Model):
    m.plot(lawn=False)
    m.box(-0.12, 0.08, 0.03, 0.5, 0.4, 0.3, "wall_brick", roof="roof_flat")
    m.box(-0.12, 0.08, 0.33, 0.54, 0.44, 0.014, "slab")
    m.windows(-0.12, 0.08, 0.03, 0.5, 0.4, 0.3, 1, cols=4, sides="fr", lit=0.5)
    m.door(-0.2, -0.12, 0.03, 0.15, 0.14, "metal")
    m.box(0.22, 0.05, 0.03, 0.26, 0.3, 0.2, "wall_grey", roof="roof_dark")
    for x, y, r, h in ((0.14, 0.34, 0.06, 0.55), (0.3, 0.3, 0.05, 0.45)):          # chimneys with red bands
        m.cyl(x, y, 0.03, r, h, "wall_grey", seg=8, r_top=r * 0.78)
        m.cyl(x, y, 0.03 + h * 0.8, r * 0.82, h * 0.1, "sign_red", seg=8)
    for x in (-0.42, -0.3):                                                         # silos
        m.cyl(x, 0.36, 0.03, 0.065, 0.42, "white", seg=8)
        m.cone(x, 0.36, 0.45, 0.07, 0.07, "metal_dark", seg=8)
    # pipe bridge and a storage tank
    m.box(0.12, -0.04, 0.2, 0.3, 0.025, 0.025, "metal")
    m.cyl(0.36, -0.2, 0.03, 0.1, 0.22, "metal", seg=10)
    m.parked_car(-0.1, -0.36, "wall_yellow", "x")
    m.fence(-0.46, -0.46, 0.46, -0.46, 0.06, "metal_dark", 12)


@building(24, "Delegacia")
def delegacia(m: Model):
    m.plot()
    m.box(0.0, 0.06, 0.03, 0.66, 0.42, 0.34, "wall_white", roof="roof_flat")
    m.box(0.0, -0.17, 0.03, 0.66, 0.06, 0.34, "wall_navy")                          # front band
    m.box(0.0, 0.06, 0.37, 0.7, 0.46, 0.016, "slab")
    m.windows(0.0, 0.06, 0.03, 0.66, 0.42, 0.34, 2, cols=4, sides="fbrl", lit=0.55)
    m.door(0.0, -0.205, 0.03, 0.1, 0.14, "glass_dark")
    m.sign(0.0, -0.205, 0.2, 0.26, 0.06, "glow_sign")
    m.steps(0.0, -0.21, 0.03, 0.18, 2)
    _back_door(m, -0.18, 0.27, 0.03)
    _louver(m, 0.12, 0.273, 0.16)
    _rear_pipes(m, 0.27, -0.32, 0.32, 0.03, 0.34)
    m.box(0.18, 0.36, 0.03, 0.18, 0.08, 0.05, "metal_dark", roof="metal")
    m.cyl(-0.3, -0.3, 0.03, 0.008, 0.34, "metal", seg=5)                           # flagpole
    m.box(-0.27, -0.3, 0.3, 0.06, 0.004, 0.04, "sign_green")
    m.cyl(0.18, 0.2, 0.39, 0.006, 0.18, "metal", seg=4)                            # antennas
    m.ac_unit(-0.2, 0.1, 0.39)
    for x in (-0.22, -0.08, 0.08, 0.22):
        framed_window(m, x, -0.205, 0.09, w=0.052, h=0.07, mat="glow_window", frame="wall_grey")
        framed_window(m, x, -0.205, 0.235, w=0.052, h=0.07, mat="glass_dark", frame="wall_grey")
    for y in (-0.08, 0.08, 0.22):
        side_window(m, 0.33, y, 0.13, side="r", mat="glow_window")
        side_window(m, -0.33, y, 0.13, side="l", mat="glass_dark")
    c_cornice(m, 0, 0.06, 0.66, 0.42, 0.405)
    c_roof_seams(m, 0, 0.06, 0.58, 0.34, 0.408, n=5)
    m.box(0, -0.255, 0.035, 0.24, 0.08, 0.012, "concrete")
    rail(m, -0.15, 0.15, -0.3, 0.045, h=0.045, posts=5)
    c_bollards(m, (-0.32, -0.24, 0.24, 0.32), -0.38)
    paving_lines(m, -0.36, xs=(-0.36, -0.18, 0.0, 0.18, 0.36))
    m.parked_car(0.3, -0.33, "white", "x")
    m.fence(-0.46, -0.46, 0.46, -0.46, 0.06, "metal_dark", 12)
    m.tree(-0.42, 0.36, 1.0)
    m.tree(0.42, 0.36, 1.0, dark=True)


@building(30, "Quartel dos Bombeiros")
def quartel_bombeiros(m: Model):
    m.plot(lawn=False)
    m.box(0.05, 0.05, 0.03, 0.62, 0.44, 0.3, "wall_white", roof="roof_flat")
    m.box(0.05, -0.18, 0.03, 0.62, 0.06, 0.3, "wall_red")
    for i in range(3):                                                              # engine bay doors
        m.box(-0.12 + i * 0.17, -0.215, 0.03, 0.13, 0.01, 0.17, "metal")
    m.box(-0.34, 0.05, 0.03, 0.18, 0.18, 0.78, "wall_brick", roof="roof_dark")      # hose tower
    m.windows(-0.34, 0.05, 0.03, 0.18, 0.18, 0.78, 4, cols=1, sides="fbrl", lit=0.5)
    m.box(-0.34, 0.05, 0.81, 0.24, 0.24, 0.016, "slab")
    m.windows(0.05, 0.05, 0.03, 0.62, 0.44, 0.3, 1, cols=5, sides="brl", lit=0.5)
    m.sign(0.05, -0.215, 0.23, 0.3, 0.05, "glow_sign")
    _back_door(m, 0.2, 0.27, 0.03)
    _louver(m, -0.02, 0.273, 0.14)
    _rear_pipes(m, 0.27, -0.24, 0.36, 0.03, 0.29)
    m.ac_unit(0.22, 0.14, 0.34)
    for x in (-0.12, 0.05, 0.22):
        m.box(x, -0.222, 0.03, 0.15, 0.012, 0.19, "metal_dark")
        for z in (0.075, 0.12, 0.165):
            m.box(x, -0.23, z, 0.13, 0.008, 0.006, "metal")
    for z in (0.18, 0.34, 0.5, 0.66):
        side_window(m, -0.43, 0.05, z, side="l", mat="glow_window", h=0.06)
    c_cornice(m, 0.05, 0.05, 0.62, 0.44, 0.365)
    c_cornice(m, -0.34, 0.05, 0.18, 0.18, 0.85, mat="roof_dark")
    c_roof_seams(m, 0.05, 0.05, 0.54, 0.36, 0.368, n=5)
    m.box(-0.34, -0.07, 0.12, 0.018, 0.06, 0.62, "metal_dark")                 # hose rail
    m.box(-0.34, -0.07, 0.42, 0.08, 0.014, 0.014, "metal_dark")
    c_bollards(m, (-0.28, -0.2, 0.32, 0.4), -0.38)
    paving_lines(m, -0.36, xs=(-0.22, -0.05, 0.12, 0.29))
    m.fence(-0.46, 0.42, 0.3, 0.42, 0.06, "metal_dark", 9)
    # two red trucks on the apron
    for x in (-0.05, 0.22):
        m.box(x, -0.34, 0.04, 0.2, 0.09, 0.09, "sign_red", roof="sign_red")
        m.box(x + 0.07, -0.34, 0.04, 0.06, 0.085, 0.07, "glass_dark")
    m.fence(-0.46, -0.46, 0.46, -0.46, 0.06, "metal_dark", 12)
    m.tree(0.42, 0.38, 1.0)
