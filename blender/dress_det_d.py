"""Extra dressing for det-d transport, utility, and industry buildings."""


def curb_stripes(m, x0, x1, y, count=5, mat="white"):
    step = (x1 - x0) / count
    for i in range(count):
        x = x0 + step * (i + 0.5)
        m._quad([(x - 0.018, y - 0.055, 0.033), (x + 0.018, y - 0.055, 0.033),
                 (x + 0.018, y + 0.055, 0.033), (x - 0.018, y + 0.055, 0.033)], mat)


def thin_frame(m, cx, y, z, w, h, mat="white", front=True):
    off = -0.006 if front else 0.006
    m.box(cx, y + off, z + h, w + 0.018, 0.008, 0.012, mat)
    m.box(cx, y + off, z + 0.006, w + 0.018, 0.008, 0.012, mat)
    m.box(cx - w / 2 - 0.006, y + off, z, 0.01, 0.008, h, mat)
    m.box(cx + w / 2 + 0.006, y + off, z, 0.01, 0.008, h, mat)


def roof_seams(m, cx, cy, z, w, d, along="x", count=5, mat="metal_dark"):
    for i in range(1, count + 1):
        t = i / (count + 1) - 0.5
        if along == "x":
            m.box(cx + t * w, cy, z, 0.008, d * 0.94, 0.012, mat)
        else:
            m.box(cx, cy + t * d, z, w * 0.94, 0.008, 0.012, mat)


def bollards(m, xs, y, mat="sign_orange"):
    for x in xs:
        m.cyl(x, y, 0.03, 0.012, 0.06, mat, seg=6)
        m.cyl(x, y, 0.075, 0.013, 0.012, "metal_dark", seg=6)


def pipe_run(m, y, xs, z0, z1, mat="metal"):
    for x in xs:
        m.box(x, y, z0, 0.012, 0.012, z1 - z0, mat)
    m.box((xs[0] + xs[-1]) / 2, y, z1, xs[-1] - xs[0], 0.012, 0.012, mat)


def tank_ladder(m, x, y, z0, h, front=True):
    off = -0.006 if front else 0.006
    m.box(x - 0.018, y + off, z0 + h / 2, 0.006, 0.006, h, "metal_dark")
    m.box(x + 0.018, y + off, z0 + h / 2, 0.006, 0.006, h, "metal_dark")
    for i in range(5):
        z = z0 + 0.025 + i * (h - 0.05) / 4
        m.box(x, y + off, z, 0.05, 0.006, 0.006, "metal_dark")


def container_ribs(m, cx, cy, z, w, d, h, along="y", count=4, mat="metal_dark"):
    for i in range(count):
        t = -0.5 + (i + 0.5) / count
        if along == "y":
            m.box(cx, cy + t * d, z + h / 2, w + 0.006, 0.006, h * 0.92, mat)
        else:
            m.box(cx + t * w, cy, z + h / 2, 0.006, d + 0.006, h * 0.92, mat)


def guard_rail(m, x0, x1, y, z=0.08, posts=5):
    m.box((x0 + x1) / 2, y, z, x1 - x0, 0.008, 0.01, "metal_dark")
    for i in range(posts):
        x = x0 + (x1 - x0) * i / (posts - 1)
        m.box(x, y, 0.03, 0.008, 0.008, z - 0.03, "metal_dark")
