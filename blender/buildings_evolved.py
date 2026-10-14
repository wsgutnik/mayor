"""Evolved zoned footprints: one authored building per 2x2/4x4 lot.

These are intentionally site compositions, not scaled copies of kit models.
Coordinates are Blender X/Y ground axes (front is -Y); all sites leave a
0.04-tile perimeter, use a shared entrance toward -Y, and have z=0 bases.
"""
from lib import Model
from registry import building


def _site(m: Model, span, paving="paving"):
    m.box(0, 0, 0, span - .04, span - .04, .028, paving, roof=paving)


def _plant(m: Model, x, y, top):
    m.ac_unit(x, y, top + .01, .13, .09, .06)
    m.box(x + .12, y, top + .01, .035, .035, .12, "metal_dark")


def _entry(m: Model, width=.34, y=-.84, z=.03, sign=None):
    m.steps(0, y - .08, z, width + .14, n=3)
    m.door(0, y, z, .12, .20, "glass_dark")
    if sign: m.box(0, y + .012, .27, width, .018, .04, sign)


def _block(m: Model, x, y, w, d, h, wall, style, floors, cols, roof="roof_flat", balconies=False):
    m.box(x, y, .028, w, d, h, wall, roof=roof)
    m.windows(x, y, .028, w, d, h, floors, cols=cols, sides="fbrl", lit=.52, style=style)
    # Thin plinth and parapet read at city zoom without producing a fake second building.
    m.box(x, y - d / 2 - .006, .03, w + .025, .018, .035, "concrete")
    m.box(x, y, h + .028, w + .025, d + .025, .026, "slab", roof="slab")
    if balconies:
        for z in (.38, .68):
            if z < h - .08: m.balcony(x, y - d / 2 - .005, z, w * .72, depth=.075)


def _res_x2(m: Model, n, wall, h, tower=False):
    _site(m, 2)
    # Offset upper wing breaks the old single-box silhouette; corner piers and
    # alternating balcony decks turn the bay rhythm into readable massing.
    _block(m, 0, .14, 1.54, 1.22, min(h, .72), wall, "apartment", 3, 6, balconies=True)
    if tower:
        _block(m, .16, .25, 1.08, .84, h, wall, "apartment", 4, 4, balconies=True)
        m.box(-.46, .42, .75, .18, .20, h - .69, "wall_beige", roof="roof_flat")
    m.awning(0, -.48, .24, .50, mat="sign_green" if n % 2 else "sign_orange")
    _entry(m, .42, -.78)
    _plant(m, .38, .34, h + .055)
    m.tree(-.72, .72, .62); m.tree(.72, .72, .62, dark=True)


def _retail_x2(m: Model, n, wall, h, office=False):
    _site(m, 2)
    _block(m, 0, .08, 1.62, 1.25, h, wall, "curtain" if office else "retail", 4 if office else 2, 8)
    m.box(0, -.56, .04, 1.48, .10, .18, "glass_blue")
    for x in (-.52, 0, .52): m.awning(x, -.55, .25, .38, mat="sign_orange" if x == 0 else "sign_green")
    if office:
        _block(m, .18, .22, .92, .78, h + .18, wall, "curtain", 5, 5)
    _entry(m, .46, -.80, sign="glow_sign")
    _plant(m, -.38, .34, h + .055)
    m.tree(.76, .68, .58)


def _industrial_x2(m: Model, n, h, heavy=False):
    _site(m, 2, "asphalt")
    _block(m, -.12, .20, 1.48, 1.20, h, "wall_grey", "industrial", 2, 5, roof="roof_dark")
    m.box(-.12, -.42, .04, .58, .04, .28, "metal_dark")
    m.door(-.12, -.42, .03, .36, .22, "metal")
    _plant(m, .34, .36, h + .055)
    if heavy:
        m.cyl(.68, .45, .03, .12, h + .28, "metal", seg=10)
        m.cyl(.68, .45, h + .28, .14, .05, "metal_dark", seg=10)
    else:
        m.box(.70, -.45, .03, .32, .48, .10, "concrete", roof="concrete")


for _n, _wall, _h, _tower in [(1,"wall_cream",.54,False),(2,"wall_beige",.62,False),(3,"wall_brick",.72,False),
                               (4,"wall_white",.76,False),(5,"wall_grey",.98,True),(6,"wall_cream",.86,False),
                               (7,"wall_blue",1.10,True),(8,"wall_beige",.92,False),(9,"wall_brick",1.02,True),(10,"wall_white",1.26,True)]:
    @building(_n, "Evolved residential", variant="x2", version=1, footprint=(2, 2))
    def _res(m: Model, n=_n, wall=_wall, h=_h, tower=_tower): _res_x2(m, n, wall, h, tower)

