"""V2 reference buildings, group v2a: #02 through #09 residential/mixed use."""

from lib import Model
from registry import building
from dress_v2_v2a import (
    balcony,
    cornice,
    entry_canopy,
    framed_window,
    lamp,
    parapet,
    planter,
    roof_gear,
    shopfront,
)


def _front_lot(m, lawn=True):
    m.box(0, 0, 0, 0.96, 0.96, 0.03, "paving", roof="paving")
    m.box(0, -0.455, 0.03, 0.96, 0.05, 0.006, "concrete", roof="concrete")
    if lawn:
        m.box(-0.33, -0.26, 0.03, 0.23, 0.30, 0.005, "grass", roof="grass")
        m.box(0.33, -0.26, 0.03, 0.23, 0.30, 0.005, "grass", roof="grass")


def _gable_cap(m, cx, cy, z, length, axis="y"):
    if axis == "y":
        m.box(cx, cy, z, 0.030, length, 0.012, "roof_dark", roof="roof_dark")
    else:
        m.box(cx, cy, z, length, 0.030, 0.012, "roof_dark", roof="roof_dark")


def _family_house(m: Model, lod: int):
    full = lod == 0
    _front_lot(m)
    if lod < 2:
        m.box(0.30, -0.25, 0.033, 0.20, 0.42, 0.008, "concrete", roof="concrete")
        m.box(-0.06, -0.31, 0.034, 0.12, 0.20, 0.006, "paving", roof="paving")
    m.box(-0.08, 0.08, 0.03, 0.52, 0.44, 0.07, "concrete")
    m.box(-0.08, 0.08, 0.10, 0.50, 0.42, 0.25, "wall_cream")
    m.box(0.29, 0.10, 0.03, 0.24, 0.34, 0.06, "concrete")
    m.box(0.29, 0.10, 0.09, 0.23, 0.32, 0.17, "wall_beige")
    if lod < 2:
        cornice(m, -0.08, 0.08, 0.53, 0.45, 0.345, "white", h=0.014)
        cornice(m, 0.29, 0.10, 0.25, 0.35, 0.255, "white", h=0.012)
    m.hip(-0.08, 0.08, 0.35, 0.60, 0.52, 0.20, "roof_red")
    m.gable(0.29, 0.10, 0.26, 0.31, 0.42, 0.14, "roof_slate", end="wall_beige")
    if full:
        _gable_cap(m, 0.29, 0.10, 0.40, 0.37)
        m.box(-0.17, 0.16, 0.45, 0.046, 0.046, 0.14, "wall_brick")
        m.box(-0.17, 0.16, 0.59, 0.062, 0.062, 0.012, "concrete")
        for x in (-0.24, 0.08):
            framed_window(m, x, -0.13, 0.225, side="f", pane="glow_window")
        framed_window(m, -0.30, 0.08, 0.225, side="l", pane="glass_dark")
        m.door(-0.06, -0.13, 0.08, 0.07, 0.13, "wall_wood")
        entry_canopy(m, -0.06, -0.15, 0.255, 0.19, "roof_slate")
        m.steps(-0.06, -0.20, 0.03, 0.18, n=2)
        m.box(0.29, -0.06, 0.10, 0.17, 0.010, 0.12, "white")
        m.box(0.29, -0.068, 0.105, 0.15, 0.006, 0.11, "wall_grey")
        for z in (0.13, 0.16, 0.19):
            m.box(0.29, -0.072, z, 0.15, 0.004, 0.006, "slab")
        planter(m, -0.31, -0.38)
        planter(m, 0.12, -0.38)
        lamp(m, -0.42, -0.41)
        m.tree(0.40, 0.38, 0.85)
    elif lod == 1:
        m.windows(-0.08, 0.08, 0.10, 0.50, 0.42, 0.25, 1, cols=3, sides="f", lit=0.6, slabs=False)
        m.door(-0.06, -0.13, 0.08, 0.07, 0.13, "wall_wood")
    else:
        m.box(-0.06, -0.13, 0.08, 0.08, 0.01, 0.13, "wall_wood")


