# Fable Cities study: buildings, zoning and alignment rules for Mayor

Read-only study, 2026-10-13. Neither repository was edited.

**Source.** `/tmp/gh-refs/fable-cities` is github.com/rawprogress/fable-cities @ `aea8b10` (2026-09-03). It is MIT,
"Copyright (c) 2026 raw (github.com/rawprogress)", written in JavaScript on Three.js, with units in **metres** and an
8 m zoning cell.

**Fable files read in full:**

- `src/modules/buildings/{index,generators,lots,geometry}.js`
- `facadeShader.js` lines 1–700 (the facade, roof and night-light GLSL)
- the headers and pool code of `renderer.js` and `materials.js`
- `src/modules/zoning/{ZoneGrid,ZoneTypes,GroundPlan,index}.js`, plus the headers of `ZoneGround.js`, `ZoneOverlay.js`
  and `GroundMaterials.js`
- `src/demo/{facadeTex,Landmarks}.js`, plus the header of `DistrictGround.js`
- `docs/LOOK_TARGET.md`, `docs/MATERIAL_TARGET.md`, `docs/requests/{buildings,zoning}.md`
- `docs/critique/{buildings_p5,buildings_w2,zoning_w2,zoning_p4}.json`

**Mayor files read:**

- `AGENTS.md` rule 11 and `.claude/skills/mayor-visual-quality/SKILL.md`
- `docs/process/05-oriented-lots.md` and `docs/process/08-fable-cities-port.md` (the junction study this report
  complements)
- `src/sim/{zoneblocks,orientedlots,zonecells}.ts`, the head of `blocks.ts`, the growth loop and `planOrientedLots` call
  in `sim.ts`, and the profile in `corridor.ts`
- `src/render/{lots,visual-v2,glb-models,kit-materials,lod}.ts`, the lot block of `scene.ts` (lines 739–1024) and
  `models.ts makeWindowTextures`
- `blender/{lib,registry}.py`, plus samples from `buildings_zz_hero.py` and `buildings_v2_a.py`

## Verdict

1. **Zoning and alignment: port about four functions.** Fable's zoning grid (`ZoneGrid.js`) is the CS2 model that 05
   describes, with four rules we do not have:
   - 9-point cell rejection against a rasterised road footprint that includes junction fillets;
   - trapezoid cells on curves with a minimum-area cut;
   - a priority-ordered greedy overlap resolution with second-chance passes;
   - a dynamic-programming lot packer whose seeded width preference is keyed on world position, so lot ids and buildings
     survive repaints.

   Each of these is a small, testable change to `zoneblocks.ts` or `orientedlots.ts`. `GroundPlan.planLot` (disjoint
   per-zone ground rects) is a clean pure port that fixes "buildings on a golf course".
2. **Procedural buildings: portable, but not as-is.** `generators.js` is a deterministic recipe engine. It turns a
   lot's `w × d` into instanced unit parts (box, gable, hip, wedge, cylinders), and its numbers are good. It is still too
   heavy for the iPad: fable measures 1 300–1 550 draw calls and 5–7.8 M triangles, against an 8 M budget of its own. Its
   own critic also failed it at 7.0/10.

   The portable value is in three places:
   - (a) a **reduced TS mass generator** for multi-cell oriented lots, which today are faked as a 2×2 cluster of 1×1
     GLBs (`orientedModelCells`);
   - (b) its **proportion recipes**, fed back into `blender/lib.py`;
   - (c) its **per-window night-light rule**, which drops straight into our `glow_window` material.
3. **Facade shader: port a "lite" version only.** The window grid is fitted to the instance scale, with style tables,
   lit-window hashing and a LOD dissolve. Skip the parallax reveal, the sun-shadowed sills and the analytic sky dome on
   iPad; they are desktop-tier at best.
4. **Skip:**
   - the growth timing, the info-view tint, the HDR-multiply zone overlay and the landmark demo layout;
   - `facadeTex.js`, except its 34 %-lit mask idea;
   - the ZoneGround mid-block backfill, for now.

---

## 0. Units and frames (applies to every number below)

| Item | Fable | Mayor | Conversion |
|---|---|---|---|
| Length (plan) | metres | tiles, 1 tile = 1 zone cell = 8 m (05 §0) | **÷ 8** for everything on the ground plane: lot sizes, setbacks, ground rects, cell sizes, road clearances |
| Zone cell | 8 m | 1 tile | identical |
| Lot size | 2–4 cells per side (`ZoneTypes.js`); minimum 2×2 | 1–4 cells (`orientedlots.ts BASE_SHAPES`, 1×1 allowed) | cells identical. Fable's **minimum 2×2 is a gameplay rule, not a unit**: keep our 1×1 |
| Lot record | `x, z` centre; `w` along the road and `d` away, both **metres**; `yaw` makes local +Z face the road | `OrientedLot` `cx, cz, yaw`; `w` = rows along the road, `d` = cols, both **tiles**; `yaw = atan2(F)` with F toward the road (`lotPose`) | `w_m = lot.w·8`. The frames are **identical**: local +x runs along the road and +z points toward the road. Fable generators place the front at `+d/2`, which is our `orientedKerb` edge. No sign flip |
| Vertical (buildings) | real metres: storey 2.9–3.7 m | **kit scale.** Measured from `lib.windows(...)` calls: storey ≈ 0.20–0.27 tile (`buildings_zz_hero.py:46,123,377`), door 0.06×0.10 tile (`lib.door`), building cap `check_bounds max_h=2.6` (4.2 for wide models) | Real storeys are 0.36–0.46 tile. **Do not divide fable heights by 8.** Use one pinned constant `KIT_STOREY = 0.25` tile and convert floors, not metres. Façade details (door, window, sill) scale by `KIT = 0.6 × (m/8)` when they must match the GLB kit (lead decision, §6 R1) |
| Plan-scale vs kit-scale | — | roads are true scale (street drawn 0.9 tile = 7.2 m); buildings are miniature (≈0.45–0.75×) | Mixing true-scale setbacks with miniature buildings makes buildings look small on their lots. Choose per task: ground plan ÷8 exact; masses ÷8 in plan, `KIT_STOREY` in height |
| Height samples | `terrain.getHeight` metres | `heightAt(w, x, z)` world units (tiles) | ÷8 |

Absolute tolerances to convert explicitly:

| Fable | Meaning | Tiles |
|---|---|---|
| road raster margin `+0.6 m` | clearance around the road footprint | 0.075 |
| node fillet stamp `maxW/2 + 3.0 m` (nodes with ≥ 3 segments) | junction keep-out disc | `maxDrawHalf + 0.375` |
| corner/edge sample shrink `0.93` | ratio | unchanged |
| `MIN_AREA_FRAC = 0.42` | squashed-cell cut | unchanged (fraction of 1 tile²) |
| `CONFLICT_DIST = 6.4 m` | rival-cell centre distance | 0.8 |
| `MAX_SLOPE = 10.5 m` per cell | cliff | 1.31 (ours `CELL_SLOPE_LIMIT = 1.0`: keep ours) |
| `EDGE_STEP = 2 m` | road-edge sample step | 0.25 (ours `sample(pts, 0.25)`: same) |
| lots.js segment-end margin 11 m / 15 m (avenue) | fallback junction avoidance | 1.375 / 1.875 |
| lots.js gap behind the sidewalk 1.0 m | lot setback from the frontage | 0.125 |
| lots.js own-road clearance `hw + 0.6 m`, crossing-road clearance `hw + 2.0 m` | | `hw + 0.075` / `hw + 0.25` |
| lots.js slope gate `4.5 + 0.08·d` m | | `0.5625 + 0.08·d` |
| `siteLevel` spread threshold 0.14 m; plinth when `y − minY > 0.9 m`; plinth depth `y − minY + 0.6` | site grading | 0.0175 / 0.1125 / +0.075 |
| water clearance `wl + 0.7 m` | | 0.0875 |

---

## 1. Lot, cell and block alignment rules: fable vs Mayor

### 1.1 Side-by-side

