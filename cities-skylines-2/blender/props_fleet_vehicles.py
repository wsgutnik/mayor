"""Parametric vehicles for traffic variety: cars, vans, trucks, semis and buses.

Same contract as props_vehicles.py: drive along +X, wheels at ground, length 1 = one tile, body in the tintable
``car_body`` material, glow_head / glow_tail light up at night. The proportions follow the user-provided
transport pack (third_party/mayor-transport-pack); automatic decimation of those meshes lost wheels and windows,
so the shapes are rebuilt here from boxes, within the triangle budgets.
"""
from registry import prop
from props_vehicles import _car, _wheels

L_HEAD = "glow_head"
L_TAIL = "glow_tail"


def _lights(m, front, back, half_w, z, h=0.025, spread=0.32):
    for s in (-1, 1):
        y = s * half_w * 2 * spread
        m._quad([(front + 0.002, y - 0.02, z), (front + 0.002, y + 0.02, z), (front + 0.002, y + 0.02, z + h), (front + 0.002, y - 0.02, z + h)], L_HEAD)
        m._quad([(back - 0.002, y + 0.02, z), (back - 0.002, y - 0.02, z), (back - 0.002, y - 0.02, z + h), (back - 0.002, y + 0.02, z + h)], L_TAIL)


# ---------------------------------------------------------------- cars
@prop("car_taxi")
def car_taxi(m):
    _car(m, 0.40, 0.17, 0.07, 0.21, 0.06)
    m.box(-0.02, 0, 0.034 * 0.8 + 0.07 + 0.06, 0.06, 0.04, 0.025, "glow_sign")      # roof sign


@prop("car_police")
def car_police(m):
    _car(m, 0.41, 0.17, 0.07, 0.21, 0.06)
    z = 0.034 * 0.8 + 0.07 + 0.06
    m.box(-0.02, -0.03, z, 0.04, 0.045, 0.018, "sign_red")
    m.box(-0.02, 0.03, z, 0.04, 0.045, 0.018, "sign_blue")
    m.box(0.0, 0, 0.034 * 0.8 + 0.035, 0.2, 0.172, 0.012, "white")                   # door stripe


@prop("car_midsize")
def car_midsize(m):
    _car(m, 0.40, 0.17, 0.07, 0.22, 0.06)


@prop("car_compact")
def car_compact(m):
    _car(m, 0.31, 0.16, 0.07, 0.19, 0.07, cabin_off=-0.03, wheel_r=0.032)


@prop("car_crossover")
def car_crossover(m):
    _car(m, 0.40, 0.18, 0.085, 0.26, 0.07, cabin_off=-0.04, wheel_r=0.038)


@prop("car_minivan")
def car_minivan(m):
    _car(m, 0.42, 0.18, 0.09, 0.31, 0.08, cabin_off=-0.03, wheel_r=0.036)


@prop("car_electric")
def car_electric(m):
    _car(m, 0.32, 0.16, 0.065, 0.2, 0.065, cabin_off=-0.02, wheel_r=0.032)
    m.box(0.16, 0, 0.034 * 0.8 + 0.03, 0.012, 0.1, 0.012, "glow_sign")              # charge-light strip


@prop("car_pickup")
def car_pickup(m):
    r = 0.036
    z = r * 0.8
    m.box(0.07, 0, z, 0.2, 0.18, 0.075, "car_body", roof="car_body")                # cab + hood
    m.box(0.05, 0, z + 0.075, 0.1, 0.15, 0.055, "car_glass", roof="car_body")
    m.box(-0.14, 0, z, 0.2, 0.18, 0.04, "car_body", roof="car_body")                # bed floor
    for sy in (-1, 1):
        m.box(-0.14, sy * 0.085, z + 0.04, 0.2, 0.012, 0.04, "car_body", roof="car_body")
    m.box(-0.235, 0, z + 0.04, 0.012, 0.16, 0.04, "car_body", roof="car_body")
    _lights(m, 0.17, -0.24, 0.09, z + 0.025)
    _wheels(m, (0.1, -0.15), 0.09, r=r)


# ---------------------------------------------------------------- vans and trucks
def _cab_truck(m, r, cab_x, cab_l, cab_h, w):
    z = r * 0.8
    m.box(cab_x, 0, z, cab_l, w, cab_h * 0.55, "car_body", roof="car_body")
    m.box(cab_x, 0, z + cab_h * 0.55, cab_l * 0.9, w * 0.9, cab_h * 0.45, "car_glass", roof="car_body")
    return z


@prop("van_cargo")
def van_cargo(m):
    r = 0.036
    z = r * 0.8
    m.box(-0.02, 0, z, 0.34, 0.18, 0.14, "car_body", roof="car_body")
    m.box(0.17, 0, z, 0.1, 0.18, 0.075, "car_body", roof="car_body")
    m.box(0.17, 0, z + 0.075, 0.08, 0.16, 0.05, "car_glass", roof="car_body")
    _lights(m, 0.22, -0.19, 0.09, z + 0.025)
    _wheels(m, (0.15, -0.11), 0.09, r=r)


