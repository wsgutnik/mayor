"""Residential and commercial buildings 2--19 from the Mayor basic kit."""
from lib import Model
from registry import building


def trees(m, pts):
    for i, (x, y, s) in enumerate(pts):
        m.tree(x, y, s, dark=bool(i % 2))


def flat_block(m, cx, cy, w, d, h, wall="wall_white", floors=2, cols=3, sides="fr"):
    m.box(cx, cy, 0.03, w, d, h, wall, roof="roof_flat")
    m.windows(cx, cy, 0.03, w, d, h, floors, cols=cols, sides=sides, lit=.5)


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
    m.windows(0, .04, .03, .55, .40, .27, 1, cols=3, sides="fr", lit=.7)
    m.box(-.05, -.166, .03, .075, .012, .17, "wall_wood")
    trees(m, [(-.39,-.28,1),(.38,.28,.9)])


@building(3, "Sobrado Moderno")
def sobrado_moderno(m: Model):
    m.plot(); flat_block(m, 0, .04, .50, .39, .62, floors=2, cols=3)
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
        flat_block(m, x, .04, .34, .42, .48, floors=2, cols=2, sides="f")
        m.box(x, -.18, .03, .07, .012, .17, "wall_wood")
        m.awning(x, -.18, .23, .16, .08, "roof_dark")
        roof_units(m, .51, [(x,.04)])
    m.box(0, .04, .03, .035, .42, .48, "wall_wood")
    trees(m, [(-.40,.31,.8),(.40,.31,.8)])


@building(5, "Pequeno Apartamento")
def pequeno_apartamento(m: Model):
    m.plot(); flat_block(m, 0, .06, .48, .40, .92, floors=4, cols=3)
    m.box(.12, .06, .03, .12, .40, .92, "wall_wood")
    for z in (.20,.41,.62,.83): balcony(m, -.20, -.18, z, .18)
    m.box(0, -.15, .03, .16, .025, .18, "glass_dark")
    roof_units(m, .95, [(-.10,.06),(.13,.10)])
    trees(m, [(-.39,-.30,.9),(.38,.30,.9)])


@building(6, "Condomínio Jardim")
def condominio_jardim(m: Model):
    m.plot(); flat_block(m, 0, .06, .62, .42, .72, floors=3, cols=4)
    m.box(0, -.17, .03, .20, .04, .18, "glass_dark")
    for z in (.22,.43,.64):
        balcony(m, -.25, -.18, z, .15); balcony(m, .25, -.18, z, .15)
    roof_units(m, .75, [(-.16,.05),(.14,.08)])
    trees(m, [(-.39,-.29,1),(.39,-.28,1),(-.38,.32,.8),(.38,.32,.8)])


@building(7, "Torre Compacta")
def torre_compacta(m: Model):
    m.plot(); flat_block(m, 0, .08, .38, .35, 1.25, floors=6, cols=3)
    m.box(.10, .08, .03, .11, .35, 1.25, "wall_wood")
    for z in (.23,.43,.63,.83,1.03,1.23): balcony(m, -.18, -.13, z, .14)
    m.box(0, -.12, .03, .48, .18, .14, "wall_white", roof="roof_flat")
    roof_units(m, 1.28, [(0,.08)])
    trees(m, [(-.35,-.31,.9),(.35,-.31,.9)])


@building(8, "Residencial Varanda")
def residencial_varanda(m: Model):
    m.plot(); flat_block(m, 0, .05, .62, .42, .78, floors=4, cols=4)
    m.box(0, .05, .03, .11, .42, .78, "wall_wood")
    for z in (.22,.40,.58,.76):
        balcony(m, -.23, -.18, z, .19); balcony(m, .23, -.18, z, .19)
    m.box(0,.05,.81,.48,.32,.08,"wall_white",roof="grass")
    trees(m, [(-.40,-.29,.9),(.40,.29,.9)])


