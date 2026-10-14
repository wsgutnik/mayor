"""Parametric vehicles for traffic variety: cars, vans, trucks, semis and buses.

Same contract as props_vehicles.py: drive along +X, wheels at ground, length 1 = one tile, body in the tintable
``car_body`` material, glow_head / glow_tail light up at night. The proportions follow the user-provided
transport pack (third_party/mayor-transport-pack); automatic decimation of those meshes lost wheels and windows,
so the shapes are rebuilt here from boxes, within the triangle budgets.
"""
from registry import prop
from dress_vehicles2 import (
    car as _car,
    cargo_bed_ribs as _cargo_bed_ribs,
    door_seams as _door_seams,
    face_quad as _face_quad,
    glass_pillars as _glass_pillars,
    grille as _grille,
    light_clusters as _dress_lights,
    mirrors as _mirrors,
    plates as _plates,
    rear_bumper as _dress_rear_bumper,
    rear_doors as _dress_rear_doors,
    roof_rack as _roof_rack,
    side_quad as _side_quad,
    wheels as _wheels,
)

L_HEAD = "glow_head"
L_TAIL = "glow_tail"


def _lights(m, front, back, half_w, z, h=0.025, spread=0.32):
    """Head/tail lights set into dark recess bezels."""
    _dress_lights(m, front, back, half_w, z, h=h, spread=spread)


def _rear_doors(m, back, z0, z1):
    """Split rear cargo doors: centre shut-line and two grab handles."""
    _dress_rear_doors(m, back, z0, z1)


def _rear_bumper(m, back, z, w=0.19):
    _dress_rear_bumper(m, back, z, w=w)


# ---------------------------------------------------------------- cars
@prop("car_taxi")
def car_taxi(m):
    _car(m, 0.40, 0.17, 0.07, 0.21, 0.06)
    z = 0.034 * 0.8 + 0.07 + 0.06
    m.box(-0.02, 0, z - 0.004, 0.07, 0.05, 0.008, "black")                      # sign base
    m.box(-0.02, 0, z + 0.004, 0.06, 0.04, 0.025, "glow_sign")                  # roof sign


@prop("car_police")
def car_police(m):
    _car(m, 0.41, 0.17, 0.07, 0.21, 0.06)
    z = 0.034 * 0.8 + 0.07 + 0.06
    m.box(-0.02, 0, z - 0.003, 0.05, 0.11, 0.006, "black")                      # light-bar base
    m.box(-0.02, -0.03, z + 0.003, 0.04, 0.045, 0.018, "sign_red")
    m.box(-0.02, 0.03, z + 0.003, 0.04, 0.045, 0.018, "sign_blue")
    m.box(0.0, 0, 0.034 * 0.8 + 0.035, 0.2, 0.172, 0.012, "white")               # door stripe


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
    hw = 0.09
    front, back = 0.17, -0.24
    m.box(0.07, 0, z, 0.2, 0.18, 0.075, "car_body", roof="car_body")                # cab + hood
    m.box(0.05, 0, z + 0.075, 0.1, 0.15, 0.055, "glass_dark", roof="car_body")
    m.box(-0.14, 0, z, 0.2, 0.18, 0.04, "car_body", roof="car_body")                # bed floor
    for sy in (-1, 1):
        m.box(-0.14, sy * 0.085, z + 0.04, 0.2, 0.012, 0.04, "car_body", roof="car_body")
    m.box(-0.235, 0, z + 0.04, 0.012, 0.16, 0.04, "car_body", roof="car_body")
    _cargo_bed_ribs(m, -0.22, -0.06, hw, z + 0.045, n=4)
    m.box(front, 0, z + 0.005, 0.014, 0.165, 0.028, "black")                        # bumpers
    m.box(back, 0, z + 0.005, 0.014, 0.165, 0.028, "black")
    _grille(m, front + 0.001, z + 0.032, z + 0.052, 0.08)
    _plates(m, front + 0.0078, back - 0.0078, z + 0.008)
    _lights(m, front, back, hw, z + 0.025)
    _mirrors(m, 0.09, z + 0.085, 0.075)
    _door_seams(m, (0.0,), hw, z + 0.01, z + 0.068, handles=(0.03,))
    _wheels(m, (0.1, -0.15), hw, r=r)