def _townhouse(m: Model, lod: int):
    full = lod == 0
    _front_lot(m, lawn=False)
    if lod < 2:
        m.box(-0.32, -0.02, 0.03, 0.12, 0.72, 0.005, "grass", roof="grass")
        m.box(0.31, -0.18, 0.033, 0.16, 0.48, 0.008, "concrete", roof="concrete")
    m.box(0.00, 0.08, 0.03, 0.42, 0.54, 0.86, "wall_white", roof="roof_flat")
    m.box(-0.15, -0.02, 0.03, 0.13, 0.48, 0.78, "wall_navy", roof="roof_flat")
    m.box(0.16, 0.08, 0.03, 0.09, 0.54, 0.92, "wall_wood", roof="roof_flat")
    if lod < 2:
        parapet(m, 0, 0.08, 0.89, 0.43, 0.55, "concrete", h=0.045)
        m.box(0, -0.20, 0.33, 0.46, 0.025, 0.025, "concrete")
        m.box(0, -0.20, 0.61, 0.46, 0.025, 0.025, "concrete")
    if full:
        for z in (0.20, 0.48, 0.75):
            framed_window(m, 0.02, -0.19, z, w=0.12, h=0.13, side="f", frame="wall_grey")
            framed_window(m, 0.16, -0.19, z, w=0.055, h=0.13, side="f", frame="white")
        m.door(-0.15, -0.21, 0.07, 0.07, 0.15, "wall_red")
        entry_canopy(m, -0.15, -0.22, 0.28, 0.18, "metal_dark")
        balcony(m, 0.02, -0.19, 0.60, 0.22)
        m.box(-0.15, -0.245, 0.23, 0.12, 0.018, 0.035, "glow_sign")
        roof_gear(m, 0.935, dense=True)
        planter(m, -0.34, -0.36)
        lamp(m, 0.39, -0.40)
    elif lod == 1:
        m.windows(0, 0.08, 0.08, 0.40, 0.52, 0.78, 3, cols=3, sides="f", lit=0.6, slabs=False)
        balcony(m, 0.02, -0.19, 0.60, 0.22)
    else:
        m.box(0.0, -0.195, 0.18, 0.25, 0.008, 0.55, "glass_dark")


def _semi_villa(m: Model, lod: int):
    full = lod == 0
    _front_lot(m)
    for sx, wall, roof in ((-1, "wall_beige", "roof_slate"), (1, "wall_cream", "roof_red")):
        cx = sx * 0.13
        m.box(cx, 0.08, 0.03, 0.25, 0.44, 0.07, "concrete")
        m.box(cx, 0.08, 0.10, 0.24, 0.42, 0.30, wall)
        m.gable(cx, 0.08, 0.40, 0.28, 0.50, 0.18, roof, end=wall)
        if lod < 2:
            m.box(cx, -0.17, 0.30, 0.16, 0.10, 0.11, wall)
            m.gable(cx, -0.17, 0.41, 0.18, 0.14, 0.08, roof, end=wall, ridge="x")
        if full:
            _gable_cap(m, cx, 0.08, 0.58, 0.42)
            framed_window(m, cx, -0.13, 0.24, w=0.08, h=0.11, side="f", frame="white")
            framed_window(m, cx + sx * 0.065, -0.21, 0.35, w=0.055, h=0.06, side="f", frame="white")
            m.door(cx - sx * 0.055, -0.13, 0.08, 0.055, 0.13, "wall_wood")
            m.steps(cx - sx * 0.055, -0.19, 0.03, 0.12, n=2)
            framed_window(m, cx + sx * 0.125, 0.08, 0.25, w=0.07, side="r" if sx > 0 else "l", frame="white")
    m.box(0, 0.08, 0.10, 0.018, 0.42, 0.31, "white")
    if full:
        m.fence(-0.46, -0.40, -0.46, 0.36, posts=5)
        m.fence(0.46, -0.40, 0.46, 0.36, posts=5)
        m.fence(0.0, -0.38, 0.0, 0.36, posts=5)
        planter(m, -0.30, -0.36)
        planter(m, 0.30, -0.36)
        lamp(m, 0.0, -0.42)
    elif lod == 1:
        m.windows(-0.13, 0.08, 0.10, 0.24, 0.42, 0.30, 1, cols=2, sides="f", slabs=False)
        m.windows(0.13, 0.08, 0.10, 0.24, 0.42, 0.30, 1, cols=2, sides="f", slabs=False)


