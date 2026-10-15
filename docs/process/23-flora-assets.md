# Flora photo-asset recipe

Owner-supplied tree studio shots are converted to straight-alpha 512 px PNGs. White pixels are thresholded, then the matte is eroded one pixel and blurred 0.45 px to remove bright fringes. Tree props remain centred, base at Z=0, inside a 1.5-tile prop envelope, and use a six-sided trunk plus 20-triangle deterministic foliage volumes. Every foliage material is alpha-tested at 0.5 with depth writes enabled: it must never use transparent sorting.

Ground maps are 512 px `md` and 1024 px `hd`. Their outer 1/64 is symmetrically blended to the opposite edge. The invariant is max RGB difference of opposing edges <= 2/255; preview sheets are 3x3 repeats. This is intentionally a conservative seam recipe, not a replacement for existing terrain layers.

Cloud source cut-outs use a softer matte and remain optional sprites; existing instanced low-poly clouds remain the runtime fallback until a sprite atlas is wired for each quality profile.


## Pack trees (lead pass)

The four `trees_blender_pack` procedural trees (30k-51k triangles each) ship as 194-234 triangle low-poly reductions built by `blender/make_pack_trees.py` (foliage cards clustered into 8-10 icosahedron clumps coloured from the source vertex colours, 5-sided tapered trunk, three limbs). They are exported under the species names `tree_maple` (broad green), `tree_maple_dense` (deep green), `tree_birch` (light airy) and `tree_autumn_maple` (amber). Previews: `docs/img/flora/tree_pack_*.png`. Clouds are NOT photo cards (the supplied cloud photos were mislabelled in the first pass and showed trees on black): `src/render/ambience.ts` builds volumetric cumulus banks from ~44 soft noise-alpha point-sprite puffs per cloud, lit white on top and blue-grey underneath, in three drift layers; the old low-poly blobs remain only for headless runs.