@building(9, "Edifício Misto Local")
def edificio_misto_local(m: Model):
    m.plot(lawn=False)
    m.box(0,.05,.03,.72,.46,.19,"wall_grey",roof="concrete")
    m.windows(0,.05,.03,.72,.46,.19,1,cols=6,sides="f",lit=.8)
    flat_block(m, 0,.08,.58,.37,.56,floors=3,cols=4)
    sign(m,-.23,-.195,.12,.18,"sign_blue"); sign(m,0,-.195,.12,.18,"sign_orange"); sign(m,.23,-.195,.12,.18,"sign_green")
    roof_units(m,.78,[(-.14,.08),(.14,.08)])
    trees(m,[(-.40,.32,.8),(.40,.32,.8)])


@building(10, "Torre Premium")
def torre_premium(m: Model):
    m.plot(); flat_block(m,0,.07,.48,.38,1.42,floors=7,cols=4)
    m.glass_band(0,.07,.03,.20,.385,1.42,"glass_blue")
    m.box(.16,.07,.03,.08,.38,1.42,"wall_wood")
    for z in (.25,.45,.65,.85,1.05,1.25,1.43): balcony(m,-.22,-.15,z,.14)
    m.box(0,.07,1.45,.34,.28,.06,"grass",roof="grass")
    trees(m,[(-.38,-.30,.9),(.38,-.30,.9)])


@building(11, "Loja de Conveniência")
def loja_conveniencia(m: Model):
    m.plot(); m.box(0,.06,.03,.68,.43,.34,"wall_white",roof="roof_flat")
    m.windows(0,.06,.03,.68,.43,.34,1,cols=6,sides="f",lit=.8)
    sign(m,0,-.17,.29,.70,"sign_red"); sign(m,0,-.182,.34,.70,"sign_orange")
    m.box(-.25,-.184,.10,.08,.012,.18,"wall_red")
    roof_units(m,.37,[(.06,.06)])
    trees(m,[(-.40,.30,.9),(.40,.30,.9)])


@building(12, "Café de Esquina")
def cafe_de_esquina(m: Model):
    m.plot(); m.box(0,.06,.03,.58,.45,.38,"wall_brick",roof="roof_flat")
    m.windows(0,.06,.03,.58,.45,.38,1,cols=4,sides="fr",lit=.9)
    m.awning(-.14,-.17,.27,.25,.10,"black"); m.awning(.15,-.17,.27,.24,.10,"black")
    sign(m,0,-.181,.31,.28,"glow_sign")
    roof_units(m,.41,[(-.12,.05),(.13,.05)])
    for x in (-.25,0,.25): m.cyl(x,-.36,.03,.035,.06,"wall_wood",seg=5)
    trees(m,[(-.40,.30,.9),(.40,.30,.9)])


@building(13, "Mercado Local")
def mercado_local(m: Model):
    m.plot(); m.box(-.06,.06,.03,.62,.43,.34,"wall_white",roof="roof_flat")
    m.windows(-.06,.06,.03,.62,.43,.34,1,cols=5,sides="f",lit=.8)
    sign(m,-.06,-.17,.28,.64,"sign_green")
    m.awning(-.06,-.18,.25,.64,.10,"sign_green")
    m.box(.34,.13,.03,.20,.20,.21,"wall_grey",roof="roof_flat")
    roof_units(m,.37,[(0,.06)])
    trees(m,[(-.40,.31,.9),(.40,.33,.8)])


@building(14, "Restaurante Urbano")
def restaurante_urbano(m: Model):
    m.plot(); m.box(0,.08,.03,.58,.42,.38,"wall_wood",roof="roof_flat")
    m.windows(0,.08,.03,.58,.42,.38,1,cols=4,sides="fr",lit=.9)
    m.awning(.13,-.14,.28,.30,.13,"sign_red"); sign(m,.12,-.151,.32,.31,"black")
    m.box(-.20,-.22,.03,.24,.20,.025,"wall_wood")
    for x in (-.30,-.10): m.box(x,-.30,.03,.018,.018,.20,"wall_wood")
    m.awning(-.20,-.13,.30,.27,.20,"wall_wood")
    roof_units(m,.41,[(.08,.08)])
    trees(m,[(-.40,.31,.9),(.40,.31,.9)])


