"""V2 reference buildings, group v2c: 1x1 civic/services with three LODs."""

from lib import Model
from registry import building
from dress_v2_v2c import (
    bollards, cornice, flag, ground, lamp, parapet, qf, rooftop_bits, side_windows, window,
)


def _civic_shell(m: Model, lod, cx, cy, w, d, h, wall, trim="white", rows=1):
    m.box(cx, cy, 0.03, w + 0.04, d + 0.04, 0.05, "concrete", roof="concrete")
    m.box(cx, cy, 0.08, w, d, h, wall, roof="roof_flat")
    if lod < 2:
        cornice(m, cx, cy, w, d, 0.08 + h, trim)
        parapet(m, cx, cy, 0.08 + h + 0.018, w, d, mat=trim)
    if lod == 0:
        side_windows(m, cx, cy, w, d, 0.08, rows=rows)
        rooftop_bits(m, 0.08 + h + 0.065, cy)
    elif lod == 1:
        m.windows(cx, cy, 0.08, w, d, h, rows, cols=4, sides="fb", lit=0.55, slabs=False)


def _library(m: Model, lod: int):
    ground(m)
    _civic_shell(m, lod, 0.0, 0.10, 0.62, 0.42, 0.34, "wall_brick", "wall_cream", rows=2)
    # Tall central reading room and book-stack side pier.
    m.box(0, -0.12, 0.08, 0.40, 0.09, 0.30, "glass_blue")
    m.box(-0.33, 0.10, 0.08, 0.11, 0.42, 0.40, "wall_brick")
    if lod < 2:
        m.box(0, -0.19, 0.30, 0.46, 0.13, 0.035, "concrete")
        m.box(0, -0.255, 0.03, 0.32, 0.09, 0.035, "concrete", roof="concrete")
        m.steps(0, -0.31, 0.03, 0.28, 3)
        m.sign(0, -0.175, 0.24, 0.30, 0.055, "glow_sign")
        m.box(0, -0.166, 0.08, 0.14, 0.012, 0.16, "glass_dark")
        m.box(0.20, 0.10, 0.43, 0.16, 0.12, 0.08, "glass_blue", roof="glass_blue")
    if lod == 0:
        for x in (-0.14, -0.07, 0.07, 0.14):
            m.box(x, -0.175, 0.09, 0.012, 0.018, 0.26, "metal_dark")
        for z in (0.16, 0.26):
            m.box(0, -0.18, z, 0.40, 0.014, 0.012, "metal_dark")
        for z in (0.17, 0.27, 0.37):
            window(m, -0.33, -0.12, z, w=0.055, h=0.07, side="f", frame="wall_cream")
        for x in (-0.39, 0.39):
            lamp(m, x, -0.34)
        m.box(-0.38, 0.36, 0.03, 0.12, 0.05, 0.05, "wall_wood", roof="grass")
        m.box(0.34, 0.36, 0.03, 0.12, 0.05, 0.05, "wall_wood", roof="grass")
    elif lod == 2:
        m.box(0, -0.19, 0.30, 0.46, 0.13, 0.035, "concrete")


def _community(m: Model, lod: int):
    ground(m)
    _civic_shell(m, lod, -0.04, 0.10, 0.58, 0.40, 0.30, "wall_white", "wall_wood", rows=1)
    m.box(-0.34, 0.10, 0.08, 0.13, 0.40, 0.34, "wall_wood")
    m.box(0.24, 0.22, 0.08, 0.22, 0.18, 0.18, "wall_cream", roof="roof_flat")
    if lod < 2:
        m.box(-0.04, -0.20, 0.25, 0.46, 0.17, 0.035, "roof_dark")
        for x in (-0.25, 0.16):
            m.box(x, -0.27, 0.03, 0.026, 0.026, 0.22, "wall_wood")
        m.box(-0.04, -0.12, 0.08, 0.20, 0.012, 0.16, "glass_blue")
        m.sign(-0.04, -0.285, 0.25, 0.30, 0.045, "glow_sign")
        m.steps(-0.04, -0.31, 0.03, 0.30, 2)
    if lod == 0:
        for x in (-0.22, -0.10, 0.04, 0.16):
            window(m, x, -0.10, 0.18, side="f")
        for y in (-0.04, 0.09, 0.22):
            m.box(-0.415, y, 0.11, 0.012, 0.08, 0.012, "wall_cream")
        m.box(0.30, -0.34, 0.03, 0.18, 0.08, 0.018, "wall_green", roof="wall_green")
        m.box(0.30, -0.34, 0.05, 0.12, 0.035, 0.045, "bench_wood")
        lamp(m, -0.36, -0.32)
        lamp(m, 0.40, -0.28)


