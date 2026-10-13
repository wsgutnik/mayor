"""Civic + industry kit models (entries 21-30, 34-39)."""
from lib import Model
from registry import building


def _sign(m: Model, cx, y, z, w, h=0.05, mat="glow_sign"):
    m.box(cx, y, z, w, 0.02, h, mat)


def _cross(m: Model, cx, y, z, s=0.09, mat="sign_red"):
    m.box(cx, y, z, s, 0.02, s * 0.36, mat)
    m.box(cx, y, z - s * 0.32, s * 0.36, 0.02, s, mat)


def _column(m: Model, x, y, z0, h, w=0.045, mat="wall_white"):
    m.box(x, y, z0, w, w, h, mat)


def _truck(m: Model, cx, cy, body_mat="wall_white", cab_mat="sign_blue"):
    # simple box truck facing -Y, parked at a dock
    m.box(cx, cy + 0.02, 0.05, 0.11, 0.2, 0.12, body_mat)
    m.box(cx, cy - 0.11, 0.05, 0.1, 0.07, 0.09, cab_mat)


def _amb(m: Model, cx, cy):
    m.box(cx, cy, 0.05, 0.09, 0.16, 0.09, "wall_white")
    m.box(cx, cy - 0.09, 0.05, 0.08, 0.05, 0.06, "wall_white")
    _cross(m, cx, cy - 0.02, 0.1, s=0.05)


def _tank(m: Model, cx, cy, r, wall_mat="concrete"):
    # open clarifier: outer wall + water disc + walkway
    m.cyl(cx, cy, 0.03, r, 0.12, wall_mat, seg=10)
    m.cyl(cx, cy, 0.10, r * 0.88, 0.02, "water", seg=10)
    m.box(cx, cy, 0.13, 0.03, r * 2.0, 0.03, "metal_dark")


def _pylon(m: Model, cx, cy, h=0.62, w=0.2):
    for sx in (-1, 1):
        m.box(cx + sx * w / 2, cy, 0.03, 0.03, 0.03, h, "metal_dark")
    m.box(cx, cy, 0.03 + h - 0.03, w + 0.06, 0.03, 0.03, "metal_dark")
    m.box(cx, cy, 0.03 + h - 0.14, w * 0.7, 0.03, 0.025, "metal_dark")


def _xfmr(m: Model, cx, cy):
    m.box(cx, cy, 0.03, 0.12, 0.09, 0.12, "metal")
    for i in (-1, 0, 1):
        m.cyl(cx + i * 0.035, cy, 0.15, 0.008, 0.07, "trunk", seg=4)


def _fence_run(m: Model, cx, cy, w, d):
    # low site fence as thin walls (2 tris per face kept low by using boxes)
    if w >= d:
        m.box(cx, cy, 0.03, w, 0.015, 0.07, "metal_dark")
    else:
        m.box(cx, cy, 0.03, 0.015, d, 0.07, "metal_dark")


def _back_door(m: Model, x, y_back, z=0.03, w=0.07, h=0.12, mat="metal_dark"):
    m.box(x, y_back + 0.004, z, w + 0.016, 0.008, h + 0.01, "white")
    m._quad([(x + w / 2, y_back + 0.009, z), (x - w / 2, y_back + 0.009, z),
             (x - w / 2, y_back + 0.009, z + h), (x + w / 2, y_back + 0.009, z + h)], mat)


def _rear_pipes(m: Model, y_back, x0, x1, z0, h):
    for x in (x0, x1):
        m.box(x, y_back + 0.006, z0, 0.014, 0.012, h, "metal_dark")


def _louver(m: Model, x, y_back, z, w=0.09, h=0.055):
    m.box(x, y_back + 0.006, z, w, 0.01, h, "metal_dark")


def _roof_parapet(m: Model, cx, cy, w, d, z, mat="slab"):
    m.box(cx, cy - d / 2, z, w, 0.018, 0.035, mat)
    m.box(cx, cy + d / 2, z, w, 0.018, 0.035, mat)
    m.box(cx - w / 2, cy, z, 0.018, d, 0.035, mat)
    m.box(cx + w / 2, cy, z, 0.018, d, 0.035, mat)


