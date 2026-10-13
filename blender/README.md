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

Rules: inside the tile (|x|,|y| <= 0.5, base z = 0), front faces -Y, at most 1400 triangles,
use palette material names (`glow_*` materials light up at night). Output goes to `public/models/NN.glb`;
the game swaps procedural models for these as they load.

## Coordinate convention

| Space | Up | Front of a building | Ground footprint | Unit |
|---|---|---|---|---|
| Blender | +Z | -Y | `|x|, |y| <= 0.5` | 1 = one map tile |
| glTF / Three.js (exporter converts, `+Y up`) | +Y | -Z | `|x|, |z| <= 0.5` | 1 = one map tile |

Base sits at height 0 (no geometry below -0.01, nothing floating above 0.02); the tallest building stays under 2.7.
A building's `footprint` (tiles wide x deep) is declared in `registry.building(..., footprint=(w, d))`; every
shipped model is 1x1. Several models may share a kit number as *variants* (`variant`, `version`); the last
registration for a number wins and any replacement must be listed in `registry.DECLARED_OVERRIDES`.

## Strict validation

`--strict` fails the build (exit 1) when a model leaves its tile, exceeds `MAYOR_BUILDING_TRI_LIMIT`
(default 450), a number 1-40 is unregistered, or a replacement is undeclared. A `manifest.json` (kit number,
name, variant, version, footprint, triangles, bounds, source module) is written next to the GLBs on a full build,
and `src/render/building-inventory.test.ts` checks it against the GLBs. `--previews DIR` writes two angles per
model (`NN.png` front-right, `NN_b.png` back-left) with identical lighting and framing.
