"""Local v2d dressing helpers for transport, utility, and industry v2 models."""
import math


def slab(m, cx, cy, z, w, d, mat="concrete", h=0.006):
    m.box(cx, cy, z, w, d, h, mat, roof=mat)


def ground_grid(m, cx, cy, w, d, nx=3, ny=3, mat="slab"):
    for i in range(1, nx):
        x = cx - w / 2 + w * i / nx
        m.box(x, cy, 0.038, 0.006, d, 0.003, mat)
    for j in range(1, ny):
        y = cy - d / 2 + d * j / ny
        m.box(cx, y, 0.038, w, 0.006, 0.003, mat)


def parapet(m, cx, cy, z, w, d, h=0.045, t=0.02, mat="concrete"):
    m.box(cx, cy - d / 2 + t / 2, z, w, t, h, mat)
    m.box(cx, cy + d / 2 - t / 2, z, w, t, h, mat)
    m.box(cx - w / 2 + t / 2, cy, z, t, d - 2 * t, h, mat)
    m.box(cx + w / 2 - t / 2, cy, z, t, d - 2 * t, h, mat)


def roof_seams(m, cx, cy, z, w, d, count=5, along="x", mat="metal_dark"):
    for i in range(1, count + 1):
        t = i / (count + 1) - 0.5
        if along == "x":
            m.box(cx + t * w, cy, z, 0.008, d * 0.94, 0.01, mat)
        else:
            m.box(cx, cy + t * d, z, w * 0.94, 0.008, 0.01, mat)


def framed_window(m, x, y, z, w=0.08, h=0.075, side="f", lit=True, frame="white"):
    mat = "glow_window" if lit else "glass_dark"
    s = -1 if side in ("f", "l") else 1
    if side in ("f", "b"):
        m.box(x, y + s * 0.003, z - h / 2 - 0.006, w + 0.022, 0.010, h + 0.018, frame)
        yp = y + s * 0.010
        pts = [(x - w / 2, yp, z - h / 2), (x + w / 2, yp, z - h / 2),
               (x + w / 2, yp, z + h / 2), (x - w / 2, yp, z + h / 2)]
        m._quad(pts if side == "f" else list(reversed(pts)), mat)
        m.box(x, y + s * 0.011, z - h / 2 - 0.018, w + 0.035, 0.018, 0.012, frame)
    else:
        m.box(y + s * 0.003, x, z - h / 2 - 0.006, 0.010, w + 0.022, h + 0.018, frame)
        xp = y + s * 0.010
        pts = [(xp, x - w / 2, z - h / 2), (xp, x + w / 2, z - h / 2),
               (xp, x + w / 2, z + h / 2), (xp, x - w / 2, z + h / 2)]
        m._quad(pts if side == "r" else list(reversed(pts)), mat)
        m.box(y + s * 0.011, x, z - h / 2 - 0.018, 0.018, w + 0.035, 0.012, frame)


def dock_door(m, x, y, w=0.13, h=0.14, mat="metal_dark"):
    m.box(x, y, 0.03, w + 0.018, 0.014, h + 0.016, "concrete")
    m.box(x, y - 0.006, 0.035, w, 0.010, h, mat)
    for z in (0.075, 0.115, 0.155):
        m.box(x, y - 0.012, z, w * 0.94, 0.006, 0.008, "metal")


def bollards(m, xs, y, mat="sign_orange"):
    for x in xs:
        m.cyl(x, y, 0.03, 0.011, 0.065, mat, seg=6)
        m.cyl(x, y, 0.09, 0.012, 0.01, "metal_dark", seg=6)


def fence_rect(m, x0=-0.46, y0=-0.46, x1=0.46, y1=0.46, open_front=0.22, h=0.08):
    if open_front:
        m.fence(x0, y0, -open_front / 2, y0, h, "metal_dark", 5)
        m.fence(open_front / 2, y0, x1, y0, h, "metal_dark", 5)
    else:
        m.fence(x0, y0, x1, y0, h, "metal_dark", 9)
    m.fence(x0, y0, x0, y1, h, "metal_dark", 7)
    m.fence(x1, y0, x1, y1, h, "metal_dark", 7)
    m.fence(x0, y1, x1, y1, h, "metal_dark", 9)


