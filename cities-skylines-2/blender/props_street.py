"""Street-level props: signals, signs, furniture, people and animals.

Each prop is centred on the origin with its base at z = 0, at most 250
triangles, built from the shared palette (plus a few new entries below).
The traffic_light head carries glow_red / glow_amber / glow_green lamps so the
game can tint or switch them per state.

Note: this module re-registers "hydrant" (also present in props_vehicles) with
a richer model; the import below guarantees ours wins regardless of load order.
"""
import math

import props_vehicles  # noqa: F401  (see note above)

import lib
from registry import prop

lib.PALETTE.update({
    "glow_red": ("#c02020", 0.4, "#ff2a20", 1.6),
    "glow_amber": ("#c07a10", 0.4, "#ffaa20", 1.6),
    "glow_green": ("#1fa04a", 0.4, "#2aff66", 1.6),
    "skin_a": ("#f2c9a0", 0.8, None, 0),
    "skin_b": ("#c98a5a", 0.8, None, 0),
    "skin_c": ("#7a4a2c", 0.8, None, 0),
    "planter": ("#a85838", 0.9, None, 0),
})


def _octagon(m, cx, cy, z, r, thick, mat):
    """Stop-sign board: an octagonal prism facing -Y (8-gon fans + rim)."""
    f, b = cy - thick / 2, cy + thick / 2
    ring_f = [(cx + math.cos(math.pi / 8 + k * math.pi / 4) * r, f,
               z + math.sin(math.pi / 8 + k * math.pi / 4) * r) for k in range(8)]
    ring_b = [(x, b, zz) for x, _, zz in ring_f]
    cf = m.bm.verts.new((cx, f, z))
    cb = m.bm.verts.new((cx, b, z))
    vf = [m.bm.verts.new(p) for p in ring_f]
    vb = [m.bm.verts.new(p) for p in ring_b]
    i = m._slot(mat)
    for k in range(8):
        f0 = m.bm.faces.new([cf, vf[k], vf[(k + 1) % 8]])
        f0.material_index = i
        f1 = m.bm.faces.new([cb, vb[(k + 1) % 8], vb[k]])
        f1.material_index = i
        f2 = m.bm.faces.new([vf[k], vb[k], vb[(k + 1) % 8], vf[(k + 1) % 8]])
        f2.material_index = i


def _face_quad(m, cx, y, z, w, h, mat):
    """A thin sign face at height z (front faces -Y)."""
    t = 0.004
    m.box(cx, y, z - h / 2, w, t, h, mat, roof=mat)


def _person(m, skin, shirt, pants, stride=0.0, arm_swing=0.0, scale=1.0, bag=None):
    """A simple ~0.12 tall person: legs, torso, arms, head. stride/arm_swing
    offset limbs in x for a walking pose."""
    leg_h, torso_h = 0.05 * scale, 0.045 * scale
    lw = 0.016 * scale
    for s in (-1, 1):
        m.box(s * 0.014 * scale, s * stride * 0.5, 0, lw, lw, leg_h, pants)          # legs
        m.box(s * 0.026 * scale, -s * arm_swing * 0.5, leg_h, 0.012 * scale, 0.012 * scale, torso_h, shirt)  # arms
    m.box(0, 0, leg_h, 0.038 * scale, 0.022 * scale, torso_h, shirt, roof=shirt)      # torso
    m.cyl(0, 0, leg_h + torso_h, 0.013 * scale, 0.026 * scale, skin, seg=6)           # head
    m.box(0, 0, leg_h + torso_h + 0.020 * scale, 0.027 * scale, 0.027 * scale, 0.008 * scale, pants)  # hair cap
    if bag:
        m.box(0.032 * scale, 0.01, leg_h + 0.01, 0.014 * scale, 0.03 * scale, 0.03 * scale, bag)


