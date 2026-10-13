"""Transport kit models (entries 31-33): bus station, train station, cargo terminal."""
from lib import Model
from registry import building


def _column(m: Model, x, y, z0, h, w=0.03, mat="metal_dark"):
    m.box(x, y, z0, w, w, h, mat)


def _fence_wall(m: Model, cx, cy, w, d, h=0.07, mat="metal_dark"):
    """A cheap fence run as one thin wall (one box)."""
    if w >= d:
        m.box(cx, cy, 0.03, w, 0.015, h, mat)
    else:
        m.box(cx, cy, 0.03, 0.015, d, h, mat)


def _lamp(m: Model, x, y, h=0.24):
    m.box(x, y, 0.03, 0.018, 0.018, h, "lamp_pole")
    m.box(x, y, 0.03 + h, 0.05, 0.03, 0.025, "glow_lamp")


def _back_door(m: Model, x, y_back, z=0.03, w=0.07, h=0.12, mat="metal_dark"):
    m.box(x, y_back + 0.004, z, w + 0.016, 0.008, h + 0.01, "white")
    m.box(x, y_back + 0.007, z, w, 0.006, h, mat)


def _downpipes(m: Model, cx, y_back, z0, h, w):
    for sx in (-1, 1):
        m.box(cx + sx * (w / 2 - 0.03), y_back + 0.008, z0, 0.014, 0.012, h, "metal_dark")


def _bench(m: Model, cx, cy, simple=False):
    m.box(cx, cy, 0.03, 0.12, 0.03, 0.035, "bench_wood")
    if not simple:
        m.box(cx, cy + 0.022, 0.03, 0.12, 0.012, 0.07, "bench_wood")


def _back_door(m: Model, x, y_back, z=0.03, w=0.07, h=0.11, mat="glass_dark"):
    m.box(x, y_back + 0.004, z, w + 0.016, 0.008, h + 0.01, "white")
    m._quad([(x + w / 2, y_back + 0.009, z), (x - w / 2, y_back + 0.009, z),
             (x - w / 2, y_back + 0.009, z + h), (x + w / 2, y_back + 0.009, z + h)], mat)


def _louver(m: Model, x, y_back, z, w=0.08, h=0.045):
    m.box(x, y_back + 0.006, z, w, 0.01, h, "metal_dark")


def _bus(m: Model, cx, cy, body="white", stripe="sign_blue"):
    """City bus along X: body, glass strips, skirt stripes, windscreen, dark under-box."""
    L, W, H, lift = 0.3, 0.095, 0.1, 0.035
    m.box(cx, cy, lift, L, W, H, body, roof=body)
    for s in (-1, 1):
        y = cy + s * (W / 2 + 0.002)
        pts = [(cx - L / 2 + 0.03, y, lift + 0.045), (cx + L / 2 - 0.03, y, lift + 0.045),
               (cx + L / 2 - 0.03, y, lift + H - 0.015), (cx - L / 2 + 0.03, y, lift + H - 0.015)]
        m._quad(pts if s < 0 else list(reversed(pts)), "glass_dark")
        st = [(cx - L / 2 + 0.01, y, lift + 0.008), (cx + L / 2 - 0.01, y, lift + 0.008),
              (cx + L / 2 - 0.01, y, lift + 0.03), (cx - L / 2 + 0.01, y, lift + 0.03)]
        m._quad(st if s < 0 else list(reversed(st)), stripe)
    m._quad([(cx + L / 2 + 0.002, cy - W / 2 + 0.015, lift + 0.045),
             (cx + L / 2 + 0.002, cy + W / 2 - 0.015, lift + 0.045),
             (cx + L / 2 + 0.002, cy + W / 2 - 0.015, lift + H - 0.015),
             (cx + L / 2 + 0.002, cy - W / 2 + 0.015, lift + H - 0.015)], "glass_dark")
    m.box(cx, cy, lift - 0.012, L * 0.9, W * 0.8, 0.014, "black")


