"""Residential and commercial buildings 2--19 from the Mayor basic kit."""
from dress_det_b import bollards, curb_blocks, facade_trim, gooseneck_lamps, parking_stripes, planters, roof_dress, roof_seams, storefront_grid
from lib import Model
from registry import building
from dress_det_a import back_frame, balcony_rail_posts, cornice, front_frame, lamp, pavers, planter, side_frame


def trees(m, pts):
    for i, (x, y, s) in enumerate(pts):
        m.tree(x, y, s, dark=bool(i % 2))


def flat_block(m, cx, cy, w, d, h, wall="wall_white", floors=2, sides="fr", style="apartment", family=None):
    m.box(cx, cy, 0.03, w, d, h, wall, roof="roof_flat")
    m.windows(cx, cy, 0.03, w, d, h, floors, sides=sides, style=style, family=family)


def roof_units(m, z, pts):
    for x, y in pts:
        m.box(x, y, z, .08, .07, .055, "metal", roof="metal")


def balcony(m, x, y, z, w):
    m.box(x, y, z, w, .10, .025, "concrete", roof="concrete")
    m.box(x, y-.047, z+.025, w, .012, .07, "glass_blue")


def sign(m, x, y, z, w, mat):
    m.box(x, y, z, w, .018, .10, mat)


@building(2, "Casa Familiar")
def casa_familiar(m: Model):
    m.plot(); m.box(0, .04, .03, .55, .40, .27, "wall_cream")
    m.hip(0, .04, .30, .61, .46, .20, "roof_slate")
    m.box(.18, .09, .39, .055, .055, .16, "wall_white")
    m.box(-.05, -.20, .03, .34, .16, .025, "paving")
    m.box(-.20, -.18, .03, .025, .025, .25, "wall_wood"); m.box(.10, -.18, .03, .025, .025, .25, "wall_wood")
    m.awning(-.05, -.16, .29, .36, .16, "roof_slate")
    m.windows(0, .04, .03, .55, .40, .27, 1, sides="fr")
    m.box(-.05, -.166, .03, .075, .012, .17, "wall_wood")
    trees(m, [(-.39,-.28,1),(.38,.28,.9)])


@building(3, "Sobrado Moderno")
def sobrado_moderno(m: Model):
    m.plot(); flat_block(m, 0, .04, .50, .39, .62, floors=2)
    m.box(.18, .04, .03, .13, .39, .62, "wall_wood", roof="roof_flat")
    balcony(m, -.08, -.20, .34, .30)
    m.box(-.08, -.246, .37, .02, .012, .15, "metal")
    m.box(-.08, -.16, .03, .08, .012, .19, "wall_wood")
    roof_units(m, .65, [(0,.05)])
    trees(m, [(-.38,.31,1),(.38,-.30,.9)])


@building(4, "Vila Geminada")
def vila_geminada(m: Model):
    m.plot()
    for x in (-.19,.19):
        flat_block(m, x, .04, .34, .42, .48, floors=2, sides="f")
        m.box(x, -.18, .03, .07, .012, .17, "wall_wood")
        m.awning(x, -.18, .23, .16, .08, "roof_dark")
        roof_units(m, .51, [(x,.04)])
    m.box(0, .04, .03, .035, .42, .48, "wall_wood")
    trees(m, [(-.40,.31,.8),(.40,.31,.8)])


# --- rear detailing helpers (rear facades face +Y) ---
def back_door(m, x, y_back, z, w=0.07, h=0.12, mat="metal_dark"):
    """Service door on a rear wall."""
    m.box(x, y_back + 0.004, z, w + 0.016, 0.008, h + 0.01, "white")
    m.box(x, y_back + 0.007, z, w, 0.006, h, mat)


def rear_balcony(m, x, y_back, z, w):
    """Balcony slab hanging off a rear wall (mirror of balcony)."""
    m.box(x, y_back + 0.05, z, w, .10, .025, "concrete", roof="concrete")
    m.box(x, y_back + 0.097, z + .025, w, .012, .07, "glass_blue")


def rear_pipes(m, cx, y_back, z0, h, w):
    """Downpipes at both rear corners."""
    for sx in (-1, 1):
        m.box(cx + sx * (w / 2 - 0.03), y_back + 0.008, z0, 0.016, 0.014, h, "metal_dark")