for _n, _wall, _h, _office in [(11,"wall_cream",.48,False),(12,"wall_brick",.50,False),(13,"wall_beige",.58,False),
                                (14,"wall_red",.60,False),(15,"wall_white",.52,False),(16,"wall_grey",.72,True),
                                (17,"wall_navy",.76,True),(18,"wall_beige",1.02,True),(19,"wall_cream",.82,False),(20,"wall_grey",1.22,True)]:
    @building(_n, "Evolved commercial", variant="x2", version=1, footprint=(2, 2))
    def _com(m: Model, n=_n, wall=_wall, h=_h, office=_office): _retail_x2(m, n, wall, h, office)

for _n, _h, _heavy in [(36,.54,False),(37,.72,False),(38,.96,True),(39,.66,False),(40,1.02,True)]:
    @building(_n, "Evolved industrial", variant="x2", version=1, footprint=(2, 2))
    def _ind(m: Model, n=_n, h=_h, heavy=_heavy): _industrial_x2(m, n, h, heavy)


def _tower_x4(m: Model, n, wall, height, office=False):
    _site(m, 4)
    # Podium is broad but inset; tower setback makes the silhouette legible.
    _block(m, 0, .24, 3.38, 2.82, .42, "wall_cream", "retail", 1, 12)
    _block(m, 0, .35, 1.72, 1.54, height * .72, wall, "curtain" if office else "apartment", 5, 6, balconies=not office)
    _block(m, .18, .45, 1.25, 1.12, height, wall, "curtain" if office else "apartment", 6, 5, balconies=not office)
    m.box(-.62, .55, height * .72 + .03, .30, .34, height * .28, "wall_beige", roof="roof_flat")
    m.box(0, .35, height + .04, .74, .62, .018, "grass", roof="grass")
    _entry(m, .60, -1.46, sign="glow_sign" if office else None)
    _plant(m, -.42, .35, height + .055); _plant(m, .34, .35, height + .055)
    for x, y in [(-1.55,-1.30),(1.55,-1.30),(-1.56,1.35),(1.56,1.35)]: m.tree(x, y, .72, dark=x > 0)


def _campus_x4(m: Model, n, heavy=False):
    _site(m, 4, "asphalt")
    _block(m, -.75, .38, 1.55, 1.78, .78 if heavy else .62, "wall_grey", "industrial", 2, 5, roof="roof_dark")
    _block(m, .83, .45, 1.10, 1.36, .64, "wall_beige", "industrial", 2, 4)
    m.box(.05, -1.12, .03, 2.85, .80, .055, "concrete", roof="concrete")
    for x in (-.9,-.35,.25,.85): m.parked_car(x, -1.14, "wall_white", along="x")
    _entry(m, .42, -1.48)
    if heavy:
        for x, y, h in [(-1.42,.98,1.35),(-1.05,1.15,1.10)]: m.cyl(x, y, .03, .13, h, "metal", seg=10)
    else:
        m.box(-.05, 1.28, .03, 1.36, .72, .13, "concrete", roof="concrete")
        for x in (-.5,-.05,.4): _plant(m, x, 1.28, .16)


@building(5, "Apartment campus", variant="x4", version=1, footprint=(4, 4))
def apartment_campus_x4(m: Model): _tower_x4(m, 5, "wall_grey", 1.55)
@building(10, "Premium residential tower", variant="x4", version=1, footprint=(4, 4))
def premium_tower_x4(m: Model): _tower_x4(m, 10, "wall_white", 2.05)
@building(18, "Executive hotel", variant="x4", version=1, footprint=(4, 4))
def hotel_x4(m: Model): _tower_x4(m, 18, "wall_beige", 1.78, office=True)
@building(20, "Corporate tower", variant="x4", version=1, footprint=(4, 4))
def corporate_x4(m: Model): _tower_x4(m, 20, "wall_grey", 2.25, office=True)
@building(37, "Light factory campus", variant="x4", version=1, footprint=(4, 4))
def light_factory_x4(m: Model): _campus_x4(m, 37)
@building(38, "Heavy factory campus", variant="x4", version=1, footprint=(4, 4))
def heavy_factory_x4(m: Model): _campus_x4(m, 38, heavy=True)