| Rule | Fable (`ZoneGrid.js`, `lots.js`, `GroundPlan.js`, `generators.js`) | Mayor (`zoneblocks.ts`, `orientedlots.ts`, `render/lots.ts`) | Gap / port |
|---|---|---|---|
| **Frame origin** | Cells start at the **outer sidewalk edge** (`roads.api.sampleEdge`), 0 m gap. The frame runs over the whole segment length; `count = floor(Le/8)` | Cells at `lat0 = drawHalf + sidewalk(0) + setback + 0.5` (street 1.0, avenue 1.5), so the front edge is at the raster edge 0.5 / 1.0. `s0` is 0 (street) or 0.5 (avenue); street rows `floor(len+0.1)+1` | Equivalent. 08 option A keeps our lot front at 0.5/1.0 with the sidewalk inside the raster. **No change** |
| **Cell shape** | **Trapezoid** from two edge samples `E0(s0)`, `E1(s1)` offset by `normal·k·8` (`_buildFrame`). Cells whose signed area is `< 0.42·cell²` are dropped (inner side of curves); the column stops there | Unit **square** per row frame (`cellCorners`). On curves the outer cells gap and the inner cells overlap; overlap resolution then deletes cells | **Port P-Z2.** Trapezoid `cellCorners` from row edges at `s0 + row ± 0.5` and the `MIN_AREA_FRAC` cut. Outer curves stop showing gaps between cells and pads |
| **Road / junction rejection** | 1 m raster of every road footprint (`width/2 + 0.6 m`) **plus a disc `maxW/2 + 3 m` at every node with ≥ 3 segments** (`_rasterise`). A cell is blocked if its centre, any of 4 corners pulled in 7 % (`S = 0.93`), or any of 4 edge midpoints is occupied, where occupied means all 4 surrounding raster samples are inside, so there are no false positives (`_blocked`, `_occupied`) | Cell **centre only**: `blocksBuilding(centre tile)` or distance to another segment's centreline `< roadHalfWidth(other) + 0.45` (`applyValidity`). No node keep-out | **Port P-Z1.** 9-sample test against analytic footprints (distance to centreline `< drawHalf + sidewalk + 0.075`) plus node discs `maxDrawHalf + R_corner + sidewalk`. When `junction.ts` (08 P2) lands, swap the disc for the junction `sidewalkOuter` ring. This is the "lots touching kerbs" item on the rule-11 list |
| **Water / slope** | water at the centre or any corner; slope across the 4 corners `> 10.5 m` | slope centre vs road point `> 1.0`; `isLand(centre tile)`; corners in bounds | keep ours; add the water test at the corners (cheap) |
| **Strip continuity** | A column survives only as far as its unbroken run from the kerb, and **runs < 2 are dropped** ("a single 8 m cell can never hold a lot", which squares off junction corners) | Row cut-off: `valid[c] = 0` if `valid[c−1] = 0`. Same rule, no minimum run | keep 1-deep (we allow 1×1); optional `MIN_RUN` flag per zone type |
| **Overlap / corner resolution** | **Greedy independent set** in a global priority order: `k` ascending (nearer the kerb), then wider road, lower seg id, side, `i`. A conflict is centre distance `< 6.4 m` or point-in-quad either way; frame neighbours (same `k`, `|Δi| ≤ 1`) never conflict. **Up to 3 second-chance passes** re-admit cells whose rival was dropped (`_resolveConflicts`), so a block keeps a clean edge with no holes | **Pairwise** `loser(a, b)` per tile bucket in iteration order: `col ≤ 1` band beats `col ≥ 2`, then age, then key, then row. The loser is invalidated immediately, even if the winner is later invalidated by a third cell. No second chance | **Port P-Z3.** Order dependence is a latent determinism and hole bug. Sort all valid cells once by `(col, −roadWidth, age, side, row)` (our CS1 band rule can stay as the first key), keep a cell if it fits, then run 3 re-admission passes. Test: shuffling the segment order gives identical validity |
| **Painting persistence** | Paint stored per **world cell key**. On a road rebuild a cell inherits from the nearest old painted cell within 4.5 m (0.56 tile) | `migrateCells`: nearest within 0.75; unchanged segments copied verbatim | equivalent; keep ours |
| **Lot packing** | Per frame, per contiguous run of same-type columns with depth ≥ 2: **exact DP** over widths 2..4 maximising Σ `w·minDepth`. Out-of-range widths cost −1.2; the seeded preferred width gets +0.6. The rng is keyed on **the front corner's world position + type + world seed**, so a repaint elsewhere never re-partitions this run. Lot depth = shallowest column (2..4). Every lot touches the road. Coverage metric `lotCells/zonedCells` (~0.85); unlotted cells are drawn desaturated | Per block: front cells **Fisher–Yates shuffled by the global rng**. Shapes `[4,4],[4,2],[2,2],[2,1],[1,2],[1,1]` (`[3,3]` for non-res level ≥ 2), 6° yaw spread, extend backward, then **1×1 lots at `col > 0`** for leftovers | **Port P-Z4.** (a) DP packer with widths 1..4 and per-zone preferences, cells = rows, depth = min col depth. (b) Seed keyed on `(round(front.x·2), round(front.z·2), zone)` instead of the shared rng stream. (c) **Finding:** `lotsReady` (`orientedlots.ts:188`) skips `col !== 0`, so the `col > 0` fallback lots never grow (`sim.ts:1363–1383`). Front lot and back cells of different level or zone strand zoned cells forever. Confirm with a test, then either drop those lots and report coverage (fable) or merge back cells into the front lot when zone matches regardless of level |
| **Lot identity** | `key = frontage(x·2, z·2) : normal(·4) : w : d : type`, so an old lot object (and its `buildingId`) is reused when the footprint is unchanged | ids kept by the `keep` persistence pass via `shapeFits` (same zone and level) | equivalent; ours is stricter. Keep it |
| **Corner lots** | none: the corner cell belongs to the winning frame and faces that road | same (05 §1.5 G-CORNER) | identical |
| **Fallback (no zoning)** | `lots.js generateLots`: sizes per type (res-low w 16/16/24 × d 16/24 m, …, ind 32/40), a margin of 11 m (15 m avenue) from **segment ends**, lots 1 m behind the sidewalk edge, corners inset 18 % toward the centre and tested against crossing roads `hw + 2 m`, slope ≤ `4.5 + 0.08d` m, SAT overlap with 0.3–0.4 m padding (`lotsOverlap`, grid `LotIndex` 32 m) | n/a | port only `lotsOverlap` (SAT with padding) as the **test oracle** for `checkLots` (lot vs lot, lot vs road OBB) |
| **In-lot setback (building inside lot)** | per generator, metres: house front `clamp(d·U(0.2,0.3), 3.5, 7)`; apartment sides 1.4–2.4, front 2.6–4.2, back 2.4–4; shop sides 0.5–1.1, front 0.8; mixed podium sides 1.2, front 1.2; office sides 2, front 3.2; industrial sides 2.5–4, back 2.5 | GLB fills ~0.96 of a 1×1 tile (`lib.plot w=0.96`), with hedges at the front | see §2.3 for tile values |
| **Ground of the lot** | `GroundPlan.planLot`: **disjoint** rects `{u0,v0,u1,v1,surf,kind}` in lot-local metres (`v=0` = kerb) by band decomposition (`Bands`), which tile the lot exactly once. 4 surfaces (PAVE / ASPH / CONC / LAWN, `NONE` = keep terrain grass), 10 decal kinds | one pad per built lot (`PLOT_TINT`), depth-shaded pads for empty lots | **Port P-Z5.** See §1.2 |
| **Site grading** | `siteLevel`: `y = max(sidewalk height in front, (minY+maxY)/2 − 0.2 m, water + 0.7 m)`; if spread `> 0.14 m`, flatten (near-axis lots) or add a concrete plinth `w−0.5 × d−0.5`, depth `y − minY + 0.6 m` | building at `heightAt(cell) + 0.04`; pad at the corner mean + lift | **Port P-Z6** as a pure `siteLevel(lot, heightAt, frontY)` |

### 1.2 GroundPlan recipes (port verbatim, metres ÷ 8)

The lot frame is `u ∈ [0, w]` along the road and `v ∈ [0, d]` from the kerb. The band numbers below are in metres.