@prop("traffic_light")
def traffic_light(m):
    m.cyl(0, 0, 0, 0.022, 0.025, "metal_dark", seg=6)          # base
    m.cyl(0, 0, 0.02, 0.012, 0.30, "lamp_pole", seg=5)         # pole
    m.box(0.05, 0, 0.30, 0.12, 0.02, 0.02, "lamp_pole")        # arm
    m.box(0.10, 0, 0.175, 0.055, 0.07, 0.17, "black", roof="black")  # head
    for k, glow in enumerate(("glow_red", "glow_amber", "glow_green")):
        z = 0.225 - k * 0.05
        m._quad([(0.075, -0.036, z + 0.016), (0.125, -0.036, z + 0.016),
                 (0.125, -0.036, z - 0.016), (0.075, -0.036, z - 0.016)], glow)
        m.box(0.10, -0.045, z + 0.008, 0.06, 0.025, 0.008, "black")  # visor


@prop("stop_sign")
def stop_sign(m):
    m.cyl(0, 0, 0, 0.016, 0.02, "metal", seg=6)
    m.cyl(0, 0, 0.015, 0.009, 0.22, "metal", seg=5)
    _octagon(m, 0, 0, 0.30, 0.055, 0.008, "sign_red")
    m._quad([(-0.032, -0.0055, 0.332), (0.032, -0.0055, 0.332),
             (0.032, -0.0055, 0.268), (-0.032, -0.0055, 0.268)], "white")


@prop("street_sign")
def street_sign(m):
    m.cyl(0, 0, 0, 0.016, 0.02, "metal_dark", seg=6)
    m.cyl(0, 0, 0.015, 0.008, 0.26, "lamp_pole", seg=5)
    _face_quad(m, 0, 0, 0.25, 0.16, 0.035, "sign_blue")
    _face_quad(m, 0, 0, 0.205, 0.12, 0.03, "sign_green")
    m.box(0, 0, 0.275, 0.02, 0.02, 0.012, "metal_dark")


@prop("hydrant")
def hydrant(m):
    m.cyl(0, 0, 0, 0.024, 0.012, "sign_red", seg=6)            # flange
    m.cyl(0, 0, 0.010, 0.019, 0.055, "sign_red", seg=6)        # body
    m.cone(0, 0, 0.065, 0.019, 0.016, "sign_red", seg=6)       # dome
    m.box(0, 0, 0.081, 0.014, 0.014, 0.012, "metal_dark")      # top nut
    for s in (-1, 1):                                          # side nozzles
        m.box(s * 0.024, 0, 0.038, 0.014, 0.016, 0.016, "metal_dark")
        m.box(s * 0.032, 0, 0.038, 0.004, 0.020, 0.020, "sign_red")
    m._quad([(-0.011, -0.0205, 0.030), (0.011, -0.0205, 0.030),
             (0.011, -0.0205, 0.052), (-0.011, -0.0205, 0.052)], "metal_dark")  # front cap


@prop("mailbox")
def mailbox(m):
    m.box(0, 0, 0.02, 0.03, 0.03, 0.09, "lamp_pole")           # post
    m.box(0, 0, 0.11, 0.055, 0.10, 0.055, "sign_blue")         # body
    m.gable(0, 0.025, 0.165, 0.055, 0.10, 0.028, "sign_blue", end="sign_blue", ridge="x")
    m._quad([(-0.024, -0.0515, 0.125), (0.024, -0.0515, 0.125),
             (0.024, -0.0515, 0.160), (-0.024, -0.0515, 0.160)], "metal")  # door
    m.box(0.032, 0, 0.13, 0.004, 0.05, 0.035, "sign_red")      # flag


@prop("trash_bin")
def trash_bin(m):
    m.cyl(0, 0, 0, 0.036, 0.075, "metal_dark", seg=7, r_top=0.031)  # body
    m.cyl(0, 0, 0.075, 0.034, 0.008, "metal_dark", seg=7, r_top=0.034)  # rim
    m.cyl(0, 0, 0.083, 0.032, 0.012, "black", seg=7)           # lid
    m.box(0, 0, 0.095, 0.02, 0.012, 0.012, "black")            # handle