def _police(m: Model, lod: int):
    ground(m, lawn=False, driveway=True)
    _civic_shell(m, lod, 0.0, 0.07, 0.66, 0.42, 0.34, "wall_white", "wall_navy", rows=2)
    m.box(0, -0.17, 0.08, 0.66, 0.065, 0.30, "wall_navy")
    if lod < 2:
        m.sign(0, -0.207, 0.24, 0.28, 0.055, "glow_sign")
        m.door(0, -0.205, 0.08, 0.11, 0.15, "glass_dark", "wall_grey")
        m.steps(0, -0.28, 0.03, 0.22, 2)
        flag(m, -0.36, -0.30, "sign_green")
    if lod == 0:
        for x in (-0.24, -0.08, 0.08, 0.24):
            window(m, x, -0.205, 0.16, side="f", pane="glow_window", frame="wall_grey")
            window(m, x, -0.205, 0.30, side="f", pane="glass_dark", frame="wall_grey")
        m.parked_car(0.31, -0.34, "white", "x")
        m.box(0.31, -0.34, 0.088, 0.08, 0.03, 0.014, "sign_blue")
        bollards(m, (-0.34, -0.26, 0.26, 0.34), -0.40)
        m.cyl(0.20, 0.22, 0.48, 0.006, 0.18, "metal", seg=4)
        m.fence(-0.46, -0.46, 0.46, -0.46, 0.06, "metal_dark", 12)


def _museum(m: Model, lod: int):
    ground(m)
    _civic_shell(m, lod, 0, 0.13, 0.62, 0.36, 0.32, "wall_cream", "white", rows=1)
    m.pyramid(0, 0.13, 0.45 if lod < 2 else 0.40, 0.34, 0.24, 0.13, "glass_blue")
    m.box(0, -0.12, 0.38, 0.46, 0.15, 0.055, "wall_cream")
    m.gable(0, -0.12, 0.435, 0.46, 0.15, 0.09, "roof_slate", end="wall_cream", ridge="x")
    if lod < 2:
        for x in (-0.18, -0.108, -0.036, 0.036, 0.108, 0.18):
            m.cyl(x, -0.18, 0.08, 0.015, 0.30, "wall_white", seg=8)
        m.box(0, -0.22, 0.03, 0.44, 0.12, 0.045, "concrete", roof="concrete")
        m.steps(0, -0.30, 0.03, 0.42, 3)
        m.door(0, -0.06, 0.08, 0.10, 0.18, "wall_wood", "white")
    if lod == 0:
        for x in (-0.24, 0.24):
            m.box(x, -0.065, 0.13, 0.07, 0.012, 0.17, "sign_red")
        m.sign(0, -0.20, 0.39, 0.28, 0.04, "glow_sign")
        for x in (-0.18, 0, 0.18):
            window(m, x, -0.06, 0.20, w=0.055, h=0.11, side="f", frame="wall_white")
        lamp(m, -0.36, -0.34)
        lamp(m, 0.36, -0.34)


def _clinic(m: Model, lod: int):
    ground(m)
    _civic_shell(m, lod, 0.02, 0.09, 0.58, 0.36, 0.29, "wall_white", "sign_blue", rows=1)
    m.box(-0.31, 0.09, 0.08, 0.12, 0.36, 0.31, "wall_wood")
    if lod < 2:
        m.awning(-0.08, -0.10, 0.23, 0.28, mat="sign_blue")
        m.door(-0.08, -0.10, 0.08, 0.13, 0.16, "glass_blue", "white")
        m.steps(-0.08, -0.19, 0.03, 0.22, 2)
        m.box(0.18, -0.105, 0.22, 0.10, 0.012, 0.035, "sign_red")
        m.box(0.18, -0.105, 0.19, 0.035, 0.012, 0.095, "sign_red")
        m.box(-0.39, -0.23, 0.03, 0.06, 0.04, 0.22, "wall_white")
        m.box(-0.39, -0.255, 0.17, 0.05, 0.008, 0.018, "sign_red")
        m.box(-0.39, -0.255, 0.155, 0.018, 0.008, 0.05, "sign_red")
    if lod == 0:
        for x in (-0.20, 0.04, 0.28):
            window(m, x, -0.10, 0.17, side="f")
        m.parked_car(0.34, -0.34, "white", "x")
        m.box(0.31, -0.34, 0.075, 0.055, 0.03, 0.025, "sign_red")
        bollards(m, (-0.25, 0.06), -0.25)