def _small_apartment(m: Model, lod: int):
    full = lod == 0
    _front_lot(m, lawn=False)
    m.box(0, 0.08, 0.03, 0.54, 0.48, 0.10, "concrete")
    m.box(0, 0.08, 0.13, 0.52, 0.46, 0.74, "wall_brick", roof="roof_flat")
    if lod < 2:
        cornice(m, 0, 0.08, 0.54, 0.48, 0.87, "white", h=0.028)
        m.box(0, -0.17, 0.13, 0.18, 0.035, 0.70, "wall_cream")
    if full:
        for fl, z in enumerate((0.25, 0.43, 0.61, 0.79)):
            for x in (-0.17, 0.17):
                framed_window(m, x, -0.15, z, w=0.08, h=0.095, side="f", frame="white")
            balcony(m, 0.0, -0.15, z - 0.065, 0.16, depth=0.06)
            framed_window(m, -0.27, 0.08, z, side="l", frame="white", pane="glass_dark")
            framed_window(m, 0.27, 0.08, z, side="r", frame="white", pane="glass_dark")
        m.door(0, -0.165, 0.08, 0.075, 0.15, "glass_dark")
        entry_canopy(m, 0, -0.18, 0.29, 0.22, "metal_dark")
        parapet(m, 0, 0.08, 0.89, 0.52, 0.46, "concrete")
        roof_gear(m, 0.935)
        planter(m, -0.36, -0.38)
        planter(m, 0.36, -0.38)
        lamp(m, -0.43, -0.41)
    elif lod == 1:
        m.windows(0, 0.08, 0.13, 0.52, 0.46, 0.74, 4, cols=4, sides="f", lit=0.55, slabs=False)
        for z in (0.185, 0.365, 0.545):
            balcony(m, 0.0, -0.15, z, 0.16)
    else:
        m.box(0, -0.155, 0.22, 0.40, 0.008, 0.55, "glass_dark")


def _garden_condo(m: Model, lod: int):
    full = lod == 0
    _front_lot(m)
    m.box(-0.16, 0.10, 0.03, 0.30, 0.42, 0.68, "wall_white", roof="roof_flat")
    m.box(0.17, 0.12, 0.03, 0.30, 0.38, 0.56, "wall_beige", roof="roof_flat")
    m.box(0.0, 0.06, 0.03, 0.18, 0.30, 0.50, "wall_grey", roof="roof_flat")
    if lod < 2:
        parapet(m, -0.16, 0.10, 0.71, 0.30, 0.42, "concrete")
        parapet(m, 0.17, 0.12, 0.59, 0.30, 0.38, "concrete")
        m.box(0.0, -0.28, 0.033, 0.16, 0.25, 0.008, "concrete", roof="concrete")
    if full:
        for cx, y, floors in ((-0.16, -0.11, 3), (0.17, -0.07, 2)):
            for i in range(floors):
                z = 0.20 + i * 0.17
                framed_window(m, cx - 0.07, y, z, side="f", frame="white")
                framed_window(m, cx + 0.07, y, z, side="f", frame="white")
                balcony(m, cx, y, z - 0.065, 0.19)
        m.door(0.0, -0.09, 0.07, 0.07, 0.14, "glass_dark")
        entry_canopy(m, 0.0, -0.115, 0.26, 0.22, "roof_green")
        m.box(-0.36, 0.34, 0.03, 0.20, 0.12, 0.02, "grass", roof="grass")
        m.box(0.34, 0.34, 0.03, 0.18, 0.12, 0.02, "grass", roof="grass")
        m.tree(-0.37, 0.36, 0.9)
        m.tree(0.36, 0.34, 0.8, dark=True)
        planter(m, -0.30, -0.38)
        planter(m, 0.30, -0.38)
        lamp(m, 0.42, -0.40)
        roof_gear(m, 0.755, dense=False)
    elif lod == 1:
        m.windows(-0.16, 0.10, 0.08, 0.30, 0.42, 0.60, 3, cols=2, sides="f", slabs=False)
        m.windows(0.17, 0.12, 0.08, 0.30, 0.38, 0.48, 2, cols=2, sides="f", slabs=False)
        balcony(m, -0.16, -0.11, 0.30, 0.19)
        balcony(m, 0.17, -0.07, 0.30, 0.19)