# ---------------------------------------------------------------- vans and trucks
def _cab_truck(m, r, cab_x, cab_l, cab_h, w):
    z = r * 0.8
    front = cab_x + cab_l / 2
    m.box(cab_x, 0, z, cab_l, w, cab_h * 0.55, "car_body", roof="car_body")
    m.box(cab_x, 0, z + cab_h * 0.55, cab_l * 0.9, w * 0.9, cab_h * 0.45, "glass_dark", roof="car_body")
    _glass_pillars(m, (cab_x + cab_l * 0.05,), w * 0.45, z + cab_h * 0.58, z + cab_h * 0.96)
    m.box(front, 0, z + 0.005, 0.014, w * 0.92, 0.028, "black")                     # bumper
    _grille(m, front + 0.001, z + 0.032, z + 0.052, w * 0.5)
    _plates(m, front + 0.0078, None, z + 0.008, w=0.04)
    _mirrors(m, front - 0.02, z + cab_h * 0.55 + 0.008, w * 0.45)
    _door_seams(m, (cab_x - cab_l * 0.25, cab_x + cab_l * 0.3), w / 2, z + 0.01, z + cab_h * 0.5,
                handles=(cab_x + cab_l * 0.12,))
    for yy in (-0.03, 0.0, 0.03):                                                    # roof marker lights
        _face_quad(m, front - 0.004, yy - 0.005, yy + 0.005, z + cab_h - 0.012, z + cab_h - 0.004, +1, "glow_sign")
    return z


@prop("van_cargo")
def van_cargo(m):
    r = 0.036
    z = r * 0.8
    hw = 0.09
    front, back = 0.22, -0.19
    m.box(-0.02, 0, z, 0.34, 0.18, 0.14, "car_body", roof="car_body")
    m.box(0.17, 0, z, 0.1, 0.18, 0.075, "car_body", roof="car_body")
    m.box(0.17, 0, z + 0.075, 0.08, 0.16, 0.05, "glass_dark", roof="car_body")
    _glass_pillars(m, (0.17,), 0.08, z + 0.083, z + 0.12)
    m.box(front, 0, z + 0.005, 0.014, 0.165, 0.028, "black")                        # bumpers
    m.box(back, 0, z + 0.005, 0.014, 0.165, 0.028, "black")
    _grille(m, front + 0.001, z + 0.032, z + 0.05, 0.08)
    _plates(m, front + 0.0078, back - 0.0078, z + 0.008)
    m.box(-0.02, 0, z + 0.14, 0.09, 0.08, 0.018, "metal", roof="metal_dark")        # roof vent
    _lights(m, front, back, hw, z + 0.025)
    _mirrors(m, 0.19, z + 0.085, 0.08)
    _door_seams(m, (0.1, -0.06), hw, z + 0.01, z + 0.068, handles=(0.13, -0.02))
    _wheels(m, (0.15, -0.11), hw, r=r)


@prop("truck_box")
def truck_box(m):
    r = 0.04
    z = _cab_truck(m, r, 0.21, 0.16, 0.13, 0.2)
    back = -0.28
    m.box(-0.1, 0, z + 0.012, 0.36, 0.205, 0.21, "car_body", roof="car_body")
    m.box(0.0, 0, z - 0.004, 0.66, 0.14, 0.02, "metal_dark")
    _rear_bumper(m, back, z)
    _rear_doors(m, back, z + 0.03, z + 0.2)
    _lights(m, 0.29, back, 0.1, z + 0.03)
    _wheels(m, (0.2, -0.12, -0.22), 0.1, r=r, w=0.036)


@prop("truck_garbage")
def truck_garbage(m):
    r = 0.04
    z = _cab_truck(m, r, 0.21, 0.16, 0.13, 0.2)
    back = -0.31
    m.box(-0.1, 0, z + 0.01, 0.36, 0.2, 0.17, "wall_green", roof="wall_green")
    m.box(-0.285, 0, z + 0.03, 0.05, 0.16, 0.13, "metal_dark")                        # rear hopper
    m.box(-0.1, 0, z + 0.18, 0.36, 0.16, 0.025, "metal_dark")
    m.box(0.0, 0, z - 0.004, 0.66, 0.14, 0.02, "metal_dark")
    _rear_bumper(m, back, z)
    _lights(m, 0.29, back, 0.1, z + 0.03)
    _wheels(m, (0.2, -0.12, -0.22), 0.1, r=r, w=0.036)


