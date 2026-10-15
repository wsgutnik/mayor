"""Service tiers of the 41-84 expansion (docs/process/24-service-usage.md, item 3).

2x2 kinds ship as `x2` variants (models/x2/NN.glb, footprint |x|,|y| <= 1, legacy service cap 4000 triangles);
the two 1x1 kinds ship as `x1` variants (models/x1/NN.glb, |x|,|y| <= 0.5, 1400 triangles) so the 40-file kit
inventory stays untouched. Base z = 0, front faces -Y (the street), every part inside its footprint.
Each building is scaled against its family: the solar field and the large plant fill the same 2x2 as the
thermal plant (#40 x2), the water tower stands taller than a 1x1 house, the fire post is smaller than the
fire station (#30) and the headquarters fills a 2x2.
"""
import math

from lib import Model
from registry import building
from dress_x2 import (
    column, cooling_tower, curb, fence_rect, flagpole, parked_row, pipe, rail_pair, slab, stripe, tank,
)


def _parapet(m: Model, cx, cy, w, d, z, mat="slab"):
    m.box(cx, cy - d / 2, z, w, 0.02, 0.035, mat)
    m.box(cx, cy + d / 2, z, w, 0.02, 0.035, mat)
    m.box(cx - w / 2, cy, z, 0.02, d, 0.035, mat)
    m.box(cx + w / 2, cy, z, 0.02, d, 0.035, mat)


def _fire_truck(m: Model, cx, cy, along="y"):
    """A red engine with a white ladder rack (about 40 triangles)."""
    if along == "y":
        m.box(cx, cy + 0.02, 0.04, 0.085, 0.2, 0.075, "sign_red", roof="sign_red")
        m.box(cx, cy - 0.1, 0.04, 0.08, 0.055, 0.065, "sign_red", roof="glass_dark")
        m.box(cx, cy + 0.03, 0.117, 0.03, 0.17, 0.012, "metal")
        m.box(cx, cy - 0.127, 0.06, 0.06, 0.004, 0.03, "glass_dark")
    else:
        m.box(cx + 0.02, cy, 0.04, 0.2, 0.085, 0.075, "sign_red", roof="sign_red")
        m.box(cx - 0.1, cy, 0.04, 0.055, 0.08, 0.065, "sign_red", roof="glass_dark")
        m.box(cx + 0.03, cy, 0.117, 0.17, 0.03, 0.012, "metal")


def _bay_doors(m: Model, x0, x1, y_wall, z, n, h=0.17, mat="metal"):
    """Engine bay doors on a front wall (y_wall), with a dark frame and a lit strip above each."""
    step = (x1 - x0) / n
    for i in range(n):
        x = x0 + step * (i + 0.5)
        m.box(x, y_wall - 0.006, z, step * 0.8, 0.012, h + 0.02, "metal_dark")
        m.box(x, y_wall - 0.012, z, step * 0.7, 0.01, h, mat)
        for k in range(1, 4):
            m.box(x, y_wall - 0.018, z + h * k / 4, step * 0.7, 0.004, 0.006, "metal_dark")


def _panel_row(m: Model, x0, x1, yc, depth=0.12, z0=0.06, rise=0.07, n=4):
    """A row of tilted photovoltaic panels facing the street side (-Y), on two legs per panel."""
    step = (x1 - x0) / n
    y0, y1 = yc - depth / 2, yc + depth / 2
    for i in range(n):
        a, b = x0 + step * i + 0.008, x0 + step * (i + 1) - 0.008
        m._quad([(a, y0, z0), (b, y0, z0), (b, y1, z0 + rise), (a, y1, z0 + rise)], "glass_dark")
        m._quad([(b, y0, z0 - 0.006), (a, y0, z0 - 0.006), (a, y1, z0 + rise - 0.006), (b, y1, z0 + rise - 0.006)], "metal")
        for x in (a + 0.02, b - 0.02):
            m.box(x, yc + depth * 0.25, 0.03, 0.012, 0.012, z0 + rise * 0.75 - 0.03, "metal_dark")
    # aluminium frame line along the low edge
    m.box((x0 + x1) / 2, y0, z0 - 0.004, x1 - x0, 0.01, 0.01, "metal")