@prop("truck_box")
def truck_box(m):
    r = 0.04
    z = _cab_truck(m, r, 0.21, 0.16, 0.13, 0.2)
    m.box(-0.1, 0, z + 0.012, 0.36, 0.205, 0.21, "car_body", roof="car_body")
    m.box(0.0, 0, z - 0.004, 0.66, 0.14, 0.02, "metal_dark")
    _lights(m, 0.29, -0.28, 0.1, z + 0.03)
    _wheels(m, (0.2, -0.12, -0.22), 0.1, r=r, w=0.036)


@prop("truck_garbage")
def truck_garbage(m):
    r = 0.04
    z = _cab_truck(m, r, 0.21, 0.16, 0.13, 0.2)
    m.box(-0.1, 0, z + 0.01, 0.36, 0.2, 0.17, "wall_green", roof="wall_green")
    m.box(-0.285, 0, z + 0.03, 0.05, 0.16, 0.13, "metal_dark")                        # rear hopper
    m.box(-0.1, 0, z + 0.18, 0.36, 0.16, 0.025, "metal_dark")
    m.box(0.0, 0, z - 0.004, 0.66, 0.14, 0.02, "metal_dark")
    _lights(m, 0.29, -0.31, 0.1, z + 0.03)
    _wheels(m, (0.2, -0.12, -0.22), 0.1, r=r, w=0.036)


@prop("truck_utility")
def truck_utility(m):
    r = 0.04
    z = _cab_truck(m, r, 0.2, 0.15, 0.13, 0.19)
    m.box(-0.1, 0, z + 0.02, 0.34, 0.19, 0.04, "car_body", roof="car_body")          # service deck
    m.box(-0.2, 0, z + 0.06, 0.1, 0.1, 0.11, "metal", roof="metal")                   # turret
    m.box(-0.05, 0, z + 0.14, 0.34, 0.035, 0.035, "sign_orange")                      # boom
    m.box(0.12, 0, z + 0.15, 0.04, 0.05, 0.05, "sign_orange")                         # basket
    m.box(0.0, 0, z - 0.004, 0.62, 0.14, 0.02, "metal_dark")
    _lights(m, 0.275, -0.27, 0.095, z + 0.03)
    _wheels(m, (0.2, -0.12, -0.2), 0.095, r=r, w=0.036)


@prop("truck_cement")
def truck_cement(m):
    r = 0.04
    z = _cab_truck(m, r, 0.21, 0.16, 0.13, 0.2)
    m.box(0.0, 0, z, 0.66, 0.14, 0.02, "metal_dark")
    # drum: three stacked slabs read as a round tank at game scale, a cone at the nose
    for i, (w, hh, zz) in enumerate(((0.19, 0.06, 0.02), (0.22, 0.09, 0.08), (0.17, 0.05, 0.17))):
        m.box(-0.1, 0, z + zz, 0.34 - i * 0.02, w, hh, "sign_orange" if i == 1 else "white", roof="white")
    m.box(0.05, 0, z + 0.08, 0.06, 0.15, 0.1, "white", roof="white")
    _lights(m, 0.29, -0.28, 0.1, z + 0.03)
    _wheels(m, (0.2, -0.1, -0.2), 0.1, r=r, w=0.036)


@prop("truck_flatbed")
def truck_flatbed(m):
    r = 0.04
    z = _cab_truck(m, r, 0.21, 0.16, 0.13, 0.2)
    m.box(-0.1, 0, z + 0.01, 0.38, 0.2, 0.03, "metal", roof="metal")
    m.box(-0.1, 0, z + 0.04, 0.12, 0.12, 0.07, "bark", roof="bark")                   # a load of crates
    m.box(-0.22, 0, z + 0.04, 0.1, 0.12, 0.05, "wall_wood", roof="wall_wood")
    m.box(0.0, 0, z - 0.004, 0.66, 0.14, 0.02, "metal_dark")
    _lights(m, 0.29, -0.29, 0.1, z + 0.03)
    _wheels(m, (0.2, -0.12, -0.22), 0.1, r=r, w=0.036)


@prop("truck_tanker")
def truck_tanker(m):
    r = 0.04
    z = _cab_truck(m, r, 0.21, 0.16, 0.13, 0.2)
    m.box(0.0, 0, z, 0.66, 0.14, 0.02, "metal_dark")
    for hh, w, zz in ((0.05, 0.14, 0.02), (0.09, 0.2, 0.07), (0.05, 0.14, 0.16)):
        m.box(-0.1, 0, z + zz, 0.4, w, hh, "metal", roof="metal")
    m.box(-0.1, 0, z + 0.21, 0.05, 0.05, 0.02, "metal_dark")                          # hatch
    _lights(m, 0.29, -0.3, 0.1, z + 0.03)
    _wheels(m, (0.2, -0.12, -0.22), 0.1, r=r, w=0.036)