def _compact_tower(m: Model, lod: int):
    full = lod == 0
    _front_lot(m, lawn=False)
    m.box(0, 0.05, 0.03, 0.62, 0.50, 0.25, "wall_grey", roof="roof_flat")
    m.box(0.02, 0.08, 0.28, 0.38, 0.34, 1.32, "wall_white", roof="roof_flat")
    m.box(-0.19, 0.08, 0.28, 0.08, 0.34, 1.38, "wall_navy", roof="roof_flat")
    if lod < 2:
        m.box(0, -0.23, 0.22, 0.40, 0.16, 0.025, "metal_dark")
        parapet(m, 0.02, 0.08, 1.60, 0.38, 0.34, "concrete", h=0.05)
    if full:
        m.windows(0, 0.05, 0.06, 0.62, 0.50, 0.20, 1, cols=6, sides="fr", lit=0.65, slabs=False)
        for i in range(8):
            z = 0.39 + i * 0.145
            framed_window(m, -0.07, -0.09, z, w=0.075, h=0.095, side="f", frame="wall_grey")
            framed_window(m, 0.10, -0.09, z, w=0.075, h=0.095, side="f", frame="wall_grey")
            if i % 2 == 0:
                balcony(m, 0.10, -0.09, z - 0.065, 0.18, depth=0.055)
            framed_window(m, 0.21, 0.08, z, w=0.065, h=0.09, side="r", frame="wall_grey")
        m.door(0, -0.205, 0.06, 0.09, 0.15, "glass_dark")
        m.sign(0, -0.245, 0.23, 0.25, 0.04, "glow_sign")
        m.cyl(0.13, 0.14, 1.65, 0.055, 0.12, "white", seg=8)
        m.cone(0.13, 0.14, 1.77, 0.06, 0.035, "roof_dark", seg=8)
        roof_gear(m, 1.65)
        lamp(m, -0.35, -0.39)
        lamp(m, 0.35, -0.39)
    elif lod == 1:
        m.windows(0.02, 0.08, 0.30, 0.38, 0.34, 1.25, 8, cols=3, sides="f", lit=0.55, slabs=False)
        for z in (0.47, 0.76, 1.05, 1.34):
            balcony(m, 0.10, -0.09, z, 0.18, depth=0.055)
        m.cyl(0.13, 0.14, 1.65, 0.055, 0.12, "white", seg=8)
    else:
        m.box(0.02, -0.095, 0.36, 0.25, 0.008, 1.10, "glass_dark")


