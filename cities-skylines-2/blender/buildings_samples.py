from lib import Model
from registry import building


@building(1, "Casa Inicial")
def casa_inicial(m: Model):
    m.plot()
    # walls, blue gabled roof, chimney, porch and garden, as in kit page 1
    m.box(-0.02, 0.04, 0.03, 0.46, 0.34, 0.26, "wall_cream")
    m.gable(-0.02, 0.04, 0.29, 0.50, 0.38, 0.2, "roof_blue", end="wall_cream")
    m.box(0.1, 0.1, 0.4, 0.06, 0.06, 0.16, "wall_brick")
    m.box(-0.02, -0.16, 0.03, 0.2, 0.1, 0.02, "concrete", roof="concrete")  # porch step
    m.box(-0.17, -0.14, 0.03, 0.04, 0.04, 0.24, "wall_wood")                # porch post
    m.box(0.13, -0.14, 0.03, 0.04, 0.04, 0.24, "wall_wood")
    m.box(-0.02, -0.16, 0.27, 0.34, 0.12, 0.025, "roof_slate")              # porch roof
    m.windows(-0.02, 0.04, 0.03, 0.46, 0.34, 0.26, 1, cols=3, sides="fr", lit=0.7)
    m.box(-0.02, -0.132, 0.03, 0.07, 0.01, 0.15, "wall_wood")               # door
    m.tree(0.36, -0.3, 1.2)
    m.tree(-0.38, 0.3, 1.0, dark=True)
    m.tree(0.38, 0.32, 0.9)


@building(20, "Torre Corporativa")
def torre_corporativa(m: Model):
    m.plot()
    m.box(0, 0.02, 0.03, 0.74, 0.5, 0.2, "wall_white")                       # podium
    m.windows(0, 0.02, 0.03, 0.74, 0.5, 0.2, 1, cols=6, sides="fr", lit=0.5)
    m.box(0.04, 0.06, 0.23, 0.4, 0.34, 1.5, "glass_blue", roof="concrete")     # tower
    m.windows(0.04, 0.06, 0.23, 0.4, 0.34, 1.5, 9, cols=4, sides="fr", lit=0.35)
    m.box(0.04, 0.06, 1.73, 0.26, 0.22, 0.12, "wall_grey")
    m.cyl(0.04, 0.06, 1.85, 0.012, 0.22, "metal", seg=5)
    m.tree(-0.36, -0.3, 1.0)
    m.tree(0.38, -0.32, 1.0)
    m.tree(-0.38, 0.36, 0.9, dark=True)


@building(40, "Usina Termelétrica")
def usina_termeletrica(m: Model):
    m.plot(lawn=False)
    m.box(-0.12, -0.08, 0.03, 0.46, 0.3, 0.28, "wall_grey")
    m.windows(-0.12, -0.08, 0.03, 0.46, 0.3, 0.28, 2, cols=4, sides="fr", lit=0.4)
    m.box(0.2, -0.18, 0.03, 0.22, 0.2, 0.2, "wall_beige")
    for x, y, r, h in ((0.2, 0.22, 0.17, 0.75), (-0.2, 0.28, 0.15, 0.65)):
        m.cyl(x, y, 0.03, r, h, "concrete", seg=10, r_top=r * 0.72)           # cooling towers
    m.cyl(-0.38, -0.3, 0.03, 0.035, 0.95, "white", seg=7, r_top=0.028)        # chimney
    m.cyl(-0.38, -0.3, 0.86, 0.04, 0.05, "sign_red", seg=7)
    m.cyl(0.38, -0.34, 0.03, 0.09, 0.2, "metal", seg=8)
    m.tree(0.38, 0.4, 0.9)
    m.tree(-0.42, 0.42, 0.9, dark=True)