def _box_truck(m: Model, cx, cy, along="x", body="white", cab="sign_blue"):
    if along == "x":
        m.box(cx - 0.04, cy, 0.045, 0.24, 0.11, 0.12, body, roof=body)
        m.box(cx + 0.13, cy, 0.045, 0.08, 0.1, 0.085, cab)
        m._quad([(cx + 0.171, cy - 0.04, 0.095), (cx + 0.171, cy + 0.04, 0.095),
                 (cx + 0.171, cy + 0.04, 0.12), (cx + 0.171, cy - 0.04, 0.12)], "glass_dark")
        m.box(cx - 0.02, cy, 0.032, 0.3, 0.09, 0.016, "black")
    else:
        m.box(cx, cy + 0.04, 0.045, 0.11, 0.24, 0.12, body, roof=body)
        m.box(cx, cy - 0.13, 0.045, 0.1, 0.08, 0.085, cab)
        m._quad([(cx - 0.04, cy - 0.171, 0.095), (cx + 0.04, cy - 0.171, 0.095),
                 (cx + 0.04, cy - 0.171, 0.12), (cx - 0.04, cy - 0.171, 0.12)], "glass_dark")
        m.box(cx, cy + 0.02, 0.032, 0.09, 0.3, 0.016, "black")


def _train_car(m: Model, cx, cy, body="wall_red"):
    L, W, H, lift = 0.52, 0.11, 0.12, 0.05
    m.box(cx, cy, lift, L, W, H, body, roof="roof_slate")
    for s in (-1, 1):
        y = cy + s * (W / 2 + 0.002)
        pts = [(cx - L / 2 + 0.04, y, lift + 0.05), (cx + L / 2 - 0.04, y, lift + 0.05),
               (cx + L / 2 - 0.04, y, lift + H - 0.02), (cx - L / 2 + 0.04, y, lift + H - 0.02)]
        m._quad(pts if s < 0 else list(reversed(pts)), "glow_window")
    m._quad([(cx + L / 2 + 0.002, cy - W / 2 + 0.01, lift + 0.02),
             (cx + L / 2 + 0.002, cy + W / 2 - 0.01, lift + 0.02),
             (cx + L / 2 + 0.002, cy + W / 2 - 0.01, lift + 0.08),
             (cx + L / 2 + 0.002, cy - W / 2 + 0.01, lift + 0.08)], "glass_dark")
    m.box(cx, cy, lift - 0.014, L * 0.92, W * 0.75, 0.016, "black")


def _track(m: Model, cy, x0=-0.44, x1=0.44, sleepers=6):
    m._quad([(x0, cy - 0.055, 0.034), (x1, cy - 0.055, 0.034),
             (x1, cy + 0.055, 0.034), (x0, cy + 0.055, 0.034)], "asphalt")
    for dy in (-0.035, 0.035):
        m.box((x0 + x1) / 2, cy + dy, 0.034, x1 - x0, 0.012, 0.012, "metal")
    for i in range(sleepers):
        x = x0 + 0.03 + (x1 - x0 - 0.06) * i / (sleepers - 1)
        m._quad([(x - 0.012, cy - 0.05, 0.035), (x + 0.012, cy - 0.05, 0.035),
                 (x + 0.012, cy + 0.05, 0.035), (x - 0.012, cy + 0.05, 0.035)], "trunk")


