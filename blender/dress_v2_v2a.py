"""Detail helpers for v2a residential and mixed-use reference buildings."""


def q_front(m, x0, x1, y, z0, z1, mat):
    m._quad([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], mat)


def q_back(m, x0, x1, y, z0, z1, mat):
    m._quad([(x1, y, z0), (x0, y, z0), (x0, y, z1), (x1, y, z1)], mat)


def q_right(m, x, y0, y1, z0, z1, mat):
    m._quad([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], mat)


def q_left(m, x, y0, y1, z0, z1, mat):
    m._quad([(x, y1, z0), (x, y0, z0), (x, y0, z1), (x, y1, z1)], mat)


def framed_window(m, u, plane, z, w=0.07, h=0.095, side="f", frame="white",
                  pane="glow_window", sill="concrete", mullion=True):
    """Inset-looking window on any wall side."""
    s = -1 if side in ("f", "l") else 1
    z0, z1 = z - h / 2, z + h / 2
    if side in ("f", "b"):
        m.box(u, plane + s * 0.004, z0 - 0.011, w + 0.022, 0.010, h + 0.022, frame)
        if side == "f":
            q_front(m, u - w / 2, u + w / 2, plane + s * 0.010, z0, z1, pane)
        else:
            q_back(m, u - w / 2, u + w / 2, plane + s * 0.010, z0, z1, pane)
        m.box(u, plane + s * 0.012, z0 - 0.016, w + 0.038, 0.022, 0.012, sill, roof=sill)
        if mullion:
            m.box(u, plane + s * 0.013, z0, 0.006, 0.005, h, frame)
    else:
        m.box(plane + s * 0.004, u, z0 - 0.011, 0.010, w + 0.022, h + 0.022, frame)
        if side == "r":
            q_right(m, plane + s * 0.010, u - w / 2, u + w / 2, z0, z1, pane)
        else:
            q_left(m, plane + s * 0.010, u - w / 2, u + w / 2, z0, z1, pane)
        m.box(plane + s * 0.012, u, z0 - 0.016, 0.022, w + 0.038, 0.012, sill, roof=sill)
        if mullion:
            m.box(plane + s * 0.013, u, z0, 0.005, 0.006, h, frame)


def cornice(m, cx, cy, w, d, z, mat="white", h=0.018, t=0.022):
    m.box(cx, cy - d / 2 - t / 2, z, w + 0.035, t, h, mat, roof=mat)
    m.box(cx, cy + d / 2 + t / 2, z, w + 0.035, t, h, mat, roof=mat)
    m.box(cx - w / 2 - t / 2, cy, z, t, d + 0.035, h, mat, roof=mat)
    m.box(cx + w / 2 + t / 2, cy, z, t, d + 0.035, h, mat, roof=mat)


def parapet(m, cx, cy, z, w, d, mat="concrete", h=0.045, t=0.022):
    m.box(cx, cy - d / 2 + t / 2, z, w, t, h, mat)
    m.box(cx, cy + d / 2 - t / 2, z, w, t, h, mat)
    m.box(cx - w / 2 + t / 2, cy, z, t, d - 2 * t, h, mat)
    m.box(cx + w / 2 - t / 2, cy, z, t, d - 2 * t, h, mat)


def balcony(m, cx, y_wall, z, w, depth=0.07, side="f", rail="glass_blue"):
    s = -1 if side == "f" else 1
    m.box(cx, y_wall + s * depth / 2, z, w, depth, 0.012, "concrete", roof="concrete")
    ye, z0, z1 = y_wall + s * depth, z + 0.012, z + 0.062
    if side == "f":
        q_front(m, cx - w / 2, cx + w / 2, ye, z0, z1, rail)
    else:
        q_back(m, cx - w / 2, cx + w / 2, ye, z0, z1, rail)
    m.box(cx - w / 2, y_wall + s * depth / 2, z0, 0.008, depth, 0.05, "metal_dark")
    m.box(cx + w / 2, y_wall + s * depth / 2, z0, 0.008, depth, 0.05, "metal_dark")


def entry_canopy(m, cx, y, z, w, mat="roof_slate"):
    m.box(cx, y - 0.045, z, w, 0.09, 0.018, mat, roof=mat)
    m.box(cx - w / 2 + 0.018, y - 0.075, z - 0.12, 0.014, 0.014, 0.12, "metal_dark")
    m.box(cx + w / 2 - 0.018, y - 0.075, z - 0.12, 0.014, 0.014, 0.12, "metal_dark")


def shopfront(m, cx, y, z, w, name_mat="glow_sign", awning="sign_red"):
    m.box(cx, y - 0.004, z, w, 0.012, 0.18, "glass_blue")
    m.box(cx, y - 0.014, z, w * 0.96, 0.012, 0.025, "metal_dark")
    for x in (cx - w * 0.25, cx, cx + w * 0.25):
        m.box(x, y - 0.016, z, 0.012, 0.012, 0.18, "metal_dark")
    m.awning(cx, y - 0.018, z + 0.22, w + 0.04, depth=0.075, mat=awning)
    m.sign(cx, y - 0.012, z + 0.245, w + 0.02, 0.045, name_mat)


def planter(m, x, y, w=0.11, d=0.045, mat="wall_wood"):
    m.box(x, y, 0.033, w, d, 0.035, mat, roof="grass")
    m.blob(x - w * 0.22, y, 0.083, 0.026, 0.018, 0.020, "leaf_a", subdiv=0, seed=int((x + 1) * 1000))
    m.blob(x + w * 0.22, y, 0.083, 0.026, 0.018, 0.020, "leaf_c", subdiv=0, seed=int((y + 1) * 1000))


def lamp(m, x, y, h=0.18):
    m.cyl(x, y, 0.03, 0.007, h, "lamp_pole", seg=5)
    m.box(x, y - 0.006, 0.03 + h, 0.032, 0.026, 0.026, "glow_lamp", roof="glow_lamp")


def roof_gear(m, z, dense=True):
    m.ac_unit(-0.12, 0.15, z)
    if dense:
        m.ac_unit(0.08, 0.13, z, w=0.06, d=0.045)
        m.skylight(0.14, -0.02, z, w=0.075, d=0.055)
        m.cyl(-0.02, 0.20, z, 0.014, 0.09, "metal", seg=6)