def _tractor(m, r, x0):
    z = r * 0.8
    m.box(x0 + 0.1, 0, z, 0.22, 0.2, 0.08, "car_body", roof="car_body")
    m.box(x0 + 0.04, 0, z + 0.08, 0.1, 0.2, 0.1, "car_body", roof="car_body")         # sleeper
    m.box(x0 + 0.13, 0, z + 0.08, 0.07, 0.18, 0.06, "car_glass", roof="car_body")
    m.box(x0 + 0.04, 0, z - 0.004, 0.34, 0.14, 0.02, "metal_dark")
    return z


@prop("semi_box")
def semi_box(m):
    r = 0.036
    z = _tractor(m, r, 0.24)
    m.box(-0.2, 0, z + 0.02, 0.62, 0.2, 0.26, "white", roof="white")
    m.box(-0.2, 0, z - 0.004, 0.64, 0.14, 0.02, "metal_dark")
    _lights(m, 0.46, -0.51, 0.1, z + 0.02)
    _wheels(m, (0.38, 0.2, -0.36), 0.1, r=r, w=0.034)


@prop("semi_container")
def semi_container(m):
    r = 0.036
    z = _tractor(m, r, 0.24)
    m.box(-0.2, 0, z, 0.64, 0.14, 0.02, "metal_dark")                                  # chassis
    for i, c in enumerate(("sign_red", "sign_blue")):                                  # two 20 ft containers
        m.box(-0.04 - i * 0.3, 0, z + 0.02, 0.28, 0.2, 0.22, c, roof=c)
    _lights(m, 0.46, -0.51, 0.1, z + 0.02)
    _wheels(m, (0.38, 0.2, -0.36), 0.1, r=r, w=0.034)


# ---------------------------------------------------------------- buses
def _bus(m, length, h, w=0.17, r=0.036, x0=0.0, decks=1, nose=0.0):
    z = r * 0.8
    m.box(x0, 0, z, length, w, h, "car_body", roof="car_body")
    band_h = 0.07 if decks == 1 else 0.055
    for d in range(decks):
        zz = z + 0.07 + d * (h - 0.02) / decks
        m.box(x0, 0, zz, length * 0.94, w + 0.004, band_h, "car_glass", roof="car_glass")
    m.box(x0 + length / 2 - 0.004, 0, z + 0.05, 0.012, w * 0.7, 0.05, "car_glass")  # windscreen
    return z


@prop("bus_city")
def bus_city(m):
    z = _bus(m, 0.76, 0.2)
    _lights(m, 0.38, -0.38, 0.085, z + 0.02)
    _wheels(m, (0.25, -0.25), 0.085, r=0.036)


@prop("bus_articulated")
def bus_articulated(m):
    z = _bus(m, 0.5, 0.2, x0=0.28)
    _bus(m, 0.5, 0.2, x0=-0.28)
    m.box(0.0, 0, z + 0.01, 0.1, 0.15, 0.18, "metal_dark", roof="metal_dark")           # bellows
    _lights(m, 0.53, -0.53, 0.085, z + 0.02)
    _wheels(m, (0.42, 0.18, -0.42), 0.085, r=0.036)


@prop("bus_school")
def bus_school(m):
    z = _bus(m, 0.62, 0.19)
    m.box(0.0, 0, z + 0.035, 0.62, 0.174, 0.012, "black")                               # belt stripe
    m.box(0.34, 0, z, 0.1, 0.16, 0.08, "car_body", roof="car_body")                    # hood
    _lights(m, 0.39, -0.31, 0.085, z + 0.02)
    _wheels(m, (0.22, -0.22), 0.085, r=0.036)


@prop("bus_double")
def bus_double(m):
    z = _bus(m, 0.72, 0.3, decks=2)
    _lights(m, 0.36, -0.36, 0.085, z + 0.02)
    _wheels(m, (0.24, -0.24), 0.085, r=0.036)


@prop("bus_coach")
def bus_coach(m):
    r = 0.04
    z = r * 0.8
    m.box(0.0, 0, z, 0.82, 0.18, 0.06, "car_body", roof="car_body")                    # luggage hold
    m.box(0.0, 0, z + 0.06, 0.82, 0.18, 0.15, "car_body", roof="car_body")
    m.box(0.0, 0, z + 0.09, 0.78, 0.184, 0.075, "car_glass", roof="car_glass")
    m.box(0.41, 0, z + 0.09, 0.012, 0.15, 0.09, "car_glass")
    _lights(m, 0.41, -0.41, 0.09, z + 0.015)
    _wheels(m, (0.28, -0.26, -0.34), 0.09, r=r)


@prop("bus_mini")
def bus_mini(m):
    z = _bus(m, 0.52, 0.17, w=0.16, r=0.032)
    _lights(m, 0.26, -0.26, 0.08, z + 0.02)
    _wheels(m, (0.17, -0.17), 0.08, r=0.032)
