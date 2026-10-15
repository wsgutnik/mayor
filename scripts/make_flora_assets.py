"""Prepare owner-supplied flora imagery for Mayor's runtime budget.

The white studio backgrounds are converted to straight alpha (not premultiplied),
then lightly eroded to remove white fringe. Ground maps use mirror-safe edges:
the outer 8 px are cross-faded to their opposite edge, making repeat seams
deterministic and measurable by the accompanying test.
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).parents[1]
SRC = Path('/tmp/mayor-agents/flora-src')
OUT = ROOT / 'public/textures/flora'
PRE = ROOT / 'docs/img/flora'
OUT.mkdir(parents=True, exist_ok=True); PRE.mkdir(parents=True, exist_ok=True)
BLENDER = ROOT / 'blender/textures/flora'
BLENDER.mkdir(parents=True, exist_ok=True)

def png(name): return SRC / name

TREES = [
 ('maple', 'ChatGPT Image Oct 14, 2026, 10_41_17 PM-1.png'),
 ('maple_dense', 'ChatGPT Image Oct 14, 2026, 10_41_19 PM-2.png'),
 ('birch', 'ChatGPT Image Oct 14, 2026, 10_41_19 PM-3.png'),
 ('autumn_maple', 'ChatGPT Image Oct 14, 2026, 10_41_20 PM-4.png'),
]
CLOUDS = [
 ('cloud_1', 'ChatGPT Image Oct 14, 2026, 10_44_04 PM-1.png'),
 ('cloud_2', 'ChatGPT Image Oct 14, 2026, 10_44_06 PM-2.png'),
 ('cloud_3', 'ChatGPT Image Oct 14, 2026, 10_44_07 PM-3.png'),
 ('cloud_4', 'ChatGPT Image Oct 14, 2026, 10_44_09 PM-4.png'),
]
GROUND = [
 ('grass_fur', 'Naymul_Islam_100_real_texture_green_color_--ar_916_--raw_--st_3fcdc42d-91f3-4fc2-b794-8720e6ab31b3_0.png'),
 ('hedge', 'chanicefernandez_straight_on_4k_photograph_of_green_shrubbery_465e6ff6-d72e-4950-8ff6-d76097e0e63f_0.png'),
 ('limestone', 'coda_ai_studio_Wet_dark_beige_limestone_texture_surface_with__41177239-640a-433c-b62a-0fedd7e4b71e_0.png'),
 ('soil_grey', 'apherino_aerial_photograph_taken_from_ten_metres_directly_abo_19ad500f-cf85-4603-8384-ed9938f7b277_0.png'),
 ('earth_red', 'u5193613644_seamless_tileable_game_texture_of_a_packed_earth__bedbcfac-73c1-4b4c-966f-fc77c94b59a8_0.png'),
]

def alpha_cut(src, size, soft=False):
    im = Image.open(src).convert('RGBA')
    im.thumbnail((size, size), Image.Resampling.LANCZOS)
    bg = Image.new('RGB', im.size, 'white')
    rgb = im.convert('RGB')
    # Distance from white, with a low threshold that preserves pale foliage/cloud cores.
    d = ImageChops.difference(rgb, bg).convert('L').point(lambda x: max(0, min(255, (x - (5 if soft else 16)) * (3 if soft else 5))))
    if not soft: d = d.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.45))
    out = Image.new('RGBA', im.size)
    # Decontaminate toward local colour before writing straight alpha.
    out.paste(rgb, mask=d); out.putalpha(d)
    canvas = Image.new('RGBA', (size, size))
    canvas.alpha_composite(out, ((size - out.width)//2, (size - out.height)//2))
    return canvas

def seamless(im, size):
    im = im.convert('RGB'); im = im.resize((size, size), Image.Resampling.LANCZOS)
    px = im.load(); n = max(4, size//64)
    for y in range(size):
        for i in range(n):
            t = (i + 1) / (n + 1)
            a, b = px[i, y], px[size-1-i, y]
            v = tuple(round(a[k]*(1-t)+b[k]*t) for k in range(3))
            px[i, y] = px[size-1-i, y] = v
    for x in range(size):
        for i in range(n):
            t = (i + 1) / (n + 1)
            a, b = px[x, i], px[x, size-1-i]
            v = tuple(round(a[k]*(1-t)+b[k]*t) for k in range(3))
            px[x, i] = px[x, size-1-i] = v
    return im

for name, file in TREES:
    im = alpha_cut(png(file), 512)
    im.save(OUT / f'{name}.png', optimize=True)
    im.save(BLENDER / f'{name}.png', optimize=True)
for name, file in CLOUDS:
    alpha_cut(png(file), 512, soft=True).save(OUT / f'{name}.png', optimize=True)
for name, file in GROUND:
    for size, suffix in ((512, 'md'), (1024, 'hd')):
        im = seamless(Image.open(png(file)), size)
        # Terrain is sampled as small world-space detail; palette quantisation
        # keeps each HD PNG under the project's 1.5 MB iPad budget.
        im = im.quantize(colors=192, method=Image.Quantize.MEDIANCUT)
        im.save(OUT / f'{name}_{suffix}.png', optimize=True)
    base = seamless(Image.open(png(file)), 192)
    sheet = Image.new('RGB', (576, 576))
    for y in range(3):
        for x in range(3): sheet.paste(base, (x*192, y*192))
    sheet.save(PRE / f'{name}_3x3.png', optimize=True)
