"""Vehicles, boats and street furniture. Vehicles drive along +X (the game rotates them); length 1 = one tile."""
from registry import prop
import dress_vehicles2 as dress


def _side_quad(m, x0, x1, y, z0, z1, side, mat):
    """Outward-facing quad on a +Y (side = +1) or -Y (side = -1) flank."""
    if side > 0:
        m._quad([(x1, y, z0), (x0, y, z0), (x0, y, z1), (x1, y, z1)], mat)
    else:
        m._quad([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], mat)


def _face_quad(m, x, y0, y1, z0, z1, facing, mat):
    """Outward-facing quad on the front (+X, facing = +1) or rear (facing = -1) face."""
    if facing > 0:
        m._quad([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], mat)
    else:
        m._quad([(x, y1, z0), (x, y0, z0), (x, y0, z1), (x, y1, z1)], mat)


def _wheels(m, xs, half_w, r=0.034, w=0.03, z=None, seg=8, arches=True):
    """Wheels with rim faces, spoke bars, hub caps and dark arch wells behind them."""
    zc = r if z is None else z
    for x in xs:
        for side in (-1, 1):
            y = side * (half_w - w / 2 + 0.004)
            m.wheel(x, y, zc, r, w, seg=seg)
            yo = y + side * (w / 2 + 0.0012)
            hr, sw = r * 0.8, r * 0.16
            _side_quad(m, x - hr, x + hr, yo, zc - sw, zc + sw, side, "metal_dark")
            _side_quad(m, x - sw, x + sw, yo, zc - hr, zc + hr, side, "metal_dark")
            yh, hr2 = yo + side * 0.0008, r * 0.34
            _side_quad(m, x - hr2, x + hr2, yh, zc - hr2, zc + hr2, side, "black")
            if arches:
                _side_quad(m, x - r - 0.008, x + r + 0.008, side * (half_w + 0.0015),
                           zc - 0.01, zc + r + 0.006, side, "black")


def _plates(m, front, back, z, w=0.036, h=0.014):
    """License plates on the bumper faces; either end may be None."""
    if front is not None:
        _face_quad(m, front, -w / 2, w / 2, z, z + h, +1, "white")
    if back is not None:
        _face_quad(m, back, -w / 2, w / 2, z, z + h, -1, "white")


def _grille(m, x, z0, z1, w=0.07):
    _face_quad(m, x, -w / 2, w / 2, z0, z1, +1, "black")
    mid = (z0 + z1) / 2
    _face_quad(m, x + 0.0008, -w / 2 + 0.004, w / 2 - 0.004, mid - 0.002, mid + 0.002, +1, "metal_dark")


def _mirrors(m, x, z, half_w, housing="car_body"):
    """Side mirrors: body-colour housings biting into the glasshouse, glass facing the driver."""
    for s in (-1, 1):
        my = s * (half_w + 0.005)
        m.box(x, my, z, 0.016, 0.012, 0.014, housing, roof=housing)
        _face_quad(m, x - 0.0088, my - 0.004, my + 0.004, z + 0.002, z + 0.012, -1, "glass_dark")


def _door_seams(m, xs, half_w, z0, z1, handles=(), hz=None):
    """Vertical door shut-lines with small grab handles; xs are absolute x positions."""
    for s in (-1, 1):
        y = s * (half_w + 0.0012)
        for dx in xs:
            _side_quad(m, dx - 0.0012, dx + 0.0012, y, z0, z1, s, "black")
        hh = z1 - 0.006 if hz is None else hz
        for hx in handles:
            _side_quad(m, hx - 0.004, hx + 0.004, y, hh - 0.0025, hh + 0.0025, s, "metal_dark")


