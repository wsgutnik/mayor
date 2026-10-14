"""V2 reference buildings, group v2b: commercial block #11-#19 with LODs."""

from lib import Model
from registry import building
from dress_v2_v2b import (
    awning_with_ribs,
    bollards,
    crate_stack,
    ground,
    lamp,
    loading_dock,
    parapet,
    parking,
    patio_table,
    planter,
    qf,
    roof_kit,
    side_projecting_sign,
    sign_band,
    simple_lod_ground,
    storefront,
    window_grid,
)


def _low_shop(m, wall, sign, awning, w=0.66, d=0.38, h=0.26, cx=0, cy=0.08, lod=0):
    if lod == 2:
        simple_lod_ground(m)
        m.box(cx, cy, 0.03, w, d, h, wall, roof="roof_flat")
        m.box(cx, cy, 0.03 + h, w + 0.04, d + 0.04, 0.045, "concrete")
        return
    ground(m, lawn=True)
    m.box(cx, cy, 0.03, w, d, h, wall, roof="roof_flat")
    m.box(cx, cy, 0.03 + h, w + 0.04, d + 0.04, 0.018, "slab")
    parapet(m, cx, cy, w + 0.04, d + 0.04, 0.048 + h)
    storefront(m, cx, cy - d / 2 - 0.005, 0.045, w - 0.08, 0.145, 5, door_x=cx + w * 0.23)
    awning_with_ribs(m, cx, cy - d / 2 - 0.003, 0.215, w - 0.05, awning, 5)
    sign_band(m, cx, cy - d / 2 - 0.006, 0.255, w * 0.58, 0.052, sign)
    if lod == 0:
        window_grid(m, cx, cy, 0.06, w, d, 1, 4, sides="brl")
        roof_kit(m, 0.03 + h + 0.08, 2)
        planter(m, -0.38, -0.15, flowers=True)
        planter(m, 0.38, -0.15)
        lamp(m, -0.42, -0.33)
        lamp(m, 0.42, -0.33)


def _convenience(m: Model, lod: int):
    _low_shop(m, "wall_white", "glow_sign", "sign_red", lod=lod)
    if lod == 0:
        parking(m, -0.315)
        m.parked_car(-0.27, -0.315, "sign_blue", "y")
        m.parked_car(0.24, -0.315, "sign_orange", "y")
        bollards(m, (-0.25, -0.12, 0.0, 0.26), -0.17)
        m.cyl(0.405, -0.115, 0.03, 0.012, 0.20, "metal", seg=5)
        m.box(0.405, -0.115, 0.235, 0.075, 0.014, 0.060, "glow_sign")
        m.box(0.31, 0.36, 0.03, 0.13, 0.08, 0.075, "metal_dark", roof="metal")
        crate_stack(m, -0.32, 0.35)
    elif lod == 1:
        parking(m, -0.315, (-0.28, 0.0, 0.28))
        m.parked_car(0.25, -0.315, "sign_orange", "y")


def _cafe(m: Model, lod: int):
    if lod == 2:
        simple_lod_ground(m)
        m.box(0, 0.10, 0.03, 0.62, 0.34, 0.25, "wall_brick", roof="roof_flat")
        m.box(0, 0.10, 0.28, 0.66, 0.38, 0.05, "concrete")
        m.box(-0.34, -0.25, 0.03, 0.04, 0.26, 0.05, "metal_dark")
        return
    ground(m)
    m.box(0, 0.10, 0.03, 0.62, 0.34, 0.25, "wall_brick", roof="roof_flat")
    m.box(0, 0.10, 0.28, 0.66, 0.38, 0.018, "slab")
    parapet(m, 0, 0.10, 0.66, 0.38, 0.298)
    storefront(m, 0, -0.078, 0.045, 0.50, 0.135, 4, door_x=0)
    awning_with_ribs(m, -0.13, -0.076, 0.205, 0.24, "roof_dark", 3)
    awning_with_ribs(m, 0.13, -0.076, 0.205, 0.24, "roof_dark", 3)
    sign_band(m, 0, -0.080, 0.245, 0.30, 0.050, "glow_sign")
    if lod == 0:
        window_grid(m, 0, 0.10, 0.06, 0.62, 0.34, 1, 4, sides="brl", lit=0.75)
        for x in (-0.24, 0.0, 0.24):
            patio_table(m, x, -0.255, "sign_red" if x else "wall_cream")
        m.fence(-0.37, -0.405, 0.37, -0.405, 0.045, "metal_dark", 7)
        m.fence(-0.37, -0.405, -0.37, -0.18, 0.045, "metal_dark", 4)
        m.fence(0.37, -0.405, 0.37, -0.18, 0.045, "metal_dark", 4)
        planter(m, -0.34, -0.16, flowers=True)
        planter(m, 0.34, -0.16, flowers=True)
        side_projecting_sign(m, 0.33, -0.03, 0.22)
        roof_kit(m, 0.36, 1)
        m.tree(-0.42, 0.34, 0.9)
    elif lod == 1:
        for x in (-0.22, 0.22):
            patio_table(m, x, -0.26)