def roof_parapet(m, cx, cy, w, d, z, h=0.03, mat="wall_white"):
    """Low parapet ring around a flat roof."""
    t = 0.016
    m.box(cx, cy - d / 2 + t / 2, z, w, t, h, mat)
    m.box(cx, cy + d / 2 - t / 2, z, w, t, h, mat)
    m.box(cx - w / 2 + t / 2, cy, z, t, d - 2 * t, h, mat)
    m.box(cx + w / 2 - t / 2, cy, z, t, d - 2 * t, h, mat)


def roof_vent(m, x, y, z):
    """Exhaust vent pipe with a cap."""
    m.cyl(x, y, z, 0.02, 0.09, "metal", seg=6)
    m.box(x, y, z + 0.09, 0.055, 0.055, 0.015, "metal_dark")


@building(5, "Pequeno Apartamento")
def pequeno_apartamento(m: Model):
    m.plot(); flat_block(m, 0, .06, .48, .40, .92, floors=4, sides="fbrl")
    m.box(.12, .06, .03, .12, .40, .92, "wall_wood")
    for z in (.20,.41,.62,.83): balcony(m, -.20, -.18, z, .18)
    for z in (.20,.41,.62,.83):
        balcony_rail_posts(m, -.20, -.227, z + .025, .18, 3)
    for z in (.13,.34,.55,.76):
        for x in (-.08,.08):
            front_frame(m, x, -.14, z, .07, .085, frame="wall_white")
    m.box(0, -.15, .03, .16, .025, .18, "glass_dark")
    m.box(0, -.175, .03, .20, .035, .025, "concrete", roof="concrete")
    m.box(-.17, .262, .03, .10, .02, .92, "glass_dark")  # rear stair-core glazing
    for z in (.41,.83): rear_balcony(m, .12, .26, z, .14)
    back_door(m, .02, .26, .03)
    rear_pipes(m, 0, .26, .03, .92, .48)
    roof_parapet(m, 0, .06, .48, .40, .95)
    cornice(m, 0, .06, .48, .40, .93, "slab")
    roof_units(m, .95, [(-.10,.06),(.13,.10)])
    roof_vent(m, .02, -.02, .95)
    trees(m, [(-.39,-.30,.9),(.38,.30,.9)])
    planter(m, .3, -.34, .1, .04)


@building(6, "Condomínio Jardim")
def condominio_jardim(m: Model):
    m.plot(); flat_block(m, 0, .06, .62, .42, .72, floors=3, sides="fbrl")
    m.box(0, -.17, .03, .20, .04, .18, "glass_dark")
    for z in (.22,.43,.64):
        balcony(m, -.25, -.18, z, .15); balcony(m, .25, -.18, z, .15)
        balcony_rail_posts(m, -.25, -.227, z + .025, .15, 3); balcony_rail_posts(m, .25, -.227, z + .025, .15, 3)
    for z in (.14,.35,.56):
        for x in (-.11,.11):
            front_frame(m, x, -.15, z, .075, .09)
    side_frame(m, -.31, .02, .34, -1, .08, .09)
    side_frame(m, .31, .1, .55, 1, .08, .09)
    for z in (.22,.64): rear_balcony(m, 0, .27, z, .16)
    back_door(m, -.2, .27, .03); back_door(m, .2, .27, .03)
    rear_pipes(m, 0, .27, .03, .72, .62)
    roof_parapet(m, 0, .06, .62, .42, .75)
    cornice(m, 0, .06, .62, .42, .73, "slab")
    roof_units(m, .75, [(-.16,.05),(.14,.08)])
    m.box(0, .38, .03, .44, .13, .005, "asphalt", roof="asphalt")  # rear parking pad
    m.parked_car(-.11, .38, "sign_blue", "x"); m.parked_car(.11, .38, "white", "x")
    trees(m, [(-.39,-.29,1),(.39,-.28,1),(-.38,.32,.8),(.38,.32,.8)])
    lamp(m, 0, -.34)


