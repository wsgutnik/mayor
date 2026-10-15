# Flora photo-asset recipe

Owner-supplied tree studio shots are converted to straight-alpha 512 px PNGs. White pixels are thresholded, then the matte is eroded one pixel and blurred 0.45 px to remove bright fringes. Tree props remain centred, base at Z=0, inside a 1.5-tile prop envelope, and use a six-sided trunk plus 20-triangle deterministic foliage volumes. Every foliage material is alpha-tested at 0.5 with depth writes enabled: it must never use transparent sorting.

Ground maps are 512 px `md` and 1024 px `hd`. Their outer 1/64 is symmetrically blended to the opposite edge. The invariant is max RGB difference of opposing edges <= 2/255; preview sheets are 3x3 repeats. This is intentionally a conservative seam recipe, not a replacement for existing terrain layers.

Cloud source cut-outs use a softer matte and remain optional sprites; existing instanced low-poly clouds remain the runtime fallback until a sprite atlas is wired for each quality profile.


## Pack trees (lead pass)

The four `trees_blender_pack` procedural trees (30k-51k triangles each) ship as 194-234 triangle low-poly reductions built by `blender/make_pack_trees.py` (foliage cards clustered into 8-10 icosahedron clumps coloured from the source vertex colours, 5-sided tapered trunk, three limbs). They are exported under the species names `tree_maple` (broad green), `tree_maple_dense` (deep green), `tree_birch` (light airy) and `tree_autumn_maple` (amber). Previews: `docs/img/flora/tree_pack_*.png`. Clouds are NOT photo cards (the supplied cloud photos were mislabelled in the first pass and showed trees on black): `src/render/ambience.ts` builds volumetric cumulus banks from ~44 soft noise-alpha point-sprite puffs per cloud, lit white on top and blue-grey underneath, in three drift layers; the old low-poly blobs remain only for headless runs.

## Ground maps in the terrain (lead pass, item 1 of the 2026-10-15 request)

The five seamless ground pairs are wired into the M20 splat material (`src/render/terrain-splat.ts`) as per-biome
detail layer sets, without adding samplers: the shader binds exactly five (grass, sand, rock, dirt, accent) for every
biome, and `terrainLayerSet(biome, seed)` decides which texture fills each slot. The seed is the world generation
seed (`World.seed`, derived: a load regenerates the world from the save's seed), so a city picks the same variant and
the same accent noise offset on every load.

| Biome | Dirt slot | Accent slot (mode) | Other |
|---|---|---|---|
| plains | grey soil | grass fur (patch) or hedge (patch), by seed | |
| forest | M20 dirt or grey soil, by seed | hedge undergrowth (patch) | |
| river | grey soil | limestone (shore band) | |
| coast | M20 dirt | limestone (shore band, beach transition) | |
| mountain | red earth | hedge scrub or grass fur (patch), by seed | |
| desert | red earth (more hue) | limestone flats (patch) | rock slot: red earth (triplanar red cliffs) |

Grass and sand keep the grey M20 maps everywhere, so a city's base look does not change. Blend rules, all mirrored
on the CPU (`splatWeightsEx`, `accentBand`, `floraFade`, `slotColor`) and pinned by `terrain-splat.test.ts`:

- The accent only takes a share of the grass weight (never sand, rock or dirt); with no accent the five-slot blend
  is exactly the old four-slot one. Patch accents follow their own noise field (frequency 1.7/6 per tile, seed
  offset); shore accents live in a band 0.1 to 0.8 above the sand line.
- Flora photos are colour-graded per slot: `hue` mixes from the M20 grain (biome colour x texel / average) to the
  texture's own hue at the biome colour's luminance; `contrast` squeezes texels toward the texture mean. Averaged
  over a texture the luminance equals the biome colour's, so a layer border never steps in brightness.
- Flora slots blend a second sample of the same sampler, rotated and rescaled, to break the visible repeat.
- Accent weight and the dirt hue fade out over the last 0.35 below the rock line, where the vertex colours switch to
  rock and snow (a tinted sample there painted grey rock red).

Quality tiers: low keeps flat vertex colours (no textures loaded); medium (iPad) loads the 512 px `_md` maps, high the
1024 px `_hd` maps; textures are cached per tier and file and shared across layer sets; uniforms are updated in place
once per load (no per-frame allocation). GPU cost: five samplers, nine texture fetches per terrain fragment at most
(was six). Screenshots, day and night, game zoom and close up, before (M20 grey set) and after:
`docs/img/terrain/{plains,coast,mountain}_*.jpg`.
