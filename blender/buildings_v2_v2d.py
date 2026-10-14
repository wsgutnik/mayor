"""V2 reference batch v2d: #31, #33, #35, #36, #37, #39 with three LODs."""
from lib import Model
from registry import building
from dress_v2_v2d import (
    bollards, bus, container, dock_door, fence_rect, framed_window, ground_grid,
    hpipe, lamp, parapet, roof_seams, slab, tank_ladder, truck,
)


def _plot(m: Model, yard="paving"):
    m.box(0, 0, 0, 0.96, 0.96, 0.03, yard, roof=yard)
    m.box(0, -0.475, 0.03, 0.96, 0.05, 0.006, "concrete", roof="concrete")


def _bus_station(m: Model, lod: int):
    full = lod == 0
    _plot(m)
    m.box(0, -0.22, 0.031, 0.82, 0.34, 0.008, "asphalt", roof="asphalt")
    if lod < 2:
        for x in (-0.23, 0.23):
            m.box(x, -0.29, 0.039, 0.16, 0.012, 0.004, "white")
            m.box(x, -0.15, 0.039, 0.16, 0.012, 0.004, "white")
        m.box(0, 0.02, 0.03, 0.82, 0.16, 0.025, "concrete", roof="concrete")
        ground_grid(m, 0, 0.02, 0.82, 0.16, 5, 2)

    m.box(0, 0.30, 0.03, 0.78, 0.23, 0.21, "wall_cream", roof="roof_flat")
    m.box(0, 0.30, 0.24, 0.82, 0.27, 0.025, "slab")
    m.box(0, -0.02, 0.285, 0.88, 0.48, 0.03, "roof_dark", roof="roof_dark")
    if lod < 2:
        m.box(0, -0.25, 0.285, 0.88, 0.026, 0.045, "wall_navy")
        for x in (-0.36, -0.12, 0.12, 0.36):
            m.box(x, -0.20, 0.03, 0.028, 0.028, 0.255, "metal_dark")
            m.box(x, 0.12, 0.03, 0.028, 0.028, 0.255, "metal_dark")
        m.door(0, 0.181, 0.03, 0.10, 0.13, "glass_dark", "white")
        m.box(0, 0.175, 0.17, 0.22, 0.014, 0.04, "glow_sign")
        for x in (-0.28, -0.14, 0.14, 0.28):
            framed_window(m, x, 0.18, 0.11, w=0.085, side="f", lit=True)
        roof_seams(m, 0, -0.02, 0.318, 0.84, 0.44, count=5)
    if full:
        bus(m, -0.23, -0.30)
        bus(m, 0.23, -0.24, stripe="sign_green")
        m.box(-0.31, 0.02, 0.19, 0.18, 0.06, 0.012, "glass_blue")
        m.box(-0.31, 0.00, 0.07, 0.15, 0.035, 0.02, "bench_wood")
        m.box(0.30, 0.03, 0.07, 0.14, 0.035, 0.02, "bench_wood")
        m.box(0.39, -0.40, 0.03, 0.035, 0.035, 0.24, "metal_dark")
        m.box(0.39, -0.40, 0.27, 0.10, 0.025, 0.07, "glow_sign")
        for x in (-0.08, -0.03, 0.02):
            m.box(x, -0.415, 0.037, 0.03, 0.10, 0.003, "white")
        bollards(m, (-0.41, -0.16, 0.16, 0.41), -0.245)
        lamp(m, -0.42, -0.38)
        lamp(m, 0.42, 0.12)
        m.tree(-0.43, 0.42, 0.9)
        m.tree(0.43, 0.42, 0.9, dark=True)


def _cargo_terminal(m: Model, lod: int):
    full = lod == 0
    _plot(m, "asphalt")
    if lod < 2:
        slab(m, -0.07, -0.20, 0.03, 0.72, 0.28, "concrete")
        ground_grid(m, -0.07, -0.20, 0.72, 0.28, 4, 2)
    m.box(-0.12, 0.12, 0.03, 0.68, 0.43, 0.30, "wall_grey", roof="roof_flat")
    m.gable(-0.12, 0.12, 0.33, 0.70, 0.45, 0.08, "roof_slate", end="wall_grey", ridge="x")
    m.box(0.28, 0.03, 0.03, 0.20, 0.28, 0.20, "wall_beige", roof="roof_flat")
    if lod < 2:
        for x in (-0.34, -0.14, 0.06):
            dock_door(m, x, -0.105)
            m.box(x, -0.155, 0.03, 0.16, 0.08, 0.012, "concrete", roof="concrete")
        m.windows(-0.12, 0.12, 0.18, 0.68, 0.43, 0.11, 1, cols=5, sides="fbrl", lit=0.5, slabs=False)
        framed_window(m, 0.28, -0.11, 0.13, side="f", lit=True)
        m.door(0.36, -0.11, 0.03, 0.055, 0.12, "glass_dark")
        roof_seams(m, -0.12, 0.12, 0.415, 0.66, 0.41, count=5)
        m.skylight(-0.22, 0.09, 0.41, 0.12, 0.08)
        m.skylight(0.04, 0.16, 0.41, 0.12, 0.08)
    if full:
        truck(m, -0.18, -0.30)
        truck(m, 0.27, -0.33, body="wall_cream", cab="wall_red")
        container(m, 0.38, 0.24, 0.03, 0.10, 0.22, 0.09, "wall_blue", along="y")
        container(m, 0.38, 0.36, 0.03, 0.10, 0.18, 0.09, "sign_orange", along="y")
        container(m, 0.38, 0.36, 0.12, 0.10, 0.18, 0.09, "wall_red", along="y")
        container(m, -0.35, -0.36, 0.03, 0.20, 0.09, 0.09, "wall_green")
        m.ac_unit(-0.33, 0.05, 0.415)
        m.box(-0.38, 0.38, 0.03, 0.12, 0.05, 0.06, "wall_wood")
        bollards(m, (-0.41, -0.27, -0.01, 0.13), -0.16)
        lamp(m, 0.45, -0.42)