@building(7, "Torre Compacta")
def torre_compacta(m: Model):
    m.plot(); flat_block(m, 0, .08, .38, .35, 1.25, floors=6, sides="fbrl")
    m.box(.10, .08, .03, .11, .35, 1.25, "wall_wood")
    for z in (.23,.43,.63,.83,1.03,1.23): balcony(m, -.18, -.13, z, .14)
    for z in (.23,.43,.63,.83,1.03,1.23):
        balcony_rail_posts(m, -.18, -.177, z + .025, .14, 3)
    for z in (.15,.35,.55,.75,.95,1.15):
        front_frame(m, .02, -.095, z, .065, .075)
    m.box(0, -.12, .03, .48, .18, .14, "wall_white", roof="roof_flat")
    m.box(0, -.22, .03, .28, .05, .02, "concrete", roof="concrete")
    for x in (-.12, 0, .12):  # rear facade fins
        m.box(x, .258, .03, .025, .02, 1.25, "wall_wood")
    for z in (.33,.73,1.13): rear_balcony(m, .06, .255, z, .08)
    back_door(m, -.06, .255, .03)
    rear_pipes(m, 0, .255, .03, 1.25, .38)
    roof_parapet(m, 0, .08, .38, .35, 1.28)
    cornice(m, 0, .08, .38, .35, 1.26, "slab")
    m.crown(0, .08, 1.28, .38, .35, 1)  # stepped setback crown (fable crown kind 1)
    trees(m, [(-.35,-.31,.9),(.35,-.31,.9)])
    pavers(m, -.13, -.42, .13, -.22, 4)


@building(8, "Residencial Varanda")
def residencial_varanda(m: Model):
    m.plot(); flat_block(m, 0, .05, .62, .42, .78, floors=4, sides="fbrl")
    m.box(0, .05, .03, .11, .42, .78, "wall_wood")
    for z in (.22,.40,.58,.76):
        balcony(m, -.23, -.18, z, .19); balcony(m, .23, -.18, z, .19)
        balcony_rail_posts(m, -.23, -.227, z + .025, .19, 3); balcony_rail_posts(m, .23, -.227, z + .025, .19, 3)
    for z in (.13,.31,.49,.67):
        front_frame(m, 0, -.15, z, .075, .085)
    rear_balcony(m, -.23, .26, .40, .19); rear_balcony(m, .23, .26, .58, .19)
    m.box(0,.05,.81,.48,.32,.08,"wall_white",roof="grass")
    for px in (-.14,.14):  # pergola over the roof garden
        m.box(px, -.02, .89, .02, .02, .10, "wall_wood")
        m.box(px, .12, .89, .02, .02, .10, "wall_wood")
    m.box(0, .05, .99, .34, .18, .015, "wall_wood", roof="wall_wood")
    for x in (-.14, 0, .14):
        m.box(x, .05, 1.005, .018, .2, .018, "wall_wood", roof="wall_wood")
    planter(m, -.14, .03, .1, .04)
    back_door(m, .18, .26, .03)
    rear_pipes(m, 0, .26, .03, .78, .62)
    roof_parapet(m, 0, .05, .62, .42, .81)
    cornice(m, 0, .05, .62, .42, .79, "slab")
    trees(m, [(-.40,-.29,.9),(.40,.29,.9)])


@building(9, "Edifício Misto Local")
def edificio_misto_local(m: Model):
    m.plot(lawn=False)
    m.box(0,.05,.03,.72,.46,.19,"wall_grey",roof="concrete")
    m.windows(0,.05,.03,.72,.46,.19,1,sides="fbrl",style="retail")
    flat_block(m, 0,.08,.58,.37,.56,floors=3,sides="fbrl")
    for z in (.31,.49,.67):
        for x in (-.18,0,.18):
            front_frame(m, x, -.105, z, .07, .075)
    sign(m,-.23,-.195,.12,.18,"sign_blue"); sign(m,0,-.195,.12,.18,"sign_orange"); sign(m,.23,-.195,.12,.18,"sign_green")
    for x in (-.23,0,.23):
        m.box(x, -.222, .21, .18, .055, .012, "metal_dark", roof="metal_dark")
        m.box(x - .075, -.245, .03, .01, .01, .18, "metal_dark")
        m.box(x + .075, -.245, .03, .01, .01, .18, "metal_dark")
    m.box(0, -.195, .225, .72, .018, .018, "slab", roof="slab")
    m.box(-.2,.282,.06,.14,.012,.06,"sign_blue")  # rear shop sign
    back_frame(m, -.05, .265, .33, .075, .085)
    back_door(m, .12, .28, .03); back_door(m, .28, .28, .03, mat="metal")
    rear_pipes(m, 0, .265, .22, .56, .58)
    roof_parapet(m, 0, .08, .58, .37, .78)
    cornice(m, 0, .08, .58, .37, .76, "slab")
    roof_units(m,.78,[(-.14,.08),(.14,.08)])
    roof_vent(m, .0, .16, .78)
    trees(m,[(-.40,.32,.8),(.40,.32,.8)])
    lamp(m, -.36, -.32); lamp(m, .36, -.32)


