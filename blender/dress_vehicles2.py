"""Second-pass vehicle dressing helpers.

The first fleet pass gave vehicles lights and seams, but most shells were still
single-colour boxes.  These helpers keep the same material contract
(``car_body`` is the tintable paint and glow_* materials stay emissive) while
adding readable, real geometry: pinched/chamfered bodies, dark greenhouse panes,
pillars, lower trim, wheel arches, plates, mirrors and role-friendly trim.
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


def _inset_box(m, cx, cy, z0, w, d, h, mat, roof=None, ix=0.018, iy=0.014):
    """Box with a smaller top footprint, enough bevel to catch the silhouette."""
    x0, x1 = cx - w / 2, cx + w / 2
    y0, y1 = cy - d / 2, cy + d / 2
    z1 = z0 + h
    tx0, tx1 = x0 + ix, x1 - ix
    ty0, ty1 = y0 + iy, y1 - iy
    m._quad([(x0, y0, z0), (x1, y0, z0), (tx1, ty0, z1), (tx0, ty0, z1)], mat)
    m._quad([(x1, y1, z0), (x0, y1, z0), (tx0, ty1, z1), (tx1, ty1, z1)], mat)
    m._quad([(x1, y0, z0), (x1, y1, z0), (tx1, ty1, z1), (tx1, ty0, z1)], mat)
    m._quad([(x0, y1, z0), (x0, y0, z0), (tx0, ty0, z1), (tx0, ty1, z1)], mat)
    m._quad([(tx0, ty0, z1), (tx1, ty0, z1), (tx1, ty1, z1), (tx0, ty1, z1)], roof or mat)


def _wedge(m, x0, x1, width, z0, z1, mat, roof=None, front_high=True):
    """Sloped hood/trunk panel between two x positions."""
    y0, y1 = -width / 2, width / 2
    za, zb = (z0, z1) if front_high else (z1, z0)
    t = 0.012
    m._quad([(x0, y0, za - t), (x1, y0, zb - t), (x1, y0, zb), (x0, y0, za)], mat)
    m._quad([(x1, y1, zb - t), (x0, y1, za - t), (x0, y1, za), (x1, y1, zb)], mat)
    m._quad([(x1, y0, zb - t), (x1, y1, zb - t), (x1, y1, zb), (x1, y0, zb)], mat)
    m._quad([(x0, y1, za - t), (x0, y0, za - t), (x0, y0, za), (x0, y1, za)], mat)
    m._quad([(x0, y0, za), (x1, y0, zb), (x1, y1, zb), (x0, y1, za)], roof or mat)


def lower_trim(m, front, back, half_w, z, h=0.018):
    m.box((front + back) / 2, 0, z, front - back, half_w * 2 + 0.006, h, "black")
    for s in (-1, 1):
        side_quad(m, back + 0.02, front - 0.02, s * (half_w + 0.004), z + h * 0.75, z + h + 0.004, s, "metal_dark")


def wheels(m, xs, half_w, r=0.034, w=0.03, z=None, seg=10, arches=True):
    zc = r if z is None else z
    for x in xs:
        for side in (-1, 1):
            y = side * (half_w - w / 2 + 0.004)
            m.wheel(x, y, zc, r, w, seg=seg)
            yo = y + side * (w / 2 + 0.0012)
            hr, sw = r * 0.78, r * 0.14
            side_quad(m, x - hr, x + hr, yo, zc - sw, zc + sw, side, "metal_dark")
            side_quad(m, x - sw, x + sw, yo, zc - hr, zc + hr, side, "metal_dark")
            side_quad(m, x - r * 0.34, x + r * 0.34, yo + side * 0.001, zc - r * 0.34, zc + r * 0.34, side, "black")
            if arches:
                side_quad(m, x - r - 0.01, x + r + 0.01, side * (half_w + 0.002),
                          zc - 0.008, zc + r + 0.01, side, "black")


def plates(m, front, back, z, w=0.036, h=0.014):
    if front is not None:
        face_quad(m, front, -w / 2, w / 2, z, z + h, +1, "white")
    if back is not None:
        face_quad(m, back, -w / 2, w / 2, z, z + h, -1, "white")


def grille(m, x, z0, z1, w=0.07):
    face_quad(m, x, -w / 2, w / 2, z0, z1, +1, "black")
    for dz in (0.25, 0.55, 0.85):
        z = z0 + (z1 - z0) * dz
        face_quad(m, x + 0.0008, -w / 2 + 0.004, w / 2 - 0.004, z - 0.0012, z + 0.0012, +1, "metal_dark")


def mirrors(m, x, z, half_w, housing="car_body"):
    for s in (-1, 1):
        my = s * (half_w + 0.006)
        m.box(x, my, z, 0.018, 0.012, 0.014, housing, roof=housing)
        face_quad(m, x - 0.0095, my - 0.004, my + 0.004, z + 0.002, z + 0.012, -1, "glass_dark")


def door_seams(m, xs, half_w, z0, z1, handles=(), hz=None):
    for s in (-1, 1):
        y = s * (half_w + 0.002)
        for dx in xs:
            side_quad(m, dx - 0.0014, dx + 0.0014, y, z0, z1, s, "black")
        hh = z1 - 0.006 if hz is None else hz
        for hx in handles:
            side_quad(m, hx - 0.005, hx + 0.005, y, hh - 0.0025, hh + 0.0025, s, "metal_dark")


def glass_pillars(m, xs, half_w, z0, z1, width=0.006):
    for s in (-1, 1):
        y = s * (half_w + 0.003)
        for x in xs:
            side_quad(m, x - width / 2, x + width / 2, y, z0, z1, s, "black")


def light_clusters(m, front, back, half_w, z, h=0.025, spread=0.32):
    for s in (-1, 1):
        y = s * half_w * 2 * spread
        face_quad(m, front + 0.001, y - 0.027, y + 0.027, z - 0.004, z + h + 0.004, +1, "black")
        face_quad(m, front + 0.002, y - 0.021, y + 0.021, z, z + h, +1, "glow_head")
        face_quad(m, back - 0.001, y - 0.027, y + 0.027, z - 0.004, z + h + 0.004, -1, "black")
        face_quad(m, back - 0.002, y - 0.021, y + 0.021, z, z + h, -1, "glow_tail")


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
        m.box(x, 0, z, 0.008, half_w * 1.7, 0.012, "metal_dark")


def rear_doors(m, back, z0, z1):
    face_quad(m, back - 0.001, -0.0012, 0.0012, z0, z1, -1, "black")
    face_quad(m, back - 0.0015, 0.008, 0.02, (z0 + z1) / 2 - 0.004, (z0 + z1) / 2 + 0.004, -1, "metal_dark")
    face_quad(m, back - 0.0015, -0.02, -0.008, (z0 + z1) / 2 - 0.004, (z0 + z1) / 2 + 0.004, -1, "metal_dark")


def rear_bumper(m, back, z, w=0.19):
    m.box(back, 0, z + 0.005, 0.014, w, 0.028, "black")
    plates(m, None, back - 0.0078, z + 0.008, w=0.04)


def glasshouse(m, x, z, length, width, height, front_rake=0.018, rear_rake=0.014, rear_glass=True):
    hw = width / 2
    x0, x1 = x - length / 2, x + length / 2
    y0, y1 = -hw, hw
    z0, z1 = z, z + height
    top_x0, top_x1 = x0 + rear_rake, x1 - front_rake
    top_y0, top_y1 = y0 + 0.014, y1 - 0.014
    for s, yb, yt in ((-1, y0, top_y0), (1, y1, top_y1)):
        pts = [(x0, yb, z0), (x1, yb, z0), (top_x1, yt, z1), (top_x0, yt, z1)]
        side_quad(m, x0, x1, yb + s * 0.002, z0 + 0.002, z1 - 0.003, s, "glass_dark")
    face_quad(m, x1 + 0.001, y0 + 0.014, y1 - 0.014, z0 + 0.005, z1 - 0.004, +1, "glass_dark")
    if rear_glass:
        face_quad(m, x0 - 0.001, y0 + 0.018, y1 - 0.018, z0 + 0.006, z1 - 0.006, -1, "glass_dark")
    m._quad([(top_x0, top_y0, z1), (top_x1, top_y0, z1), (top_x1, top_y1, z1), (top_x0, top_y1, z1)], "car_body")
    glass_pillars(m, (x1 - length * 0.18, x, x0 + length * 0.2), hw, z0 + 0.003, z1 - 0.004)


def car(m, length, width, body_h, cabin_l, cabin_h, cabin_off=-0.02, wheel_r=0.034,
        roof_detail=None, rear_glass=True):
    lift = wheel_r * 0.8
    hw = width / 2
    front, back = length / 2, -length / 2
    lower_trim(m, front, back, hw, lift - 0.002)
    _inset_box(m, 0, 0, lift + 0.012, length * 0.96, width, body_h * 0.62, "car_body", "car_body",
               ix=0.018, iy=0.012)
    # sloped hood and trunk lids break the white-box read at distance.
    hood0 = cabin_off + cabin_l * 0.36
    trunk1 = cabin_off - cabin_l * 0.43
    _wedge(m, hood0, front - 0.01, width * 0.92, lift + body_h * 0.62, lift + body_h * 0.9, "car_body")
    _wedge(m, back + 0.01, trunk1, width * 0.9, lift + body_h * 0.58, lift + body_h * 0.8, "car_body", front_high=False)
    cz = lift + body_h * 0.82
    glasshouse(m, cabin_off, cz, cabin_l, width * 0.84, cabin_h, rear_glass=rear_glass)
    m.box(front - 0.004, 0, lift + 0.01, 0.012, width * 0.9, 0.025, "black")
    m.box(back + 0.004, 0, lift + 0.01, 0.012, width * 0.9, 0.025, "black")
    grille(m, front + 0.0025, lift + 0.024, lift + 0.046, width * 0.44)
    plates(m, front + 0.0028, back - 0.0028, lift + 0.004)
    light_clusters(m, front, back, hw, lift + body_h * 0.5, h=body_h * 0.36)
    door_seams(m, (cabin_off + cabin_l * 0.29, cabin_off - cabin_l * 0.28), hw, lift + 0.018, cz + cabin_h * 0.54,
               handles=(cabin_off + cabin_l * 0.12, cabin_off - cabin_l * 0.16))
    mirrors(m, cabin_off + cabin_l / 2 - 0.012, cz + 0.01, width * 0.42)
    wheels(m, (length * 0.3, -length * 0.3), hw, r=wheel_r)
    if roof_detail == "rack":
        roof_rack(m, cabin_off, cz + cabin_h + 0.003, cabin_l * 0.82, hw)
    return lift