| Fable type | Bands from the kerb |
|---|---|
| `res-low` | footway band 1.4 (PAVE, with the driveway ASPH cut in), driveway `dw = clamp(0.19w, 2.8, 3.6)` to `vDrive = clamp(d·(0.40+0.12r), 5, d−3.2)`, front path 1.25 wide beside the drive, terrain grass elsewhere, a back bed `0.18w..0.82w` against the back fence (2.1) |
| `res-high` | 2.6 PLAZA, then a body band `[parking pw = clamp(0.27w, 5, 7.2) BAYS][PAVE][lawn lw = clamp(0.20w, 3.2, 6) MOWN]` (flip 50 %), then a rear CONC YARD `clamp(0.13d, 2.4, 3.6)` |
| `com-low` | 2.2 PLAZA, ASPH BAYS `clamp(0.42d, 6, 13)`, PAVE, then a CONC YARD 2.6 |
| `com-high` | 3.4 PLAZA, a body with a service lane `clamp(0.16w, 3.2, 4.6)` BACKLOT, then rear `[CONC YARD 0.58w][ASPH BAYS]` `clamp(0.20d, 3.6, 6)` |
| `office` | lawn verge 1.7 (55 %), 3.4 PLAZA, PAVE, then rear BAYS `clamp(0.40d, 6.5, 14)` |
| `ind` | 1.6 PAVE, ASPH BAYS `clamp(0.34d, 6, 11)`, CONC YARD, rear `[YARD][GRAVEL 0.38w]` `clamp(0.20d, 3, 6.5)` |

Mayor mapping: RES L1 → res-low; RES L2 → res-low (area ≥ 4 → res-high); RES L3 → res-high; COM L1–2 → com-low;
COM L3 → com-high (area ≥ 9 → office); IND → ind. Minimum rect 0.35 m = 0.044 tile.

Fable lifts the ground mesh 0.035 m (0.0044 tile), below the building aprons at 0.04. Ours: pads lift 0.02–0.03 and
models sit at +0.04. Put ground rects at +0.025 and keep 0.015 of separation, or z-fighting returns.

---

## 2. Procedural buildings vs our Blender GLB pipeline

### 2.1 How fable does it

- **Recipe.** `generate(b, lot, rng, env)` returns `{mass[], detail[], height, floors, residents, jobs, main{x,z,w,d,h},
  stacks[], vents[]}`. A part is `{geo, mat, x, y, z, w, h, d, ry?, rx?, rz?, color, p1, p2, variant, t}` in the lot
  frame. Geometries are unit shapes with the base at y = 0 (`geometry.js`).
  - Parts: `box` (12 tris), `gable` (8), `hip50/35/25` (6–8), `wedge` (8), `cyl` (10 segments, 40 tris), `cylLow`
    (6 segments, 24), `cone` (20), `dome` (80), `blob` (42), `plane` (2), `panel` (2).
- **Generators** (`GENERATORS`): `house` (res-low), `apartment` (res-high), `shop` (com-low), `mixed` (com-high tower on
  a podium), `office` (stepped curtain wall), `industrial`. Level 1..5 drives floors, materials and features.
  Determinism comes from `makeRng(hash2(seed, level))`.
- **Rendering** (`renderer.js`). One `InstancedMesh` pool per (geometry × material), with per-instance `aParams`,
  `aParams2`, `aTint` and `aVariant`.
  - The **static tier** is all `mass` parts, persistent, with swap-remove.
  - The **dynamic tier** is `detail` parts streamed around the camera target: `rFull = 130 m·(0.7+0.3·density)·zoom`,
    `rBig = 250 m·(0.6+0.4·density)·zoom`, `zoom = clamp(190/camDist, 0.3, 1)`, budget 22 000 instances. Beyond `rFull`
    only parts with `t = 1` or size ≥ 2.2 m survive.
  - Alpha-tested panels (chain, sign, picket, lamp, beacon) cast no shadow.
- **Construction state.** `state: construction` with `progress` advancing over `BUILD_HOURS` (res-low 1.1 h … office
  3.0 h × (1 + 0.18·(L−1))), remounted every 1/8 of progress.
  - `constructionMass`: raw concrete cores at `h·min(1, 1.15p)` and `w, d × 0.94`; floor plates every 3.3 m, 0.26 thick
    and 0.5 oversize; ground planes switch to dirt.
  - `constructionDetail`: scaffold 0.8 m off the main volume, a lift every 2 m, poles every 2.5 m, deck boards on even
    lifts, a green net on the top lift, and a lattice tower crane when `main.h > 12 m`.
    - The crane mast is `h + 14`, with 4 chords 1.7 m apart and a diagonal per 2.6 m bay. The jib is
      `max(w,d)·0.8 + 14`, with a counter-jib, cab and beacon, and a hook between 0.35 and 0.8 of the jib.
  - Also on site: 8 starter columns with rebar, a 2 m chain fence with an 8 m gate, a container, a sand cone, pallets,
    and 3 work lights (lamp material).
- **Level-up** remounts with a new recipe (`setLevel`). Info views tint per instance (`aTint`).

### 2.2 Mayor today

- **Pipeline.** 40 kit models (`catalog.ts`; RES/COM/IND × level 1..3), built in Blender by `lib.Model`.
  - Each model is 1×1, ≤ 1 400 triangles (`glb-assets.test.ts:51`), front −Y, base z = 0.
  - Windows are quads whose lit state is **baked** per quad (`lib.windows`: `glow_window` if `rng < max(lit, 0.45)`,
    else `glass_dark`).
- **Loading.** `glb-models.ts` merges each model into one geometry. `kit-materials.ts` shares textured materials by
  palette name.
- **Night.** `glow_window` gets `emissiveMap: window_glow`, and **every** glow material gets the same
  `emissiveIntensity = nightGlow` (`scene.ts:1168–1170`). All lit windows switch on together at dusk at one brightness
  and one colour, and stay on all night.
- **Multi-cell lots.** A 2×2 cluster of four 1×1 instances of the same look (`orientedModelCells`, `scene.ts:795–801`).
  A 4×2 or 3×3 lot never gets a building shaped to its footprint.
- **LOD.** `lod.ts` reorders instances and collapses far buildings to one 12-triangle `lodBox`. The v2 GLB LOD0/1/2
  chain sits behind `?visualV2=1`.
- **Construction.** No construction state; level 0 → 1 is instant.

### 2.3 What is portable

**A. As TS procedural generators** (new `src/render/procbuildings.ts`, pure and DOM-free, plus a render pool):

| Fable function | Port as | Keep | Change |
|---|---|---|---|
| `P()`, `fp()`, `wallBox()` | `part()` and `facadeParams()` helpers emitting into typed arrays (no object per part per frame) | part schema | units in tiles; heights in `KIT_STOREY` |
| `house` | `houseRecipe(lot, level, rng)` | main volume, setback, garage on wide lots, gable/hip choice, fascia, gutter, ridge cap, chimney, door slab + canopy, path, driveway plane | drop shrubs, fences and solar into the detail tier; the triangle cap needs it |
| `apartment` | `apartmentRecipe` | slab + wing (70 % at L ≥ 2) + penthouse (L ≥ 4), bulkhead, solid balustrade balconies on the front face only, plinth + lobby portal | balcony count capped to the triangle budget |
| `shop` | `shopRecipe` | slab, cornice over the shopfront, awnings every bay except every 3rd (90 % of shops), signs `w ≤ 4.2 m`, aspect 5:1, rooftop units | awnings as `wedge` |
| `mixed` | `mixedRecipe` | podium + tower plan archetypes (slab 32 % / point 30 % / block 38 %, 45 % of slabs turned 90°), 4–6 `crown()` kinds | towers cap at a kit height (2.6–4.2 tiles) |
| `office` | `officeRecipe` | 2 or 3 tiers (splits 0.55/0.45 or 0.40/0.35/0.25; scales 1/0.72 or 1/0.78/0.58), parapet 0.86 m + coping, crown kinds | same cap |
| `industrial` | `industrialRecipe` | hall + gable roof (L < 4) or skylights (L ≥ 4), dock apron, docks on `dockLayout`, annex, chimney (L ≥ 3, 24 %/42 %), tanks in the side yard | chain fences in the detail tier |
| `crown(kind)`, `bulkhead`, `rooftopUnits`, `beaconLamp` | same names | archetype table | rooftop clutter `n = max(count, min(7, round(area/110 m²)))`; only the coarse casing in mass |
| `constructionMass`, `constructionDetail` | `constructionParts(main, lot, progress, rng)` | cores, plates, scaffold, crane over the threshold, fence | crane threshold `main.h > 12 m` becomes `> 1.0 tile` kit height; lattice simplified to 4 chords + 1 diagonal per 2 bays |
| `gableGeometry`, `hipGeometry(r)`, `wedgeGeometry` | `src/render/procgeo.ts` | verbatim (unit shapes, UV v from eave to ridge) | — |
| `bayLayout`, `dockLayout`, `doorCentre` | `src/sim/facade.ts` or `src/render/facade.ts` (pure, shared by the generator, the shader and tests) | verbatim (metres → tiles: `sideM = 0.55 m = 0.069`; min bay 1.2 m = 0.15; dock spacing `max(6.4, faceW/floor(faceW/7.2))` m) | constants in one `FACADE_TUNING` object with a pinned unit test |
| `BuildingRenderer` pools | `ProcBuildingRenderer`: one `InstancedMesh` per (geometry × material), with a static mass tier | pool and swap-remove | **no per-frame allocation** (fable allocates `near[]` and sorts per refresh); the detail tier uses our `lod.ts bucketOrder` with scratch buffers; rebuild < 10 ms at 96² |