@building(10, "Torre Premium")
def torre_premium(m: Model):
    m.plot(); flat_block(m,0,.07,.48,.38,1.42,floors=7)
    m.glass_band(0,.07,.03,.20,.385,1.42,"glass_blue")
    m.box(.16,.07,.03,.08,.38,1.42,"wall_wood")
    for z in (.25,.45,.65,.85,1.05,1.25,1.43): balcony(m,-.22,-.15,z,.14)
    m.windows(0,.07,.03,.48,.38,1.42,7,sides="b",slabs=False)  # rear only (hero v2 separate)
    back_door(m, -.08, .26, .03)
    rear_pipes(m, 0, .26, .03, 1.42, .48)
    m.crown(0,.07,1.45,.48,.38,3)  # cornice + lantern crown (fable crown kind 3)
    trees(m,[(-.38,-.30,.9),(.38,-.30,.9)])


@building(11, "Loja de Conveniência")
def loja_conveniencia(m: Model):
    m.plot(); m.box(0,.06,.03,.68,.43,.34,"wall_white",roof="roof_flat")
    m.windows(0,.06,.03,.68,.43,.34,1,sides="f")
    sign(m,0,-.17,.29,.70,"sign_red"); sign(m,0,-.182,.34,.70,"sign_orange")
    m.box(-.25,-.184,.10,.08,.012,.18,"wall_red")
    roof_units(m,.37,[(.06,.06)])
    trees(m,[(-.40,.30,.9),(.40,.30,.9)])


@building(12, "Café de Esquina")
def cafe_de_esquina(m: Model):
    m.plot(); m.box(0,.06,.03,.58,.45,.38,"wall_brick",roof="roof_flat")
    m.windows(0,.06,.03,.58,.45,.38,1,sides="fr")
    m.awning(-.14,-.17,.27,.25,.10,"black"); m.awning(.15,-.17,.27,.24,.10,"black")
    sign(m,0,-.181,.31,.28,"glow_sign")
    roof_units(m,.41,[(-.12,.05),(.13,.05)])
    for x in (-.25,0,.25): m.cyl(x,-.36,.03,.035,.06,"wall_wood",seg=5)
    trees(m,[(-.40,.30,.9),(.40,.30,.9)])


@building(13, "Mercado Local")
def mercado_local(m: Model):
    m.plot(); m.box(-.06,.06,.03,.62,.43,.34,"wall_white",roof="roof_flat")
    m.windows(-.06,.06,.03,.62,.43,.34,1,sides="f")
    sign(m,-.06,-.17,.28,.64,"sign_green")
    m.awning(-.06,-.18,.25,.64,.10,"sign_green")
    m.box(.34,.13,.03,.20,.20,.21,"wall_grey",roof="roof_flat")
    roof_units(m,.37,[(0,.06)])
    trees(m,[(-.40,.31,.9),(.40,.33,.8)])


@building(14, "Restaurante Urbano")
def restaurante_urbano(m: Model):
    m.plot(); m.box(0,.08,.03,.58,.42,.38,"wall_wood",roof="roof_flat")
    m.windows(0,.08,.03,.58,.42,.38,1,sides="fbrl",style="retail")
    storefront_grid(m, 0, -.14, .055, .48, .17, 4)
    facade_trim(m, 0, -.14, .255, .56, "concrete")
    back_door(m, -.18, .29, .03)
    m.box(.14,.36,.03,.22,.13,.025,"wall_wood",roof="wall_wood")  # rear terrace
    m.box(.14,.422,.055,.22,.012,.07,"wall_wood")  # terrace railing
    m.box(.035,.36,.055,.012,.13,.07,"wall_wood")
    rear_pipes(m, 0, .29, .03, .38, .58)
    roof_parapet(m, 0, .08, .58, .42, .41)
    roof_seams(m, 0, .08, .445, .48, .32, 4)
    roof_vent(m, -.12, .14, .41)
    m.awning(.13,-.14,.28,.30,.13,"sign_red"); sign(m,.12,-.151,.32,.31,"black")
    gooseneck_lamps(m, (-.02, .25), -.153, .36)
    m.box(-.20,-.22,.03,.24,.20,.025,"wall_wood")
    for x in (-.30,-.10): m.box(x,-.30,.03,.018,.018,.20,"wall_wood")
    m.awning(-.20,-.13,.30,.27,.20,"wall_wood")
    roof_units(m,.41,[(.08,.08)])
    roof_dress(m, .445, [(-.18, -.02, .075, .05)])
    planters(m, [(-.34, -.14), (.34, -.14)])
    trees(m,[(-.40,.31,.9),(.40,.31,.9)])