def _downpipes(m: Model, cx, y_back, z0, h, w):
    for sx in (-1, 1):
        m.box(cx + sx * (w / 2 - 0.03), y_back + 0.008, z0, 0.014, 0.012, h, "metal_dark")


def _roof_vent(m: Model, x, y, z):
    m.cyl(x, y, z, 0.018, 0.08, "metal", seg=6)
    m.box(x, y, z + 0.08, 0.05, 0.05, 0.014, "metal_dark")


@building(21, "Prefeitura")
def prefeitura(m: Model):
    m.plot()
    m.box(0, 0.08, 0.03, 0.62, 0.4, 0.3, "wall_cream", roof="roof_flat")
    m.hip(0, 0.08, 0.33, 0.66, 0.44, 0.12, "roof_blue")
    # clock tower + dome
    m.box(0, 0.08, 0.45, 0.14, 0.14, 0.22, "wall_cream")
    m.pyramid(0, 0.08, 0.67, 0.17, 0.17, 0.12, "roof_blue")
    m.box(0, -0.001, 0.52, 0.1, 0.01, 0.08, "wall_white")  # clock face
    # portico: slab + 4 columns + steps + door
    m.box(0, -0.17, 0.3, 0.34, 0.12, 0.03, "wall_white")
    for x in (-0.135, -0.045, 0.045, 0.135):
        _column(m, x, -0.21, 0.03, 0.27)
    m.box(0, -0.2, 0.03, 0.3, 0.1, 0.03, "concrete")
    m.box(0, -0.121, 0.03, 0.09, 0.01, 0.2, "wall_wood")  # door
    m.windows(0, 0.08, 0.03, 0.62, 0.4, 0.3, 1, cols=5, sides="f", lit=0.5)
    m.windows(0, 0.08, 0.03, 0.62, 0.4, 0.3, 1, cols=3, sides="r", lit=0.4)
    m.tree(0.36, -0.28, 1.0)
    m.tree(-0.37, 0.28, 0.9, dark=True)


@building(22, "Biblioteca Municipal")
def biblioteca(m: Model):
    m.plot()
    # glass reading hall between two brick piers + side wing
    m.box(0, 0.05, 0.03, 0.5, 0.34, 0.3, "glass_blue", roof="roof_flat")
    m.box(-0.3, 0.05, 0.03, 0.1, 0.34, 0.34, "wall_brick")
    m.box(0.3, 0.05, 0.03, 0.1, 0.34, 0.34, "wall_brick")
    m.box(0.28, 0.22, 0.03, 0.3, 0.2, 0.2, "wall_cream", roof="roof_flat")  # wing
    m.box(0, 0.05, 0.33, 0.52, 0.36, 0.03, "concrete")  # roof slab
    m.box(0, 0.02, 0.36, 0.2, 0.14, 0.07, "glass_dark", roof="glass_blue")  # skylight
    _sign(m, -0.08, -0.125, 0.2, 0.24)  # BIBLIOTECA band
    m.box(-0.08, -0.14, 0.03, 0.16, 0.06, 0.02, "concrete")  # entry step
    m.windows(0, 0.05, 0.03, 0.5, 0.34, 0.3, 1, cols=4, sides="fbrl", lit=0.6)
    m.windows(0.28, 0.22, 0.03, 0.3, 0.2, 0.2, 1, cols=2, sides="br", lit=0.5)
    _back_door(m, -0.12, 0.22, 0.03)
    _louver(m, 0.12, 0.223, 0.12)
    _rear_pipes(m, 0.22, -0.34, 0.34, 0.03, 0.3)
    _roof_parapet(m, 0, 0.05, 0.52, 0.36, 0.36)
    m.ac_unit(0.14, 0.12, 0.39)
    m.tree(-0.37, -0.28, 1.0)
    m.tree(0.38, -0.3, 0.9)