def _market(m: Model, lod: int):
    _low_shop(m, "wall_white", "sign_green", "sign_green", w=0.70, d=0.36, h=0.25, lod=lod)
    if lod == 0:
        for i, x in enumerate((0.05, 0.15, 0.25)):
            crate_stack(m, x, -0.145)
            m.box(x, -0.145, 0.098, 0.052, 0.036, 0.012, "leaf_c" if i % 2 else "flower_red")
        loading_dock(m, -0.16, 0.285, 0.30)
        crate_stack(m, -0.25, 0.39)
        crate_stack(m, -0.07, 0.39)
        m.box(0.30, 0.22, 0.04, 0.20, 0.10, 0.08, "wall_white", roof="wall_white")
        m.box(0.37, 0.22, 0.055, 0.06, 0.09, 0.06, "glass_dark")
    elif lod == 1:
        loading_dock(m, -0.16, 0.285, 0.28)


def _restaurant(m: Model, lod: int):
    if lod == 2:
        simple_lod_ground(m)
        m.box(0, 0.08, 0.03, 0.58, 0.42, 0.42, "wall_wood", roof="roof_flat")
        m.box(0.16, -0.23, 0.03, 0.30, 0.18, 0.08, "wall_wood")
        return
    ground(m)
    m.box(0, 0.08, 0.03, 0.58, 0.42, 0.42, "wall_wood", roof="roof_flat")
    m.box(0, 0.08, 0.45, 0.62, 0.46, 0.018, "slab")
    parapet(m, 0, 0.08, 0.62, 0.46, 0.468)
    storefront(m, 0, -0.145, 0.055, 0.48, 0.17, 4, door_x=-0.07)
    awning_with_ribs(m, 0.13, -0.145, 0.290, 0.31, "sign_red", 4, depth=0.13)
    sign_band(m, 0.13, -0.152, 0.335, 0.26, 0.055, "black")
    if lod == 0:
        window_grid(m, 0, 0.08, 0.08, 0.58, 0.42, 2, 4, sides="brl", lit=0.8)
        m.box(-0.20, -0.245, 0.032, 0.26, 0.20, 0.025, "wall_wood", roof="wall_wood")
        m.awning(-0.20, -0.145, 0.310, 0.29, 0.20, "wall_wood")
        for x in (-0.30, -0.10):
            patio_table(m, x, -0.31, "wall_cream")
        m.box(0.16, 0.37, 0.032, 0.24, 0.13, 0.025, "wall_wood", roof="wall_wood")
        m.fence(0.04, 0.43, 0.28, 0.43, 0.07, "wall_wood", 4)
        roof_kit(m, 0.53, 2)
        planter(m, -0.36, -0.13)
        planter(m, 0.36, -0.13)
    elif lod == 1:
        m.box(-0.20, -0.245, 0.032, 0.24, 0.18, 0.025, "wall_wood", roof="wall_wood")


def _pharmacy(m: Model, lod: int):
    _low_shop(m, "wall_white", "sign_red", "sign_red", w=0.62, d=0.42, h=0.40, lod=lod)
    if lod < 2:
        m.box(0.27, 0.06, 0.03, 0.10, 0.42, 0.40, "wall_red", roof="wall_red")
    if lod == 0:
        m.box(-0.23, -0.178, 0.43, 0.105, 0.020, 0.105, "white")
        m.box(-0.23, -0.190, 0.456, 0.036, 0.012, 0.052, "sign_red")
        m.box(-0.23, -0.190, 0.435, 0.074, 0.012, 0.020, "sign_red")
        bollards(m, (-0.28, -0.14, 0.0, 0.14, 0.28), -0.19)
        roof_kit(m, 0.51, 2)