@building(61, "Estação Ferroviária", variant="x2", version=1, footprint=(2, 2))
def estacao_ferroviaria_x2(m: Model):
    """Regional rail: a stone hall with a clock tower on the forecourt, two covered platforms behind."""
    slab(m, mat="paving")
    # hall on the street side
    m.box(0, -0.42, 0.03, 1.1, 0.42, 0.42, "wall_cream", roof="roof_flat")
    m.gable(0, -0.42, 0.45, 1.16, 0.48, 0.2, "roof_slate", end="wall_cream", ridge="x")
    m.windows(0, -0.42, 0.03, 1.1, 0.42, 0.42, 2, cols=7, sides="fbrl", lit=0.6)
    for x in (-0.66, 0.66):
        m.box(x, -0.42, 0.03, 0.22, 0.36, 0.3, "wall_brick", roof="roof_flat")
        m.hip(x, -0.42, 0.33, 0.26, 0.4, 0.09, "roof_slate")
        m.windows(x, -0.42, 0.03, 0.22, 0.36, 0.3, 1, cols=2, sides="fbrl", lit=0.55)
    # great arched window and entrance
    m.box(0, -0.64, 0.12, 0.3, 0.012, 0.26, "glow_window")
    m.box(0, -0.646, 0.38, 0.34, 0.012, 0.03, "wall_white")
    for x in (-0.12, 0.0, 0.12):
        column(m, x, -0.68, 0.03, 0.34, w=0.035)
    m.box(0, -0.68, 0.37, 0.36, 0.08, 0.03, "wall_white")
    m.steps(0, -0.72, 0.03, 0.4, n=3)
    m.box(0, -0.645, 0.43, 0.42, 0.012, 0.05, "glow_sign")
    # clock tower
    m.box(0.5, -0.66, 0.03, 0.16, 0.16, 1.05, "wall_brick", roof="roof_flat")
    m._quad([(0.44, -0.746, 0.86), (0.56, -0.746, 0.86), (0.56, -0.746, 0.96), (0.44, -0.746, 0.96)], "glow_lamp")  # clock
    m.box(0.5, -0.66, 1.08, 0.2, 0.2, 0.03, "wall_white")
    m.pyramid(0.5, -0.66, 1.11, 0.2, 0.2, 0.2, "roof_slate")
    # platforms and canopies (rails run along x)
    for y in (0.18, 0.62):
        m.box(0, y, 0.03, 1.88, 0.14, 0.04, "concrete", roof="paving")
        m.box(0, y, 0.32, 1.8, 0.22, 0.02, "roof_dark")
        for x in (-0.78, -0.39, 0.0, 0.39, 0.78):
            column(m, x, y, 0.07, 0.25, w=0.022, mat="metal")
        m.box(0, y - 0.05, 0.072, 1.86, 0.012, 0.004, "flower_yellow")
    for y in (0.4, 0.86):
        rail_pair(m, y, -0.96, 0.96)
    # a regional train at the far platform
    m.box(-0.2, 0.4, 0.05, 0.9, 0.09, 0.12, "wall_white", roof="roof_flat")
    m.box(-0.2, 0.4, 0.13, 0.9, 0.092, 0.025, "sign_blue")
    m.windows(-0.2, 0.4, 0.07, 0.9, 0.09, 0.06, 1, cols=9, sides="fb", lit=0.6, slabs=False, plinth=False, sills=False)
    # footbridge between the platforms
    m.box(0.82, 0.4, 0.36, 0.08, 0.56, 0.05, "metal", roof="metal_dark")
    # forecourt
    parked_row(m, (-0.85, -0.73, -0.61), -0.86, along="y")
    for x in (-0.3, 0.3):
        m.tree(x, -0.86, 0.6, dark=x > 0)
    curb(m, -0.96, 0.96, -0.96)