@prop("truck_utility")
def truck_utility(m):
    r = 0.04
    z = _cab_truck(m, r, 0.2, 0.15, 0.13, 0.19)
    back = -0.27
    m.box(0.2, 0, z + 0.13, 0.03, 0.03, 0.02, "glow_sign")                            # roof beacon
    m.box(-0.1, 0, z + 0.02, 0.34, 0.19, 0.04, "car_body", roof="car_body")          # service deck
    m.box(-0.2, 0, z + 0.06, 0.1, 0.1, 0.11, "metal", roof="metal")                   # turret
    m.box(-0.05, 0, z + 0.14, 0.34, 0.035, 0.035, "sign_orange")                      # boom
    m.box(0.12, 0, z + 0.15, 0.04, 0.05, 0.05, "sign_orange")                         # basket
    m.box(0.0, 0, z - 0.004, 0.62, 0.14, 0.02, "metal_dark")
    _rear_bumper(m, back, z)
    _lights(m, 0.275, back, 0.095, z + 0.03)
    _wheels(m, (0.2, -0.12, -0.2), 0.095, r=r, w=0.036)


@prop("truck_cement")
def truck_cement(m):
    r = 0.04
    z = _cab_truck(m, r, 0.21, 0.16, 0.13, 0.2)
    back = -0.28
    m.box(0.0, 0, z, 0.66, 0.14, 0.02, "metal_dark")
    # drum: three stacked slabs read as a round tank at game scale, a cone at the nose
    for i, (w, hh, zz) in enumerate(((0.19, 0.06, 0.02), (0.22, 0.09, 0.08), (0.17, 0.05, 0.17))):
        m.box(-0.1, 0, z + zz, 0.34 - i * 0.02, w, hh, "sign_orange" if i == 1 else "white", roof="white")
    m.box(0.05, 0, z + 0.08, 0.06, 0.15, 0.1, "white", roof="white")
    m.box(-0.3, 0, z + 0.05, 0.08, 0.03, 0.02, "metal_dark")                          # discharge chute
    _rear_bumper(m, back, z)
    _lights(m, 0.29, back, 0.1, z + 0.03)
    _wheels(m, (0.2, -0.1, -0.2), 0.1, r=r, w=0.036)


@prop("truck_flatbed")
def truck_flatbed(m):
    r = 0.04
    z = _cab_truck(m, r, 0.21, 0.16, 0.13, 0.2)
    back = -0.29
    m.box(-0.1, 0, z + 0.01, 0.38, 0.2, 0.03, "metal", roof="metal")
    _cargo_bed_ribs(m, -0.27, 0.05, 0.1, z + 0.045, n=5)
    m.box(-0.1, 0, z + 0.04, 0.12, 0.12, 0.07, "bark", roof="bark")                   # a load of crates
    m.box(-0.22, 0, z + 0.04, 0.1, 0.12, 0.05, "wall_wood", roof="wall_wood")
    m.box(0.0, 0, z - 0.004, 0.66, 0.14, 0.02, "metal_dark")
    _rear_bumper(m, back, z)
    _lights(m, 0.29, back, 0.1, z + 0.03)
    _wheels(m, (0.2, -0.12, -0.22), 0.1, r=r, w=0.036)


@prop("truck_tanker")
def truck_tanker(m):
    r = 0.04
    z = _cab_truck(m, r, 0.21, 0.16, 0.13, 0.2)
    back = -0.3
    m.box(0.0, 0, z, 0.66, 0.14, 0.02, "metal_dark")
    for hh, w, zz in ((0.05, 0.14, 0.02), (0.09, 0.2, 0.07), (0.05, 0.14, 0.16)):
        m.box(-0.1, 0, z + zz, 0.4, w, hh, "metal", roof="metal")
    m.box(-0.1, 0, z + 0.21, 0.05, 0.05, 0.02, "metal_dark")                          # hatch
    _rear_bumper(m, back, z)
    _lights(m, 0.29, back, 0.1, z + 0.03)
    _wheels(m, (0.2, -0.12, -0.22), 0.1, r=r, w=0.036)