@prop("bus_shelter")
def bus_shelter(m):
    m.box(0, 0, 0, 0.34, 0.16, 0.015, "concrete", roof="concrete")  # pad
    for x in (-0.15, 0.15):
        m.box(x, 0.055, 0.015, 0.018, 0.018, 0.15, "lamp_pole")     # posts
    m.box(0, 0.03, 0.165, 0.36, 0.17, 0.015, "roof_slate", roof="roof_slate")  # roof
    m._quad([(-0.15, 0.062, 0.03), (0.15, 0.062, 0.03),
             (0.15, 0.062, 0.155), (-0.15, 0.062, 0.155)], "glass_blue")  # back glass
    for x in (-0.155, 0.155):
        m._quad([(x, -0.045, 0.03), (x, 0.062, 0.03),
                 (x, 0.062, 0.155), (x, -0.045, 0.155)], "glass_blue")  # side glass
    m.box(0, 0.03, 0.055, 0.26, 0.04, 0.012, "bench_wood")     # bench seat
    for x in (-0.11, 0.11):
        m.box(x, 0.03, 0.015, 0.012, 0.035, 0.04, "metal_dark")
    m.box(-0.15, 0.055, 0.185, 0.09, 0.012, 0.035, "glow_sign")  # route sign


@prop("bollard")
def bollard(m):
    m.cyl(0, 0, 0, 0.020, 0.008, "metal_dark", seg=6)
    m.cyl(0, 0, 0.006, 0.014, 0.065, "metal_dark", seg=6)
    m.cyl(0, 0, 0.045, 0.0145, 0.012, "white", seg=6)          # reflective band
    m.cone(0, 0, 0.071, 0.014, 0.010, "metal_dark", seg=6)


@prop("planter_tree")
def planter_tree(m):
    m.box(0, 0, 0, 0.17, 0.17, 0.09, "planter", roof="planter")  # planter
    m.box(0, 0, 0.09, 0.19, 0.19, 0.02, "planter", roof="planter")  # rim
    m._quad([(-0.07, -0.07, 0.092), (0.07, -0.07, 0.092),
             (0.07, 0.07, 0.092), (-0.07, 0.07, 0.092)], "trunk")  # soil
    m.cyl(0, 0, 0.09, 0.014, 0.12, "bark", seg=5)
    m.blob(0, 0, 0.27, 0.10, 0.10, 0.09, "leaf_a", seed=101)
    m.blob(0.05, 0.02, 0.22, 0.07, 0.07, 0.06, "leaf_b", seed=102)
    m.blob(-0.05, -0.02, 0.23, 0.07, 0.07, 0.06, "leaf_c", seed=103)


@prop("phone_booth")
def phone_booth(m):
    m.box(0, 0, 0, 0.11, 0.11, 0.015, "concrete", roof="concrete")
    for x in (-0.05, 0.05):
        for y in (-0.05, 0.05):
            m.box(x, y, 0.015, 0.012, 0.012, 0.20, "sign_red")   # corner posts
    for y, flip in ((-0.056, False), (0.056, True)):
        pts = [(-0.05, y, 0.03), (0.05, y, 0.03), (0.05, y, 0.20), (-0.05, y, 0.20)]
        m._quad(pts if not flip else list(reversed(pts)), "glass_blue")
    m._quad([(-0.05, -0.056, 0.03), (-0.05, 0.056, 0.03),
             (-0.05, 0.056, 0.20), (-0.05, -0.056, 0.20)], "glass_blue")
    m.box(0.03, 0.03, 0.10, 0.05, 0.04, 0.09, "black")           # phone unit
    m.box(0, 0, 0.215, 0.12, 0.12, 0.02, "sign_red", roof="sign_red")
    m.box(0, -0.045, 0.235, 0.10, 0.03, 0.035, "glow_sign")      # sign band