**Scope rule (lead decision).** Use procedural buildings only for oriented lots with `w·d ≥ 4`, where the 2×2 composed
cluster looks worst. 1×1 lots keep the GLB kit. Put it behind `?procBuildings=1`, mirroring `?visualV2=1`, until the
lead accepts the visual pass. No save change: recipes are pure functions of `(lot.id, lot.zone, lot.level, w, d, seed)`.

**Mayor zone/level → fable generator:**

| Mayor | Small lot (area < 4) | Area 4–8 | Area ≥ 9 |
|---|---|---|---|
| RES L1 | GLB kit | `house` (fable L 1–2) | `house` L3 |
| RES L2 | GLB kit | `house` L4–5 or `apartment` L1 | `apartment` L2 |
| RES L3 | GLB kit | `apartment` L3 | `apartment` L4–5 |
| COM L1 | GLB kit | `shop` L1–2 | `shop` L3 |
| COM L2 | GLB kit | `shop` L4–5 | `office` L1–2 |
| COM L3 | GLB kit | `mixed` L3 | `mixed` L4–5 / `office` L3–5 |
| IND L1..3 | GLB kit | `industrial` L1/3/5 | same |

**Generator numbers, converted.** Plan values are ÷8. Heights use `KIT_STOREY` (written `S` below, = 0.25 tile) instead
of metres.

| Generator | Footprint (tiles) | Floors | Notable |
|---|---|---|---|
| house | front setback `clamp(d·U(0.2,0.3), 0.44, 0.875)`; depth `clamp(d − sb − max(0.5, 0.3d), 0.875, 1.625)`; width `min(max(0.825, w·U(0.42,0.58)), 1.875, w − 0.375 − garage)`, L1 ≤ 1.19 | L1: 1, L2: 1–2, L3–4: 2, L5: 2–3 | garage if `w ≥ 1.56` with p 0.93 (L ≥ 2) / 0.62; width 0.38/0.44/0.75, depth 0.775. Overhang 0.053–0.078; pitch 0.50–0.68 rad. Hip at L ≥ 3, 45 %: `hip50` if ratio > 0.85, `hip35` > 0.62, else `hip25`. Front gable wing if `hw > 1.125`, 45 %. Dormers 34 % on 2-storey gables. Chimney 82 %. Porch at L ≥ 3 |
| apartment | sides 0.175–0.3, front 0.325–0.525, back 0.3–0.5; max 5.25 × 3.0 | `[3,5,8,12,18][L−1] + U{−1..2}`, cap `3 + floor(w·d·64/70)`; ground storey 1.13·S (retail 1.4·S); parapet 0.075 | balconies skipped in 26 % of bays (loggia), depth 0.13 (30 %) or 0.175, width `min(bay·0.62, 0.4)`; every 2nd bay when floors·bays > 40; slab colour `wall·0.72 + 0.06` |
| shop | sides 0.06–0.14, front 0.1; depth `clamp(d·U(0.55,0.72), 1.0, 2.75)` | `[1, 1–2, 2, 2–3, 3]`; ground 1.4·S, upper 1.07·S | awning drop 1.45 m below the ground storey; sign at `groundH − 0.8 m`; rooftop billboard at L ≥ 3, 70 % |
| mixed | podium `w − 0.3 × d − 0.275` | podium 2 (L ≤ 2) or 3; tower `[5,8,12,18,26] + U{−1..3}`, cap `5 + floor(w·d·64/32)` | glass at L ≥ 4 62 %, L3 35 %; beacon if the crown is above 45 m (kit: above 2.4 tiles) |
| office | `min(w − 0.5, 5) × min(d − 0.625, 4)`, front 0.4 | L1 3–4, L2 5–7, L3 10–16, L4 16–26, L5 26–40; cap `8 + floor(w·d·64/24)` | tiers as above |
| industrial | sides 0.31–0.5; hall depth `clamp(d·U(0.48,0.62), 1.25, 3.25)`; back 0.31 | hall height `[5.5,6.5,8,9.5,11] m + U(−0.5, 0.8)` → ×`S/3` | roof pitch 0.14–0.24 rad; dock apron 0.3 deep, 0.14 high; annex ≤ 1.25 wide; fence 0.275 high with a 1.125 gate |

All Mayor heights then clamp to `check_bounds`: 2.6 tiles, 4.2 for hero-sized footprints. This compresses fable's top
levels. The level → floors table must be re-pinned to our skyline (lead decision R2), or a 40-floor office becomes 10
tiles tall.

**B. As improvements to our Blender generators** (`blender/lib.py`, `buildings_*.py`). No new runtime code:

1. **`lib.windows()` bay layout.** Today `cols = round(w/0.13)` with a 0.05 margin and a 12 % inset, always the same
   window shape. Port `bayLayout` (`sideM = 0.069` tile at plan scale, ×0.6 kit = 0.041) with
   `nB = max(1, floor(usable/bayW + 0.35))`, and the per-style window boxes from §3.1 (house `wW = min(0.62·bay, …)`,
   `wH` 1.55 m, centre at 55 % of the storey; apartment `wH = 0.54h`, 28 % tall windows at `0.76h`; retail ground floor
   `0.88·bay × 0.60·groundH`). Add a door bay at `floor(nB/2)` on the front face only. `top margin` is 0.45 m (flat roof)
   or 0.10 m (pitched).
2. **Emit every pane as `glow_window`.** Choose lit/unlit in the shader (§3.2), not at bake time. Encode the style by
   material-name suffix (`glow_window_res`, `_office`, `_shop`, `_ind`) so `kit-materials.ts` can give each family its
   `litBias`. `glass_dark` remains for never-lit glazing: stair cores, lobbies by day.
3. **Sills** (thickness 0.10 m, projection 0.14 m, overhang 0.11 m past the window) as a box under punched windows. Our
   `framed_window` in `buildings_v2_a.py` already does a version of this. Add **plinth bands**: house 0.34 m, apartment
   0.85 m, retail 0.30 m, curtain wall 0.9 m.
4. **Roof kit.** Eave overhang 0.42–0.62 m, fascia board 0.22 m, gutter 0.13 × 0.14, ridge cap 0.17 × 0.36 in the roof
   material. Hip roofs keep a shorter ridge (×0.34 / 0.52 / 0.68). Chimney cap +0.95 m above the ridge.
5. **Tower crowns.** The six archetypes of `crown()`: flat parapet, 2-step setback (×0.74, ×0.50), pitched cap
   `hh = min(w,d)·U(0.22,0.34)`, cornice + glazed lantern `0.42w`, mast `U(9,20) m` with red bands + 2 beacons, glazed
   lightbox `U(3.4,5.8) m`. Our hero models (`buildings_zz_hero.py` 20, 10, 7) would gain silhouette variety for free.
