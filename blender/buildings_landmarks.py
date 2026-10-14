"""Named civic landmarks: compact hero silhouettes, front at -Y and base at z=0.

They deliberately use low sided cylinders and repeated facade strips: at game zoom
the roofline reads first, while glow panes, lanterns and entry detail survive night.
"""
from lib import Model
from registry import landmark


def _site(m, span, plaza=True):
    m.box(0, 0, 0, span - .04, span - .04, .028, "paving", roof="paving")
    if plaza:
        m.box(0, -span * .34, .03, span * .58, .22, .009, "concrete", roof="concrete")


def _lit_box(m, x, y, w, d, h, wall="wall_cream", style="apartment", floors=3):
    m.box(x, y, .028, w, d, h, wall, roof="roof_flat")
    m.windows(x, y, .028, w, d, h, floors, sides="fbrl", style=style)
    m.box(x, y, h + .028, w + .035, d + .035, .025, "slab", roof="slab")


def _lanterns(m, span):
    for x in (-span * .28, span * .28):
        m.cyl(x, -span * .35, .03, .012, .19, "lamp_pole", seg=5)
        m.cyl(x, -span * .35, .22, .028, .035, "glow_lamp", seg=6)


@landmark("landmark_opera", "Opera house", (2, 2))
def opera(m: Model):
    _site(m, 2); _lanterns(m, 2)
    _lit_box(m, 0, .22, 1.54, .86, .42, "wall_cream", "retail", 2)
    m.box(0, -.23, .06, 1.26, .035, .25, "glass_blue")
    m.steps(0, -.70, .03, 1.18, n=4)
    # Three asymmetrically stepped shells make the silhouette read as sails.
    for x, y, w, h in [(-.46, .27, .52, .62), (0, .34, .62, .82), (.47, .26, .48, .55)]:
        m.pyramid(x, y, .45, w, .54, h, "sail")
    m.box(0, -.66, .28, .40, .03, .045, "glow_sign")


@landmark("landmark_cathedral", "Cathedral", (2, 2))
def cathedral(m: Model):
    _site(m, 2); _lanterns(m, 2)
    _lit_box(m, 0, .17, .92, 1.35, .78, "wall_cream", "apartment", 3)
    m.gable(0, .17, .81, .98, 1.41, .34, "roof_green", end="wall_cream", ridge="y")
    for x in (-.58, .58):
        _lit_box(m, x, -.30, .30, .34, 1.20, "wall_beige", "apartment", 4)
        m.cone(x, -.30, 1.25, .20, .54, "roof_green", seg=6)
    for x in (-.48, .48): m.box(x, .30, .03, .08, 1.20, .50, "wall_beige") # buttresses
    m.cyl(0, -.515, .48, .16, .025, "glow_window_res", seg=10)
    m.steps(0, -.82, .03, .68, n=4)


@landmark("landmark_artdeco", "Art Deco tower", (2, 2))
def artdeco(m: Model):
    _site(m, 2); _lanterns(m, 2)
    _lit_box(m, 0, .12, 1.34, 1.26, .36, "wall_beige", "retail", 1)
    _lit_box(m, 0, .18, .78, .76, 1.22, "wall_grey", "curtain", 7)
    _lit_box(m, 0, .18, .54, .56, 1.52, "wall_beige", "curtain", 4)
    m.box(0, .18, 1.56, .62, .64, .035, "glow_sign")
    m.cone(0, .18, 1.59, .09, .38, "metal", seg=6)
    m.steps(0, -.76, .03, .54, n=3)


@landmark("landmark_hotel", "Grand hotel", (4, 4))
def hotel(m: Model):
    _site(m, 4); _lanterns(m, 4)
    _lit_box(m, 0, .42, 3.20, 2.45, .66, "wall_cream", "retail", 2)
    _lit_box(m, 0, .48, 1.65, 1.38, 1.46, "wall_beige", "apartment", 6)
    m.hip(0, .48, 1.52, 1.82, 1.55, .32, "roof_slate")
    for x in (-1.18, 1.18):
        _lit_box(m, x, .42, .62, 1.52, .93, "wall_cream", "apartment", 4)
        m.hip(x, .42, .99, .72, 1.62, .20, "roof_slate")
    # Porte-cochere and arrival fountain make the broad site intentional.
    m.box(0, -1.02, .03, 1.20, .52, .24, "wall_cream", roof="roof_flat")
    for x in (-.48, .48): m.cyl(x, -1.20, .03, .035, .31, "wall_beige", seg=6)
    m.cyl(0, -1.58, .03, .22, .055, "concrete", seg=10); m.cyl(0, -1.58, .085, .10, .06, "water", seg=8)
    for x in (-1.55, 1.55): m.tree(x, -1.42, .9)