@building(31, "Estação de Ônibus")
def estacao_onibus(m: Model):
    m.plot()
    # waiting hall at the back: warm glass front, roof slab, lit windows
    m.box(0, 0.27, 0.03, 0.78, 0.2, 0.17, "wall_cream", roof="roof_flat")
    m.box(0, 0.27, 0.2, 0.82, 0.24, 0.02, "slab")
    m.box(0, 0.165, 0.03, 0.7, 0.012, 0.12, "glass_blue")
    m.windows(0, 0.27, 0.03, 0.78, 0.2, 0.17, 1, cols=6, sides="fbrl", lit=0.7, slabs=False)
    m.door(0.0, 0.159, 0.03, 0.09, 0.11, "glass_dark")
    _back_door(m, -0.22, 0.37, 0.03)
    _louver(m, 0.16, 0.373, 0.11)
    m.box(0.32, 0.4, 0.03, 0.12, 0.06, 0.05, "metal_dark", roof="metal")
    # linear canopy on dark columns, with a skylight strip and a glowing fascia
    m.box(0, -0.04, 0.3, 0.86, 0.4, 0.025, "roof_flat", roof="roof_flat")
    m.box(0, -0.04, 0.325, 0.7, 0.12, 0.012, "glass_blue", roof="glass_blue")
    m.box(0, -0.235, 0.285, 0.86, 0.015, 0.04, "wall_navy")
    m._quad([(-0.4, -0.243, 0.29), (-0.2, -0.243, 0.29),
             (-0.2, -0.243, 0.315), (-0.4, -0.243, 0.315)], "glow_sign")
    for x in (-0.38, 0.0, 0.38):
        _column(m, x, -0.19, 0.03, 0.27, w=0.035)
        _column(m, x, 0.11, 0.03, 0.27, w=0.035)
    # two buses in the bays, staggered like the kit art
    _bus(m, -0.2, -0.3, "white", "sign_blue")
    _bus(m, 0.22, -0.38, "white", "sign_blue")
    # passenger shelter with a bench under the canopy, plus a second bench
    m.box(-0.28, 0.02, 0.2, 0.2, 0.08, 0.015, "glass_blue")
    _column(m, -0.36, 0.02, 0.03, 0.17, w=0.02, mat="metal")
    _column(m, -0.2, 0.02, 0.03, 0.17, w=0.02, mat="metal")
    _bench(m, -0.28, 0.0)
    _bench(m, 0.25, 0.02, simple=True)
    # pylon sign, lamps, crosswalk stripes
    m.box(0.4, -0.24, 0.03, 0.03, 0.03, 0.2, "metal_dark")
    m.box(0.4, -0.24, 0.23, 0.1, 0.03, 0.07, "glow_sign")
    m.box(-0.36, 0.19, 0.03, 0.16, 0.018, 0.1, "glow_sign")
    _fence_wall(m, -0.44, 0.0, 0, 0.72)
    _fence_wall(m, 0.44, 0.0, 0, 0.72)
    _lamp(m, -0.42, -0.36)
    _lamp(m, 0.1, 0.06)
    for i in range(3):
        x = -0.04 + i * 0.035
        m._quad([(x, -0.42, 0.033), (x + 0.022, -0.42, 0.033),
                 (x + 0.022, -0.34, 0.033), (x, -0.34, 0.033)], "white")
    m.tree(-0.42, 0.42, 0.9)
    m.tree(0.42, 0.42, 0.9, dark=True)


