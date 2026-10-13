"""Mayor Visual V2: five ORIGINAL reference buildings with three geometric LODs.

This module is deliberately NOT imported by build_all.py and does NOT register/replace
any of the 40 production models. Blender Z is up; street entrance faces -Y.
LOD 0 = near/detail; LOD 1 = mid; LOD 2 = skyline-preserving silhouette.
All prototypes currently fit the legacy one-tile bounds.
"""
from lib import Model


def starter_house(m: Model, lod: int):
    m.plot(lawn=(lod == 0))
    # Split volumes and pitched roof persist at all LODs, unlike a far-distance box.
    m.box(-0.09, 0.065, 0.03, 0.51, 0.43, 0.29, "wall_cream")
    m.hip(-0.09, 0.065, 0.32, 0.55, 0.47, 0.18, "roof_slate")
    m.box(0.26, 0.095, 0.03, 0.23, 0.35, 0.23, "wall_white")
    m.gable(0.26, 0.095, 0.26, 0.27, 0.39, 0.13, "roof_blue", end="wall_white")
    if lod <= 1:
        m.door(-0.21, -0.154, 0.03, 0.075, 0.14, "wall_wood")
        m.windows(-0.09, 0.065, 0.03, 0.51, 0.43, 0.29, 1, cols=3, sides="fr", lit=0.65)
        m.box(0.26, -0.086, 0.03, 0.17, 0.009, 0.14, "metal_dark")  # garage door
        m.box(-0.21, -0.18, 0.25, 0.21, 0.09, 0.014, "roof_dark")
    if lod == 0:
        m.steps(-0.21, -0.17, 0.03, 0.13, 2)
        m.chimney(0.03, 0.19, 0.4, 0.12)
        m.skylight(-0.14, 0.06, 0.45)
        m.box(0.26, -0.32, 0.03, 0.18, 0.3, 0.012, "concrete")
        m.fence(-0.44, 0.43, 0.44, 0.43, posts=8)
        m.tree(-0.4, 0.32, 0.95)
        m.tree(0.4, 0.34, 0.8, dark=True)
        m.box(-0.4, -0.35, 0.03, 0.025, 0.025, 0.09, "wall_white")


def premium_tower(m: Model, lod: int):
    m.plot(lawn=False)
    m.box(0, 0.045, 0.03, 0.66, 0.52, 0.17, "wall_white", roof="roof_flat")  # lobby podium
    m.box(-0.07, 0.07, 0.20, 0.45, 0.36, 1.82, "wall_white", roof="roof_dark")
    m.box(0.20, 0.13, 0.20, 0.19, 0.27, 1.40, "wall_blue", roof="roof_slate")
    m.box(-0.07, 0.07, 2.02, 0.49, 0.40, 0.06, "slab", roof="roof_dark")
    if lod <= 1:
        m.glass_band(-0.07, 0.07, 0.20, 0.45, 0.36, 1.82, "glass_blue")
        m.windows(-0.07, 0.07, 0.20, 0.45, 0.36, 1.82,
                  9 if lod == 0 else 5, cols=3, sides="f", lit=0.55, slabs=False)
        m.box(0.0, -0.235, 0.03, 0.17, 0.025, 0.14, "glass_dark")
        for z in ((0.41, 0.60, 0.79, 0.98, 1.17, 1.36, 1.55, 1.74) if lod == 0 else (0.55, 1.0, 1.5)):
            m.balcony(-0.20, -0.11, z, 0.15, depth=0.065)
    if lod == 0:
        for x in (-0.2, 0.08):
            m.ac_unit(x, 0.06, 2.08)
        m.box(0.0, -0.29, 0.03, 0.3, 0.08, 0.035, "paving")
        m.tree(-0.41, -0.29, 0.8)
        m.tree(0.41, -0.29, 0.8)


def corporate_tower(m: Model, lod: int):
    m.plot(lawn=False)
    m.box(0.0, 0.02, 0.03, 0.76, 0.55, 0.20, "concrete", roof="roof_flat")
    m.box(-0.11, 0.065, 0.23, 0.43, 0.37, 1.72, "wall_grey", roof="roof_dark")
    m.box(0.23, 0.10, 0.23, 0.22, 0.30, 1.22, "wall_blue", roof="roof_flat")
    m.box(-0.11, 0.065, 1.95, 0.47, 0.41, 0.05, "slab", roof="roof_dark")
    if lod <= 1:
        m.glass_band(-0.11, 0.065, 0.25, 0.43, 0.37, 1.67, "glass_blue")
        m.windows(-0.11, 0.065, 0.25, 0.43, 0.37, 1.67,
                  9 if lod == 0 else 5, cols=3, sides="f", slabs=False)
        m.box(0.0, -0.27, 0.03, 0.25, 0.04, 0.17, "glass_dark")
    if lod == 0:
        for x in (-0.22, -0.11, 0.0):
            m.box(x, -0.165, 0.23, 0.009, 0.015, 1.7, "metal")
        for z in (0.56, 0.89, 1.22, 1.55):
            m.box(-0.11, -0.155, z, 0.43, 0.012, 0.014, "slab")
        m.ac_unit(-0.2, 0.04, 2.0)
        m.ac_unit(-0.02, 0.08, 2.0)
        m.box(0.25, -0.30, 0.03, 0.28, 0.10, 0.04, "paving")
        m.tree(-0.42, -0.3, 0.8)