def _balcony_residence(m: Model, lod: int):
    full = lod == 0
    _front_lot(m)
    m.box(0, 0.08, 0.03, 0.58, 0.46, 0.78, "wall_cream", roof="roof_flat")
    m.box(0.22, 0.08, 0.03, 0.10, 0.46, 0.86, "wall_brick", roof="roof_flat")
    if lod < 2:
        parapet(m, 0, 0.08, 0.81, 0.58, 0.46, "concrete")
        m.box(-0.12, -0.17, 0.03, 0.30, 0.035, 0.75, "wall_white")
    if full:
        for i, z in enumerate((0.20, 0.38, 0.56, 0.74)):
            balcony(m, -0.13, -0.15, z - 0.065, 0.24, depth=0.075)
            framed_window(m, -0.13, -0.15, z, w=0.12, h=0.10, side="f", frame="white")
            framed_window(m, 0.10, -0.15, z, w=0.07, h=0.10, side="f", frame="white")
            framed_window(m, -0.29, 0.08, z, w=0.065, side="l", frame="white")
            if i < 3:
                m.box(-0.04, -0.22, z - 0.045, 0.05, 0.035, 0.025, "hedge", roof="hedge")
        m.door(0.10, -0.15, 0.07, 0.07, 0.14, "wall_wood")
        entry_canopy(m, 0.10, -0.17, 0.26, 0.18, "roof_slate")
        roof_gear(m, 0.855)
        m.tree(-0.38, 0.35, 0.85)
        planter(m, -0.34, -0.37)
        lamp(m, 0.39, -0.40)
    elif lod == 1:
        m.windows(0, 0.08, 0.08, 0.58, 0.46, 0.70, 4, cols=4, sides="f", slabs=False)
        for z in (0.135, 0.315, 0.495, 0.675):
            balcony(m, -0.13, -0.15, z, 0.24)
    else:
        m.box(-0.13, -0.155, 0.17, 0.26, 0.008, 0.55, "glass_blue")


def _mixed_use(m: Model, lod: int):
    full = lod == 0
    _front_lot(m, lawn=False)
    m.box(0, 0.07, 0.03, 0.62, 0.48, 0.23, "wall_grey", roof="roof_flat")
    m.box(0, 0.08, 0.26, 0.56, 0.44, 0.58, "wall_brick", roof="roof_flat")
    if lod < 2:
        m.box(0, 0.08, 0.245, 0.64, 0.50, 0.035, "concrete", roof="concrete")
        cornice(m, 0, 0.08, 0.56, 0.44, 0.84, "white", h=0.024)
    if full:
        shopfront(m, -0.17, -0.17, 0.055, 0.25, name_mat="glow_sign", awning="sign_orange")
        shopfront(m, 0.17, -0.17, 0.055, 0.25, name_mat="sign_blue", awning="sign_green")
        m.box(-0.39, -0.30, 0.033, 0.10, 0.12, 0.006, "asphalt", roof="asphalt")
        m.box(-0.39, -0.30, 0.04, 0.06, 0.05, 0.045, "sign_red", roof="sign_red")
        m.box(0.39, -0.31, 0.04, 0.08, 0.04, 0.035, "wall_wood", roof="wall_wood")
        for z in (0.39, 0.57, 0.75):
            for x in (-0.18, 0.0, 0.18):
                framed_window(m, x, -0.14, z, w=0.07, h=0.095, side="f", frame="white")
            framed_window(m, -0.28, 0.08, z, side="l", frame="white", pane="glass_dark")
            framed_window(m, 0.28, 0.08, z, side="r", frame="white", pane="glass_dark")
        balcony(m, 0.0, -0.14, 0.505, 0.20, depth=0.055)
        m.door(0.29, -0.17, 0.055, 0.055, 0.13, "wall_wood")
        m.steps(0.29, -0.22, 0.03, 0.11, n=2)
        parapet(m, 0, 0.08, 0.865, 0.56, 0.44, "concrete")
        roof_gear(m, 0.91)
        lamp(m, -0.45, -0.41)
        lamp(m, 0.45, -0.41)
    elif lod == 1:
        m.windows(0, 0.08, 0.29, 0.56, 0.44, 0.50, 3, cols=5, sides="f", slabs=False)
        m.sign(-0.17, -0.18, 0.24, 0.25, 0.04, "glow_sign")
        m.sign(0.17, -0.18, 0.24, 0.25, 0.04, "sign_blue")
    else:
        m.box(0, -0.175, 0.07, 0.48, 0.010, 0.12, "glass_blue")
        m.box(0, -0.145, 0.36, 0.44, 0.008, 0.38, "glass_dark")