@building(23, "Centro Comunitário")
def centro(m: Model):
    m.plot()
    m.box(-0.05, 0.1, 0.03, 0.56, 0.4, 0.28, "wall_white", roof="roof_flat")
    m.box(-0.28, 0.1, 0.03, 0.12, 0.4, 0.3, "wall_wood")  # wood side volume
    m.box(0.2, 0.22, 0.03, 0.26, 0.2, 0.18, "wall_cream", roof="roof_flat")
    # wide entry canopy on posts
    m.box(-0.05, -0.2, 0.24, 0.4, 0.16, 0.03, "roof_dark")
    _column(m, -0.22, -0.26, 0.03, 0.21, w=0.03)
    _column(m, 0.12, -0.26, 0.03, 0.21, w=0.03)
    _sign(m, -0.05, -0.105, 0.26, 0.3, h=0.04)
    m.box(-0.05, -0.12, 0.03, 0.2, 0.02, 0.16, "glass_blue")  # glazed entry
    m.windows(-0.05, 0.1, 0.03, 0.56, 0.4, 0.28, 1, cols=4, sides="fbrl", lit=0.6)
    m.windows(0.2, 0.22, 0.03, 0.26, 0.2, 0.18, 1, cols=2, sides="br", lit=0.45)
    _back_door(m, 0.05, 0.3, 0.03, mat="wall_wood")
    _louver(m, -0.18, 0.303, 0.12)
    _rear_pipes(m, 0.3, -0.31, 0.21, 0.03, 0.27)
    _roof_parapet(m, -0.05, 0.1, 0.56, 0.4, 0.31)
    m.tree(0.36, -0.28, 1.0)
    m.tree(-0.38, -0.3, 0.9, dark=True)


@building(24, "Delegacia")
def delegacia(m: Model):
    m.plot(lawn=False)
    m.box(0, 0.1, 0.03, 0.6, 0.36, 0.3, "wall_white", roof="roof_flat")
    m.box(-0.32, 0.1, 0.03, 0.1, 0.36, 0.34, "wall_blue")
    m.box(0.32, 0.1, 0.03, 0.1, 0.36, 0.34, "wall_blue")
    m.box(0, 0.1, 0.33, 0.62, 0.38, 0.04, "concrete")  # roof plant deck
    m.box(-0.15, 0.15, 0.37, 0.12, 0.1, 0.08, "wall_grey")
    m.box(0, -0.085, 0.12, 0.3, 0.02, 0.12, "wall_blue")  # POLICIA band
    _sign(m, 0, -0.085, 0.2, 0.2, h=0.035)
    m.box(0, -0.1, 0.03, 0.12, 0.03, 0.14, "glass_dark")  # entry
    # flag + patrol car + gate posts
    m.cyl(-0.36, -0.2, 0.03, 0.008, 0.3, "metal", seg=4)
    m.box(-0.31, -0.2, 0.25, 0.09, 0.01, 0.06, "sign_green")
    m.box(0.2, -0.28, 0.03, 0.1, 0.2, 0.09, "wall_navy")  # patrol car
    m.box(0.2, -0.36, 0.03, 0.09, 0.04, 0.07, "wall_white")
    m.windows(0, 0.1, 0.03, 0.6, 0.36, 0.3, 1, cols=5, sides="f", lit=0.4)
    m.tree(-0.4, 0.32, 0.9)
    m.tree(0.4, 0.32, 0.9, dark=True)


@building(25, "Museu Municipal")
def museu(m: Model):
    m.plot()
    m.box(0, 0.12, 0.03, 0.6, 0.36, 0.3, "wall_cream", roof="roof_flat")
    m.pyramid(0, 0.12, 0.33, 0.34, 0.24, 0.14, "glass_blue")  # glass crown
    # front pediment on 6 columns + stairs
    m.box(0, -0.12, 0.33, 0.44, 0.14, 0.05, "wall_cream")
    m.gable(0, -0.12, 0.38, 0.44, 0.14, 0.09, "roof_slate", end="wall_cream", ridge="x")
    for x in (-0.18, -0.108, -0.036, 0.036, 0.108, 0.18):
        _column(m, x, -0.17, 0.03, 0.3, w=0.04)
    m.box(0, -0.2, 0.03, 0.4, 0.12, 0.03, "concrete")
    m.box(0, -0.061, 0.03, 0.1, 0.01, 0.2, "wall_wood")  # door
    m.box(-0.26, -0.061, 0.1, 0.08, 0.01, 0.16, "sign_red")  # banners
    m.box(0.26, -0.061, 0.1, 0.08, 0.01, 0.16, "sign_red")
    m.windows(0, 0.12, 0.03, 0.6, 0.36, 0.3, 1, cols=5, sides="fbrl", lit=0.55)
    _back_door(m, 0.18, 0.3, 0.03, mat="wall_wood")
    _louver(m, -0.16, 0.303, 0.16)
    _rear_pipes(m, 0.3, -0.28, 0.28, 0.03, 0.3)
    _roof_parapet(m, 0, 0.12, 0.6, 0.36, 0.33, mat="wall_cream")
    m.tree(0.37, -0.28, 1.0)
    m.tree(-0.37, -0.28, 0.9, dark=True)


