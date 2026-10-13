"""
Richer versions of the buildings players see most. Loaded last, so these replace the simpler ones in
buildings_res_com.py / buildings_civic_ind.py. Same footprint and front-faces--Y rules as every model.
"""
from lib import Model
from registry import building


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
    m.door(-0.22, -0.234, 0.03, 0.07, 0.13, "wall_navy")
    m.steps(-0.22, -0.24, 0.03, 0.13, 2)
    m.box(0.26, -0.24, 0.03, 0.16, 0.06, 0.02, "concrete", roof="concrete")       # driveway apron
    m.parked_car(0.26, -0.28, "sign_blue", "x")
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
    m.balcony(-0.06, -0.14, 0.23, 0.3, depth=0.1)
    m.door(-0.2, -0.134, 0.03, 0.065, 0.13, "wall_navy")
    m.box(0.0, 0.05, 0.49, 0.54, 0.4, 0.014, "slab")                               # roof edge
    m.ac_unit(-0.12, 0.1, 0.5)
    m.skylight(0.08, 0.02, 0.5)
    m.hedge_row = None
    m.box(0.0, -0.4, 0.03, 0.8, 0.04, 0.045, "hedge", roof="hedge")
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
        m.door(cx - sx * 0.08, -0.152, 0.03, 0.065, 0.13, "wall_navy")
        m.box(cx - sx * 0.08, -0.19, 0.2, 0.14, 0.07, 0.014, "roof_dark", roof="roof_dark")  # canopy
        m.ac_unit(cx + sx * 0.05, 0.1, 0.44)
    m.box(0.0, 0.04, 0.03, 0.025, 0.4, 0.42, "wall_wood")                          # party wall
    m.box(0.0, -0.4, 0.03, 0.8, 0.04, 0.045, "hedge", roof="hedge")
    m.tree(-0.38, 0.33, 1.1)
    m.tree(0.38, 0.33, 1.1, dark=True)
    m.tree(0.0, -0.3, 0.9)


@building(11, "Loja de Conveniência")
def loja_conveniencia(m: Model):
    m.plot()
    m.box(-0.04, 0.08, 0.03, 0.66, 0.36, 0.2, "wall_white", roof="roof_flat")
    m.box(-0.04, 0.08, 0.23, 0.7, 0.4, 0.016, "slab")
    m.box(-0.04, -0.12, 0.03, 0.62, 0.012, 0.15, "glass_blue")                      # shop front
    m.awning(-0.04, -0.12, 0.2, 0.66, 0.1, "sign_red")
    m.sign(-0.04, -0.12, 0.2, 0.34, 0.05, "glow_sign")
    m.door(0.14, -0.126, 0.03, 0.09, 0.12, "glass_dark")
    m.ac_unit(0.1, 0.12, 0.24)
    m.ac_unit(-0.18, 0.1, 0.24)
    # forecourt and two parked cars
    m.box(0.0, -0.3, 0.03, 0.9, 0.2, 0.004, "asphalt", roof="asphalt")
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
    m.box(0.0, -0.075, 0.03, 0.5, 0.012, 0.14, "glass_blue")
    m.awning(-0.13, -0.075, 0.18, 0.24, 0.1, "roof_dark")
    m.awning(0.13, -0.075, 0.18, 0.24, 0.1, "roof_dark")
    m.sign(0.0, -0.075, 0.2, 0.3, 0.05, "glow_sign")
    m.door(0.0, -0.081, 0.03, 0.08, 0.12, "glass_dark")
    # terrace: tables with umbrellas
    for x in (-0.24, 0.0, 0.24):
        m.cyl(x, -0.24, 0.03, 0.045, 0.02, "wall_wood", seg=6)
        m.cyl(x, -0.24, 0.05, 0.007, 0.1, "metal", seg=4)
        m.cone(x, -0.24, 0.14, 0.085, 0.045, "sign_red" if x else "wall_cream", seg=6)
    m.fence(-0.36, -0.4, 0.36, -0.4, 0.04, "metal_dark", 6)
    m.ac_unit(0.12, 0.14, 0.27)
    m.tree(-0.4, 0.36, 1.0)
    m.tree(0.4, 0.34, 1.1, dark=True)
    m.tree(-0.42, -0.1, 0.8)