def _office(m: Model, lod: int):
    if lod == 2:
        simple_lod_ground(m)
        m.box(0, 0.06, 0.03, 0.52, 0.39, 0.78, "wall_grey", roof="roof_flat")
        m.box(0, -0.16, 0.03, 0.28, 0.10, 0.14, "wall_white")
        return
    ground(m, lawn=True)
    m.box(0, 0.06, 0.03, 0.52, 0.39, 0.78, "wall_grey", roof="roof_flat")
    m.box(-0.21, 0.06, 0.03, 0.085, 0.39, 0.78, "wall_beige", roof="wall_beige")
    m.glass_band(0.03, 0.06, 0.05, 0.30, 0.39, 0.72, "glass_blue")
    m.box(0, -0.16, 0.03, 0.28, 0.10, 0.14, "wall_white", roof="roof_flat")
    storefront(m, 0, -0.214, 0.045, 0.22, 0.125, 3, door_x=0)
    parapet(m, 0, 0.06, 0.56, 0.43, 0.81)
    if lod == 0:
        window_grid(m, 0, 0.06, 0.05, 0.52, 0.39, 5, 4, sides="fbrl", lit=0.65)
        for z in (0.25, 0.48, 0.71):
            m.box(0, -0.147, z, 0.54, 0.018, 0.012, "slab")
        m.box(0.14, 0.06, 0.86, 0.18, 0.15, 0.10, "wall_grey", roof="roof_dark")
        roof_kit(m, 0.86, 2)
        lamp(m, -0.38, -0.30)
        lamp(m, 0.38, -0.30)
    elif lod == 1:
        window_grid(m, 0, 0.06, 0.08, 0.52, 0.39, 3, 3, sides="fb", lit=0.55)
        m.box(0.14, 0.06, 0.86, 0.18, 0.15, 0.10, "wall_grey", roof="roof_dark")


def _bank(m: Model, lod: int):
    if lod == 2:
        simple_lod_ground(m)
        m.box(0, 0.07, 0.03, 0.66, 0.44, 0.47, "wall_white", roof="roof_flat")
        m.box(0, -0.20, 0.03, 0.34, 0.12, 0.36, "wall_white")
        return
    ground(m, lawn=True)
    m.box(0, 0.07, 0.03, 0.66, 0.44, 0.47, "wall_white", roof="roof_flat")
    parapet(m, 0, 0.07, 0.70, 0.48, 0.50)
    window_grid(m, 0, 0.07, 0.065, 0.66, 0.44, 2, 4, sides="fbrl", lit=0.45)
    m.box(0, -0.19, 0.03, 0.32, 0.11, 0.35, "wall_white", roof="concrete")
    if lod == 0:
        for x in (-0.12, -0.04, 0.04, 0.12):
            m.cyl(x, -0.235, 0.03, 0.018, 0.31, "concrete", seg=8)
        m.box(0, -0.245, 0.03, 0.25, 0.052, 0.018, "concrete", roof="concrete")
        m.door(0, -0.238, 0.035, 0.085, 0.14, "glass_dark")
        sign_band(m, 0, -0.240, 0.350, 0.25, 0.05, "glow_sign")
        m.box(0.18, 0.35, 0.03, 0.16, 0.11, 0.20, "wall_grey", roof="roof_dark")
        m.box(0.18, 0.292, 0.08, 0.10, 0.012, 0.10, "metal_dark")
        roof_kit(m, 0.57, 2)
        planter(m, -0.35, -0.16)
        planter(m, 0.35, -0.16)
    elif lod == 1:
        for x in (-0.10, 0.0, 0.10):
            m.box(x, -0.235, 0.03, 0.025, 0.025, 0.31, "concrete")