def _tractor(m, r, x0):
    z = r * 0.8
    front = x0 + 0.21
    glass_f = x0 + 0.165
    m.box(x0 + 0.1, 0, z, 0.22, 0.2, 0.08, "car_body", roof="car_body")
    m.box(x0 + 0.04, 0, z + 0.08, 0.1, 0.2, 0.1, "car_body", roof="car_body")         # sleeper
    m.box(x0 + 0.13, 0, z + 0.08, 0.07, 0.18, 0.06, "glass_dark", roof="car_body")
    _glass_pillars(m, (x0 + 0.11,), 0.09, z + 0.087, z + 0.132)
    m.box(x0 + 0.04, 0, z - 0.004, 0.34, 0.14, 0.02, "metal_dark")
    m.box(front, 0, z + 0.005, 0.014, 0.184, 0.028, "black")                        # bumper
    _grille(m, front + 0.001, z + 0.03, z + 0.05, 0.1)
    _plates(m, front + 0.0078, None, z + 0.008, w=0.04)
    _mirrors(m, front - 0.03, z + 0.09, 0.09)
    _door_seams(m, (x0 + 0.0,), 0.1, z + 0.01, z + 0.07, handles=(x0 + 0.05,))
    m.cyl(x0 - 0.02, 0.095, z, 0.012, 0.16, "metal_dark", seg=5)                    # exhaust stack
    for yy in (-0.03, 0.0, 0.03):                                                    # roof markers
        _face_quad(m, glass_f + 0.001, yy - 0.005, yy + 0.005, z + 0.128, z + 0.136, +1, "glow_sign")
    _face_quad(m, glass_f + 0.001, -0.07, 0.07, z + 0.138, z + 0.148, +1, "car_body")  # sun visor
    return z


@prop("semi_box")
def semi_box(m):
    r = 0.036
    z = _tractor(m, r, 0.24)
    back = -0.51
    m.box(-0.2, 0, z + 0.02, 0.62, 0.2, 0.26, "white", roof="white")
    m.box(-0.2, 0, z - 0.004, 0.64, 0.14, 0.02, "metal_dark")
    _rear_bumper(m, back, z)
    _rear_doors(m, back, z + 0.04, z + 0.26)
    _lights(m, 0.45, back, 0.1, z + 0.024)
    _wheels(m, (0.38, 0.2, -0.36), 0.1, r=r, w=0.034)


@prop("semi_container")
def semi_container(m):
    r = 0.036
    z = _tractor(m, r, 0.24)
    back = -0.48
    m.box(-0.2, 0, z, 0.64, 0.14, 0.02, "metal_dark")                                  # chassis
    for i, c in enumerate(("sign_red", "sign_blue")):                                  # two 20 ft containers
        m.box(-0.04 - i * 0.3, 0, z + 0.02, 0.28, 0.2, 0.22, c, roof=c)
    _rear_bumper(m, back, z)
    _rear_doors(m, back, z + 0.04, z + 0.22)
    _lights(m, 0.45, back, 0.1, z + 0.024)
    _wheels(m, (0.38, 0.2, -0.36), 0.1, r=r, w=0.034)


# ---------------------------------------------------------------- buses
def _bus(m, length, h, w=0.17, r=0.036, x0=0.0, decks=1, nose=0.0):
    z = r * 0.8
    m.box(x0, 0, z, length, w, h, "car_body", roof="car_body")
    band_h = 0.07 if decks == 1 else 0.055
    for d in range(decks):
        zz = z + 0.07 + d * (h - 0.02) / decks
        m.box(x0, 0, zz, length * 0.94, w + 0.004, band_h, "glass_dark", roof="glass_dark")
    m.box(x0 + length / 2 - 0.004, 0, z + 0.05, 0.012, w * 0.7, 0.05, "glass_dark")  # windscreen
    return z


def _bus_front(m, front, z, hw, sign=True, mz=None):
    m.box(front, 0, z + 0.005, 0.014, hw * 1.84, 0.028, "black")                    # bumper
    _grille(m, front + 0.001, z + 0.03, z + 0.048, hw * 0.9)
    _plates(m, front + 0.0078, None, z + 0.008, w=0.04)
    _mirrors(m, front - 0.03, z + 0.1 if mz is None else mz, hw)
    if sign:
        _face_quad(m, front + 0.0025, -0.05, 0.05, z + 0.115, z + 0.14, +1, "glow_sign")


def _bus_rear(m, back, z, hw):
    m.box(back, 0, z + 0.005, 0.014, hw * 1.84, 0.028, "black")
    _plates(m, None, back - 0.0078, z + 0.008, w=0.04)


def _bus_ac(m, x, z, top):
    m.box(x, 0, z + top, 0.2, 0.12, 0.028, "metal", roof="metal_dark")
    m.box(x, 0, z + top + 0.028, 0.16, 0.08, 0.008, "metal_dark")


def _bus_door(m, x, z, hw, h):
    _door_seams(m, (x - 0.05, x + 0.05), hw + 0.002, z + 0.015, z + h - 0.03, handles=(x + 0.02,))