6. **Rooftop clutter rule.** At least one unit per ~110 m² (≈ 1.7 tile²), and never a near-black primitive on a pale
   roof (values within the roof's family).
7. **Texture repeat sizes vs `lib.PATTERN`.**

   | Material | Fable (m per tile) | Our `PATTERN` (tile) | ≈ m |
   |---|---|---|---|
   | brick | 1.5 (calibrated to 10 cm courses) | 0.4 | 3.2 |
   | plaster | 3.0–3.2 | 0.5 | 4 |
   | wood siding | 1.5 | — | — |
   | concrete wall | 3.6 | — | — |
   | corrugated | 2.0 | — | — |

   At kit scale (×0.6) brick should be about 0.11–0.19 tile. Ours is 2–3× coarse. Re-run with the `glb-assets` texel
   test.
8. **Palette.** LOOK_TARGET rows 7–8: lit façades at Y ≈ 0.18, OKLab C ≈ 0.036, hue 30–55°, HSV S 0.20–0.40. Our
   `wall_cream #eadfc8` and `wall_white #f3f1ea` are far brighter and greyer. `wall_blue`, `wall_green` and `wall_red`
   are saturated primaries. Adopt `PLASTER_TINTS` / `SIDING_TINTS` / `MODERN_TINTS` (linear 0.36–0.68) via the tinted
   neutral textures, as the skill already requires.
9. **LOD chain.** Fable keeps coarse plant (AC casing, tank shell, chimney) in the always-drawn tier and streams the
   fine plant. Map this to our `v2_lod1`: keep parts whose size ≥ 2.2 m (≈ 0.28 tile plan, ≈ 0.17 kit), drop smaller
   ones.

**C. Construction states.** These need a sim change, see task B6. Fable shows that scaffold, crane and site fence carry
the whole "city is growing" read. It is optional for Mayor but high-impact.

---

## 3. Per-building visual rules (numbers)

### 3.1 Facade grid (`facadeShader.js` FACADE_FRAG; style ids `PLAIN 0, HOUSE 1, APARTMENT 2, RETAIL 3, CURTAIN 4, INDUSTRIAL 5, INDUSTRIAL_METAL 6`)

**Per-instance parameters:**

- `aParams = (floorH, style, seed, groundH)`
- `aParams2 = (bayW, winFrac, litBias, texScale)`
- The facade UV is in **metres**, derived from the instance scale (`SCALE_GLSL`). The face id is +x 0, −x 1, +z 2 (front),
  −z 3, roof 4.

**Layout:**

- `sideM = 0.55`; `usable = faceW − 1.1`; `nB = max(1, floor(usable/bayW + 0.35))`; `bay = usable/nB`.
- Ground storey `[0, groundH]`; upper storeys `floorH`; `nFl = floor((faceH − groundH − topMargin)/floorH)`.

**Window boxes by style:**

| Style | Window `wW × wH`, centre `wC` (fraction of storey) | Frame RGB / roughness / metalness | Glass tint (linear) | Recess | Sill | Plinth |
|---|---|---|---|---|---|---|
| HOUSE | `min(0.62·bay, 1.85) × 1.55`, `wC 0.55`; door bay `floor(nB/2)`, front face, `1.02 × 2.15` | (0.84,0.83,0.79) / 0.44 / 0.05 | 0.022–0.040 warm | 0.20 (door 0.10) | yes | 0.34 |
| APARTMENT | `bay·winFrac (0.42–0.55) × 0.54h`, `wC 0.56`; 28 % tall `0.76h @ 0.49`. Ground: door `1.9 × 2.5`, lobby ±1.6 bays `0.80·bay × 0.62h` | (0.33,0.34,0.36) / 0.40 / 0.25 | 0.019–0.036 | 0.21 (lobby 0.12) | yes | 0.85 |
| RETAIL | ground `0.88·bay × 0.60·groundH @ 0.40`, no sill; upper as apartment. Fascia band `[groundH − 0.92, groundH − 0.06]`, chroma capped at 0.085 value | (0.21,0.22,0.24) / 0.30 / 0.45 | ground 0.018 | 0.13 / 0.16 | upper only | 0.30 |
| CURTAIN | `(bay − 0.24) × (h − 0.26)` (12 cm mullion each side); **opaque spandrel on the lower 32 % of every upper floor**; lobby `groundH − 1.5` | (0.46,0.47,0.49) / 0.32 / 0.30 | 0.016–0.024, family from the wall hue (55 %) | 0.11 (lobby 0.30) | no | 0.9 |
| INDUSTRIAL | no floor grid: panel joints every 1.06 m (not on metal clad), horizontal every 2.35 m above 1.15 m, kicker 1.1 m. Clerestory `[faceH − 2.25, faceH − 0.95]` in 2.28 m panes on a 2.6 m pitch. Roller doors 3.9 × `min(4.3, faceH − 2.6)` on `dockLayout` | doors (0.30,0.31,0.32) / (0.22,0.26,0.30), ribs every 0.34 m | 0.030–0.038 | door 0.10 | — | — |

**Wall detail (multipliers):**

- Macro: `macro = 0.62·val(f·0.21) + 0.38·val(f·0.062)`; `wall *= 0.80 + 0.40·macro`.
- Stain: `×(0.93 + 0.14·stain)`. Dirt runs −13 % toward the base.
- Grime under sills −18 % over 1.7 m. Slab band −15 % (0.05–0.10 m around each floor line).
- Corner darkening −12 % within 0.55 m. Sill AO and shadow −34 %.
- Base ramp `×(0.84 + 0.16·smoothstep(0, 1.8 m, y))`.
- **Blinds.** 20 % of panes (`hCell > 0.80`; office 10 %), colour `hue·clamp(wallY, 0.06, 0.55)·mix(0.52, 0.88)`, so a
  blind never outshines the wall.
- **Sill.** `clamp(mix(wall·1.22 + 0.045, 0.46 grey, 0.40), 0.05, 0.62)`, roughness 0.62.

**Flat roof (top face):**

- Gravel tex tile 7 m; felt seams every 2.4 m; ponding on 3.5 m cells (−22 %).
- Parapet ring where the edge distance is < 0.30–0.46 m, colour (0.46,0.45,0.43), coping at 0.20 m (+22 %).
- AO 0.62 within 1.1 m of the parapet.

**LOD dissolve (anti-moiré):**

- `lod = smoothstep(0.10, 0.42, pixelFootprint/bay)`.
- The far colour is `mix(wall·0.94, mix(gcol·1.25, frameCol, frameFrac), glazedFraction)`, with
  `frameFrac = 0.20` (office 0.38) and `glazedFraction = clamp(wW·wH/(bay·h), 0, 0.88)`. The reflection fades with it.

### 3.2 Night lights (port this first, it is cheap)

```
nightOn = smoothstep(0.06, 0.42, uNight)
cell    = hCell (per bay × floor × face × building hash); office: mix(hCell, floorLamp, 0.7)   // floor-coherent offices
frac    = clamp(litBias · 0.68 · nightOn, 0, 1)
lit     = smoothstep(frac + 0.06, frac − 0.06, cell) · (1 − isDoor) · nightOn
colour  = mix((1.00,0.56,0.24), (1.00,0.79,0.53), hCell2);  8 % cool (0.62,0.76,1.00) if hCell2 > 0.92;
          office: (0.84,0.90,1.00) when hCell2 > 0.35 (65 %)
bright  = mix(0.22, 0.85, fract(hCell·17)) · (blinds ? 0.42 : 1)
emissive += colour · glassMask · lit · bright · 0.86;   reveal spill += colour · reveal · lit · bright · 0.34
diffuse  = mix(diffuse, colour·0.14, emiss)      // a lit pane loses its daytime glass look
```

**`litBias` per generator:**

| Generator | `litBias` | Night lit fraction (`litBias × 0.68`) |
|---|---|---|
| house | 0.70 | 47.6 % |
| apartment | 0.60 | 40.8 % |
| shop | 0.75 | 51 % |
| mixed podium | 0.70 | 47.6 % |
| tower | 0.60 | 40.8 % |
| office | 0.55 | 37.4 % |
| industrial | 0.35 | 23.8 % |
| office annex | 0.50 | 34 % |

**Industrial clerestories:** a strip is lit if `hash > 0.62` (38 %), at colour (0.95,0.93,0.82) × 0.45.

**Shopfronts by day:** a warm interior glow `(1,0.82,0.58)·interior·(0.030 + 0.075·hCell)·(0.35 + 0.65·night)`.

**Shared emissive uniforms** (`index.js update`):

- signs: `0.03 + 0.85·night`
- lamps: `0.02 + 2.4·night`
- beacons: `(1.15 + 4.2·night)·(0.34 + 0.66·max(0, sin(1.6t))⁶)`

`demo/facadeTex.js`, for comparison, uses canvas textures: a 24 m tile of 6 bays × 8 floors, 34 % of panes lit at
warmth 0.7–1.0, and 40 % of the lit panes half-blinded at 55 % black.

**Mayor today vs this rule:**

- Ours: lit fraction ≥ 45 % fixed at bake time.
- Ours: one colour, `#ffd27a` emissive with `window_glow`.
- Ours: one intensity, `nightGlow = max(0, 1 − 1.6·day)·1.1`.
- Ours: all lit windows switch together.

**The port** is an `onBeforeCompile` patch on the `glow_window*` materials in `kit-materials.ts`:

- `hCell` = hash(instance translation, `floor(localPos / windowCell)`).
- The window cell is derived from the per-quad UV: windows map 0..1 per quad, so the quad centre's local position
  quantised to 0.02 tile is a stable per-window id.
- `uNight` comes from the existing `nightGlow`.
- `litBias` comes from the material-name suffix.

A pure TS mirror `windowLight(h, h2, night, litBias, office)` gives unit tests.

### 3.3 Material targets (MATERIAL_TARGET.md, base values)

| Surface | Roughness | Metalness | Notes |
|---|---|---|---|
| curtain glass | 0.05 | 0 | specular floor 8–15 % of sky luminance; pane Y 0.04–0.12 at 17:30 with a top-to-bottom gradient |
| punched window glass | 0.10 | 0 | never an opaque black card |
| corrugated / metal roof | 0.45 | 0.95 | neutral to cool tints only; a warm tint on a metal reflecting a blue sky comes back lilac |
| brick / plaster | 0.88 | — | |
| roof tiles | 0.78 | — | |
| concrete / kerb | 0.80 | — | |
| solar | 0.10 | — | |

Our palette roughness is mostly 0.8–0.95, with glass at 0.15–0.2. Fable's scene-level finding was that "65 % of
materials ≥ 0.7 is chalk". The same audit is worth running on ours (`kit-materials.ts` sets `metalness: 0` for
everything, including `metal`).