@building(26, "Clínica")
def clinica(m: Model):
    m.plot()
    m.box(0, 0.08, 0.03, 0.56, 0.36, 0.26, "wall_white", roof="roof_flat")
    m.box(-0.3, 0.08, 0.03, 0.12, 0.36, 0.28, "wall_wood")
    m.box(0.12, 0.2, 0.29, 0.2, 0.14, 0.12, "wall_grey")  # roof plant
    _cross(m, 0.12, -0.105, 0.2)  # facade cross
    m.awning(-0.1, -0.1, 0.2, 0.24, mat="sign_blue")  # blue entry canopy
    m.box(-0.1, -0.12, 0.03, 0.14, 0.02, 0.15, "glass_blue")
    # totem sign with mini cross
    m.box(-0.36, -0.2, 0.03, 0.06, 0.04, 0.2, "wall_white")
    _cross(m, -0.36, -0.225, 0.16, s=0.05)
    m.windows(0, 0.08, 0.03, 0.56, 0.36, 0.26, 1, cols=4, sides="fbrl", lit=0.6)
    _back_door(m, 0.18, 0.26, 0.03)
    _louver(m, -0.1, 0.263, 0.12)
    _rear_pipes(m, 0.26, -0.28, 0.26, 0.03, 0.25)
    _roof_parapet(m, 0, 0.08, 0.56, 0.36, 0.29)
    m.ac_unit(-0.12, 0.16, 0.32)
    m.tree(0.37, -0.28, 1.0)
    m.tree(-0.4, 0.3, 0.9, dark=True)


@building(27, "Hospital Geral")
def hospital(m: Model):
    m.plot(lawn=False)
    # central tower + two wings + glazed ER entry
    m.box(0, 0.14, 0.03, 0.3, 0.3, 0.52, "wall_white", roof="roof_flat")
    _cross(m, 0, -0.015, 0.42)
    m.box(-0.28, 0.1, 0.03, 0.26, 0.34, 0.24, "wall_white", roof="roof_flat")
    m.box(0.28, 0.1, 0.03, 0.26, 0.34, 0.24, "wall_white", roof="roof_flat")
    m.box(0, -0.16, 0.26, 0.34, 0.16, 0.03, "glass_blue")  # ER canopy
    _column(m, -0.14, -0.22, 0.03, 0.23, w=0.03)
    _column(m, 0.14, -0.22, 0.03, 0.23, w=0.03)
    _sign(m, 0, -0.015, 0.16, 0.2, h=0.04, mat="sign_red")  # HOSPITAL band
    m.box(-0.2, 0.14, 0.55, 0.1, 0.1, 0.1, "wall_grey")
    _amb(m, -0.12, -0.3)
    _amb(m, 0.02, -0.3)
    m.windows(0, 0.14, 0.03, 0.3, 0.3, 0.52, 3, cols=3, sides="fbrl", lit=0.5)
    m.windows(-0.28, 0.1, 0.03, 0.26, 0.34, 0.24, 1, cols=2, sides="fbl", lit=0.5)
    m.windows(0.28, 0.1, 0.03, 0.26, 0.34, 0.24, 1, cols=2, sides="fbr", lit=0.5)
    _back_door(m, 0.0, 0.29, 0.03)
    _louver(m, -0.18, 0.293, 0.13)
    _louver(m, 0.18, 0.293, 0.13)
    _rear_pipes(m, 0.29, -0.42, 0.42, 0.03, 0.24)
    _roof_parapet(m, 0, 0.14, 0.3, 0.3, 0.55)
    m.tree(0.38, 0.34, 0.9)
    m.tree(-0.38, 0.34, 0.9, dark=True)