def _hotel(m: Model, lod: int):
    if lod == 2:
        simple_lod_ground(m)
        m.box(0, 0.08, 0.03, 0.65, 0.43, 0.98, "wall_grey", roof="roof_flat")
        m.box(0, -0.17, 0.03, 0.42, 0.12, 0.20, "wall_white")
        return
    ground(m)
    m.box(0, 0.08, 0.03, 0.65, 0.43, 0.92, "wall_grey", roof="roof_flat")
    m.box(0, 0.08, 0.03, 0.12, 0.43, 0.92, "wall_wood")
    window_grid(m, 0, 0.08, 0.07, 0.65, 0.43, 5, 5, sides="fbrl", lit=0.70)
    for z in (0.25, 0.46, 0.67, 0.88):
        m.box(0, -0.145, z, 0.67, 0.018, 0.012, "slab")
    m.box(0, -0.17, 0.03, 0.42, 0.12, 0.20, "wall_white", roof="roof_flat")
    storefront(m, 0, -0.235, 0.045, 0.34, 0.14, 3, door_x=0)
    parapet(m, 0, 0.08, 0.69, 0.47, 0.95)
    m.box(0, 0.08, 1.02, 0.30, 0.04, 0.10, "glow_sign", roof="glow_sign")
    m.box(-0.12, 0.08, 0.95, 0.02, 0.02, 0.07, "metal_dark")
    m.box(0.12, 0.08, 0.95, 0.02, 0.02, 0.07, "metal_dark")
    if lod == 0:
        sign_band(m, 0, -0.145, 0.73, 0.18, 0.18, "glow_sign")
        m.box(0, 0.345, 0.16, 0.24, 0.09, 0.02, "concrete", roof="concrete")
        roof_kit(m, 0.96, 3)
        bollards(m, (-0.26, -0.13, 0.13, 0.26), -0.245)
        m.parked_car(-0.33, -0.33, "white", "y")


def _mall(m: Model, lod: int):
    if lod == 2:
        simple_lod_ground(m)
        m.box(0, 0.08, 0.03, 0.82, 0.53, 0.38, "wall_white", roof="roof_flat")
        m.box(0, -0.23, 0.03, 0.40, 0.12, 0.07, "paving")
        return
    ground(m)
    m.box(0, 0.08, 0.03, 0.82, 0.53, 0.38, "wall_white", roof="roof_flat")
    m.box(0, 0.08, 0.41, 0.86, 0.57, 0.018, "slab")
    parapet(m, 0, 0.08, 0.86, 0.57, 0.428)
    storefront(m, 0, -0.197, 0.055, 0.76, 0.155, 6, door_x=0)
    sign_band(m, 0, -0.200, 0.285, 0.30, 0.06, "sign_blue")
    sign_band(m, -0.29, -0.200, 0.235, 0.17, 0.045, "sign_red")
    sign_band(m, 0.29, -0.200, 0.235, 0.17, 0.045, "sign_orange")
    parking(m, -0.34, (-0.38, -0.19, 0.0, 0.19, 0.38))
    if lod == 0:
        window_grid(m, 0, 0.08, 0.065, 0.82, 0.53, 1, 7, sides="brl", lit=0.75)
        loading_dock(m, -0.20, 0.350, 0.34)
        crate_stack(m, -0.37, 0.40)
        m.door(0.28, 0.350, 0.04, 0.07, 0.13, "metal_dark")
        bollards(m, (-0.38, -0.26, -0.14, 0.14, 0.26, 0.38), -0.205)
        roof_kit(m, 0.49, 3)
        m.parked_car(-0.30, -0.34, "sign_blue", "y")
        m.parked_car(0.30, -0.34, "white", "y")
    elif lod == 1:
        loading_dock(m, -0.20, 0.350, 0.30)


BUILDERS = {
    11: ("Loja de Conveniência", _convenience),
    12: ("Café de Esquina", _cafe),
    13: ("Mercado Local", _market),
    14: ("Restaurante Urbano", _restaurant),
    15: ("Farmácia de Bairro", _pharmacy),
    16: ("Escritório Compacto", _office),
    17: ("Banco Local", _bank),
    18: ("Hotel Executivo", _hotel),
    19: ("Shopping de Bairro", _mall),
}


def _register(n, name, fn):
    @building(n, name, variant="v2", version=1)
    def lod0(m: Model, _fn=fn):
        _fn(m, 0)

    @building(n, name, variant="v2_lod1", version=1)
    def lod1(m: Model, _fn=fn):
        _fn(m, 1)

    @building(n, name, variant="v2_lod2", version=1)
    def lod2(m: Model, _fn=fn):
        _fn(m, 2)

    globals()[f"building_{n:02d}_v2"] = lod0
    globals()[f"building_{n:02d}_v2_lod1"] = lod1
    globals()[f"building_{n:02d}_v2_lod2"] = lod2


for _n, (_name, _fn) in BUILDERS.items():
    _register(_n, _name, _fn)