---

## 4. Function-level port list → our files

| # | Fable source (file#function) | Mayor target | Kind |
|---|---|---|---|
| 1 | `zoning/ZoneGrid.js#_blocked`, `#_occupied`, `#_rasterise` (node stamp) | `src/sim/zoneblocks.ts applyValidity` (9-point sampling, node keep-out) | algorithm, analytic instead of a raster |
| 2 | `ZoneGrid.js#_buildFrame` (trapezoid corners, `MIN_AREA_FRAC`) | `zoneblocks.ts cellCorners`, `blocksForSegment` | geometry |
| 3 | `ZoneGrid.js#_resolveConflicts`, `#_better` | `zoneblocks.ts resolveOverlaps` (replaces `loser`) | algorithm |
| 4 | `ZoneGrid.js#rebuildLots` (DP, `wantAt` seeding), `#_makeLot` (key) | `src/sim/orientedlots.ts planOrientedLots` (new packer after the persistence pass) | algorithm |
| 5 | `ZoneGrid.js#_computeAdjacency`, `#_computeZoneEdges` | `zoneblocks.ts` (optional: neighbour masks for overlay outlines) | optional |
| 6 | `buildings/lots.js#lotsOverlap` (SAT + pad) | `src/sim/orientedlots.ts checkLots()` test oracle | verbatim |
| 7 | `zoning/GroundPlan.js#planLot`, `Bands`, `backfillFor` | new `src/sim/lotground.ts` → rendered in `scene.ts` lot block via `plot-material.ts` | verbatim, units ÷8 |
| 8 | `buildings/index.js#siteLevel`, `#lotCorners` | `src/render/lots.ts siteLevel()` (pure) used by `scene.ts placeLotCell` and `padY` | algorithm |
| 9 | `buildings/facadeShader.js#bayLayout`, `#dockLayout`, `#doorCentre` | new `src/render/facade.ts` + a Python twin in `blender/lib.py` | verbatim |
| 10 | `facadeShader.js` night-light block (lines 664–681) | `src/render/kit-materials.ts` `glow_window*` `onBeforeCompile` + `windowLight()` CPU mirror | GLSL |
| 11 | `facadeShader.js` FACADE_VERT + FACADE_FRAG (grid, styles, blinds, sills, plinth, flat roof, LOD dissolve; **without** parallax, sun shadow or sky dome) | new `src/render/facade-material.ts` for procedural boxes | GLSL lite |
| 12 | `buildings/geometry.js` gable/hip/wedge | new `src/render/procgeo.ts` | verbatim |
| 13 | `buildings/generators.js#house`, `#apartment`, `#shop`, `#mixed`, `#office`, `#industrial`, `#crown`, `#bulkhead`, `#rooftopUnits`, `#beaconLamp`, `#awning` | new `src/render/procbuildings.ts` | port + trim |
| 14 | `generators.js#constructionMass`, `#constructionDetail` | `procbuildings.ts constructionParts` + sim progress | port + trim |
| 15 | `buildings/renderer.js` Pool / BuildingRenderer | new `src/render/procbuildings-renderer.ts` (alloc-free, uses `lod.ts`) | rewrite |
| 16 | `generators.js` tint tables (PLASTER/SIDING/MODERN/GLASS/CORRUGATED/SHINGLE/TILE/FASCIA/DOOR) | `blender/lib.py PALETTE` + `procbuildings.ts` | data |
| 17 | `demo/Landmarks.js#decoTower`, `#roundTower`, `#twinTowers` | `blender/buildings_zz_hero.py` (recipe ideas only: setbacks ×0.80 per step with cornices, banded round tower, twins + skybridge) | inspiration, not code |

---

## 5. What to skip

- **Parallax reveal, sun-directional sill shadows, analytic sky dome, `patchGlassSky` / `patchMetalSky`, CSM / GTAO
  hooks.** These are desktop-class ALU and rely on fable's engine hooks. Revisit only for a desktop "ultra" tier.
- **ZoneOverlay HDR multiply blend** (`dst·(1+src)`). It needs a linear HDR composer, which we do not have, and fable's
  own critic found it invisible at night. Its line hierarchy is worth copying if we touch the overlay: cell seams quiet,
  parcel borders mid, zone boundaries strong, white reserved for the frontage bar and cursors, lines fading by distance
  160–420 m (20–52 tiles).
- **Growth pacing** (`BUILD_HOURS`, `STARTER_RATE`, `MEAN_FILL_HOURS`, level-up odds). Mayor's sim has its own demand
  model.
- **Info-view tint**, `aTint`. We have our own.
- **Landmarks / DistrictGround as code.** They are demo-layout specific (reserved grid blocks, `g.L(u, v)`); the
  per-lot GroundPlan supersedes DistrictGround. Keep only DistrictGround's idea of paved areas 0.17 m proud with a kerb
  skirt (0.021 tile).
- **ZoneGround mid-block backfill** (3 m claim raster, `BACK_MAX` 27 m). Defer until P-Z5 lands and the gaps are
  measured.
- **`facadeTex.js` canvas textures.** The per-window shader rule is strictly better.
- **Minimum lot 2×2 / minimum run 2.** This is a gameplay difference; Mayor keeps 1×1.
- **Fable's fallback `lots.js generateLots`** as a planner. We have zoning. Keep only `lotsOverlap` as a test oracle.

---

## 6. Risks

1. **Scale (highest).** Roads and lots are true scale (8 m tiles), but our building kit is miniature: storey
   0.20–0.27 tile, doors 0.06 × 0.10 tile, which is ≈ 0.45–0.75× real.
   - Literal ÷8 conversion makes procedural buildings 1.5–2× taller than neighbouring GLBs.
   - Lead decisions needed:
     - R1: `KIT_STOREY` (proposed 0.25) and the `KIT` detail factor (proposed 0.6).
     - R2: level → floors table re-pinned under the 2.6 / 4.2-tile caps.
   - Pin both in a unit test.