@building(32, "Estação de Trem")
def estacao_trem(m: Model):
    m.plot()
    # central hall: cream walls, dark blue hip roof, glowing entry sign
    m.box(0, 0.28, 0.03, 0.38, 0.28, 0.24, "wall_cream", roof="roof_flat")
    m.hip(0, 0.28, 0.27, 0.44, 0.34, 0.11, "roof_blue")
    m.box(-0.28, 0.28, 0.03, 0.18, 0.26, 0.18, "wall_brick", roof="roof_flat")
    m.hip(-0.28, 0.28, 0.21, 0.22, 0.3, 0.08, "roof_blue")
    m.box(0.28, 0.28, 0.03, 0.18, 0.26, 0.18, "wall_brick", roof="roof_flat")
    m.hip(0.28, 0.28, 0.21, 0.22, 0.3, 0.08, "roof_blue")
    m.windows(0, 0.28, 0.03, 0.38, 0.28, 0.24, 1, cols=3, sides="f", lit=0.7, slabs=False)
    m.windows(-0.28, 0.28, 0.03, 0.18, 0.26, 0.18, 1, cols=1, sides="f", lit=0.6, slabs=False)
    m.windows(0.28, 0.28, 0.03, 0.18, 0.26, 0.18, 1, cols=1, sides="f", lit=0.6, slabs=False)
    m.windows(0, 0.28, 0.03, 0.38, 0.28, 0.24, 1, cols=3, sides="brl", lit=0.65, slabs=False)
    m.windows(-0.28, 0.28, 0.03, 0.18, 0.26, 0.18, 1, cols=1, sides="bl", lit=0.55, slabs=False)
    m.windows(0.28, 0.28, 0.03, 0.18, 0.26, 0.18, 1, cols=1, sides="br", lit=0.55, slabs=False)
    m.door(0, 0.136, 0.03, 0.1, 0.14, "wall_wood")
    _back_door(m, -0.07, 0.42, mat="wall_wood")
    _back_door(m, 0.3, 0.41, w=0.055, h=0.1)
    _downpipes(m, 0, 0.42, 0.03, 0.24, 0.38)
    m.box(0, 0.13, 0.18, 0.16, 0.02, 0.05, "glow_sign")
    m.box(0.18, 0.427, 0.18, 0.14, 0.012, 0.035, "glow_sign")
    # clock tower with a glowing face
    m.box(0, 0.28, 0.38, 0.12, 0.12, 0.2, "wall_cream")
    m.pyramid(0, 0.28, 0.58, 0.15, 0.15, 0.09, "roof_blue")
    m._quad([(-0.045, 0.218, 0.46), (0.045, 0.218, 0.46),
             (0.045, 0.218, 0.54), (-0.045, 0.218, 0.54)], "glow_lamp")
    # platform and one long canopy over the platform and both tracks
    m.box(0, -0.02, 0.03, 0.88, 0.2, 0.03, "concrete", roof="paving")
    m.box(-0.03, -0.13, 0.26, 0.78, 0.56, 0.02, "roof_dark", roof="roof_dark")
    for x in (-0.34, -0.03, 0.28):
        _column(m, x, -0.29, 0.03, 0.23, w=0.025)
        _column(m, x, 0.05, 0.03, 0.23, w=0.025)
    # two tracks with rails and sleepers, a train car at the platform
    _track(m, -0.22, sleepers=6)
    _track(m, -0.36, sleepers=6)
    _train_car(m, -0.1, -0.22, "wall_red")
    # footbridge over the tracks: deck, sloped stair quads (both faces), side rail
    m.box(0.445, -0.23, 0.26, 0.08, 0.34, 0.02, "metal")
    south = [(0.405, -0.48, 0.03), (0.485, -0.48, 0.03), (0.485, -0.4, 0.26), (0.405, -0.4, 0.26)]
    m._quad(south, "metal_dark")
    m._quad(list(reversed(south)), "metal_dark")
    north = [(0.405, 0.04, 0.06), (0.485, 0.04, 0.06), (0.485, -0.06, 0.26), (0.405, -0.06, 0.26)]
    m._quad(north, "metal_dark")
    m._quad(list(reversed(north)), "metal_dark")
    m._quad([(0.403, -0.4, 0.28), (0.403, -0.06, 0.28),
             (0.403, -0.06, 0.34), (0.403, -0.4, 0.34)], "metal_dark")
    m.ac_unit(-0.12, 0.28, 0.29, 0.07, 0.05, 0.03)
    m.box(0.18, 0.27, 0.29, 0.06, 0.04, 0.045, "metal_dark")
    _lamp(m, -0.42, 0.1)
    _lamp(m, 0.3, -0.02, h=0.18)
    m.tree(-0.43, 0.4, 0.9)
    m.tree(0.43, 0.4, 0.9, dark=True)


