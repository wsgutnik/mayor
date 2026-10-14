"""Detail helpers for det-a residential building pass."""


def front_frame(m, x, y, z, w=0.09, h=0.12, frame="white", pane="glow_window"):
    """Inset-looking front window with a sill, side frames and a mullion."""
    m.box(x, y - 0.006, z, w + 0.018, 0.01, h + 0.018, frame)
    m._quad([(x - w / 2, y - 0.012, z), (x + w / 2, y - 0.012, z),
             (x + w / 2, y - 0.012, z + h), (x - w / 2, y - 0.012, z + h)], pane)
    m.box(x, y - 0.017, z - 0.012, w + 0.035, 0.026, 0.014, "concrete", roof="concrete")
    m.box(x, y - 0.018, z, 0.01, 0.012, h, frame)


def back_frame(m, x, y, z, w=0.08, h=0.1, frame="white", pane="glow_window"):
    m.box(x, y + 0.006, z, w + 0.016, 0.01, h + 0.016, frame)
    m._quad([(x + w / 2, y + 0.012, z), (x - w / 2, y + 0.012, z),
             (x - w / 2, y + 0.012, z + h), (x + w / 2, y + 0.012, z + h)], pane)
    m.box(x, y + 0.017, z - 0.01, w + 0.03, 0.024, 0.012, "concrete", roof="concrete")


def side_frame(m, x, y, z, side, w=0.08, h=0.1, frame="white", pane="glow_window"):
    off = 0.006 if side > 0 else -0.006
    m.box(x + off, y, z, 0.01, w + 0.016, h + 0.016, frame)
    xx = x + (0.012 if side > 0 else -0.012)
    if side > 0:
        m._quad([(xx, y - w / 2, z), (xx, y + w / 2, z), (xx, y + w / 2, z + h), (xx, y - w / 2, z + h)], pane)
    else:
        m._quad([(xx, y + w / 2, z), (xx, y - w / 2, z), (xx, y - w / 2, z + h), (xx, y + w / 2, z + h)], pane)


def cornice(m, cx, cy, w, d, z, mat="slab"):
    m.box(cx, cy - d / 2 - 0.008, z, w + 0.035, 0.018, 0.018, mat, roof=mat)
    m.box(cx, cy + d / 2 + 0.008, z, w + 0.035, 0.018, 0.018, mat, roof=mat)
    m.box(cx - w / 2 - 0.008, cy, z, 0.018, d + 0.035, 0.018, mat, roof=mat)
    m.box(cx + w / 2 + 0.008, cy, z, 0.018, d + 0.035, 0.018, mat, roof=mat)


def roof_seams(m, cx, cy, z, w, d, count=5, ridge="y", mat="roof_dark"):
    if ridge == "y":
        for i in range(count):
            x = cx - w * 0.38 + i * (w * 0.76 / max(1, count - 1))
            m.box(x, cy, z, 0.009, d * 0.86, 0.012, mat, roof=mat)
    else:
        for i in range(count):
            y = cy - d * 0.38 + i * (d * 0.76 / max(1, count - 1))
            m.box(cx, y, z, w * 0.86, 0.009, 0.012, mat, roof=mat)


def balcony_rail_posts(m, cx, y, z, w, count=4, mat="metal_dark"):
    for i in range(count):
        x = cx - w / 2 + i * (w / max(1, count - 1))
        m.box(x, y, z, 0.008, 0.008, 0.075, mat)
    m.box(cx, y, z + 0.07, w, 0.008, 0.008, mat)


def planter(m, x, y, w=0.12, d=0.04):
    m.box(x, y, 0.033, w, d, 0.035, "wall_wood", roof="grass")
    m.blob(x - w * 0.25, y, 0.085, 0.035, 0.022, 0.025, "leaf_a", subdiv=1, jitter=0.05)
    m.blob(x + w * 0.22, y, 0.085, 0.03, 0.022, 0.025, "leaf_c", subdiv=1, jitter=0.05)


def lamp(m, x, y):
    m.cyl(x, y, 0.03, 0.008, 0.16, "lamp_pole", seg=6)
    m.box(x, y - 0.006, 0.185, 0.035, 0.025, 0.025, "glow_lamp", roof="glow_lamp")


def pavers(m, x0=-0.18, y0=-0.42, x1=0.18, y1=-0.18, n=4):
    for i in range(n):
        y = y0 + (i + 0.5) * ((y1 - y0) / n)
        m.box((x0 + x1) / 2, y, 0.034, x1 - x0, 0.012, 0.006, "concrete", roof="concrete")