@prop("newsstand")
def newsstand(m):
    m.box(0, 0, 0, 0.26, 0.16, 0.10, "wall_green", roof="wall_green")  # body
    m.box(0, 0, 0.10, 0.28, 0.18, 0.015, "bench_wood")           # counter top
    for x in (-0.12, 0.12):
        m.box(x, 0.06, 0.115, 0.015, 0.015, 0.09, "metal_dark")  # roof posts
    m.box(0, 0.02, 0.205, 0.30, 0.20, 0.015, "roof_slate", roof="roof_slate")
    m._quad([(-0.14, -0.075, 0.15), (0.14, -0.075, 0.15),
             (0.14, -0.075, 0.205), (-0.14, -0.075, 0.205)], "sign_red")  # awning
    for i, (x, mat) in enumerate(((-0.08, "paper"), (-0.03, "sign_red"), (0.02, "sign_blue"),
                                  (0.07, "flower_yellow"), (0.11, "paper"))):
        m._quad([(x - 0.02, -0.0815, 0.115), (x + 0.02, -0.0815, 0.115),
                 (x + 0.02, -0.0815, 0.15), (x - 0.02, -0.0815, 0.15)], mat)  # magazines
    m.box(-0.09, 0.02, 0.115, 0.05, 0.08, 0.03, "flower_red")    # goods crate
    m.box(0.08, 0.02, 0.115, 0.05, 0.08, 0.025, "sign_orange")


@prop("pedestrian_a")
def pedestrian_a(m):
    _person(m, "skin_a", "wall_red", "wall_navy", stride=0.012, arm_swing=0.010)


@prop("pedestrian_b")
def pedestrian_b(m):
    _person(m, "skin_c", "wall_blue", "black", bag="wall_beige")


@prop("pedestrian_c")
def pedestrian_c(m):
    _person(m, "skin_b", "wall_green", "wall_grey", stride=-0.010, arm_swing=-0.008, scale=0.88)


@prop("cyclist")
def cyclist(m):
    for x in (-0.055, 0.055):
        m.wheel(x, 0, 0.035, 0.035, 0.008, seg=6)                # wheels
    m.box(0, 0, 0.055, 0.11, 0.012, 0.012, "sign_red")           # frame bar
    m.box(-0.045, 0, 0.035, 0.012, 0.012, 0.05, "sign_red")      # seat post
    m.box(0.055, 0, 0.045, 0.012, 0.03, 0.03, "black")           # handlebar
    m.box(0.005, 0, 0.075, 0.036, 0.020, 0.038, "wall_yellow")   # rider torso
    for s in (-1, 1):
        m.box(s * 0.013, 0, 0.035, 0.013, 0.013, 0.045, "wall_navy")  # rider legs
    m.box(0.035, 0, 0.095, 0.024, 0.012, 0.012, "wall_yellow")   # rider arms
    m.cyl(-0.005, 0, 0.113, 0.012, 0.024, "skin_a", seg=6)       # head
    m.box(-0.005, 0, 0.131, 0.025, 0.025, 0.008, "sign_red")     # helmet


@prop("dog")
def dog(m):
    m.box(0, 0, 0.030, 0.075, 0.028, 0.028, "trunk", roof="trunk")  # body
    m.box(0.045, 0, 0.045, 0.026, 0.024, 0.026, "trunk")         # head
    m.box(0.062, 0, 0.040, 0.014, 0.014, 0.012, "bark")          # snout
    for x, y in ((0.052, -0.008), (0.052, 0.008)):
        m._tri([(x - 0.006, y - 0.004, 0.058), (x + 0.006, y - 0.004, 0.058),
                (x, y - 0.004, 0.070)], "bark")                 # ears
    for x in (-0.026, 0.026):
        for s in (-1, 1):
            m.box(x, s * 0.009, 0, 0.010, 0.008, 0.032, "bark")  # legs
    m.box(-0.045, 0, 0.055, 0.020, 0.007, 0.007, "bark")        # tail
