"""Vehicles, boats and street furniture. Vehicles drive along +X (the game rotates them); length 1 = one tile."""
from registry import prop


def _wheels(m, xs, half_w, r=0.034, w=0.03, z=None, seg=6):
    z = r if z is None else z
    for x in xs:
        for side in (-1, 1):
            m.wheel(x, side * (half_w - w / 2 + 0.004), z, r, w, seg=seg)


def _car(m, length, width, body_h, cabin_l, cabin_h, cabin_off=-0.02, wheel_r=0.034):
    lift = wheel_r * 0.8
    m.box(0, 0, lift, length, width, body_h, "car_body", roof="car_body")
    # cabin with glass on all four sides and the roof in body colour
    cz = lift + body_h
    m.box(cabin_off, 0, cz, cabin_l, width * 0.84, cabin_h, "car_glass", roof="car_body")
    # bumpers, lights
    m.box(length / 2 - 0.004, 0, lift + 0.01, 0.012, width * 0.9, 0.025, "black")
    m.box(-length / 2 + 0.004, 0, lift + 0.01, 0.012, width * 0.9, 0.025, "black")
    for s in (-1, 1):
        m._quad([(length / 2 + 0.002, s * width * 0.32 - 0.02, lift + body_h * 0.55), (length / 2 + 0.002, s * width * 0.32 + 0.02, lift + body_h * 0.55),
                 (length / 2 + 0.002, s * width * 0.32 + 0.02, lift + body_h * 0.9), (length / 2 + 0.002, s * width * 0.32 - 0.02, lift + body_h * 0.9)], "glow_head")
        m._quad([(-length / 2 - 0.002, s * width * 0.32 + 0.02, lift + body_h * 0.55), (-length / 2 - 0.002, s * width * 0.32 - 0.02, lift + body_h * 0.55),
                 (-length / 2 - 0.002, s * width * 0.32 - 0.02, lift + body_h * 0.9), (-length / 2 - 0.002, s * width * 0.32 + 0.02, lift + body_h * 0.9)], "glow_tail")
    _wheels(m, (length * 0.3, -length * 0.3), width / 2, r=wheel_r)


@prop("car_sedan")
def car_sedan(m):
    _car(m, 0.40, 0.17, 0.07, 0.21, 0.06)


@prop("car_hatch")
def car_hatch(m):
    _car(m, 0.33, 0.165, 0.07, 0.2, 0.07, cabin_off=-0.04)


@prop("car_suv")
def car_suv(m):
    _car(m, 0.40, 0.18, 0.09, 0.27, 0.07, cabin_off=-0.04, wheel_r=0.04)


@prop("van")
def van(m):
    _car(m, 0.42, 0.18, 0.1, 0.3, 0.09, cabin_off=-0.04, wheel_r=0.038)


@prop("truck")
def truck(m):
    r = 0.04
    lift = r * 0.8
    m.box(0.12, 0, lift, 0.2, 0.19, 0.1, "car_glass", roof="car_body")           # cab
    m.box(0.12, 0, lift, 0.2, 0.19, 0.05, "car_body")
    m.box(-0.1, 0, lift + 0.01, 0.36, 0.2, 0.2, "car_body", roof="car_body")     # cargo box
    m.box(0, 0, lift - 0.005, 0.66, 0.15, 0.02, "metal_dark")                    # chassis
    for s in (-1, 1):
        m._quad([(0.222, s * 0.06 - 0.025, lift + 0.03), (0.222, s * 0.06 + 0.025, lift + 0.03), (0.222, s * 0.06 + 0.025, lift + 0.05), (0.222, s * 0.06 - 0.025, lift + 0.05)], "glow_head")
        m._quad([(-0.282, s * 0.06 + 0.025, lift + 0.03), (-0.282, s * 0.06 - 0.025, lift + 0.03), (-0.282, s * 0.06 - 0.025, lift + 0.05), (-0.282, s * 0.06 + 0.025, lift + 0.05)], "glow_tail")
    _wheels(m, (0.2, -0.12, -0.22), 0.1, r=r, w=0.036)


@prop("bus")
def bus(m):
    r = 0.04
    lift = r * 0.8
    L, W, H = 0.78, 0.25, 0.22
    m.box(0, 0, lift, L, W, H, "car_body", roof="car_body")
    # a continuous glass strip down both sides and across the windscreen
    for s in (-1, 1):
        y = s * (W / 2 + 0.002)
        m._quad([(-L / 2 + 0.04, y, lift + 0.09), (L / 2 - 0.04, y, lift + 0.09), (L / 2 - 0.04, y, lift + H - 0.03), (-L / 2 + 0.04, y, lift + H - 0.03)], "car_glass") if s < 0 else \
            m._quad([(L / 2 - 0.04, y, lift + 0.09), (-L / 2 + 0.04, y, lift + 0.09), (-L / 2 + 0.04, y, lift + H - 0.03), (L / 2 - 0.04, y, lift + H - 0.03)], "car_glass")
    m._quad([(L / 2 + 0.002, -W / 2 + 0.02, lift + 0.09), (L / 2 + 0.002, W / 2 - 0.02, lift + 0.09), (L / 2 + 0.002, W / 2 - 0.02, lift + H - 0.03), (L / 2 + 0.002, -W / 2 + 0.02, lift + H - 0.03)], "car_glass")
    m.box(-0.05, 0, lift + H, 0.22, 0.14, 0.03, "metal")                         # roof unit
    m.box(L / 2 - 0.004, 0, lift + 0.02, 0.012, W * 0.92, 0.04, "black")
    for s in (-1, 1):
        m._quad([(L / 2 + 0.003, s * 0.085 - 0.02, lift + 0.05), (L / 2 + 0.003, s * 0.085 + 0.02, lift + 0.05), (L / 2 + 0.003, s * 0.085 + 0.02, lift + 0.08), (L / 2 + 0.003, s * 0.085 - 0.02, lift + 0.08)], "glow_head")
    _wheels(m, (0.26, -0.24), W / 2, r=r, w=0.036)