def _school(m: Model, lod: int):
    ground(m)
    _civic_shell(m, lod, -0.04, 0.15, 0.62, 0.30, 0.29, "wall_cream", "wall_brick", rows=1)
    m.box(-0.34, 0.15, 0.08, 0.13, 0.30, 0.33, "wall_brick")
    m.box(0.24, 0.15, 0.08, 0.13, 0.30, 0.33, "wall_brick")
    if lod < 2:
        m.awning(-0.04, -0.01, 0.23, 0.24, mat="sign_blue")
        m.door(-0.04, -0.02, 0.08, 0.12, 0.15, "glass_blue", "white")
        m.steps(-0.04, -0.10, 0.03, 0.20, 2)
    if lod == 0:
        for x in (-0.23, -0.10, 0.08):
            window(m, x, -0.005, 0.17, side="f")
        m.box(-0.31, -0.29, 0.03, 0.09, 0.09, 0.14, "sign_red")
        m.box(-0.31, -0.29, 0.17, 0.10, 0.10, 0.014, "roof_blue")
        m._quad([(-0.26, -0.30, 0.15), (-0.21, -0.30, 0.15), (-0.13, -0.30, 0.04), (-0.18, -0.30, 0.04)], "sign_orange")
        for x in (0.06, 0.23):
            m.box(x, -0.31, 0.03, 0.018, 0.018, 0.16, "metal_dark")
        m.box(0.145, -0.31, 0.19, 0.22, 0.018, 0.018, "metal_dark")
        m.fence(-0.43, -0.42, 0.36, -0.42, 0.05, "metal_dark", 9)
        m.box(0.12, -0.31, 0.075, 0.09, 0.012, 0.012, "sign_blue")


def _fire(m: Model, lod: int):
    ground(m, lawn=False, driveway=True)
    _civic_shell(m, lod, 0.06, 0.06, 0.62, 0.42, 0.32, "wall_white", "sign_red", rows=1)
    m.box(0.06, -0.18, 0.08, 0.62, 0.065, 0.26, "wall_red")
    m.box(-0.35, 0.06, 0.03, 0.18, 0.18, 0.78, "wall_brick", roof="roof_dark")
    if lod < 2:
        m.box(-0.35, 0.06, 0.81, 0.24, 0.24, 0.028, "slab")
        m.sign(0.06, -0.216, 0.25, 0.34, 0.05, "glow_sign")
        for x in (-0.12, 0.06, 0.24):
            m.box(x, -0.22, 0.08, 0.14, 0.016, 0.18, "metal_dark")
            m.box(x, -0.226, 0.17, 0.13, 0.008, 0.010, "metal")
    if lod == 0:
        for z in (0.19, 0.35, 0.51, 0.67):
            window(m, -0.35, -0.03, z, w=0.055, h=0.07, side="f", pane="glow_window", frame="wall_cream")
        m.box(-0.35, -0.07, 0.13, 0.018, 0.06, 0.62, "metal_dark")
        for x in (-0.05, 0.23):
            m.box(x, -0.35, 0.04, 0.19, 0.09, 0.09, "sign_red", roof="sign_red")
            m.box(x + 0.055, -0.35, 0.075, 0.055, 0.085, 0.045, "glass_dark")
        bollards(m, (-0.30, -0.22, 0.34, 0.42), -0.40)
        m.fence(-0.46, 0.42, 0.30, 0.42, 0.06, "metal_dark", 9)


def _reg(n, name, fn):
    @building(n, name, variant="v2", version=1)
    def lod0(m: Model):
        fn(m, 0)

    @building(n, name, variant="v2_lod1", version=1)
    def lod1(m: Model):
        fn(m, 1)

    @building(n, name, variant="v2_lod2", version=1)
    def lod2(m: Model):
        fn(m, 2)


_reg(22, "Biblioteca Municipal", _library)
_reg(23, "Centro Comunitário", _community)
_reg(24, "Delegacia", _police)
_reg(25, "Museu Municipal", _museum)
_reg(26, "Clínica", _clinic)
_reg(28, "Escola Primária", _school)
_reg(30, "Quartel dos Bombeiros", _fire)