@building(15, "Farmácia de Bairro")
def farmacia_de_bairro(m: Model):
    m.plot(); m.box(0,.06,.03,.62,.42,.40,"wall_white",roof="roof_flat")
    m.windows(0,.06,.03,.62,.42,.40,1,cols=5,sides="f",lit=.8)
    sign(m,0,-.161,.31,.64,"sign_red")
    m.box(-.23,-.175,.42,.10,.02,.10,"white"); m.box(-.23,-.187,.445,.035,.012,.05,"sign_red"); m.box(-.23,-.187,.425,.07,.012,.018,"sign_red")
    m.box(.27,.06,.03,.10,.42,.40,"wall_red",roof="wall_red")
    roof_units(m,.43,[(0,.06)])
    trees(m,[(-.40,.30,.8),(.40,.30,.8)])


@building(16, "Escritório Compacto")
def escritorio_compacto(m: Model):
    m.plot(); flat_block(m,0,.06,.52,.39,.72,floors=3,cols=4)
    m.glass_band(0,.06,.03,.28,.395,.72,"glass_blue")
    m.box(-.20,.06,.03,.08,.39,.72,"wall_beige")
    m.box(0,-.16,.03,.26,.10,.12,"wall_white",roof="roof_flat")
    roof_units(m,.75,[(0,.06)])
    trees(m,[(-.38,-.29,.9),(.38,.30,.9)])


@building(17, "Banco Local")
def banco_local(m: Model):
    m.plot(); m.box(0,.07,.03,.66,.44,.43,"wall_white",roof="roof_flat")
    m.windows(0,.07,.03,.66,.44,.43,2,cols=4,sides="fr",lit=.5)
    m.box(0,-.18,.03,.30,.10,.34,"wall_white",roof="concrete")
    for x in (-.12,-.04,.04,.12): m.cyl(x,-.225,.03,.018,.31,"concrete",seg=6)
    sign(m,0,-.237,.34,.26,"glow_sign")
    roof_units(m,.46,[(-.14,.07),(.14,.07)])
    trees(m,[(-.40,-.29,.8),(.40,-.29,.8)])


@building(18, "Hotel Executivo")
def hotel_executivo(m: Model):
    m.plot(); flat_block(m,0,.08,.65,.43,.86,floors=4,cols=5)
    m.box(0,-.17,.03,.42,.12,.18,"wall_white",roof="roof_flat")
    m.box(0,.08,.03,.12,.43,.86,"wall_wood")
    sign(m,0,-.145,.73,.18,"glow_sign")
    roof_units(m,.89,[(-.18,.07),(.18,.07)])
    trees(m,[(-.40,-.29,.9),(.40,-.29,.9),(-.40,.32,.8)])


@building(19, "Shopping de Bairro")
def shopping_de_bairro(m: Model):
    m.plot(lawn=False); m.box(0,.08,.03,.82,.53,.34,"wall_white",roof="roof_flat")
    m.windows(0,.08,.03,.82,.53,.34,1,cols=7,sides="fr",lit=.8)
    sign(m,0,-.196,.27,.28,"sign_blue")
    sign(m,-.29,-.196,.23,.18,"sign_red"); sign(m,.29,-.196,.23,.18,"sign_orange")
    m.box(0,-.23,.03,.34,.12,.05,"paving",roof="paving")
    roof_units(m,.37,[(-.24,.08),(0,.08),(.24,.08)])
    trees(m,[(-.42,.34,.8),(.42,.34,.8)])
