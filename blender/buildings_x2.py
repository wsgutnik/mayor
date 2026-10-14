"""2x2 service-building variants."""
from lib import Model
from registry import building
from dress_x2 import (
    ambulance, coal_pile, column, cooling_tower, court, cross, curb, fence_rect, flagpole, fountain,
    helipad, parked_row, pipe, rail_pair, slab, stripe, tank,
)


def _parapet(m: Model, cx, cy, w, d, z, mat="slab"):
    m.box(cx, cy - d / 2, z, w, 0.02, 0.035, mat)
    m.box(cx, cy + d / 2, z, w, 0.02, 0.035, mat)
    m.box(cx - w / 2, cy, z, 0.02, d, 0.035, mat)
    m.box(cx + w / 2, cy, z, 0.02, d, 0.035, mat)


@building(21, "Prefeitura", variant="x2", version=1, footprint=(2, 2))
def prefeitura_x2(m: Model):
    slab(m, mat="paving")
    m.box(0, 0.17, 0.03, 0.72, 0.48, 0.42, "wall_cream", roof="roof_flat")
    m.hip(0, 0.17, 0.45, 0.78, 0.54, 0.16, "roof_blue")
    for x in (-0.56, 0.56):
        m.box(x, 0.15, 0.03, 0.38, 0.42, 0.34, "wall_cream", roof="roof_flat")
        m.hip(x, 0.15, 0.37, 0.42, 0.46, 0.11, "roof_blue")
        m.windows(x, 0.15, 0.03, 0.38, 0.42, 0.34, 2, cols=3, sides="fbrl", lit=0.5)
    m.box(0, 0.17, 0.61, 0.18, 0.18, 0.5, "wall_cream")
    m.pyramid(0, 0.17, 1.11, 0.23, 0.23, 0.16, "roof_blue")
    m._quad([(-0.055, 0.077, 0.82), (0.055, 0.077, 0.82), (0.055, 0.077, 0.94), (-0.055, 0.077, 0.94)], "glow_lamp")
    m.windows(0, 0.17, 0.03, 0.72, 0.48, 0.42, 2, cols=5, sides="fbrl", lit=0.55)
    m.box(0, -0.16, 0.44, 0.48, 0.16, 0.04, "wall_white")
    m.gable(0, -0.16, 0.48, 0.48, 0.16, 0.11, "roof_slate", end="wall_cream", ridge="x")
    for x in (-0.19, -0.095, 0, 0.095, 0.19):
        column(m, x, -0.22, 0.03, 0.41)
    m.door(0, -0.065, 0.03, 0.13, 0.22, "wall_wood")
    m.steps(0, -0.32, 0.03, 0.46, n=4)
    fountain(m, 0, -0.62)
    for x in (-0.48, 0.48):
        flagpole(m, x, -0.62, "sign_green" if x < 0 else "sign_blue")
    for x in (-0.78, 0.78):
        m.tree(x, -0.7, 0.9, dark=x > 0)
        m.tree(x, 0.72, 0.95)
    curb(m, -0.92, 0.92, -0.48)


@building(27, "Hospital Geral", variant="x2", version=1, footprint=(2, 2))
def hospital_x2(m: Model):
    slab(m, mat="concrete")
    m.box(0, 0.18, 0.03, 0.46, 0.46, 0.88, "wall_white", roof="roof_flat")
    m.box(-0.55, 0.14, 0.03, 0.58, 0.38, 0.42, "wall_white", roof="roof_flat")
    m.box(0.55, 0.14, 0.03, 0.58, 0.38, 0.42, "wall_white", roof="roof_flat")
    m.box(0, 0.58, 0.03, 0.78, 0.28, 0.36, "wall_grey", roof="roof_flat")
    for args in [(0, 0.18, 0.46, 0.46, 0.88, 4, 4), (-0.55, 0.14, 0.58, 0.38, 0.42, 2, 4), (0.55, 0.14, 0.58, 0.38, 0.42, 2, 4), (0, 0.58, 0.78, 0.28, 0.36, 2, 5)]:
        m.windows(args[0], args[1], 0.03, args[2], args[3], args[4], args[5], cols=args[6], sides="fbrl", lit=0.55)
    m.box(0, -0.24, 0.33, 0.46, 0.18, 0.035, "glass_blue")
    for x in (-0.18, 0.18):
        column(m, x, -0.32, 0.03, 0.3, w=0.03)
    cross(m, 0, -0.055, 0.68, s=0.16)
    cross(m, 0, -0.335, 0.335, s=0.09)
    _parapet(m, 0, 0.18, 0.46, 0.46, 0.91)
    helipad(m, -0.55, 0.14, 0.45, r=0.17)
    m.box(-0.55, -0.62, 0.03, 0.6, 0.28, 0.2, "wall_white", roof="roof_flat")
    m.box(-0.55, -0.78, 0.05, 0.42, 0.04, 0.14, "glass_dark")
    m.box(-0.55, -0.48, 0.22, 0.48, 0.12, 0.035, "sign_red")
    for x in (-0.72, -0.55, -0.38):
        ambulance(m, x, -0.82)
    parked_row(m, (0.4, 0.53, 0.66, 0.79), -0.7)
    m.box(0.58, -0.58, 0.033, 0.5, 0.5, 0.008, "asphalt", roof="asphalt")
    for x in (0.335, 0.465, 0.595, 0.725, 0.825):
        stripe(m, x, -0.58, 0.01, 0.42)
    for x in (-0.9, 0.9):
        m.tree(x, 0.78, 0.9, dark=x > 0)