@building(73, "Usina Solar", variant="x2", version=1, footprint=(2, 2))
def usina_solar_x2(m: Model):
    """Solar field: seven rows of tilted panels over grass, an inverter house and a substation yard."""
    slab(m, mat="grass")
    m.box(0, -0.86, 0.03, 1.9, 0.14, 0.004, "paving", roof="paving")  # service road along the street
    for i, yc in enumerate((-0.6, -0.38, -0.16, 0.06, 0.28, 0.5, 0.72)):
        x1 = 0.92 if yc < 0.2 else 0.28
        _panel_row(m, -0.92, x1, yc, n=6 if yc < 0.2 else 4)
    # inverter house and transformer yard (back right)
    m.box(0.62, 0.52, 0.03, 0.34, 0.26, 0.2, "wall_white", roof="roof_flat")
    m.windows(0.62, 0.52, 0.03, 0.34, 0.26, 0.2, 1, cols=2, sides="fr", lit=0.4, slabs=False)
    m.door(0.55, 0.39, 0.03, 0.06, 0.12, "metal_dark")
    m.box(0.62, 0.79, 0.03, 0.34, 0.2, 0.004, "concrete", roof="concrete")
    for x in (0.52, 0.72):
        m.box(x, 0.8, 0.034, 0.08, 0.08, 0.1, "metal", roof="metal_dark")
        m.cyl(x, 0.8, 0.134, 0.012, 0.05, "wall_white", seg=6)
    for x in (0.47, 0.77):
        m.box(x, 0.8, 0.03, 0.012, 0.012, 0.26, "metal_dark")
    m.box(0.62, 0.8, 0.27, 0.32, 0.012, 0.012, "metal_dark")
    m.sign(0.62, 0.39, 0.16, 0.18, 0.035, "glow_sign")
    fence_rect(m)


@building(81, "Usina de Grande Porte", variant="x2", version=1, footprint=(2, 2))
def usina_grande_x2(m: Model):
    """Large plant: twin tall cooling towers, a long turbine hall, a stack and a switchyard."""
    slab(m, mat="asphalt")
    m.box(-0.2, -0.38, 0.03, 1.1, 0.5, 0.56, "wall_grey", roof="roof_flat")
    m.gable(-0.2, -0.38, 0.59, 1.14, 0.54, 0.16, "roof_dark", end="wall_grey", ridge="x")
    m.windows(-0.2, -0.38, 0.08, 1.1, 0.5, 0.44, 2, cols=7, sides="fbrl", lit=0.38, style="industrial")
    m.box(0.62, -0.5, 0.03, 0.42, 0.34, 0.32, "wall_beige", roof="roof_flat")
    m.windows(0.62, -0.5, 0.03, 0.42, 0.34, 0.32, 2, cols=3, sides="fbr", lit=0.5)
    _parapet(m, 0.62, -0.5, 0.42, 0.34, 0.35)
    m.sign(0.62, -0.67, 0.25, 0.26, 0.04, "glow_sign")
    cooling_tower(m, -0.48, 0.42, 0.34, 1.35)
    cooling_tower(m, 0.24, 0.48, 0.31, 1.2)
    m.cyl(0.82, 0.02, 0.03, 0.07, 1.9, "white", seg=10, r_top=0.055)
    for z in (1.0, 1.45, 1.78):
        m.cyl(0.82, 0.02, z, 0.074 - (z - 1.0) * 0.012, 0.07, "sign_red", seg=10)
    pipe(m, -0.7, 0.6, -0.06, 0.24)
    pipe(m, -0.48, 0.24, 0.1, 0.32)
    # switchyard
    for x in (0.42, 0.6, 0.78):
        m.box(x, 0.88, 0.03, 0.012, 0.012, 0.34, "metal_dark")
        m.box(x, 0.88, 0.03, 0.09, 0.07, 0.08, "metal", roof="metal_dark")
    m.box(0.6, 0.88, 0.37, 0.4, 0.012, 0.012, "metal_dark")
    m.box(-0.7, -0.8, 0.03, 0.3, 0.2, 0.004, "concrete", roof="concrete")
    parked_row(m, (-0.82, -0.7, -0.58), -0.8, along="y")
    fence_rect(m)