BUILDERS = {
    2: ("Casa Familiar", _family_house),
    3: ("Sobrado Moderno", _townhouse),
    4: ("Vila Geminada", _semi_villa),
    5: ("Pequeno Apartamento", _small_apartment),
    6: ("Condomínio Jardim", _garden_condo),
    7: ("Torre Compacta", _compact_tower),
    8: ("Residencial Varanda", _balcony_residence),
    9: ("Edifício Misto Local", _mixed_use),
}


@building(2, "Casa Familiar", variant="v2", version=1)
def family_house_v2(m: Model):
    _family_house(m, 0)


@building(2, "Casa Familiar", variant="v2_lod1", version=1)
def family_house_v2_lod1(m: Model):
    _family_house(m, 1)


@building(2, "Casa Familiar", variant="v2_lod2", version=1)
def family_house_v2_lod2(m: Model):
    _family_house(m, 2)


@building(3, "Sobrado Moderno", variant="v2", version=1)
def townhouse_v2(m: Model):
    _townhouse(m, 0)


@building(3, "Sobrado Moderno", variant="v2_lod1", version=1)
def townhouse_v2_lod1(m: Model):
    _townhouse(m, 1)


@building(3, "Sobrado Moderno", variant="v2_lod2", version=1)
def townhouse_v2_lod2(m: Model):
    _townhouse(m, 2)


@building(4, "Vila Geminada", variant="v2", version=1)
def semi_villa_v2(m: Model):
    _semi_villa(m, 0)


@building(4, "Vila Geminada", variant="v2_lod1", version=1)
def semi_villa_v2_lod1(m: Model):
    _semi_villa(m, 1)


@building(4, "Vila Geminada", variant="v2_lod2", version=1)
def semi_villa_v2_lod2(m: Model):
    _semi_villa(m, 2)


@building(5, "Pequeno Apartamento", variant="v2", version=1)
def small_apartment_v2(m: Model):
    _small_apartment(m, 0)


@building(5, "Pequeno Apartamento", variant="v2_lod1", version=1)
def small_apartment_v2_lod1(m: Model):
    _small_apartment(m, 1)


@building(5, "Pequeno Apartamento", variant="v2_lod2", version=1)
def small_apartment_v2_lod2(m: Model):
    _small_apartment(m, 2)


@building(6, "Condomínio Jardim", variant="v2", version=1)
def garden_condo_v2(m: Model):
    _garden_condo(m, 0)


@building(6, "Condomínio Jardim", variant="v2_lod1", version=1)
def garden_condo_v2_lod1(m: Model):
    _garden_condo(m, 1)


@building(6, "Condomínio Jardim", variant="v2_lod2", version=1)
def garden_condo_v2_lod2(m: Model):
    _garden_condo(m, 2)


@building(7, "Torre Compacta", variant="v2", version=1)
def compact_tower_v2(m: Model):
    _compact_tower(m, 0)


@building(7, "Torre Compacta", variant="v2_lod1", version=1)
def compact_tower_v2_lod1(m: Model):
    _compact_tower(m, 1)


@building(7, "Torre Compacta", variant="v2_lod2", version=1)
def compact_tower_v2_lod2(m: Model):
    _compact_tower(m, 2)


@building(8, "Residencial Varanda", variant="v2", version=1)
def balcony_residence_v2(m: Model):
    _balcony_residence(m, 0)


@building(8, "Residencial Varanda", variant="v2_lod1", version=1)
def balcony_residence_v2_lod1(m: Model):
    _balcony_residence(m, 1)


@building(8, "Residencial Varanda", variant="v2_lod2", version=1)
def balcony_residence_v2_lod2(m: Model):
    _balcony_residence(m, 2)


@building(9, "Edifício Misto Local", variant="v2", version=1)
def mixed_use_v2(m: Model):
    _mixed_use(m, 0)


@building(9, "Edifício Misto Local", variant="v2_lod1", version=1)
def mixed_use_v2_lod1(m: Model):
    _mixed_use(m, 1)


@building(9, "Edifício Misto Local", variant="v2_lod2", version=1)
def mixed_use_v2_lod2(m: Model):
    _mixed_use(m, 2)