@building(33, "Terminal de Carga")
def terminal_carga(m: Model):
    m.plot(lawn=False)
    # main warehouse: grey hall, yellow dock doors, lit strip windows, skylight
    m.box(-0.12, 0.16, 0.03, 0.68, 0.4, 0.28, "wall_grey", roof="roof_flat")
    m.box(-0.12, 0.16, 0.31, 0.72, 0.44, 0.02, "slab")
    for x in (-0.34, -0.12, 0.1):
        m.box(x, -0.045, 0.03, 0.13, 0.015, 0.14, "wall_yellow")
    m.windows(-0.12, 0.16, 0.17, 0.68, 0.4, 0.11, 1, cols=5, sides="f", lit=0.5, slabs=False)
    m.windows(-0.12, 0.16, 0.17, 0.68, 0.4, 0.11, 1, cols=5, sides="brl", lit=0.45, slabs=False)
    for x in (-0.26, 0.02):
        m.box(x, 0.365, 0.03, 0.14, 0.012, 0.13, "metal_dark")
        m.box(x, 0.41, 0.03, 0.16, 0.08, 0.012, "concrete", roof="concrete")
    _back_door(m, 0.2, 0.36, w=0.06, h=0.11)
    _downpipes(m, -0.12, 0.36, 0.03, 0.28, 0.68)
    m.skylight(-0.12, 0.16, 0.33, 0.12, 0.09)
    m.ac_unit(-0.34, 0.14, 0.33)
    m.ac_unit(0.08, 0.24, 0.33)
    # small storage shed in the yard
    m.box(0.03, -0.13, 0.03, 0.12, 0.12, 0.1, "wall_beige", roof="roof_dark")
    m.box(0.095, -0.13, 0.05, 0.008, 0.06, 0.055, "metal_dark")
    # container yard: one single and one stacked pair, long side along Y
    m.box(0.34, 0.2, 0.03, 0.09, 0.2, 0.09, "wall_blue")
    m.box(0.34, 0.32, 0.03, 0.09, 0.2, 0.09, "sign_orange")
    m.box(0.34, 0.32, 0.12, 0.09, 0.2, 0.09, "wall_red")
    m.box(-0.28, -0.26, 0.03, 0.2, 0.09, 0.09, "wall_green")
    m.box(0.1, -0.36, 0.03, 0.2, 0.09, 0.09, "wall_yellow")
    # gantry crane straddling the container row, with cab and spreader
    for dx, dy in ((-0.09, -0.12), (0.09, -0.12), (-0.09, 0.12), (0.09, 0.12)):
        _column(m, 0.34 + dx, 0.26 + dy, 0.03, 0.3, w=0.03, mat="wall_yellow")
    m.box(0.34, 0.26, 0.33, 0.24, 0.3, 0.03, "wall_yellow")
    m.box(0.26, 0.26, 0.26, 0.06, 0.06, 0.07, "glass_dark")
    m._quad([(0.32, 0.2, 0.33), (0.36, 0.2, 0.33),
             (0.36, 0.2, 0.21), (0.32, 0.2, 0.21)], "metal_dark")
    m._quad([(0.36, 0.2, 0.33), (0.32, 0.2, 0.33),
             (0.32, 0.2, 0.21), (0.36, 0.2, 0.21)], "metal_dark")
    m.box(0.34, 0.2, 0.18, 0.12, 0.05, 0.03, "metal_dark")
    # trucks: one backed into a dock, one circulating
    _box_truck(m, -0.12, -0.28, "y", "white", "sign_blue")
    _box_truck(m, 0.3, -0.18, "x", "white", "wall_red")
    # gatehouse with lit windows, site fence, lamps
    m.box(-0.36, -0.4, 0.03, 0.16, 0.12, 0.1, "wall_cream", roof="slab")
    m.windows(-0.36, -0.4, 0.03, 0.16, 0.12, 0.1, 1, cols=2, sides="f", lit=0.7, slabs=False)
    _fence_wall(m, 0.0, -0.44, 0.8, 0)
    _fence_wall(m, -0.48, 0.0, 0, 0.85)
    _fence_wall(m, 0.48, 0.0, 0, 0.85)
    _lamp(m, -0.15, -0.08)
    _lamp(m, 0.3, -0.05)
    m.tree(-0.4, 0.43, 0.8)
    m.tree(0.44, -0.44, 0.7, dark=True)