@building(28, "Escola Primária")
def escola1(m: Model):
    m.plot()
    m.box(-0.05, 0.14, 0.03, 0.6, 0.3, 0.26, "wall_cream", roof="roof_flat")
    m.box(-0.3, 0.14, 0.03, 0.14, 0.3, 0.28, "wall_brick")
    m.box(0.2, 0.14, 0.03, 0.14, 0.3, 0.28, "wall_brick")
    m.awning(-0.05, -0.01, 0.2, 0.2, mat="sign_blue")  # ESCOLA canopy
    m.box(-0.05, -0.03, 0.03, 0.12, 0.02, 0.15, "glass_blue")
    m.windows(-0.05, 0.14, 0.03, 0.6, 0.3, 0.26, 1, cols=4, sides="fbrl", lit=0.55)
    _back_door(m, 0.17, 0.29, 0.03)
    _louver(m, -0.11, 0.293, 0.12)
    _rear_pipes(m, 0.29, -0.36, 0.24, 0.03, 0.26)
    _roof_parapet(m, -0.05, 0.14, 0.6, 0.3, 0.29)
    # playground: slide tower + slide + swing frame
    m.box(-0.3, -0.28, 0.03, 0.08, 0.08, 0.14, "sign_red")
    m._quad([(-0.26, -0.28, 0.14), (-0.22, -0.28, 0.14), (-0.14, -0.28, 0.035), (-0.18, -0.28, 0.035)], "sign_orange")
    m.box(0.05, -0.3, 0.03, 0.02, 0.02, 0.14, "metal_dark")
    m.box(0.21, -0.3, 0.03, 0.02, 0.02, 0.14, "metal_dark")
    m.box(0.13, -0.3, 0.17, 0.2, 0.02, 0.02, "metal_dark")
    _fence_run(m, 0, -0.4, 0.9, 0)
    m.tree(0.36, 0.32, 1.0)
    m.tree(-0.38, 0.32, 0.9, dark=True)


@building(29, "Escola Secundária")
def escola2(m: Model):
    m.plot(lawn=False)
    # three blocks around a courtyard + barrel-roof gym
    m.box(-0.26, 0.2, 0.03, 0.3, 0.3, 0.34, "wall_cream", roof="roof_flat")
    m.box(0.24, 0.2, 0.03, 0.3, 0.3, 0.34, "wall_cream", roof="roof_flat")
    m.box(0, 0.24, 0.03, 0.24, 0.2, 0.3, "glass_blue", roof="roof_flat")  # link
    m.box(-0.26, 0.2, 0.37, 0.32, 0.32, 0.03, "concrete")
    m.box(0.24, 0.2, 0.37, 0.32, 0.32, 0.03, "concrete")
    m.box(0.2, -0.22, 0.03, 0.34, 0.24, 0.22, "wall_brick")  # gym
    m.gable(0.2, -0.22, 0.25, 0.36, 0.26, 0.1, "roof_dark", end="wall_brick", ridge="x")
    m.box(-0.28, -0.2, 0.03, 0.2, 0.2, 0.16, "wall_cream", roof="roof_flat")
    # court: green slab + white edges
    m._quad([(-0.42, -0.02, 0.035), (-0.1, -0.02, 0.035), (-0.1, 0.12, 0.035), (-0.42, 0.12, 0.035)], "wall_green")
    m.windows(-0.26, 0.2, 0.03, 0.3, 0.3, 0.34, 2, cols=3, sides="fbl", lit=0.45)
    m.windows(0.24, 0.2, 0.03, 0.3, 0.3, 0.34, 2, cols=3, sides="fbr", lit=0.45)
    m.windows(0.2, -0.22, 0.03, 0.34, 0.24, 0.22, 1, cols=3, sides="fbr", lit=0.4)
    _back_door(m, -0.28, 0.35, 0.03)
    _back_door(m, 0.24, 0.35, 0.03)
    _louver(m, 0.0, 0.343, 0.15)
    _rear_pipes(m, 0.35, -0.41, 0.39, 0.03, 0.33)
    m.ac_unit(-0.12, 0.24, 0.4)
    m.tree(0.38, 0.36, 0.9)
    m.tree(-0.4, -0.32, 0.9, dark=True)