def lamp(m, x, y, h=0.24):
    m.cyl(x, y, 0.03, 0.008, h, "lamp_pole", seg=5)
    m.box(x, y - 0.025, 0.03 + h, 0.014, 0.055, 0.012, "lamp_pole")
    m.box(x, y - 0.052, 0.02 + h, 0.034, 0.026, 0.018, "glow_lamp")


def hpipe(m, cx, cy, z, length, r=0.012, axis="x", mat="metal", seg=6):
    for i in range(seg):
        a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
        c0, s0 = math.cos(a0) * r, math.sin(a0) * r
        c1, s1 = math.cos(a1) * r, math.sin(a1) * r
        if axis == "x":
            x0, x1 = cx - length / 2, cx + length / 2
            m._quad([(x0, cy + c0, z + s0), (x0, cy + c1, z + s1),
                     (x1, cy + c1, z + s1), (x1, cy + c0, z + s0)], mat)
        else:
            y0, y1 = cy - length / 2, cy + length / 2
            m._quad([(cx + c0, y0, z + s0), (cx + c0, y1, z + s0),
                     (cx + c1, y1, z + s1), (cx + c1, y0, z + s1)], mat)


def tank_ladder(m, x, y, z0, h, front=True):
    off = -0.006 if front else 0.006
    m.box(x - 0.018, y + off, z0 + h / 2, 0.006, 0.006, h, "metal_dark")
    m.box(x + 0.018, y + off, z0 + h / 2, 0.006, 0.006, h, "metal_dark")
    for i in range(4):
        z = z0 + 0.025 + i * (h - 0.05) / 3
        m.box(x, y + off, z, 0.05, 0.006, 0.006, "metal_dark")


def container(m, cx, cy, z, w, d, h, mat, along="x", ribs=4):
    m.box(cx, cy, z, w, d, h, mat, roof=mat)
    for i in range(ribs):
        t = -0.5 + (i + 0.5) / ribs
        if along == "x":
            m.box(cx + t * w, cy, z + h / 2, 0.006, d + 0.006, h * 0.9, "metal_dark")
        else:
            m.box(cx, cy + t * d, z + h / 2, w + 0.006, 0.006, h * 0.9, "metal_dark")


def bus(m, cx, cy, mat="white", stripe="sign_blue"):
    m.box(cx, cy, 0.045, 0.16, 0.34, 0.12, mat, roof=mat)
    m.box(cx, cy - 0.02, 0.13, 0.15, 0.24, 0.045, "glass_dark")
    m.box(cx, cy - 0.19, 0.085, 0.13, 0.012, 0.03, "glow_window")
    m.box(cx, cy - 0.05, 0.065, 0.166, 0.010, 0.025, stripe)
    for sx in (-1, 1):
        for yy in (-0.12, 0.10):
            m.wheel(cx + sx * 0.083, cy + yy, 0.045, 0.018, 0.01, seg=6)


def truck(m, cx, cy, body="white", cab="sign_blue", along="x"):
    if along == "x":
        m.box(cx - 0.04, cy, 0.05, 0.25, 0.11, 0.12, body, roof=body)
        m.box(cx + 0.13, cy, 0.045, 0.08, 0.10, 0.09, cab, roof=cab)
        m.box(cx + 0.14, cy - 0.045, 0.11, 0.045, 0.008, 0.035, "glass_dark")
    else:
        m.box(cx, cy + 0.04, 0.05, 0.11, 0.25, 0.12, body, roof=body)
        m.box(cx, cy - 0.13, 0.045, 0.10, 0.08, 0.09, cab, roof=cab)
        m.box(cx, cy - 0.17, 0.11, 0.045, 0.008, 0.035, "glass_dark")