@building(82, "Estação de Tratamento Avançada", variant="x2", version=1, footprint=(2, 2))
def eta_avancada_x2(m: Model):
    """Advanced treatment: six clarifier basins, a long filter hall with skylights and a tall reservoir."""
    slab(m, mat="concrete")
    for x, y, r in [(-0.66, -0.52, 0.22), (-0.18, -0.52, 0.22), (0.3, -0.52, 0.22),
                    (-0.66, -0.02, 0.2), (-0.18, -0.02, 0.2), (0.3, -0.02, 0.2)]:
        tank(m, x, y, r, h=0.12)
        m.box(x, y, 0.16, r * 1.7, 0.02, 0.02, "metal")
    m.box(-0.2, 0.56, 0.03, 1.2, 0.36, 0.3, "wall_cream", roof="roof_flat")
    m.windows(-0.2, 0.56, 0.03, 1.2, 0.36, 0.3, 1, cols=8, sides="fbrl", lit=0.45, style="industrial")
    _parapet(m, -0.2, 0.56, 1.2, 0.36, 0.33)
    for x in (-0.6, -0.35, -0.1, 0.15):
        m.skylight(x, 0.56, 0.33, 0.14, 0.18)
    m.sign(-0.2, 0.38, 0.23, 0.36, 0.045, "glow_sign")
    m.cyl(0.72, 0.42, 0.03, 0.17, 0.62, "wall_white", seg=14)
    m.cone(0.72, 0.42, 0.65, 0.18, 0.1, "roof_slate", seg=14)
    m.box(0.72, 0.25, 0.4, 0.06, 0.012, 0.04, "sign_blue")
    pipe(m, -0.86, 0.5, 0.24, 0.2)
    pipe(m, 0.5, 0.86, -0.3, 0.14)
    m.box(0.72, -0.6, 0.03, 0.36, 0.42, 0.004, "asphalt", roof="asphalt")
    for x in (0.6, 0.72, 0.84):
        stripe(m, x, -0.6, 0.008, 0.3)
    parked_row(m, (0.66, 0.78), -0.62, along="y")
    m.tree(-0.86, 0.86, 0.7)
    m.tree(0.86, 0.86, 0.65, dark=True)
    fence_rect(m)


@building(83, "Quartel Central dos Bombeiros", variant="x2", version=1, footprint=(2, 2))
def quartel_central_x2(m: Model):
    """Fire HQ: a four-bay engine hall, a command block, a drill tower and engines on the apron."""
    slab(m, mat="paving")
    m.box(0, -0.62, 0.03, 1.9, 0.6, 0.004, "concrete", roof="concrete")  # apron
    # engine hall
    m.box(-0.22, -0.08, 0.03, 1.2, 0.5, 0.34, "wall_red", roof="roof_flat")
    _bay_doors(m, -0.8, 0.36, -0.33, 0.03, 4, h=0.22)
    m.windows(-0.22, -0.08, 0.03, 1.2, 0.5, 0.34, 1, cols=6, sides="brl", lit=0.45)
    m.box(-0.22, -0.335, 0.3, 1.2, 0.014, 0.05, "wall_white")
    m.sign(-0.22, -0.345, 0.3, 0.42, 0.045, "glow_sign")
    _parapet(m, -0.22, -0.08, 1.2, 0.5, 0.37)
    # command block on top of the rear wing
    m.box(-0.3, 0.42, 0.03, 0.9, 0.42, 0.5, "wall_white", roof="roof_flat")
    m.windows(-0.3, 0.42, 0.03, 0.9, 0.42, 0.5, 3, cols=6, sides="fbrl", lit=0.55)
    _parapet(m, -0.3, 0.42, 0.9, 0.42, 0.53)
    m.ac_unit(-0.5, 0.42, 0.53)
    m.ac_unit(-0.1, 0.48, 0.53)
    m.cyl(0.0, 0.5, 0.53, 0.006, 0.2, "metal", seg=4)
    # drill tower
    m.box(0.68, 0.38, 0.03, 0.26, 0.26, 1.1, "wall_brick", roof="roof_dark")
    m.windows(0.68, 0.38, 0.03, 0.26, 0.26, 1.1, 5, cols=1, sides="fbrl", lit=0.3)
    m.box(0.68, 0.38, 1.13, 0.32, 0.32, 0.02, "slab")
    m.box(0.68, 0.25, 0.98, 0.1, 0.03, 0.08, "sign_red")
    m.cyl(0.88, 0.1, 0.03, 0.005, 1.02, "metal", seg=4)
    # engines on the apron and the hose-drying yard
    for x in (-0.66, -0.37, -0.08):
        _fire_truck(m, x, -0.6)
    m.box(0.6, -0.12, 0.03, 0.5, 0.44, 0.004, "asphalt", roof="asphalt")
    for x in (0.45, 0.6, 0.75):
        stripe(m, x, -0.12, 0.008, 0.36)
    parked_row(m, (0.52, 0.68), -0.12, along="y")
    flagpole(m, 0.5, -0.86, "sign_red")
    flagpole(m, 0.62, -0.86, "sign_green")
    m.tree(0.86, -0.82, 0.6)
    m.tree(-0.88, 0.86, 0.7, dark=True)
    curb(m, -0.96, 0.96, -0.94)