@building(15, "Farmácia de Bairro")
def farmacia_de_bairro(m: Model):
    m.plot(); m.box(0,.06,.03,.62,.42,.40,"wall_white",roof="roof_flat")
    m.windows(0,.06,.03,.62,.42,.40,1,sides="fbrl",style="retail")
    storefront_grid(m, 0, -.151, .055, .58, .18, 5)
    facade_trim(m, 0, -.151, .285, .62, "slab")
    back_door(m, .1, .27, .03)
    m.box(-.15,.272,.28,.12,.012,.12,"white")  # rear cross sign
    m.box(-.15,.279,.31,.04,.008,.06,"sign_red"); m.box(-.15,.279,.325,.08,.008,.025,"sign_red")
    rear_pipes(m, 0, .27, .03, .40, .62)
    roof_parapet(m, 0, .06, .62, .42, .43)
    roof_seams(m, 0, .06, .462, .52, .32, 5)
    roof_vent(m, .12, .12, .43)
    sign(m,0,-.161,.31,.64,"sign_red")
    gooseneck_lamps(m, (-.20, .20), -.174, .35)
    m.box(-.23,-.175,.42,.10,.02,.10,"white"); m.box(-.23,-.187,.445,.035,.012,.05,"sign_red"); m.box(-.23,-.187,.425,.07,.012,.018,"sign_red")
    m.box(.27,.06,.03,.10,.42,.40,"wall_red",roof="wall_red")
    roof_units(m,.43,[(0,.06)])
    bollards(m, (-.28, -.14, .0, .14, .28), -.19)
    planters(m, [(-.34, -.08), (.34, -.08)])
    trees(m,[(-.40,.30,.8),(.40,.30,.8)])


@building(16, "Escritório Compacto")
def escritorio_compacto(m: Model):
    m.plot(); flat_block(m,0,.06,.52,.39,.72,floors=3,sides="fbrl",family="glow_window_office")
    for z in (.25, .48, .71):
        facade_trim(m, 0, -.142, z, .52, "slab")
    back_door(m, .14, .255, .03)
    rear_pipes(m, 0, .255, .03, .72, .52)
    roof_parapet(m, 0, .06, .52, .39, .75)
    m.box(.14,.06,.75,.18,.15,.09,"wall_grey",roof="roof_dark")  # rooftop plant room
    m.ac_unit(-.1, .06, .75)
    roof_dress(m, .75, [(-.22, -.02, .07, .05), (.02, .16, .06, .05)])
    m.glass_band(0,.06,.03,.28,.395,.72,"glass_blue")
    storefront_grid(m, 0, -.142, .065, .25, .61, 3, "metal_dark")
    m.box(-.20,.06,.03,.08,.39,.72,"wall_beige")
    m.box(0,-.16,.03,.26,.10,.12,"wall_white",roof="roof_flat")
    m.door(0, -.212, .03, .075, .13, "glass_dark")
    gooseneck_lamps(m, (-.11, .11), -.213, .19)
    roof_units(m,.75,[(0,.06)])
    trees(m,[(-.38,-.29,.9),(.38,.30,.9)])


