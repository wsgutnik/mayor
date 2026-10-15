# Notices

**Mayor** is an original game **inspired by** Cities: Skylines and Cities: Skylines II. It is not affiliated with,
sponsored by, or endorsed by Paradox Interactive or Colossal Order. Referenced names belong to their owners. No code,
model, texture, sound, or interface from those games is included in this repository; study reference images stay outside
git (`screenshots/` is in `.gitignore`).

## Code License

No license has been chosen yet. Until a `LICENSE` file exists, all rights are reserved by the author: the code may be
read, but not reused.

## Third-Party Materials (public domain, CC0)

| Folder | Source | License |
|---|---|---|
| `third_party/kenney-city-kit-roads/` | Kenney, City Kit Roads 2.2, https://kenney.nl/assets/city-kit-roads | CC0 |
| `third_party/polyhaven-asphalt_02/` | Poly Haven, asphalt_02, https://polyhaven.com/a/asphalt_02 | CC0 |

## Author-Provided Materials

`third_party/mayor-*`, `docs/img/brand/`, `docs/maps-kit/`, and `public/ui/` contain art kits, maps, models, and
illustrations created or commissioned by the author for this project (some generated with AI tools). They are not covered
by any open license.

## Libraries

Three.js (MIT), Tauri (MIT or Apache-2.0), Vite, and Vitest (MIT). See `package.json` and `src-tauri/Cargo.toml`.

## Third-Party Code (MIT): rawprogress/fable-cities

Signal phase grouping (`src/sim/signals.ts`: opposite-pair phases, FNV-1a
per-node desync, turn classification, angle helpers) and IDM car following
(`src/sim/traffic.ts`: `idmAccel`, curvature limits, brake/blink state, ramp
pitch pose) are adapted from **Fable Cities**,
https://github.com/rawprogress/fable-cities (commit aea8b10), translated to
TypeScript. Ported functions carry a header comment naming the fable source
file and function.

The same MIT notice covers further functions adapted from Fable Cities (each
carries a header comment naming the fable source): junction solving ideas and
lane connectors (`src/sim/lanes.ts`, `src/sim/junction.ts`), zoning (cell
validity, trapezoid cells, priority overlap resolution, DP lot packer in
`src/sim/zoneblocks.ts`, `src/sim/orientedlots.ts`), lot ground plans
(`src/sim/lotground.ts`), vehicle surface/material/palette/lights and shadow
tuning (`src/render/vehicle-*.ts`, `src/render/shadow-tuning.ts`), street-light
pools (`src/render/street-light.ts`), per-window night lights
(`src/render/window-light.ts`, `src/render/kit-materials.ts`), procedural
buildings (`src/render/facade.ts`, `procgeo.ts`, `procbuildings*.ts`), and info
view field/tint textures (`src/sim/coverage-field.ts`,
`src/render/coverage-overlay.ts`, `src/render/traffic-tint.ts`).

MIT License — Copyright (c) 2026 raw (github.com/rawprogress)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## AI-generated texture swatches (2026-10-13)

`blender/textures/*_hd.png` and `public/textures/*_hd.png` for plaster, brick, concrete, roof tile, wood, metal, paving, gravel, grass, dirt, rock, sand, asphalt, foliage, sidewalk, kerb and garden plot
swatches were derived from swatches generated with Higgsfield (GPT Image 2.5) on the project owner's account, then
made seamless, desaturated and brightness-matched by `blender/apply_ai_textures.py`. They contain no third-party
artwork by design (prompts describe generic materials).

## Fable Cities CC0 texture port (2026-10-14)

Selected files in `public/textures/*_hd.png` are resized colour maps from Fable Cities' public CC0 asset set;
per-file source and upstream credits are recorded in `third_party/README.md`. Only ambientCG CC0 sources were used
for this port; no non-CC0 Fable asset was copied.

## Owner-supplied flora imagery (2026-10-14)

`public/textures/flora/` contains derivative, budgeted PNGs made from tree, cloud, grass, hedge, limestone and soil images supplied by the project owner. The tree and cloud images were generated with ChatGPT Image; the ground images were generated with Midjourney. They are project assets, not third-party artwork, and are not offered under an open license.

`public/models/props/tree_maple.glb`, `tree_maple_dense.glb`, `tree_birch.glb` and `tree_autumn_maple.glb` are low-poly reductions (`blender/make_pack_trees.py`: foliage cards clustered into icosahedron clumps, tapered trunk and limbs, vertex colours sampled from the source) of the four procedural trees in `trees_blender_pack` supplied by the project owner.