@building(30, "Quartel dos Bombeiros")
def bombeiros(m: Model):
    m.plot(lawn=False)
    m.box(0.08, 0.12, 0.03, 0.6, 0.4, 0.3, "wall_white", roof="roof_flat")
    m.box(0.08, -0.085, 0.05, 0.56, 0.03, 0.2, "wall_red")  # red bay facade
    _sign(m, 0.08, -0.105, 0.24, 0.4, h=0.04)
    for x in (-0.1, 0.08, 0.26):  # three open bays with engines
        m.box(x, -0.06, 0.03, 0.13, 0.06, 0.13, "glass_dark")
        m.box(x, -0.02, 0.05, 0.09, 0.12, 0.08, "sign_red")
    # training tower with lookout
    m.box(-0.32, 0.2, 0.03, 0.14, 0.16, 0.62, "wall_cream")
    m.box(-0.32, 0.2, 0.65, 0.18, 0.2, 0.05, "wall_red")
    m.box(-0.32, 0.2, 0.7, 0.16, 0.18, 0.1, "glass_dark")
    m.box(-0.32, 0.2, 0.8, 0.18, 0.2, 0.03, "wall_red")
    m.box(0.3, 0.12, 0.33, 0.12, 0.12, 0.06, "wall_grey")
    m.windows(0.08, 0.12, 0.03, 0.6, 0.4, 0.3, 1, cols=4, sides="r", lit=0.45)
    m.tree(0.38, -0.32, 0.9, dark=True)


@building(34, "Estação de Tratamento de Água")
def eta(m: Model):
    m.plot(lawn=False)
    _tank(m, -0.22, -0.12, 0.16)
    _tank(m, 0.02, -0.22, 0.13)
    m.box(0.14, 0.18, 0.03, 0.4, 0.3, 0.24, "wall_cream", roof="roof_flat")
    m.box(0.14, 0.18, 0.27, 0.12, 0.1, 0.06, "wall_grey")
    m.windows(0.14, 0.18, 0.08, 0.4, 0.3, 0.16, 1, cols=3, sides="brl", lit=0.45, slabs=False)
    _back_door(m, 0.02, 0.33, w=0.055, h=0.1)
    _downpipes(m, 0.14, 0.33, 0.03, 0.24, 0.4)
    m.ac_unit(0.26, 0.15, 0.27, 0.06, 0.045, 0.03)
    _roof_vent(m, 0.08, 0.24, 0.27)
    m.box(-0.3, 0.28, 0.03, 0.24, 0.12, 0.1, "glass_blue", roof="concrete")  # basins
    m.box(-0.3, 0.18, 0.04, 0.2, 0.018, 0.06, "metal_dark")
    # water tower: tank on 4 legs
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.box(0.32 + sx * 0.06, 0.3 + sy * 0.06, 0.03, 0.02, 0.02, 0.42, "metal_dark")
    m.cyl(0.32, 0.3, 0.45, 0.09, 0.14, "wall_white", seg=10)
    m.cone(0.32, 0.3, 0.59, 0.1, 0.06, "roof_slate", seg=10)
    m.cyl(-0.28, 0.1, 0.03, 0.05, 0.16, "wall_white", seg=8)  # dosing silo
    _fence_run(m, 0, -0.42, 0.9, 0)
    _fence_run(m, -0.44, 0, 0, 0.85)
    _fence_run(m, 0.44, 0, 0, 0.85)
    m.tree(-0.38, -0.34, 0.85)