@building(17, "Banco Local")
def banco_local(m: Model):
    m.plot(); m.box(0,.07,.03,.66,.44,.43,"wall_white",roof="roof_flat")
    m.windows(0,.07,.03,.66,.44,.43,2,sides="fbrl",family="glow_window_office")
    for z in (.235, .445):
        facade_trim(m, 0, -.15, z, .66, "concrete")
    back_door(m, -.18, .29, .03)
    m.box(.18,.35,.03,.16,.11,.20,"wall_grey",roof="roof_dark")  # rear vault annex
    m.box(.18,.295,.08,.10,.012,.10,"metal_dark")  # vault door
    rear_pipes(m, 0, .29, .03, .43, .66)
    roof_parapet(m, 0, .07, .66, .44, .46)
    roof_vent(m, -.08, .0, .46)
    m.box(0,-.18,.03,.30,.10,.34,"wall_white",roof="concrete")
    for x in (-.12,-.04,.04,.12): m.cyl(x,-.225,.03,.018,.31,"concrete",seg=6)
    m.box(0, -.245, .03, .23, .05, .018, "concrete", roof="concrete")
    m.door(0, -.232, .03, .085, .14, "glass_dark")
    gooseneck_lamps(m, (-.16, .16), -.238, .35)
    sign(m,0,-.237,.34,.26,"glow_sign")
    roof_units(m,.46,[(-.14,.07),(.14,.07)])
    roof_dress(m, .49, [(0, -.08, .08, .05)])
    planters(m, [(-.34, -.17), (.34, -.17)])
    trees(m,[(-.40,-.29,.8),(.40,-.29,.8)])


@building(18, "Hotel Executivo")
def hotel_executivo(m: Model):
    m.plot(); flat_block(m,0,.08,.65,.43,.86,floors=4,sides="fbrl")
    for z in (.245, .46, .675, .89):
        facade_trim(m, 0, -.145, z, .65, "slab")
    back_door(m, -.2, .295, .03); back_door(m, .2, .295, .03)
    m.box(0,.345,.16,.24,.09,.02,"concrete",roof="concrete")  # rear canopy
    m.box(-.1,.38,.03,.02,.02,.13,"metal_dark"); m.box(.1,.38,.03,.02,.02,.13,"metal_dark")
    rear_pipes(m, 0, .295, .03, .86, .65)
    roof_parapet(m, 0, .08, .65, .43, .89)
    m.box(0,.08,.95,.30,.04,.10,"glow_sign",roof="glow_sign")  # rooftop sign
    m.box(-.12,.08,.89,.02,.02,.06,"metal_dark"); m.box(.12,.08,.89,.02,.02,.06,"metal_dark")
    m.box(0,-.17,.03,.42,.12,.18,"wall_white",roof="roof_flat")
    storefront_grid(m, 0, -.232, .055, .34, .13, 3)
    m.door(0, -.237, .03, .08, .13, "glass_dark")
    m.box(0,.08,.03,.12,.43,.86,"wall_wood")
    sign(m,0,-.145,.73,.18,"glow_sign")
    roof_units(m,.89,[(-.18,.07),(.18,.07)])
    roof_dress(m, .89, [(0, .18, .08, .05)])
    bollards(m, (-.26, -.13, .13, .26), -.245)
    trees(m,[(-.40,-.29,.9),(.40,-.29,.9),(-.40,.32,.8)])


@building(19, "Shopping de Bairro")
def shopping_de_bairro(m: Model):
    m.plot(lawn=False); m.box(0,.08,.03,.82,.53,.34,"wall_white",roof="roof_flat")
    m.windows(0,.08,.03,.82,.53,.34,1,sides="fbrl",style="retail")
    storefront_grid(m, 0, -.196, .055, .78, .15, 6)
    m.box(-.2,.40,.03,.30,.11,.025,"concrete",roof="concrete")  # loading apron
    m.box(-.26,.347,.03,.12,.012,.14,"metal"); m.box(-.12,.347,.03,.12,.012,.14,"metal")  # dock doors
    back_door(m, .28, .345, .03)
    rear_pipes(m, 0, .345, .03, .34, .82)
    roof_parapet(m, 0, .08, .82, .53, .37)
    roof_seams(m, 0, .08, .402, .72, .43, 6)
    roof_vent(m, .3, -.05, .37)
    sign(m,0,-.196,.27,.28,"sign_blue")
    sign(m,-.29,-.196,.23,.18,"sign_red"); sign(m,.29,-.196,.23,.18,"sign_orange")
    m.box(0,-.23,.03,.34,.12,.05,"paving",roof="paving")
    parking_stripes(m, (-.38, -.19, .19, .38), -.34, .12)
    curb_blocks(m, -.25, (-.28, 0, .28))
    bollards(m, (-.38, -.26, -.14, .14, .26, .38), -.205)
    roof_units(m,.37,[(-.24,.08),(0,.08),(.24,.08)])
    roof_dress(m, .405, [(-.34, -.08, .08, .05), (.34, .12, .08, .05)])
    trees(m,[(-.42,.34,.8),(.42,.34,.8)])