2. **iPad budget.** Fable's city is 5–7.8 M triangles and 1 300–1 550 draw calls (its own budget is ≤ 8 M / 2 500).
   - Every procedural building must pass the same ≤ 1 400-triangle test as the GLBs.
   - Pools must be ≤ ~30 draw calls.
   - Detail streaming must be allocation-free (fable's `refreshDetail` allocates and sorts per refresh).
   - Rule 4 says rebuild < 10 ms at 96².
3. **Two visual languages on one street.** Procedural masses next to hand-built GLBs may clash in palette, texture
   scale and window style. Mitigation: palette and `bayLayout` changes land in Blender first (B-tasks); the procedural
   path is behind `?procBuildings=1` until a side-by-side screenshot pass.
4. **Rule conflicts.** `AGENTS.md` rule 7 and the skill say buildings are Blender models. A TS generator needs an
   explicit rule amendment: same contract (base y = 0, inside the lot, front +z, ≤ 1 400 tris per building, `glow_*`
   windows, determinism).
5. **Fable is not a gold standard.** Its own critic failed buildings at 7.0 (p5) and 6.5 (w2), and zoning at 6.0–6.5.
   - Buildings: hero-skyline glass invisible, flat facades.
   - Zoning: overlay invisible at night, ground crushed to black, 51 % of painted cells unlotted before the DP packer.
   - Port mechanisms and numbers, not their look as "done". Rule 11 still requires our own day/night hard-case
     screenshots.
6. **Determinism.** Fable generators use module-global mutable state (`CUR`, `GROUND`) and a shared growth rng. Port as
   pure functions with an explicit context; seed with `hash(lot.id, level)`. Lot ids are stable through the `keep`
   pass.
7. **Order dependence in our overlap resolution** (`loser` pairwise) is a latent bug. Fixing it (P-Z3) can change which
   cells are valid in existing saves. `migrateCells` must keep zones, and it needs a migration test on a v2 fixture.
8. **Save format.** Only construction progress (B6) touches saves. It must be an optional field, validated in
   `save.ts`, with old saves loading at progress 1 (rule 3).
9. **Shader cost.** The facade-lite shader adds fwidth, hashing and value noise per fragment on every procedural wall.
   Measure on the iPad and give the low tier a cheaper branch (grid + night only).
10. **License hygiene.** The NOTICE entry and per-file headers go into the same patch as the first ported function.

---

## 7. MIT attribution

Add to `NOTICE.md`, next to the junction entry proposed in 08 §6, or merged with it as one Fable Cities section:

```markdown
## Fable Cities (MIT)

Parts of Mayor's zoning grid and lot planner (`src/sim/zoneblocks.ts`, `src/sim/orientedlots.ts`), lot ground plans
(`src/sim/lotground.ts`), facade layout and night-light shading (`src/render/facade.ts`,
`src/render/facade-material.ts`, `src/render/kit-materials.ts`), procedural building recipes and construction sites
(`src/render/procbuildings.ts`, `src/render/procgeo.ts`), and the window/roof recipes in `blender/lib.py` are adapted
from **Fable Cities**, https://github.com/rawprogress/fable-cities (commit aea8b10), translated from JavaScript to
TypeScript/Python and rescaled from metres to Mayor tiles.

MIT License

Copyright (c) 2026 raw (github.com/rawprogress)

<full permission notice and disclaimer copied verbatim from /tmp/gh-refs/fable-cities/LICENSE>
```

Per-file header:
`// Portions adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10): <file>#<function>`.
In Python, use the same text after `#`.

Copy the license body from the LICENSE file at apply time, not from a report. Only list the files a patch actually
touches.

---

## 8. Prioritized tasks (one contributor agent each)

Each task works in its own worktree and must cite `.claude/skills/mayor-visual-quality/SKILL.md` and this report. The
gate is `npx tsc --noEmit` and `npx vitest run` green. Visual tasks end with the lead's day and night screenshots of the
hard cases (diagonal street, curve, T and acute junction, dead end, slope). Effort is in agent-days.

### Wave 1: zoning correctness (sim only, Codex)

**Z1 · Cell rejection against footprints and junctions** (0.5 d). Owns `src/sim/zoneblocks.ts` `applyValidity` and
`zoneblocks.test.ts`.

- Sample 9 points per cell: centre; corners and edge midpoints pulled 7 % toward the centre.
- Reject a cell when any sample is within `drawHalf + sidewalk + 0.075` of another ground segment's centreline, or
  inside a node disc `maxDrawHalf + cornerRadius + sidewalk` at nodes with ≥ 3 arms.
- Corner water test.
- **Tests:**
  - 45° street crossing an axis street: no valid cell corner inside either asphalt (point-to-centreline distance ≥
    drawHalf for all 4 corners of every valid cell);
  - T-junction: no valid cell within the node disc;
  - perf: 2 000 segments on 128² < 15 ms (existing budget);
  - existing `blocks.test.ts` axis-aligned parity still passes.

**Z2 · Trapezoid cells on curves** (0.5 d). Owns `zoneblocks.ts` `cellCorners`, `blocksForSegment`, and the frame
storing edge tangents at `s0 + row ± 0.5`.

- Drop cells whose signed area is < 0.42 and stop the column there.
- `lotCorners` (`orientedlots.ts`) uses the same corners.
- **Tests:**
  - adjacent cells in a row share their edge within 1e-3 on a quarter-circle street (no gaps);
  - inner-side cells of an R = 2 curve are dropped;
  - a straight street gives exactly the old unit squares (1e-6).

**Z3 · Priority overlap resolution** (0.5 d). Owns `zoneblocks.ts` `resolveOverlaps` and `loser`.

- Global sort `(col asc, roadWidth desc, age asc, side, row)`.
- Conflict = centre distance < 0.8, or point-in-quad either way.
- Frame neighbours exempt; 3 re-admission passes.
- **Tests:**
  - shuffling `w.segments` order produces byte-identical `valid` masks;
  - the T-junction block has no interior holes (every valid col-k cell has a valid col-(k−1) cell);
  - the CS1 corner-ownership test (05 §1.5) still holds;
  - migration of a v2 save fixture drops 0 zoned cells on axis-aligned roads.

**Z4 · DP lot packer with stable seeding** (1 d). Owns `src/sim/orientedlots.ts` `planOrientedLots` (after the
persistence pass) and `orientedlots.test.ts`.

- Per contiguous run of same zone and level front cells: DP over widths 1..4 maximising Σ `w·minDepth`.
- Per-zone preferred widths: RES L1 [1,2], RES L2–3 [2,3], COM [2,4], IND [3,4]. Penalty −1.2 outside the range;
  +0.6 for `want`, seeded by `(round(2x), round(2z), zone, worldSeed)` of the front-left cell.
- Resolve the `col > 0` 1×1 stranding: write a failing test first that proves it (`lotsReady` never includes those
  lots), then either merge the cells into the front lot (same zone) or drop them and expose `coverage`.
- **Tests:**
  - painting one extra cell at the far end of an 8-row block leaves the other lots' ids and shapes unchanged;
  - coverage = 1.0 on a fully zoned straight block;
  - no lot spans a yaw spread > 6°;
  - determinism;
  - `checkLots` (SAT from `lots.js#lotsOverlap`, pad 0) finds 0 lot-lot and 0 lot-road overlaps on the diagonal and
    curve fixtures.

### Wave 2: cheap visual wins

**V1 · Per-window night lights on GLB windows** (1 d). Owns `src/render/kit-materials.ts`, `kit-materials.test.ts` and
a new `src/render/window-light.ts`.

- Port §3.2.
- `windowLight(h, h2, night, litBias, office)` is a CPU mirror with the same constants as the GLSL chunk.
- Per-window id = hash(instance translation, local position quantised to 0.02 tile).
- Families by material suffix (`glow_window` defaults to litBias 0.6).
- **Tests:**
  - 0 % lit for night < 0.06;
  - lit fraction over 10 000 hashes at night = 1 equals `litBias·0.68 ± 0.02`;
  - monotone in night;
  - office floor coherence (≥ 70 % of panes on a floor share state);
  - colour table pinned.
- Lead checks 18:00 / 21:00 / 02:00.

**V2 · Blender facade and roof pass** (1.5 d, Muse spark-1.3; Codex fallback for the Python-only parts). Owns
`blender/lib.py` (`windows`, `door`, new `bay_layout`, `sill`, `plinth`, `roof_kit`), the palette re-tone, `PATTERN`
brick/plaster scales, and all panes as `glow_window[_family]`.

- Rebuild `public/models`.
- **Tests:**
  - `glb-assets.test.ts`: every building ≤ 1 400 tris and inside its tile (existing);
  - new: every residential/commercial building has ≥ 1 `glow_window*` material and no `glass_dark` on upper floors;
  - `build_all.py --strict` passes.
- Report: before/after preview grid (`docs/img/models`), day and night.

**V3 · Lot ground plans** (1 d). Owns a new `src/sim/lotground.ts` (+ test), the `scene.ts` lot block (ground rect
instances only) and `plot-material.ts` (4 surface tints, world-space UV).

- Port `planLot` and `Bands` with the §1.2 mapping.
- **Tests:**
  - for 1 000 random lots of every type, rects are disjoint (pairwise intersection area < 1e-9), lie inside
    `[0,w]×[0,d]`, and their area sum plus `NONE` area equals `w·d` within 1e-6;
  - no rect thinner than 0.044;
  - deterministic per lot id.
- Lift +0.025, under models at +0.04 (z-fight check in the visual pass).

**V4 · Site grading** (0.5 d). Owns `src/render/lots.ts siteLevel()` (+ test) and its use in `scene.ts placeLotCell`
and the pad.

- `y = max(frontY, (min+max)/2 − 0.025, water + 0.0875)`.
- Concrete plinth instance when spread > 0.0175 tile and `y − min > 0.1125`; plinth depth `y − min + 0.075`.
- **Tests:**
  - the building base is never below terrain at any lot corner;
  - never more than 0.1125 above without a plinth;
  - flat ground gives no plinth.

### Wave 3: procedural buildings (behind `?procBuildings=1`; lead decisions R1 and R2 first)

**B1 · Facade layout core + procgeo** (0.5 d). Owns new `src/render/facade.ts` (`bayLayout`, `dockLayout`,
`doorCentre`, `FACADE_TUNING` in tiles) and `src/render/procgeo.ts` (gable, hip, wedge unit geometries).

- **Tests:**
  - converted constants pinned;
  - `bayLayout` matches the fable formula on 50 widths;
  - unit geometries have base y = 0, span ±0.5, outward normals, and triangle counts box 12 / gable 8 / hip 6–8 /
    wedge 8.

**B2 · Recipe generator, low-rise** (1.5 d). Owns new `src/render/procbuildings.ts`: house, apartment, shop, crown,
bulkhead, rooftopUnits, awning.

- Pure: `(lotFrame{w,d}, zoneKind, level, seed) → {parts Float32Array, height, floors, main}`.
- **Tests:**
  - every part's OBB lies inside the lot rectangle shrunk by the front setback (≥ 0.1 tile) and side margins;
  - base y ≥ 0;
  - Σ triangles ≤ 1 400 for every generator × level × lot size 1..4 × 1..4 × 20 seeds;
  - height monotone non-decreasing in level (median over seeds);
  - no part below y = 0; determinism;
  - the door centre equals `doorCentre(faceW, bayW)`.

**B3 · Recipe generator, high-rise and industrial** (1.5 d). Owns `procbuildings.ts`: mixed, office (tiers), industrial
(docks on `dockLayout`), beaconLamp.

- Same tests as B2, plus:
  - tower height ≤ kit cap (2.6 or 4.2);
  - dock bumpers align with `dockLayout` centres within 1e-3;
  - crown kinds all reachable over seeds.

**B4 · Facade-lite material** (1.5 d). Owns new `src/render/facade-material.ts` (`onBeforeCompile` on
`MeshStandardMaterial`; instance attributes `aParams`/`aParams2`; GLSL for grid, styles, blinds, sills as colour only,
plinth, flat-roof parapet, LOD dissolve, night lights from V1).

- **Tests:**
  - a CPU mirror `facadeSample(u, v, faceW, faceH, params)` classifies wall / glass / frame / spandrel / door for pinned
    fixtures (curtain spandrel on the lower 32 %, house door on the middle bay of the front face only);
  - shader source contains no `texture2D` in a loop;
  - the low-tier define strips noise.
- Lead visual day and night.

**B5 · Procedural renderer + wiring** (1.5 d). Owns new `src/render/procbuildings-renderer.ts` (pools per
geometry × material, static mass tier, detail tier via `lod.ts bucketOrder`, scratch buffers) and the `scene.ts` lot
block branch for `w·d ≥ 4` lots under the flag.

- **Tests:**
  - instance counts for a fixture city are deterministic;
  - rebuild of 500 lots < 10 ms (Node timing);
  - zero allocations in `update()` (spy on `Array`/`Float32Array` constructors);
  - draw calls (pool count) ≤ 30.
- Lead: screenshots at game zoom and close up, day and night; side by side with GLB neighbours.

**B6 · Construction state** (1.5 d; sim + render).

- Sim: optional `OrientedLot.build?: number` (0..1) in `zonecells.ts`; set on level 0 → 1 and on level-up;
  progress advances in `step` over N days; validated in `save.ts`; old saves default to 1.
- Render: `constructionParts(main, progress)` from §2.1 (cores, plates every `KIT_STOREY`, scaffold, fence, crane when
  `main.h > 1.0` tile, work lights on `glow_lamp`).
- **Tests:**
  - an old save loads with every lot at `build = 1`;
  - progress is monotone and reaches 1;
  - construction parts stay inside the lot, except the crane, which stays within `max(w,d)` + 2 tiles;
  - triangles ≤ 1 400 (crane included).
- Lead visual.

### Lead-only items (0.5 d total)

| Item | What |
|---|---|
| R1 | `KIT_STOREY` and `KIT` factor |
| R2 | level → floors table under the 2.6 / 4.2-tile caps |
| R3 | `AGENTS.md` rule 7/11 + skill amendment for procedural buildings |
| R4 | the `NOTICE.md` entry, landed with the first port |
| R5 | whether 1-deep strips may stay (fable forbids) |

**Ordering.** Z1 → Z3 → Z4 (Z2 can run in parallel with Z1). V1 and V3 run in parallel with Wave 1. V2 waits for V1's
material-suffix contract. Wave 3 waits for R1/R2. B1 → B2/B3 → B4 → B5 → B6.

**Total:** about 4 agent-days for Wave 1 + 4 for Wave 2 + about 9.5 for Wave 3.

---

## 10-line summary

1. Fable's `ZoneGrid.js` (MIT) is the CS2 zoning model our 05 spec describes. Four pieces port cleanly into `zoneblocks.ts` and `orientedlots.ts`.
2. The four pieces: 9-point cell rejection against road footprints plus junction keep-out discs (`maxW/2 + 3 m` → `+0.375` tile); trapezoid curve cells with a 0.42-area cut; priority-ordered overlap resolution with second-chance passes; a DP lot packer seeded by world position.
3. Two findings in our code. Pairwise `loser()` overlap resolution depends on iteration order. And `col > 0` fallback lots never pass `lotsReady`, so they appear to strand zoned cells forever (confirm with a test first).
4. `GroundPlan.planLot` gives disjoint per-zone ground rects (plaza, parking bays, yards, driveways) that tile each lot exactly once. It is a pure, testable port that fixes "buildings on a golf course".
5. Units: plan quantities ÷ 8 (metres to tiles). Building heights must NOT be ÷ 8, because our kit is miniature (storey 0.20–0.27 tile, so ~0.45–0.75× real). Pin `KIT_STOREY` = 0.25 and a level → floors table under the 2.6 / 4.2-tile caps.
6. Fable's procedural buildings are deterministic recipes of instanced unit parts with good numbers (setbacks, floors, roofs, crowns, balconies, docks). At 5–7.8 M triangles and 1 300–1 550 draw calls they are not iPad-ready, and their own critic failed them at 7.0.
7. Port a trimmed TS generator only for multi-cell oriented lots (today a 2×2 clone cluster), behind `?procBuildings=1`, each building ≤ 1 400 tris, with alloc-free pools. 1×1 lots keep the Blender kit.
8. Biggest cheap win: the per-window night rule. `lit = hash < litBias·0.68·smoothstep(0.06, 0.42, night)`, with a warm/cool colour table, brightness 0.22–0.85 and floor-coherent offices, on our `glow_window` material. Today every lit window turns on together at one brightness.
9. Blender gains fable's `bayLayout`, per-style window boxes, sills and plinths, the roof kit (overhang, fascia, gutter, ridge), six crown archetypes, 2–3× finer brick/plaster repeats and a warmer, darker palette (lit Y ≈ 0.18, hue 30–55°, S 0.2–0.4).
10. Skip the parallax reveal, sky dome, HDR overlay, growth pacing, landmarks and backfill. Add the MIT NOTICE with the first port. Effort is about 17 agent-days over 3 waves (Z1–Z4, V1–V4, B1–B6), with lead decisions R1–R5 gating the procedural wave.
