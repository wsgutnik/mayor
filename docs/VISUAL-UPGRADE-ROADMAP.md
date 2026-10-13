# Visual upgrade roadmap

Maturity scale (from the external audit): N0 flat volumes · N1 legible low-poly · N2 consistent stylised ·
N3 optimised architectural realism · N4 hero detail. Target: N3 for most of the catalog, N4 for the five
reference buildings and selected civic landmarks. Current baseline (this repo): N1–N2, with the hero models
(#01–#04, #11–#13, #24, #30, #36–#38) at N2.

| Cycle | Content | Gate |
|---|---|---|
| **C1 — inventory** (PR #1) | Audit script (40 buildings + 67 props), strict export, manifest, variant registry, two-angle previews, 40/40 tests, docs | 40/40 present and parseable, 0 errors, `npm run ci` green |
| **C2 — visual language** (separate branch/PR) | PBR material set, units/conventions, three LODs, five reference buildings as `v2` variants with baseline-vs-proposed comparisons | 5 pilots with visual comparison, strict build green, base assets untouched |
| C3 — refinement | Remaining 35 buildings to N3 with rear/side facades; deterministic variants per district | Old saves load; tests green |
| C4 — surroundings | Lot decoration (driveways, plazas, fences), sidewalk alignment, vehicles by anchor | No street intrusion or overlap in classic and oriented modes |
| C5 — diversity | Style families per district, silhouette variety | No visible repetition in a 300-lot city |
| C6 — performance | Benchmarks on Mac, Windows and iPad; VRAM/draw-call budgets per quality level | FPS/VRAM measured **on the hardware**, not assumed |

## Priority queue (from `BUILDING-QUALITY-REPORT.md`)

1. Rear/side facades for the whole kit (blank walls are the most visible defect while orbiting).
2. Silhouette variety for the apartment and shop families (#05–#08, #11/#13/#19, #16/#18).
3. Larger or multi-tile footprints for #27, #21, #31–#33, #34, #40.
4. Hero set to N4 (#01, #10, #20, #21, #38) and roofs with parapets/equipment everywhere.

## Out of scope / not claimed

- No hardware performance validation has been done for Cycle 2 assets.
- PBR/normal-map/KTX2 are designed, not implemented; the current look is palette + shared pattern textures.

## Status (2026-10-13)

C1 inventory: done and merged. C2 visual language: five reference buildings merged as opt-in v2 variants with three LODs and a manifest gate; PBR materials, runtime LOD switching and hardware benchmarks are not done. C3 refinement: rear and side facades done for #05-#37, #39, #40 within a 700-triangle budget; district variants, multi-tile footprints and the remaining silhouette variety are open.