@building(29, "Escola Secundária", variant="x2", version=1, footprint=(2, 2))
def escola_secundaria_x2(m: Model):
    slab(m, mat="paving")
    m.box(-0.47, 0.24, 0.03, 0.46, 1.05, 0.42, "wall_cream", roof="roof_flat")
    m.box(0.47, 0.24, 0.03, 0.46, 1.05, 0.42, "wall_cream", roof="roof_flat")
    m.box(0, 0.65, 0.03, 0.5, 0.24, 0.36, "glass_blue", roof="roof_flat")
    m.box(0, -0.27, 0.03, 0.48, 0.34, 0.3, "wall_brick", roof="roof_flat")
    m.gable(0, -0.27, 0.33, 0.52, 0.38, 0.14, "roof_dark", end="wall_brick", ridge="x")
    for x in (-0.47, 0.47):
        m.windows(x, 0.24, 0.03, 0.46, 1.05, 0.42, 2, cols=3, sides="fbrl", lit=0.48)
        _parapet(m, x, 0.24, 0.46, 1.05, 0.45)
    m.windows(0, -0.27, 0.03, 0.48, 0.34, 0.3, 1, cols=4, sides="fbrl", lit=0.4)
    m.box(0, 0.13, 0.033, 0.48, 0.58, 0.008, "grass", roof="grass")
    m.box(0, 0.13, 0.04, 0.26, 0.2, 0.01, "paving", roof="paving")
    m.tree(-0.15, 0.1, 0.6)
    m.tree(0.16, 0.18, 0.55, dark=True)
    court(m, 0.62, -0.66, 0.58, 0.36)
    m.box(-0.62, -0.64, 0.03, 0.42, 0.28, 0.18, "wall_cream", roof="roof_flat")
    m.windows(-0.62, -0.64, 0.03, 0.42, 0.28, 0.18, 1, cols=3, sides="fbrl", lit=0.5)
    for x in (-0.18, 0.18):
        m.door(x, -0.44, 0.03, 0.08, 0.14, "wall_wood")
    fence_rect(m, -0.93, 0.93, -0.93, 0.93)


@building(32, "Estação de Trem", variant="x2", version=1, footprint=(2, 2))
def estacao_trem_x2(m: Model):
    slab(m, mat="paving")
    m.box(0, 0.62, 0.03, 0.58, 0.34, 0.34, "wall_cream", roof="roof_flat")
    m.hip(0, 0.62, 0.37, 0.66, 0.42, 0.13, "roof_blue")
    for x in (-0.43, 0.43):
        m.box(x, 0.62, 0.03, 0.28, 0.32, 0.25, "wall_brick", roof="roof_flat")
        m.hip(x, 0.62, 0.28, 0.32, 0.36, 0.1, "roof_blue")
        m.windows(x, 0.62, 0.03, 0.28, 0.32, 0.25, 1, cols=2, sides="fbrl", lit=0.55)
    m.windows(0, 0.62, 0.03, 0.58, 0.34, 0.34, 2, cols=5, sides="fbrl", lit=0.6)
    m.door(0, 0.445, 0.03, 0.12, 0.18, "wall_wood")
    m.box(0, 0.435, 0.23, 0.22, 0.02, 0.055, "glow_sign")
    m.box(0, 0.1, 0.03, 1.75, 0.16, 0.035, "concrete", roof="paving")
    m.box(0, -0.42, 0.03, 1.75, 0.16, 0.035, "concrete", roof="paving")
    for y in (0.1, -0.42):
        m.box(0, y, 0.3, 1.65, 0.24, 0.025, "roof_dark")
        for x in (-0.72, -0.36, 0, 0.36, 0.72):
            column(m, x, y - 0.09, 0.03, 0.27, w=0.025, mat="metal")
            column(m, x, y + 0.09, 0.03, 0.27, w=0.025, mat="metal")
    for y in (-0.17, -0.68):
        rail_pair(m, y)
    m.box(-0.32, -0.17, 0.05, 0.42, 0.08, 0.11, "wall_red")
    m.windows(-0.32, -0.17, 0.07, 0.42, 0.08, 0.06, 1, cols=4, sides="fb", lit=0.55, slabs=False)
    m.box(0.72, -0.29, 0.36, 0.11, 0.68, 0.03, "metal")
    m.box(0.72, -0.29, 0.39, 0.11, 0.68, 0.055, "glass_blue")
    for y0, y1 in ((0.28, 0.05), (-0.85, -0.6)):
        m._quad([(0.66, y0, 0.04), (0.78, y0, 0.04), (0.78, y1, 0.36), (0.66, y1, 0.36)], "metal_dark")
        m._quad([(0.78, y0, 0.04), (0.66, y0, 0.04), (0.66, y1, 0.36), (0.78, y1, 0.36)], "metal_dark")
    for x in (-0.86, 0.88):
        m.tree(x, 0.78, 0.75, dark=x > 0)