@landmark("landmark_conservatory", "Palm conservatory", (2, 2))
def conservatory(m: Model):
    _site(m, 2); _lanterns(m, 2)
    m.box(0, .10, .03, 1.46, 1.38, .20, "wall_cream", roof="paving")
    m.cyl(0, .13, .22, .62, .48, "glass_blue", seg=12, r_top=.42)
    m.cyl(0, .13, .70, .42, .26, "glass_blue", seg=12, r_top=.05)
    for a in range(0, 12, 2):
        import math
        x, y = .63 * math.cos(a * math.pi / 6), .13 + .63 * math.sin(a * math.pi / 6)
        m.cyl(x, y, .20, .012, .52, "metal", seg=4)
    for x in (-.32, 0, .32): m.tree(x, .12, .72, dark=x == 0)
    m.door(0, -.58, .03, .18, .28, "glow_window_shop", canopy=True)


@landmark("landmark_clocktower", "Clock tower", (2, 2))
def clocktower(m: Model):
    _site(m, 2); _lanterns(m, 2)
    _lit_box(m, 0, .20, 1.45, .82, .40, "wall_cream", "retail", 1)
    for x in (-.48, -.16, .16, .48): m.cyl(x, -.17, .03, .025, .35, "wall_beige", seg=6)
    _lit_box(m, 0, .27, .52, .52, 1.40, "wall_beige", "apartment", 5)
    for y in (-.005, .545): m.cyl(0, y, 1.02, .14, .018, "glow_lamp", seg=10)
    m.hip(0, .27, 1.46, .68, .68, .30, "roof_green"); m.cone(0, .27, 1.76, .055, .34, "metal", seg=6)
    m.steps(0, -.56, .03, .54, n=3)


@landmark("landmark_observatory", "Observatory", (2, 2))
def observatory(m: Model):
    _site(m, 2); _lanterns(m, 2)
    _lit_box(m, 0, .16, 1.46, 1.20, .34, "wall_cream", "retail", 1)
    for x in (-.52, -.26, .26, .52): m.cyl(x, -.25, .03, .028, .31, "wall_beige", seg=6)
    m.cyl(0, .22, .37, .55, .34, "wall_beige", seg=12, r_top=.48)
    m.cyl(0, .22, .71, .48, .32, "roof_green", seg=12, r_top=.10)
    m.box(0, -.29, .83, .11, .035, .16, "glass_dark") # telescope shutter / slit
    m.steps(0, -.68, .03, .66, n=4)


@landmark("landmark_palace", "Palace", (4, 4))
def palace(m: Model):
    _site(m, 4); _lanterns(m, 4)
    _lit_box(m, 0, .72, 1.44, 1.15, .80, "wall_cream", "apartment", 3)
    m.hip(0, .72, .86, 1.62, 1.34, .25, "roof_green")
    for x in (-1.25, 1.25):
        _lit_box(m, x, .55, 1.05, 1.48, .56, "wall_beige", "apartment", 2)
        m.hip(x, .55, .62, 1.18, 1.60, .20, "roof_green")
    # Open formal court, hedged garden, fountain and front gate.
    m.box(0, -.66, .03, 1.65, 1.18, .012, "grass", roof="grass")
    m.cyl(0, -.66, .04, .20, .05, "concrete", seg=10); m.cyl(0, -.66, .09, .09, .05, "water", seg=8)
    for x in (-.62, .62): m.tree(x, -.66, .72)
    for x in (-.55, 0, .55): m.cyl(x, -1.47, .03, .025, .34, "metal", seg=5)
    m.box(0, -1.47, .23, 1.35, .028, .06, "glow_sign")