@building(13, "Mercado Local")
def mercado_local(m: Model):
    m.plot()
    m.box(0.0, 0.1, 0.03, 0.7, 0.36, 0.22, "wall_white", roof="roof_flat")
    m.box(0.0, 0.1, 0.25, 0.74, 0.4, 0.016, "slab")
    m.box(0.0, -0.08, 0.03, 0.6, 0.012, 0.14, "glass_blue")
    m.awning(0.0, -0.08, 0.2, 0.62, 0.1, "sign_green")
    m.sign(0.0, -0.08, 0.215, 0.4, 0.05, "sign_green")
    m.door(-0.2, -0.086, 0.03, 0.09, 0.12, "glass_dark")
    # produce crates under the awning and a delivery van at the side
    for i, x in enumerate((0.08, 0.17, 0.26)):
        m.box(x, -0.14, 0.03, 0.07, 0.05, 0.035, "wall_wood")
        m.box(x, -0.14, 0.065, 0.06, 0.04, 0.012, "flower_red" if i % 2 else "leaf_c")
    m.box(0.3, 0.22, 0.03, 0.2, 0.1, 0.08, "wall_white", roof="wall_white")
    m.box(0.37, 0.22, 0.03, 0.06, 0.09, 0.06, "glass_dark")
    m.ac_unit(-0.2, 0.15, 0.27)
    m.ac_unit(0.2, 0.15, 0.27)
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
    m.windows(0.0, 0.1, 0.18, 0.76, 0.5, 0.09, 1, cols=6, sides="f", lit=0.5, slabs=False)
    m.box(0.0, 0.36, 0.03, 0.2, 0.03, 0.2, "wall_blue")                            # office bay
    for x in (-0.3, 0.1):
        m.skylight(x, 0.12, 0.34, 0.12, 0.08)
    # a truck backed into a bay, and a trailer in the yard
    m.box(-0.1, -0.3, 0.05, 0.32, 0.12, 0.13, "white", roof="white")
    m.box(0.1, -0.3, 0.05, 0.1, 0.1, 0.08, "sign_blue")
    m.box(0.3, -0.34, 0.04, 0.26, 0.11, 0.12, "white", roof="white")
    m.fence(-0.46, -0.46, 0.46, -0.46, 0.06, "metal_dark", 12)
    m.tree(-0.4, 0.4, 0.8)


@building(37, "Fábrica Leve")
def fabrica_leve(m: Model):
    m.plot(lawn=False)
    m.box(-0.08, 0.06, 0.03, 0.6, 0.46, 0.26, "wall_grey", roof="roof_flat")
    for i in range(3):                                                              # sawtooth roof
        m.gable(-0.08 - 0.2 + i * 0.2, 0.06, 0.29, 0.2, 0.46, 0.09, "roof_slate", end="wall_grey")
    m.windows(-0.08, 0.06, 0.03, 0.6, 0.46, 0.26, 1, cols=6, sides="fr", lit=0.55)
    m.door(-0.2, -0.174, 0.03, 0.14, 0.13, "metal")
    m.chimney(0.15, 0.2, 0.3, 0.45, 0.06, "wall_brick")
    m.cyl(0.36, -0.12, 0.03, 0.07, 0.26, "metal", seg=8)                           # silo
    m.cone(0.36, -0.12, 0.29, 0.075, 0.05, "metal_dark", seg=8)
    m.box(0.3, 0.24, 0.03, 0.2, 0.14, 0.1, "wall_beige", roof="roof_dark")        # annex
    m.parked_car(0.3, -0.38, "sign_red", "x")
    m.parked_car(0.0, -0.38, "white", "x")
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
    m.windows(0.0, 0.06, 0.03, 0.66, 0.42, 0.34, 2, cols=4, sides="fr", lit=0.55)
    m.door(0.0, -0.205, 0.03, 0.1, 0.14, "glass_dark")
    m.sign(0.0, -0.205, 0.2, 0.26, 0.06, "glow_sign")
    m.steps(0.0, -0.21, 0.03, 0.18, 2)
    m.cyl(-0.3, -0.3, 0.03, 0.008, 0.34, "metal", seg=5)                           # flagpole
    m.box(-0.27, -0.3, 0.3, 0.06, 0.004, 0.04, "sign_green")
    m.cyl(0.18, 0.2, 0.39, 0.006, 0.18, "metal", seg=4)                            # antennas
    m.ac_unit(-0.2, 0.1, 0.39)
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
    m.windows(-0.34, 0.05, 0.03, 0.18, 0.18, 0.78, 4, cols=1, sides="fr", lit=0.5)
    m.box(-0.34, 0.05, 0.81, 0.24, 0.24, 0.016, "slab")
    m.windows(0.05, 0.05, 0.03, 0.62, 0.44, 0.3, 1, cols=5, sides="r", lit=0.5)
    m.sign(0.05, -0.215, 0.23, 0.3, 0.05, "glow_sign")
    # two red trucks on the apron
    for x in (-0.05, 0.22):
        m.box(x, -0.34, 0.04, 0.2, 0.09, 0.09, "sign_red", roof="sign_red")
        m.box(x + 0.07, -0.34, 0.04, 0.06, 0.085, 0.07, "glass_dark")
    m.fence(-0.46, -0.46, 0.46, -0.46, 0.06, "metal_dark", 12)
    m.tree(0.42, 0.38, 1.0)
