# Blender kit models

Low-poly models for the 40 buildings of the Basic Buildings Kit, built in code and exported as GLB.

```bash
# all models, with previews
blender -b --factory-startup --python blender/build_all.py -- --previews /tmp/previews
# only some
blender -b --factory-startup --python blender/build_all.py -- --only 2,3,4 --out /tmp/models --previews /tmp/previews
python3 blender/compare.py --previews /tmp/previews --out /tmp/compare.png 2 3 4   # kit art vs yours
```

Add a model: create `blender/buildings_<group>.py` and register a function with `@building(n, "Name")`
(see `buildings_samples.py`). `lib.Model` has box, gable, hip, pyramid, cyl, cone, windows, awning, tree and plot.

Rules: inside the tile (|x|,|y| <= 0.5, base z = 0), front faces -Y, at most ~420 triangles (average under 300),
use palette material names (`glow_*` materials light up at night). Output goes to `public/models/NN.glb`;
the game swaps procedural models for these as they load.