@building(34, "Estação de Tratamento de Água", variant="x2", version=1, footprint=(2, 2))
def eta_x2(m: Model):
    slab(m, mat="concrete")
    fence_rect(m)
    for x, y, r in [(-0.55, -0.42, 0.24), (-0.08, -0.47, 0.2), (0.4, -0.42, 0.24), (-0.55, 0.1, 0.18)]:
        tank(m, x, y, r)
    m.box(0.36, 0.26, 0.03, 0.58, 0.38, 0.26, "wall_cream", roof="roof_flat")
    m.windows(0.36, 0.26, 0.06, 0.58, 0.38, 0.2, 1, cols=4, sides="fbrl", lit=0.45, slabs=False)
    _parapet(m, 0.36, 0.26, 0.58, 0.38, 0.29)
    m.box(-0.36, 0.47, 0.03, 0.54, 0.24, 0.12, "glass_blue", roof="concrete")
    for x in (-0.5, -0.35, -0.2):
        m.box(x, 0.47, 0.145, 0.02, 0.24, 0.018, "metal_dark")
    pipe(m, -0.72, 0.58, -0.12, 0.17)
    pipe(m, -0.36, 0.72, 0.66, 0.22)
    for x in (-0.15, 0.02, 0.19):
        m.cyl(x, 0.72, 0.03, 0.055, 0.22, "wall_white", seg=10)
    m.ac_unit(0.5, 0.24, 0.3, 0.08, 0.06, 0.04)
    m.cyl(0.78, 0.34, 0.03, 0.1, 0.5, "wall_white", seg=12)
    m.cone(0.78, 0.34, 0.53, 0.11, 0.08, "roof_slate", seg=12)
    m.tree(-0.82, 0.75, 0.75)


@building(40, "Usina Termelétrica", variant="x2", version=1, footprint=(2, 2))
def usina_termeletrica_x2(m: Model):
    slab(m, mat="asphalt")
    m.box(-0.38, -0.14, 0.03, 0.72, 0.58, 0.5, "wall_grey", roof="roof_flat")
    m.gable(-0.38, -0.14, 0.53, 0.76, 0.62, 0.18, "roof_dark", end="wall_grey", ridge="x")
    m.windows(-0.38, -0.14, 0.08, 0.72, 0.58, 0.38, 2, cols=5, sides="fbrl", lit=0.38)
    m.box(0.25, -0.24, 0.03, 0.38, 0.36, 0.36, "wall_beige", roof="roof_flat")
    m.windows(0.25, -0.24, 0.08, 0.38, 0.36, 0.24, 1, cols=3, sides="fbrl", lit=0.35)
    cooling_tower(m, 0.28, 0.42, 0.23, 0.78)
    cooling_tower(m, 0.74, 0.36, 0.2, 0.68)
    m.cyl(-0.82, -0.5, 0.03, 0.055, 1.25, "white", seg=10, r_top=0.045)
    m.cyl(-0.82, -0.5, 1.1, 0.058, 0.08, "sign_red", seg=10)
    m.cyl(-0.82, -0.5, 0.72, 0.057, 0.06, "sign_red", seg=10)
    pipe(m, -0.7, 0.5, 0.165, 0.2)
    pipe(m, -0.15, 0.38, -0.55, 0.18)
    m.box(0.62, -0.66, 0.03, 0.42, 0.28, 0.08, "metal_dark", roof="black")
    for x in (0.48, 0.62, 0.76):
        coal_pile(m, x, -0.66, 0.09, 0.07)
    for x in (0.15, 0.25, 0.35):
        m.box(x, -0.24, 0.39, 0.08, 0.08, 0.06, "metal", roof="metal_dark")
    m.cyl(0.83, -0.12, 0.03, 0.07, 0.36, "metal", seg=10)
    m.box(0.83, -0.12, 0.39, 0.16, 0.16, 0.035, "metal_dark")
    fence_rect(m)