@building(76, "Reservatório Elevado", variant="x1", version=1, footprint=(1, 1))
def reservatorio_x1(m: Model):
    """Water tower: a tall steel tank on six legs with a ladder, over a small pump house."""
    m.plot(lawn=True)
    m.box(0.0, 0.0, 0.03, 0.58, 0.58, 0.004, "concrete", roof="concrete")
    for i in range(6):
        a = i * math.pi / 3
        x, y = 0.2 * math.cos(a), 0.2 * math.sin(a)
        m.cyl(x, y, 0.03, 0.016, 0.8, "metal", seg=5, r_top=0.012)
    for z in (0.32, 0.6):
        m.cyl(0, 0, z, 0.2, 0.012, "metal_dark", seg=6, cap=False)
    m.cyl(0, 0, 0.03, 0.035, 0.85, "metal_dark", seg=6)  # riser
    m.cyl(0, 0, 0.8, 0.27, 0.05, "wall_white", seg=14, r_top=0.29)
    m.cyl(0, 0, 0.85, 0.29, 0.26, "wall_blue", seg=14)
    m.cyl(0, 0, 0.98, 0.293, 0.025, "sign_blue", seg=14, cap=False)
    m.cone(0, 0, 1.11, 0.3, 0.12, "roof_slate", seg=14)
    m.box(0, -0.29, 0.03, 0.03, 0.012, 1.08, "metal_dark")  # ladder
    m.box(0, -0.22, 0.86, 0.06, 0.14, 0.012, "metal")
    m._quad([(-0.05, -0.295, 0.94), (0.05, -0.295, 0.94), (0.05, -0.295, 1.0), (-0.05, -0.295, 1.0)], "glow_lamp")
    # pump house at the street side
    m.box(0.26, -0.3, 0.03, 0.18, 0.14, 0.13, "wall_cream", roof="roof_flat")
    m.door(0.26, -0.37, 0.03, 0.05, 0.09, "metal_dark")
    m.box(-0.3, -0.3, 0.03, 0.08, 0.08, 0.06, "metal", roof="metal_dark")
    m.tree(-0.36, 0.34, 0.55)


@building(84, "Posto Avançado dos Bombeiros", variant="x1", version=1, footprint=(1, 1))
def posto_bombeiros_x1(m: Model):
    """Fire post: a single-bay station with a short hose tower, smaller than the fire station (#30)."""
    m.plot(lawn=False)
    m.box(0.06, 0.06, 0.03, 0.5, 0.42, 0.26, "wall_red", roof="roof_flat")
    _bay_doors(m, -0.17, 0.17, -0.15, 0.03, 2, h=0.16)
    m.windows(0.06, 0.06, 0.03, 0.5, 0.42, 0.26, 1, cols=3, sides="brl", lit=0.45)
    m.box(0.06, -0.155, 0.22, 0.5, 0.012, 0.04, "wall_white")
    m.sign(0.0, -0.165, 0.22, 0.2, 0.035, "glow_sign")
    _parapet(m, 0.06, 0.06, 0.5, 0.42, 0.29)
    m.box(-0.3, 0.12, 0.03, 0.14, 0.14, 0.6, "wall_brick", roof="roof_dark")
    m.windows(-0.3, 0.12, 0.03, 0.14, 0.14, 0.6, 3, cols=1, sides="fl", lit=0.3)
    m.box(-0.3, 0.12, 0.63, 0.18, 0.18, 0.014, "slab")
    m.ac_unit(0.18, 0.16, 0.29)
    m.box(0.0, -0.33, 0.03, 0.5, 0.26, 0.004, "concrete", roof="concrete")
    _fire_truck(m, 0.0, -0.3, along="x")
    m.cyl(0.38, -0.38, 0.03, 0.006, 0.3, "metal", seg=4)
    m.box(0.4, -0.38, 0.26, 0.05, 0.004, 0.035, "sign_red")