def _substation(m: Model, lod: int):
    full = lod == 0
    _plot(m, "paving")
    slab(m, 0.10, 0.20, 0.03, 0.70, 0.48, "asphalt")
    m.box(-0.16, -0.28, 0.03, 0.48, 0.17, 0.20, "wall_grey", roof="roof_flat")
    if lod < 2:
        parapet(m, -0.16, -0.28, 0.23, 0.48, 0.17, h=0.035)
        m.awning(-0.16, -0.365, 0.17, 0.22, mat="sign_blue")
        for x in (-0.30, -0.16, -0.02):
            framed_window(m, x, -0.365, 0.11, w=0.07, side="f", lit=True)
        m.door(0.05, -0.365, 0.03, 0.055, 0.12, "metal_dark")
    if lod < 2:
        for x in (-0.22, 0.04, 0.28):
            m.box(x, 0.05, 0.03, 0.12, 0.09, 0.08, "metal", roof="metal_dark")
            m.cyl(x - 0.035, 0.05, 0.11, 0.016, 0.06, "wall_cream", seg=6)
            m.cyl(x + 0.035, 0.05, 0.11, 0.016, 0.06, "wall_cream", seg=6)
            hpipe(m, x, 0.05, 0.18, 0.13, 0.008)
    if full:
        for x in (-0.28, 0.22):
            for sx in (-1, 1):
                m.box(x + sx * 0.055, 0.33, 0.03, 0.014, 0.014, 0.54, "metal_dark")
            m.box(x, 0.33, 0.55, 0.15, 0.016, 0.016, "metal_dark")
            m.box(x, 0.33, 0.42, 0.12, 0.012, 0.012, "metal_dark")
            for sx in (-1, 0, 1):
                m.cyl(x + sx * 0.05, 0.33, 0.41, 0.012, 0.05, "wall_cream", seg=5)
        m.box(0.35, -0.27, 0.03, 0.11, 0.13, 0.11, "metal", roof="metal_dark")
        fence_rect(m, y0=-0.06, open_front=0.28, h=0.09)
        lamp(m, -0.43, -0.36)


def _warehouse(m: Model, lod: int):
    full = lod == 0
    _plot(m, "asphalt")
    m.box(0, 0.09, 0.03, 0.76, 0.50, 0.28, "wall_white", roof="roof_flat")
    m.gable(0, 0.09, 0.31, 0.76, 0.50, 0.08, "roof_blue", end="wall_white", ridge="x")
    m.box(0.31, -0.03, 0.03, 0.19, 0.26, 0.20, "wall_cream", roof="roof_flat")
    if lod < 2:
        for x in (-0.30, -0.10, 0.10):
            dock_door(m, x, -0.17, mat="metal")
            m.box(x, -0.225, 0.03, 0.16, 0.08, 0.014, "concrete", roof="concrete")
        m.windows(0, 0.09, 0.19, 0.76, 0.50, 0.10, 1, cols=7, sides="fbrl", lit=0.45, slabs=False)
        m.windows(0.31, -0.03, 0.06, 0.19, 0.26, 0.12, 1, cols=1, sides="fr", lit=0.6, slabs=False)
        for x in (-0.26, 0.02, 0.26):
            m.skylight(x, 0.08, 0.39, 0.10, 0.08)
        roof_seams(m, 0, 0.09, 0.395, 0.74, 0.48, count=6)
    if full:
        truck(m, -0.10, -0.33)
        truck(m, 0.30, -0.35, body="wall_cream", cab="sign_red")
        m.box(-0.36, 0.40, 0.03, 0.16, 0.08, 0.07, "wall_wood")
        m.box(-0.21, 0.40, 0.03, 0.12, 0.08, 0.07, "wall_wood")
        m.ac_unit(0.23, 0.20, 0.39)
        bollards(m, (-0.38, -0.22, -0.02, 0.18), -0.25)
        fence_rect(m, open_front=0.42, h=0.07)
        m.tree(-0.43, 0.42, 0.8)