def city_hall(m: Model, lod: int):
    m.plot(lawn=False)
    # Symmetric wings, elevated central portico, stepped civic tower.
    m.box(0, 0.13, 0.03, 0.82, 0.40, 0.33, "wall_cream")
    m.box(-0.29, 0.08, 0.03, 0.20, 0.49, 0.29, "wall_white")
    m.box(0.29, 0.08, 0.03, 0.20, 0.49, 0.29, "wall_white")
    m.hip(0, 0.13, 0.36, 0.85, 0.44, 0.14, "roof_slate")
    m.box(0, 0.12, 0.50, 0.15, 0.15, 0.21, "wall_cream")
    m.pyramid(0, 0.12, 0.71, 0.18, 0.18, 0.12, "roof_blue")
    m.box(0, -0.13, 0.03, 0.32, 0.21, 0.035, "concrete")
    if lod <= 1:
        m.box(0, -0.145, 0.31, 0.40, 0.14, 0.03, "slab")
        for x in (-0.16, -0.055, 0.055, 0.16):
            m.box(x, -0.18, 0.06, 0.021, 0.021, 0.25, "wall_white")
        m.box(0, -0.08, 0.53, 0.1, 0.012, 0.10, "wall_white")  # clock face
        m.door(0, -0.089, 0.03, 0.08, 0.16, "wall_wood")
        m.windows(0, 0.13, 0.03, 0.82, 0.40, 0.33, 1, cols=6, sides="b", lit=0.4, slabs=False)
    if lod == 0:
        m.steps(0, -0.19, 0.03, 0.27, 3, depth=0.025)
        for x in (-0.34, 0.34):
            m.box(x, -0.13, 0.15, 0.10, 0.014, 0.14, "glass_dark")
        m.box(0.0, -0.34, 0.03, 0.26, 0.25, 0.01, "paving")
        m.tree(-0.41, -0.31, 0.8, dark=True)
        m.tree(0.41, -0.31, 0.8)


def heavy_factory(m: Model, lod: int):
    m.plot(lawn=False)
    m.box(-0.10, 0.075, 0.03, 0.61, 0.49, 0.35, "wall_brick", roof="roof_flat")
    m.gable(-0.10, 0.075, 0.38, 0.63, 0.51, 0.10, "roof_slate", end="wall_brick", ridge="x")
    m.box(0.26, 0.13, 0.03, 0.20, 0.39, 0.27, "wall_grey", roof="roof_dark")
    # Chimneys and silos form the recognizable long-distance skyline.
    m.cyl(-0.28, 0.26, 0.40, 0.052, 1.02, "wall_grey", seg=8 if lod != 0 else 12)
    m.cyl(0.29, 0.28, 0.30, 0.040, 0.82, "wall_brick", seg=8 if lod != 0 else 12)
    for x in (-0.40, -0.25):
        m.cyl(x, 0.39, 0.03, 0.055, 0.36, "metal", seg=7 if lod == 2 else 10)
    if lod <= 1:
        for x in (-0.30, -0.12, 0.06):
            m.box(x, -0.174, 0.03, 0.14, 0.014, 0.16, "metal_dark")  # loading docks
        m.box(-0.28, 0.26, 1.15, 0.115, 0.115, 0.05, "sign_red")
        m.box(0.29, 0.28, 0.95, 0.095, 0.095, 0.05, "sign_red")
        m.box(0.13, 0.12, 0.32, 0.27, 0.025, 0.03, "metal")
        m.windows(-0.10, 0.075, 0.03, 0.61, 0.49, 0.35, 1, cols=5, sides="f", lit=0.45)
    if lod == 0:
        for x in (-0.30, -0.12, 0.06):
            m.box(x, -0.24, 0.03, 0.15, 0.10, 0.02, "concrete")
        m.ac_unit(0.26, 0.14, 0.31)
        m.box(0.29, -0.31, 0.03, 0.21, 0.10, 0.09, "wall_white")
        m.fence(-0.45, 0.45, 0.45, 0.45, posts=9)


REFERENCE_MODELS = {
    1: ("Starter House", starter_house),
    10: ("Premium Tower", premium_tower),
    20: ("Corporate Tower", corporate_tower),
    21: ("City Hall", city_hall),
    38: ("Heavy Factory", heavy_factory),
}