def _car(m, length, width, body_h, cabin_l, cabin_h, cabin_off=-0.02, wheel_r=0.034):
    lift = wheel_r * 0.8
    hw = width / 2
    front, back = length / 2, -length / 2
    m.box(0, 0, lift, length, width, body_h, "car_body", roof="car_body")
    # cabin with glass on all four sides and the roof in body colour
    cz = lift + body_h
    m.box(cabin_off, 0, cz, cabin_l, width * 0.84, cabin_h, "glass_dark", roof="car_body")
    # bumpers, grille, plates
    m.box(front - 0.004, 0, lift + 0.01, 0.012, width * 0.9, 0.025, "black")
    m.box(back + 0.004, 0, lift + 0.01, 0.012, width * 0.9, 0.025, "black")
    _grille(m, front + 0.0025, lift + 0.022, lift + 0.042, width * 0.44)
    _plates(m, front + 0.0028, back - 0.0028, lift + 0.004)
    # headlight and tail-light recesses with the glow quads set inside them
    for s in (-1, 1):
        y0 = s * width * 0.32
        z0, z1 = lift + body_h * 0.55, lift + body_h * 0.9
        _face_quad(m, front + 0.0018, y0 - 0.024, y0 + 0.024, z0 - 0.004, z1 + 0.004, +1, "black")
        _face_quad(m, front + 0.0026, y0 - 0.02, y0 + 0.02, z0, z1, +1, "glow_head")
        _face_quad(m, back - 0.0018, y0 - 0.024, y0 + 0.024, z0 - 0.004, z1 + 0.004, -1, "black")
        _face_quad(m, back - 0.0026, y0 - 0.02, y0 + 0.02, z0, z1, -1, "glow_tail")
    # door seams, handles and mirrors
    _door_seams(m, (cabin_off + cabin_l * 0.28, cabin_off - cabin_l * 0.28), hw, lift + 0.01, cz - 0.002,
                handles=(cabin_off + cabin_l * 0.12, cabin_off - cabin_l * 0.16))
    _mirrors(m, cabin_off + cabin_l / 2 - 0.01, cz + 0.008, width * 0.42)
    _wheels(m, (length * 0.3, -length * 0.3), hw, r=wheel_r)


_car = dress.car
_door_seams = dress.door_seams
_face_quad = dress.face_quad
_glass_pillars = dress.glass_pillars
_grille = dress.grille
_light_clusters = dress.light_clusters
_mirrors = dress.mirrors
_plates = dress.plates
_rear_doors = dress.rear_doors
_side_quad = dress.side_quad
_wheels = dress.wheels


@prop("car_station_wagon")
def car_station_wagon(m):
    _car(m, 0.44, 0.175, 0.072, 0.29, 0.064, cabin_off=-0.055, wheel_r=0.035, roof_detail="rack")
    _glass_pillars(m, (-0.11,), 0.175 * 0.42, 0.032 + 0.072 + 0.008, 0.032 + 0.072 + 0.056)


@prop("car_convertible")
def car_convertible(m):
    _car(m, 0.38, 0.17, 0.065, 0.16, 0.035, cabin_off=-0.015, wheel_r=0.034, rear_glass=False)
    m.box(-0.08, 0, 0.034 * 0.8 + 0.067, 0.14, 0.13, 0.018, "black", roof="black")


@prop("car_coupe")
def car_coupe(m):
    _car(m, 0.37, 0.168, 0.064, 0.18, 0.052, cabin_off=-0.01, wheel_r=0.034)
    m.box(0.07, 0, 0.034 * 0.8 + 0.072, 0.07, 0.14, 0.012, "car_body", roof="car_body")


@prop("van_delivery")
def van_delivery(m):
    r = 0.036
    z = r * 0.8
    hw = 0.092
    front, back = 0.24, -0.23
    m.box(-0.04, 0, z, 0.39, 0.184, 0.15, "car_body", roof="car_body")
    m.box(0.19, 0, z, 0.1, 0.184, 0.078, "car_body", roof="car_body")
    m.box(0.19, 0, z + 0.078, 0.08, 0.16, 0.052, "glass_dark", roof="car_body")
    m.box(front, 0, z + 0.005, 0.014, 0.17, 0.028, "black")
    m.box(back, 0, z + 0.005, 0.014, 0.17, 0.028, "black")
    _grille(m, front + 0.001, z + 0.032, z + 0.052, 0.08)
    _plates(m, front + 0.0078, back - 0.0078, z + 0.008)
    _light_clusters(m, front, back, hw, z + 0.026)
    _mirrors(m, 0.21, z + 0.09, 0.08)
    _door_seams(m, (0.12, -0.06), hw, z + 0.012, z + 0.076, handles=(0.14, -0.02))
    _rear_doors(m, back, z + 0.032, z + 0.14)
    m.box(-0.06, 0, z + 0.15, 0.12, 0.09, 0.018, "metal", roof="metal_dark")
    _wheels(m, (0.16, -0.14), hw, r=r)


