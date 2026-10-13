"""Shared vehicle dressing helpers for the low-poly fleet.

Vehicles drive along +X, with wheels on the ground and tintable body panels in
``car_body``.  These helpers bias toward readable silhouettes at game zoom:
tyres/rims, arch shadows, glass pillars, seams, handles, mirrors, bumpers,
lamp clusters and role-specific roof/bed details.
"""


def side_quad(m, x0, x1, y, z0, z1, side, mat):
    if side > 0:
        m._quad([(x1, y, z0), (x0, y, z0), (x0, y, z1), (x1, y, z1)], mat)
    else:
        m._quad([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], mat)


def face_quad(m, x, y0, y1, z0, z1, facing, mat):
    if facing > 0:
        m._quad([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], mat)
    else:
        m._quad([(x, y1, z0), (x, y0, z0), (x, y0, z1), (x, y1, z1)], mat)


def wheels(m, xs, half_w, r=0.034, w=0.03, z=None, seg=8, arches=True):
    """Tyres with rim faces, spoke bars, hub caps and dark arch wells."""
    zc = r if z is None else z
    for x in xs:
        for side in (-1, 1):
            y = side * (half_w - w / 2 + 0.004)
            m.wheel(x, y, zc, r, w, seg=seg)
            yo = y + side * (w / 2 + 0.0012)
            hr, sw = r * 0.8, r * 0.16
            side_quad(m, x - hr, x + hr, yo, zc - sw, zc + sw, side, "metal_dark")
            side_quad(m, x - sw, x + sw, yo, zc - hr, zc + hr, side, "metal_dark")
            hr2 = r * 0.34
            side_quad(m, x - hr2, x + hr2, yo + side * 0.0008, zc - hr2, zc + hr2, side, "black")
            if arches:
                side_quad(m, x - r - 0.008, x + r + 0.008, side * (half_w + 0.0015),
                          zc - 0.01, zc + r + 0.006, side, "black")


def plates(m, front, back, z, w=0.036, h=0.014):
    if front is not None:
        face_quad(m, front, -w / 2, w / 2, z, z + h, +1, "white")
    if back is not None:
        face_quad(m, back, -w / 2, w / 2, z, z + h, -1, "white")


def grille(m, x, z0, z1, w=0.07):
    face_quad(m, x, -w / 2, w / 2, z0, z1, +1, "black")
    mid = (z0 + z1) / 2
    face_quad(m, x + 0.0008, -w / 2 + 0.004, w / 2 - 0.004, mid - 0.002, mid + 0.002, +1, "metal_dark")


def mirrors(m, x, z, half_w, housing="car_body"):
    for s in (-1, 1):
        my = s * (half_w + 0.005)
        m.box(x, my, z, 0.016, 0.012, 0.014, housing, roof=housing)
        face_quad(m, x - 0.0088, my - 0.004, my + 0.004, z + 0.002, z + 0.012, -1, "car_glass")


def door_seams(m, xs, half_w, z0, z1, handles=(), hz=None):
    for s in (-1, 1):
        y = s * (half_w + 0.0012)
        for dx in xs:
            side_quad(m, dx - 0.0012, dx + 0.0012, y, z0, z1, s, "black")
        hh = z1 - 0.006 if hz is None else hz
        for hx in handles:
            side_quad(m, hx - 0.004, hx + 0.004, y, hh - 0.0025, hh + 0.0025, s, "metal_dark")


def glass_pillars(m, xs, half_w, z0, z1, width=0.006):
    for s in (-1, 1):
        y = s * (half_w + 0.002)
        for x in xs:
            side_quad(m, x - width / 2, x + width / 2, y, z0, z1, s, "black")


def light_clusters(m, front, back, half_w, z, h=0.025, spread=0.32):
    for s in (-1, 1):
        y = s * half_w * 2 * spread
        face_quad(m, front + 0.001, y - 0.026, y + 0.026, z - 0.004, z + h + 0.004, +1, "black")
        face_quad(m, front + 0.002, y - 0.02, y + 0.02, z, z + h, +1, "glow_head")
        face_quad(m, back - 0.001, y - 0.026, y + 0.026, z - 0.004, z + h + 0.004, -1, "black")
        face_quad(m, back - 0.002, y - 0.02, y + 0.02, z, z + h, -1, "glow_tail")


def roof_rack(m, x, z, length, half_w):
    for y in (-half_w * 0.55, half_w * 0.55):
        m.box(x, y, z, length, 0.008, 0.008, "metal_dark")
    for dx in (-length * 0.33, length * 0.33):
        m.box(x + dx, 0, z + 0.002, 0.012, half_w * 1.25, 0.006, "metal_dark")


def cargo_bed_ribs(m, x0, x1, half_w, z, n=4):
    if n <= 1:
        return
    for i in range(n):
        x = x0 + (x1 - x0) * i / (n - 1)
        m.box(x, 0, z, 0.008, half_w * 1.7, 0.01, "metal_dark")


def rear_doors(m, back, z0, z1):
    face_quad(m, back - 0.001, -0.0012, 0.0012, z0, z1, -1, "black")
    face_quad(m, back - 0.0015, 0.008, 0.02, (z0 + z1) / 2 - 0.004, (z0 + z1) / 2 + 0.004, -1, "metal_dark")
    face_quad(m, back - 0.0015, -0.02, -0.008, (z0 + z1) / 2 - 0.004, (z0 + z1) / 2 + 0.004, -1, "metal_dark")


def rear_bumper(m, back, z, w=0.19):
    m.box(back, 0, z + 0.005, 0.014, w, 0.028, "black")
    plates(m, None, back - 0.0078, z + 0.008, w=0.04)


def car(m, length, width, body_h, cabin_l, cabin_h, cabin_off=-0.02, wheel_r=0.034,
        roof_detail=None, rear_glass=True):
    lift = wheel_r * 0.8
    hw = width / 2
    front, back = length / 2, -length / 2
    m.box(0, 0, lift, length, width, body_h, "car_body", roof="car_body")
    cz = lift + body_h
    m.box(cabin_off, 0, cz, cabin_l, width * 0.84, cabin_h, "car_glass", roof="car_body")
    glass_pillars(m, (cabin_off - cabin_l * 0.18, cabin_off + cabin_l * 0.18), width * 0.42,
                  cz + 0.006, cz + cabin_h - 0.006)
    if rear_glass:
        face_quad(m, back - 0.002, -width * 0.23, width * 0.23, cz + 0.008, cz + cabin_h - 0.012, -1, "car_glass")
    m.box(front - 0.004, 0, lift + 0.01, 0.012, width * 0.9, 0.025, "black")
    m.box(back + 0.004, 0, lift + 0.01, 0.012, width * 0.9, 0.025, "black")
    grille(m, front + 0.0025, lift + 0.022, lift + 0.042, width * 0.44)
    plates(m, front + 0.0028, back - 0.0028, lift + 0.004)
    light_clusters(m, front, back, hw, lift + body_h * 0.55, h=body_h * 0.35)
    door_seams(m, (cabin_off + cabin_l * 0.28, cabin_off - cabin_l * 0.28), hw, lift + 0.01, cz - 0.002,
               handles=(cabin_off + cabin_l * 0.12, cabin_off - cabin_l * 0.16))
    mirrors(m, cabin_off + cabin_l / 2 - 0.01, cz + 0.008, width * 0.42)
    wheels(m, (length * 0.3, -length * 0.3), hw, r=wheel_r)
    if roof_detail == "rack":
        roof_rack(m, cabin_off, cz + cabin_h + 0.003, cabin_l * 0.82, hw)
    return lift