@prop("bus_city")
def bus_city(m):
    z = _bus(m, 0.76, 0.2)
    _bus_front(m, 0.38, z, 0.085)
    _bus_rear(m, -0.38, z, 0.085)
    _bus_ac(m, -0.05, z, 0.2)
    _bus_door(m, 0.2, z, 0.085, 0.2)
    _lights(m, 0.38, -0.38, 0.085, z + 0.024)
    _wheels(m, (0.25, -0.25), 0.085, r=0.036)


@prop("bus_articulated")
def bus_articulated(m):
    z = _bus(m, 0.5, 0.2, x0=0.28)
    _bus(m, 0.5, 0.2, x0=-0.28)
    m.box(0.0, 0, z + 0.01, 0.1, 0.15, 0.18, "metal_dark", roof="metal_dark")           # bellows
    _bus_front(m, 0.53, z, 0.085)
    _bus_rear(m, -0.53, z, 0.085)
    _bus_ac(m, 0.28, z, 0.2)
    _bus_ac(m, -0.28, z, 0.2)
    _bus_door(m, 0.4, z, 0.085, 0.2)
    _bus_door(m, -0.15, z, 0.085, 0.2)
    _lights(m, 0.53, -0.53, 0.085, z + 0.024)
    _wheels(m, (0.42, 0.18, -0.42), 0.085, r=0.036)


@prop("bus_school")
def bus_school(m):
    z = _bus(m, 0.62, 0.19)
    m.box(0.0, 0, z + 0.035, 0.62, 0.174, 0.012, "black")                               # belt stripe
    m.box(0.34, 0, z, 0.1, 0.16, 0.08, "car_body", roof="car_body")                    # hood
    _bus_front(m, 0.39, z, 0.08, sign=False, mz=z + 0.055)
    _bus_rear(m, -0.31, z, 0.085)
    _bus_door(m, 0.22, z, 0.085, 0.19)
    for yy in (-0.035, 0.035):                                                           # warning lamps
        _face_quad(m, 0.311, yy - 0.012, yy + 0.012, z + 0.15, z + 0.17, +1, "glow_tail")
    _side_quad(m, 0.18, 0.22, -(0.085 + 0.003), z + 0.09, z + 0.13, -1, "sign_red")     # stop paddle
    _lights(m, 0.39, -0.31, 0.085, z + 0.024)
    _wheels(m, (0.22, -0.22), 0.085, r=0.036)


@prop("bus_double")
def bus_double(m):
    z = _bus(m, 0.72, 0.3, decks=2)
    _bus_front(m, 0.36, z, 0.085)
    _bus_rear(m, -0.36, z, 0.085)
    _bus_ac(m, 0.0, z, 0.3)
    _bus_door(m, 0.2, z, 0.085, 0.17)
    _lights(m, 0.36, -0.36, 0.085, z + 0.024)
    _wheels(m, (0.24, -0.24), 0.085, r=0.036)


@prop("bus_coach")
def bus_coach(m):
    r = 0.04
    z = r * 0.8
    hw = 0.09
    m.box(0.0, 0, z, 0.82, 0.18, 0.06, "car_body", roof="car_body")                    # luggage hold
    m.box(0.0, 0, z + 0.06, 0.82, 0.18, 0.15, "car_body", roof="car_body")
    m.box(0.0, 0, z + 0.09, 0.78, 0.184, 0.075, "glass_dark", roof="glass_dark")
    m.box(0.41, 0, z + 0.09, 0.012, 0.15, 0.09, "glass_dark")
    _bus_front(m, 0.41, z, hw, sign=False)
    _face_quad(m, 0.4125, -0.05, 0.05, z + 0.185, z + 0.205, +1, "glow_sign")          # destination sign
    _bus_rear(m, -0.41, z, hw)
    _bus_ac(m, 0.0, z, 0.21)
    _bus_door(m, 0.3, z, hw, 0.2)
    _door_seams(m, (-0.2, 0.0), hw, z + 0.005, z + 0.055, handles=())                  # luggage hatches
    _lights(m, 0.41, -0.41, hw, z + 0.024)
    _wheels(m, (0.28, -0.26, -0.34), hw, r=r)


@prop("bus_mini")
def bus_mini(m):
    z = _bus(m, 0.52, 0.17, w=0.16, r=0.032)
    _bus_front(m, 0.26, z, 0.08)
    _bus_rear(m, -0.26, z, 0.08)
    _bus_ac(m, 0.0, z, 0.17)
    _bus_door(m, 0.14, z, 0.08, 0.17)
    _lights(m, 0.26, -0.26, 0.08, z + 0.024)
    _wheels(m, (0.17, -0.17), 0.08, r=0.032)