@prop("car_minibus")
def car_minibus(m):
    r = 0.034
    z = r * 0.8
    hw = 0.085
    front, back = 0.31, -0.31
    m.box(0, 0, z, 0.62, 0.17, 0.17, "car_body", roof="car_body")
    for s in (-1, 1):
        y = s * (hw + 0.002)
        for x in (-0.17, -0.05, 0.07, 0.19):
            _side_quad(m, x - 0.04, x + 0.04, y, z + 0.085, z + 0.145, s, "glass_dark")
    _face_quad(m, front + 0.002, -0.055, 0.055, z + 0.08, z + 0.15, +1, "glass_dark")
    m.box(0.0, 0, z + 0.17, 0.18, 0.11, 0.022, "metal", roof="metal_dark")
    m.box(front, 0, z + 0.005, 0.014, 0.15, 0.028, "black")
    m.box(back, 0, z + 0.005, 0.014, 0.15, 0.028, "black")
    _grille(m, front + 0.001, z + 0.03, z + 0.05, 0.078)
    _plates(m, front + 0.0078, back - 0.0078, z + 0.008)
    _light_clusters(m, front, back, hw, z + 0.026)
    _door_seams(m, (0.18, 0.08), hw, z + 0.018, z + 0.14, handles=(0.11,))
    _mirrors(m, front - 0.03, z + 0.1, hw)
    _wheels(m, (0.2, -0.2), hw, r=r)


@prop("car_suv_long")
def car_suv_long(m):
    _car(m, 0.47, 0.185, 0.092, 0.31, 0.073, cabin_off=-0.055, wheel_r=0.041, roof_detail="rack")


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
    cab_f, back = 0.22, -0.28
    m.box(0.12, 0, lift, 0.2, 0.19, 0.1, "glass_dark", roof="car_body")           # cab
    m.box(0.12, 0, lift, 0.2, 0.19, 0.05, "car_body")
    m.box(-0.1, 0, lift + 0.01, 0.36, 0.2, 0.2, "car_body", roof="car_body")     # cargo box
    m.box(0, 0, lift - 0.005, 0.66, 0.15, 0.02, "metal_dark")                    # chassis
    m.box(cab_f, 0, lift + 0.005, 0.014, 0.175, 0.028, "black")                  # bumpers
    m.box(back, 0, lift + 0.005, 0.014, 0.19, 0.028, "black")
    _grille(m, cab_f + 0.001, lift + 0.032, lift + 0.052, 0.09)
    _plates(m, cab_f + 0.0078, back - 0.0078, lift + 0.008, w=0.04)
    for s in (-1, 1):
        y0 = s * 0.06
        _face_quad(m, cab_f + 0.001, y0 - 0.029, y0 + 0.029, lift + 0.026, lift + 0.054, +1, "black")
        _face_quad(m, cab_f + 0.002, y0 - 0.025, y0 + 0.025, lift + 0.03, lift + 0.05, +1, "glow_head")
        _face_quad(m, back - 0.001, y0 - 0.029, y0 + 0.029, lift + 0.026, lift + 0.054, -1, "black")
        _face_quad(m, back - 0.002, y0 - 0.025, y0 + 0.025, lift + 0.03, lift + 0.05, -1, "glow_tail")
    _mirrors(m, cab_f - 0.03, lift + 0.062, 0.095)
    _door_seams(m, (0.05,), 0.095, lift + 0.01, lift + 0.048, handles=(0.09,))
    _wheels(m, (0.2, -0.12, -0.22), 0.1, r=r, w=0.036)


