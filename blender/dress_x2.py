"""Shared dressing helpers for 2x2 service-building variants."""
import math

from lib import Model


def slab(m: Model, w=1.96, d=1.96, mat="paving"):
    m.box(0, 0, 0, w, d, 0.03, mat, roof=mat)


def curb(m: Model, x0, x1, y, mat="concrete"):
    m.box((x0 + x1) / 2, y, 0.033, abs(x1 - x0), 0.018, 0.012, mat)


def stripe(m: Model, cx, cy, w, d, mat="white"):
    m.box(cx, cy, 0.036, w, d, 0.004, mat, roof=mat)


def low_wall(m: Model, cx, cy, w, d, h=0.08, mat="metal_dark"):
    m.box(cx, cy, 0.03, w, d, h, mat)


def fence_rect(m: Model, x0=-0.96, x1=0.96, y0=-0.96, y1=0.96, mat="metal_dark"):
    low_wall(m, (x0 + x1) / 2, y0, x1 - x0, 0.012, 0.06, mat)
    low_wall(m, (x0 + x1) / 2, y1, x1 - x0, 0.012, 0.06, mat)
    low_wall(m, x0, (y0 + y1) / 2, 0.012, y1 - y0, 0.06, mat)
    low_wall(m, x1, (y0 + y1) / 2, 0.012, y1 - y0, 0.06, mat)


def column(m: Model, x, y, z0, h, w=0.04, mat="wall_white"):
    m.box(x, y, z0, w, w, h, mat)


def cross(m: Model, cx, y, z, s=0.12, mat="sign_red"):
    m.box(cx, y, z, s, 0.018, s * 0.34, mat)
    m.box(cx, y, z - s * 0.28, s * 0.34, 0.018, s, mat)


def flagpole(m: Model, x, y, color="sign_green"):
    m.cyl(x, y, 0.03, 0.008, 0.5, "metal", seg=5)
    m.box(x + 0.055, y, 0.43, 0.11, 0.01, 0.07, color)


def fountain(m: Model, cx, cy):
    m.cyl(cx, cy, 0.03, 0.13, 0.055, "concrete", seg=12)
    m.cyl(cx, cy, 0.075, 0.105, 0.012, "water", seg=12)
    m.cyl(cx, cy, 0.085, 0.035, 0.09, "concrete", seg=8)
    m.cone(cx, cy, 0.17, 0.055, 0.06, "water", seg=8)


def helipad(m: Model, cx, cy, z0=0.033, r=0.22):
    m.cyl(cx, cy, z0, r, 0.008, "asphalt", seg=16)
    zw = z0 + 0.009
    m.box(cx, cy, zw, r * 1.25, 0.025, 0.004, "white", roof="white")
    m.box(cx - r * 0.28, cy, zw, 0.025, r * 1.1, 0.004, "white", roof="white")
    m.box(cx + r * 0.28, cy, zw, 0.025, r * 1.1, 0.004, "white", roof="white")


def parked_row(m: Model, xs, y, along="y"):
    mats = ("sign_blue", "wall_red", "wall_white", "sign_orange", "wall_green")
    for i, x in enumerate(xs):
        m.parked_car(x, y, mats[i % len(mats)], along=along)


def ambulance(m: Model, cx, cy):
    m.box(cx, cy, 0.045, 0.09, 0.17, 0.08, "wall_white")
    m.box(cx, cy - 0.09, 0.045, 0.08, 0.055, 0.055, "wall_white")
    cross(m, cx, cy + 0.094, 0.085, s=0.045)


def court(m: Model, cx, cy, w, d):
    m.box(cx, cy, 0.033, w, d, 0.006, "wall_green", roof="wall_green")
    stripe(m, cx, cy - d * 0.45, w * 0.9, 0.008)
    stripe(m, cx, cy + d * 0.45, w * 0.9, 0.008)
    stripe(m, cx - w * 0.45, cy, 0.008, d * 0.9)
    stripe(m, cx + w * 0.45, cy, 0.008, d * 0.9)
    stripe(m, cx, cy, w * 0.9, 0.008)
    m.cyl(cx, cy, 0.037, min(w, d) * 0.12, 0.004, "white", seg=12)


def tank(m: Model, cx, cy, r, h=0.18, water=True):
    m.cyl(cx, cy, 0.03, r, h, "concrete", seg=14)
    if water:
        m.cyl(cx, cy, 0.03 + h - 0.012, r * 0.88, 0.012, "water", seg=14)
    m.box(cx, cy, 0.03 + h + 0.006, r * 1.8, 0.02, 0.02, "metal_dark")


def pipe(m: Model, x0, x1, y, z, mat="metal_dark"):
    m.box((x0 + x1) / 2, y, z, abs(x1 - x0), 0.025, 0.025, mat)
    for x in (x0, x1):
        m.box(x, y, 0.03, 0.018, 0.018, z - 0.03, mat)


def rail_pair(m: Model, y, x0=-0.92, x1=0.92):
    for off in (-0.035, 0.035):
        m.box((x0 + x1) / 2, y + off, 0.038, x1 - x0, 0.012, 0.012, "metal_dark")
    for i in range(13):
        x = x0 + (x1 - x0) * i / 12
        m.box(x, y, 0.032, 0.018, 0.18, 0.008, "trunk")


def cooling_tower(m: Model, cx, cy, r, h):
    m.cyl(cx, cy, 0.03, r, h, "concrete", seg=14, r_top=r * 0.66)
    m.cyl(cx, cy, 0.03 + h - 0.015, r * 0.55, 0.012, "black", seg=12)
    m.box(cx, cy - r * 0.7, 0.1, r * 0.9, 0.014, 0.07, "metal_dark")


def coal_pile(m: Model, cx, cy, rx=0.18, ry=0.12):
    for i, scale in enumerate((1.0, 0.72, 0.48)):
        z = 0.035 + i * 0.035
        pts = []
        for j in range(9):
            a = 2 * math.pi * j / 9
            pts.append((cx + math.cos(a) * rx * scale, cy + math.sin(a) * ry * scale, z))
        top = (cx, cy, z + 0.06)
        for j in range(9):
            m._tri([pts[j], pts[(j + 1) % 9], top], "black")