def _light_factory(m: Model, lod: int):
    full = lod == 0
    _plot(m, "asphalt")
    m.box(-0.08, 0.06, 0.03, 0.60, 0.46, 0.27, "wall_grey", roof="roof_flat")
    for x in (-0.28, -0.08, 0.12):
        m.gable(x, 0.06, 0.30, 0.20, 0.46, 0.10, "roof_slate", end="wall_grey")
    m.box(0.31, 0.22, 0.03, 0.20, 0.17, 0.13, "wall_beige", roof="roof_dark")
    m.cyl(0.18, 0.28, 0.30, 0.035, 0.42, "wall_brick", seg=8)
    if lod < 2:
        m.box(-0.24, -0.178, 0.03, 0.16, 0.018, 0.15, "metal_dark")
        m.door(0.10, -0.178, 0.03, 0.06, 0.13, "metal")
        m.windows(-0.08, 0.06, 0.06, 0.60, 0.46, 0.20, 1, cols=6, sides="fbrl", lit=0.5)
        m.cyl(0.38, -0.11, 0.03, 0.07, 0.28, "metal", seg=8)
        m.cone(0.38, -0.11, 0.31, 0.075, 0.05, "metal_dark", seg=8)
        hpipe(m, 0.06, 0.25, 0.28, 0.44, 0.012)
    if full:
        m.cyl(0.18, 0.28, 0.58, 0.033, 0.14, "sign_red", seg=8)
        tank_ladder(m, 0.18, 0.24, 0.34, 0.30)
        tank_ladder(m, 0.38, -0.18, 0.08, 0.22)
        m.ac_unit(-0.18, 0.05, 0.40)
        m.box(-0.38, -0.32, 0.03, 0.11, 0.10, 0.08, "wall_wood")
        m.parked_car(0.28, -0.38, "sign_red", "x")
        bollards(m, (-0.36, -0.16, 0.16, 0.36), -0.31)
        fence_rect(m, open_front=0.32, h=0.07)


def _recycling(m: Model, lod: int):
    full = lod == 0
    _plot(m, "asphalt")
    m.box(-0.19, 0.14, 0.03, 0.42, 0.40, 0.33, "wall_green", roof="roof_flat")
    m.box(0.29, -0.16, 0.03, 0.20, 0.31, 0.21, "wall_cream", roof="roof_flat")
    if lod < 2:
        parapet(m, -0.19, 0.14, 0.36, 0.42, 0.40, h=0.04)
        m.box(-0.19, -0.065, 0.13, 0.22, 0.012, 0.13, "wall_white")
        m.box(-0.19, -0.073, 0.18, 0.13, 0.008, 0.045, "glow_sign")
        m.windows(-0.19, 0.14, 0.18, 0.42, 0.40, 0.12, 1, cols=3, sides="brl", lit=0.45, slabs=False)
        m.windows(0.29, -0.16, 0.07, 0.20, 0.31, 0.12, 1, cols=1, sides="fbr", lit=0.55, slabs=False)
        m.box(0.16, 0.27, 0.22, 0.32, 0.22, 0.03, "metal", roof="metal")
        for x in (0.02, 0.30):
            m.box(x, 0.19, 0.03, 0.026, 0.026, 0.19, "metal_dark")
        pts = [(0.05, 0.19, 0.06), (0.26, 0.19, 0.21), (0.30, 0.19, 0.21), (0.10, 0.19, 0.06)]
        m._quad(pts, "metal_dark")
        m._quad(list(reversed(pts)), "metal_dark")
    if full:
        container(m, -0.31, -0.28, 0.03, 0.17, 0.10, 0.10, "sign_green")
        container(m, -0.04, -0.29, 0.03, 0.17, 0.10, 0.10, "sign_green")
        container(m, 0.31, -0.34, 0.03, 0.14, 0.08, 0.09, "sign_blue")
        container(m, -0.42, -0.08, 0.03, 0.08, 0.14, 0.09, "sign_blue", along="y")
        m.ac_unit(-0.30, 0.12, 0.40)
        m.cyl(0.02, 0.36, 0.03, 0.05, 0.16, "metal", seg=7)
        hpipe(m, 0.05, 0.32, 0.18, 0.24, 0.010)
        bollards(m, (-0.39, -0.19, 0.11, 0.39), -0.425)
        fence_rect(m, open_front=0.36, h=0.07)
        lamp(m, 0.43, -0.40)


def _register(n, name, builder):
    @building(n, name, variant="v2", version=1)
    def lod0(m: Model):
        builder(m, 0)

    @building(n, name, variant="v2_lod1", version=1)
    def lod1(m: Model):
        builder(m, 1)

    @building(n, name, variant="v2_lod2", version=1)
    def lod2(m: Model):
        builder(m, 2)


_register(31, "Estação de Ônibus", _bus_station)
_register(33, "Terminal de Carga", _cargo_terminal)
_register(35, "Subestação Elétrica", _substation)
_register(36, "Armazém Logístico", _warehouse)
_register(37, "Fábrica Leve", _light_factory)
_register(39, "Centro de Reciclagem", _recycling)