@prop("bus")
def bus(m):
    r = 0.04
    lift = r * 0.8
    L, W, H = 0.78, 0.25, 0.22
    hw = W / 2
    front, back = L / 2, -L / 2
    m.box(0, 0, lift, L, W, H, "car_body", roof="car_body")
    # a continuous glass strip down both sides and across the windscreen
    for s in (-1, 1):
        y = s * (W / 2 + 0.002)
        m._quad([(-L / 2 + 0.04, y, lift + 0.09), (L / 2 - 0.04, y, lift + 0.09), (L / 2 - 0.04, y, lift + H - 0.03), (-L / 2 + 0.04, y, lift + H - 0.03)], "glass_dark") if s < 0 else \
            m._quad([(L / 2 - 0.04, y, lift + 0.09), (-L / 2 + 0.04, y, lift + 0.09), (-L / 2 + 0.04, y, lift + H - 0.03), (L / 2 - 0.04, y, lift + H - 0.03)], "glass_dark")
    m._quad([(L / 2 + 0.002, -W / 2 + 0.02, lift + 0.09), (L / 2 + 0.002, W / 2 - 0.02, lift + 0.09), (L / 2 + 0.002, W / 2 - 0.02, lift + H - 0.03), (L / 2 + 0.002, -W / 2 + 0.02, lift + H - 0.03)], "glass_dark")
    m.box(-0.05, 0, lift + H, 0.22, 0.14, 0.03, "metal")                         # roof AC units
    m.box(0.22, 0, lift + H, 0.14, 0.12, 0.025, "metal", roof="metal_dark")
    m.box(front - 0.004, 0, lift + 0.02, 0.012, W * 0.92, 0.04, "black")         # bumpers
    m.box(back + 0.004, 0, lift + 0.02, 0.012, W * 0.92, 0.04, "black")
    _grille(m, front + 0.0025, lift + 0.03, lift + 0.055, 0.1)
    _plates(m, front + 0.0028, back - 0.0028, lift + 0.012)
    for s in (-1, 1):
        y0 = s * 0.085
        _face_quad(m, front + 0.002, y0 - 0.024, y0 + 0.024, lift + 0.046, lift + 0.084, +1, "black")
        _face_quad(m, front + 0.003, y0 - 0.02, y0 + 0.02, lift + 0.05, lift + 0.08, +1, "glow_head")
        _face_quad(m, back - 0.002, y0 - 0.024, y0 + 0.024, lift + 0.046, lift + 0.084, -1, "black")
        _face_quad(m, back - 0.003, y0 - 0.02, y0 + 0.02, lift + 0.05, lift + 0.08, -1, "glow_tail")
    _face_quad(m, front + 0.0025, -0.05, 0.05, lift + H - 0.055, lift + H - 0.03, +1, "glow_sign")  # destination sign
    _door_seams(m, (front - 0.17, front - 0.07), hw + 0.0016, lift + 0.02, lift + H - 0.04, handles=(front - 0.09,))
    _mirrors(m, front - 0.03, lift + 0.13, hw)
    _wheels(m, (0.26, -0.24), hw, r=r, w=0.036)


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
            m._quad(pts if s < 0 else list(reversed(pts)), "glass_dark")
    m.box(L / 2 - 0.005, 0, lift + 0.1, 0.012, W * 0.8, H - 0.16, "glass_dark")
    m.box(0, 0, lift - 0.015, L * 0.9, W * 0.7, 0.02, "metal_dark")
    m._quad([(L / 2 + 0.003, -0.07, lift + 0.03), (L / 2 + 0.003, 0.07, lift + 0.03), (L / 2 + 0.003, 0.07, lift + 0.07), (L / 2 + 0.003, -0.07, lift + 0.07)], "glow_head")


@prop("boat_motor")
def boat_motor(m):
    # pointed hull built from three boxes tapering to the bow, with a small cabin
    m.box(-0.06, 0, 0.0, 0.36, 0.17, 0.07, "hull_white", roof="metal")
    m.box(0.16, 0, 0.0, 0.1, 0.12, 0.06, "hull_white", roof="metal")
    m.box(0.24, 0, 0.0, 0.06, 0.06, 0.05, "hull_white", roof="metal")
    m.box(0.0, 0, 0.0, 0.46, 0.172, 0.02, "hull_blue")
    m.box(-0.04, 0, 0.07, 0.16, 0.11, 0.08, "glass_dark", roof="hull_white")


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
    m.box(-0.04, 0, 0.09, 0.46, 0.17, 0.1, "glass_dark", roof="hull_white")
    m.box(-0.1, 0, 0.19, 0.26, 0.13, 0.07, "glass_dark", roof="hull_white")
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