@building(35, "Subestação Elétrica")
def subestacao(m: Model):
    m.plot(lawn=False)
    # control block in front, fenced technical yard behind
    m.box(-0.1, -0.28, 0.03, 0.5, 0.16, 0.18, "wall_grey", roof="roof_flat")
    m.awning(-0.1, -0.36, 0.15, 0.2, mat="sign_blue")
    m.windows(-0.1, -0.28, 0.03, 0.5, 0.16, 0.18, 1, cols=4, sides="fbrl", lit=0.5)
    _back_door(m, -0.28, -0.2, w=0.055, h=0.1)
    m.box(0.08, -0.197, 0.08, 0.13, 0.01, 0.05, "metal_dark")
    m.box(0.22, -0.28, 0.21, 0.08, 0.06, 0.035, "metal", roof="metal_dark")
    _xfmr(m, -0.2, 0.12)
    _xfmr(m, 0.05, 0.12)
    _xfmr(m, 0.28, 0.12)
    _pylon(m, -0.28, 0.3, h=0.6)
    _pylon(m, 0.2, 0.3, h=0.6)
    m.box(0.32, -0.28, 0.03, 0.1, 0.14, 0.1, "metal")  # cabinets
    _fence_run(m, 0, -0.05, 0.9, 0)
    _fence_run(m, -0.44, 0.15, 0, 0.6)
    _fence_run(m, 0.44, 0.15, 0, 0.6)
    _fence_run(m, 0, 0.42, 0.9, 0)
    m.tree(-0.38, -0.34, 0.85, dark=True)


@building(36, "Armazém Logístico")
def armazem(m: Model):
    m.plot(lawn=False)
    m.box(0.05, 0.16, 0.03, 0.7, 0.44, 0.3, "wall_white", roof="roof_blue")
    m.box(0.05, 0.16, 0.33, 0.72, 0.46, 0.03, "roof_blue")  # roof cap
    for x in (-0.15, 0.05, 0.25):  # skylights
        m.box(x, 0.16, 0.36, 0.08, 0.1, 0.02, "glass_blue")
    # dock band + doors on the front, office annex
    m.box(0.0, -0.065, 0.1, 0.6, 0.02, 0.12, "wall_blue")
    for x in (-0.2, 0.0, 0.2):
        m.box(x, -0.06, 0.03, 0.12, 0.03, 0.14, "metal_dark")
    m.box(0.32, -0.12, 0.03, 0.16, 0.24, 0.16, "wall_cream", roof="roof_flat")
    m.windows(0.32, -0.12, 0.03, 0.16, 0.24, 0.16, 1, cols=1, sides="fr", lit=0.5)
    _truck(m, -0.2, -0.28)
    _truck(m, 0.0, -0.28, body_mat="wall_cream", cab_mat="wall_red")
    m.tree(0.4, 0.34, 0.85)


@building(37, "Fábrica Leve")
def fabrica_leve(m: Model):
    m.plot(lawn=False)
    m.box(-0.05, 0.1, 0.03, 0.62, 0.5, 0.3, "wall_white", roof="roof_blue")
    m.box(-0.05, 0.1, 0.33, 0.64, 0.52, 0.03, "roof_blue")
    for x in (-0.2, 0.05):  # skylights
        m.box(x, 0.1, 0.36, 0.1, 0.12, 0.02, "glass_blue")
    # striped chimney + side silo + office porch
    m.cyl(0.28, 0.28, 0.03, 0.045, 0.55, "wall_white", seg=8)
    m.cyl(0.28, 0.28, 0.4, 0.042, 0.18, "sign_red", seg=8)
    m.cyl(-0.36, 0.28, 0.03, 0.07, 0.22, "metal", seg=8)
    m.box(-0.2, -0.24, 0.03, 0.24, 0.12, 0.14, "wall_grey", roof="roof_flat")
    m.box(-0.28, -0.2, 0.03, 0.14, 0.02, 0.12, "wall_navy")  # big door
    m.box(0.12, -0.2, 0.03, 0.1, 0.02, 0.18, "metal_dark")  # side door
    m.box(-0.36, -0.28, 0.03, 0.1, 0.1, 0.1, "wall_wood")  # crates
    m.windows(-0.05, 0.1, 0.03, 0.62, 0.5, 0.3, 1, cols=4, sides="r", lit=0.4)
    m.tree(-0.4, 0.36, 0.85, dark=True)