@prop("train")
def train(m):
    L, W, H = 1.0, 0.3, 0.26
    lift = 0.03
    m.box(0, 0, lift, L, W, H, "car_body", roof="car_body")
    for s in (-1, 1):
        y = s * (W / 2 + 0.002)
        for i in range(4):
            x0 = -L / 2 + 0.07 + i * 0.22
            pts = [(x0, y, lift + 0.1), (x0 + 0.15, y, lift + 0.1), (x0 + 0.15, y, lift + H - 0.05), (x0, y, lift + H - 0.05)]
            m._quad(pts if s < 0 else list(reversed(pts)), "car_glass")
    m.box(L / 2 - 0.005, 0, lift + 0.1, 0.012, W * 0.8, H - 0.16, "car_glass")
    m.box(0, 0, lift - 0.015, L * 0.9, W * 0.7, 0.02, "metal_dark")
    m._quad([(L / 2 + 0.003, -0.07, lift + 0.03), (L / 2 + 0.003, 0.07, lift + 0.03), (L / 2 + 0.003, 0.07, lift + 0.07), (L / 2 + 0.003, -0.07, lift + 0.07)], "glow_head")


@prop("boat_motor")
def boat_motor(m):
    # pointed hull built from three boxes tapering to the bow, with a small cabin
    m.box(-0.06, 0, 0.0, 0.36, 0.17, 0.07, "hull_white", roof="metal")
    m.box(0.16, 0, 0.0, 0.1, 0.12, 0.06, "hull_white", roof="metal")
    m.box(0.24, 0, 0.0, 0.06, 0.06, 0.05, "hull_white", roof="metal")
    m.box(0.0, 0, 0.0, 0.46, 0.172, 0.02, "hull_blue")
    m.box(-0.04, 0, 0.07, 0.16, 0.11, 0.08, "car_glass", roof="hull_white")


@prop("boat_sail")
def boat_sail(m):
    m.box(-0.04, 0, 0.0, 0.34, 0.12, 0.06, "hull_white", roof="bench_wood")
    m.box(0.15, 0, 0.0, 0.1, 0.08, 0.05, "hull_white", roof="bench_wood")
    m.box(0.0, 0, 0.0, 0.42, 0.122, 0.015, "hull_blue")
    m.cyl(0.0, 0, 0.06, 0.008, 0.46, "metal", seg=5)
    m._tri([(0.0, 0.004, 0.14), (0.0, 0.004, 0.5), (-0.22, 0.004, 0.14)], "sail")
    m._tri([(0.0, -0.004, 0.14), (-0.22, -0.004, 0.14), (0.0, -0.004, 0.5)], "sail")
    m._tri([(0.02, 0.004, 0.16), (0.02, 0.004, 0.46), (0.17, 0.004, 0.16)], "sail")
    m._tri([(0.02, -0.004, 0.16), (0.17, -0.004, 0.16), (0.02, -0.004, 0.46)], "sail")


@prop("boat_ferry")
def boat_ferry(m):
    m.box(0, 0, 0.0, 0.72, 0.22, 0.09, "hull_white", roof="metal")
    m.box(0.37, 0, 0.0, 0.1, 0.16, 0.08, "hull_white", roof="metal")
    m.box(0.0, 0, 0.0, 0.74, 0.222, 0.025, "hull_blue")
    m.box(-0.04, 0, 0.09, 0.46, 0.17, 0.1, "car_glass", roof="hull_white")
    m.box(-0.1, 0, 0.19, 0.26, 0.13, 0.07, "car_glass", roof="hull_white")
    m.cyl(-0.2, 0, 0.26, 0.025, 0.1, "sign_red", seg=6)


# ---- street furniture -------------------------------------------------------

@prop("lamp")
def lamp(m):
    m.cyl(0, 0, 0, 0.012, 0.3, "lamp_pole", seg=5, r_top=0.008)
    m.box(0.03, 0, 0.29, 0.08, 0.014, 0.014, "lamp_pole")
    m.box(0.07, 0, 0.275, 0.05, 0.03, 0.016, "glow_lamp", roof="lamp_pole")


@prop("bench")
def bench(m):
    m.box(0, 0, 0.04, 0.14, 0.045, 0.012, "bench_wood")
    m.box(0, 0.02, 0.06, 0.14, 0.01, 0.045, "bench_wood")
    for x in (-0.055, 0.055):
        m.box(x, 0, 0.0, 0.012, 0.04, 0.04, "metal_dark")


@prop("hydrant")
def hydrant(m):
    m.cyl(0, 0, 0, 0.014, 0.045, "sign_red", seg=6)
    m.cone(0, 0, 0.045, 0.014, 0.014, "sign_red", seg=6)