@building(38, "Fábrica Pesada")
def fabrica_pesada(m: Model):
    m.plot(lawn=False)
    m.box(-0.05, 0.0, 0.03, 0.44, 0.34, 0.3, "wall_brick", roof="roof_flat")
    m.box(-0.36, 0.05, 0.03, 0.16, 0.24, 0.24, "wall_grey", roof="roof_flat")
    # two striped chimneys
    for cx in (-0.28, 0.3):
        m.cyl(cx, 0.28, 0.03, 0.04, 0.6, "wall_white", seg=7)
        m.cyl(cx, 0.28, 0.45, 0.037, 0.18, "sign_red", seg=7)
    # silos + pipe rack
    m.cyl(-0.05, 0.3, 0.03, 0.08, 0.3, "metal", seg=8)
    m.cyl(0.13, 0.3, 0.03, 0.08, 0.3, "metal", seg=8)
    m.cyl(0.36, 0.02, 0.03, 0.09, 0.26, "metal", seg=8)
    for px in (-0.14, 0.04, 0.22):
        m.box(px, 0.22, 0.03, 0.025, 0.025, 0.34, "metal_dark")
    m.box(0.04, 0.22, 0.37, 0.4, 0.03, 0.025, "metal_dark")
    m.box(0.04, -0.16, 0.03, 0.2, 0.02, 0.16, "wall_navy")  # main door
    m.windows(-0.05, 0.0, 0.03, 0.44, 0.34, 0.3, 1, cols=4, sides="f", lit=0.45)
    m.tree(-0.4, -0.34, 0.85, dark=True)


@building(39, "Centro de Reciclagem")
def reciclagem(m: Model):
    m.plot(lawn=False)
    # green sorting hall + office + open canopy over conveyor
    m.box(-0.18, 0.16, 0.03, 0.4, 0.4, 0.32, "wall_green", roof="roof_flat")
    m.box(-0.18, 0.16, 0.35, 0.42, 0.42, 0.03, "concrete")
    m.box(-0.18, -0.045, 0.12, 0.2, 0.01, 0.12, "wall_white")  # recycle logo plate
    m.windows(-0.18, 0.16, 0.18, 0.4, 0.4, 0.12, 1, cols=3, sides="brl", lit=0.45, slabs=False)
    m.box(-0.28, 0.365, 0.03, 0.12, 0.012, 0.14, "metal_dark")
    _back_door(m, -0.1, 0.36, w=0.055, h=0.1)
    _downpipes(m, -0.18, 0.36, 0.03, 0.32, 0.4)
    m.ac_unit(-0.28, 0.1, 0.38, 0.06, 0.045, 0.03)
    m.box(0.3, -0.18, 0.03, 0.18, 0.3, 0.2, "wall_cream", roof="roof_flat")
    m.windows(0.3, -0.18, 0.06, 0.18, 0.3, 0.12, 1, cols=1, sides="br", lit=0.55, slabs=False)
    _back_door(m, 0.34, -0.03, w=0.05, h=0.1)
    m.box(0.18, 0.28, 0.2, 0.3, 0.2, 0.03, "metal")  # sorting canopy
    _column(m, 0.05, 0.2, 0.03, 0.17, w=0.03, mat="metal_dark")
    _column(m, 0.31, 0.2, 0.03, 0.17, w=0.03, mat="metal_dark")
    m._quad([(0.1, 0.2, 0.05), (0.26, 0.2, 0.2), (0.3, 0.2, 0.2), (0.14, 0.2, 0.05)], "metal_dark")  # conveyor
    # bins: green roll-offs + blue paper bin
    m.box(-0.28, -0.26, 0.03, 0.16, 0.1, 0.1, "sign_green")
    m.box(0.0, -0.26, 0.03, 0.16, 0.1, 0.1, "sign_green")
    m.box(0.3, -0.3, 0.03, 0.14, 0.08, 0.09, "sign_blue")
    m.box(-0.4, -0.1, 0.03, 0.08, 0.14, 0.09, "sign_blue")
    m.windows(-0.18, 0.16, 0.03, 0.4, 0.4, 0.32, 1, cols=3, sides="f", lit=0.45)
    _roof_vent(m, -0.05, 0.22, 0.38)
    _fence_run(m, 0, 0.44, 0.85, 0)
    m.tree(0.4, 0.34, 0.85)
