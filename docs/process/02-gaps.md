# 02 — Gaps: Mayor (M15) × reference

Updated on 2026-10-12. Each item says what the code does today (read from code, not assumed; `src/` file:line), what the reference does (see `01-research.md`), and the fix. Priority: high = explains one of the five review complaints.

## The Five Complaints and the Gaps That Explain Them

| Complaint | Gaps |
|---|---|
| Roads without corners (intersections, curves, sidewalks) | G1, G2, G3, G4 |
| Poorly structured blocks | G5, G6, G7 |
| Weak rendering | G11, G12, G13, G14, G15 |
| No underground view | G8, G9, G10 |
| Odd-looking water | G16, G17, G18 |

## Roads

**G1 — There is no node; only overlapping segments** (high)
- Observed: `World.segments: RoadSegment[]` with `pts` (2 or 3 points) and `tiles` (`src/sim/world.ts:82-91`); `rebuildRoadRaster` writes only class per tile (`world.ts:432`). Connectivity is 4-neighbor BFS over tiles (`world.ts:253`). A segment touching another is not split and does not gain a node; `placeRoad` only pushes the segment to the list (`src/sim/sim.ts:221`).
- Reference: network = segments connected by nodes; node at each endpoint; the node owns intersection, traffic light, type transition, and road end (TM:PE, Road Editor).
- Fix: `nodes[] / segments[a,b]` graph, split segment on touch, node with arms sorted by angle.

**G2 — No intersection geometry; ribbons cross with disguised z-fighting** (high)
- Observed: `buildRoadGeometry` draws each segment as independent ribbons (asphalt, curb, lane) and gives each segment a `lift = 0.07 + (n % 7) * 0.002` so they do not fight on the GPU (`src/render/scene.ts:650-673`). In a T or cross, ribbons simply pass over each other; the curb of the continuing segment crosses the mouth of the incoming one. Road ends die straight, without a cul-de-sac.
- Reference: node has its own mesh (bent "straight stub"), one edge per side between sidewalks, sidewalk 0.3 u above asphalt, `Min Corner Offset` for corner radius (Road Editor).
- Fix: node mesh: asphalt polygon between arms, continuous curb with fillet between neighboring arms, sidewalk around the corner; segments shortened to node boundary; one `lift` for the whole network.

**G3 — Crosswalk by heuristic, not by node** (high)
- Observed: `touches()` searches for segments ±1 tile from the endpoint and draws crosswalks 0.8 from the segment end (`scene.ts:674-731`). In a T, the crosswalk on the continuing arm does not exist; with tile-by-tile painted roads, repeated crosswalks appear (`sim.ts:310`).
- Reference: crosswalk/stop line are part of the node; traffic light only where class asks for it (2 lanes never; 4 lanes almost always) (Roads wiki).
- Fix: crosswalk and stop line generated per node arm, on the curb line; traffic light/stop sign as node prop by class rule.

**G4 — Roads have no one-way, lanes, or road props** (medium)
- Observed: `ROAD = {STREET, AVENUE, HIGHWAY}` (`world.ts:70`); no direction; traffic uses fixed 0.12 offset for "lane" only in render (`scene.ts:910`). Poles every 4 street tiles by hash (`scene.ts:549-570`); no traffic light, sign, hydrant, sidewalk tree, parking.
- Reference: lanes with type (Vehicle/Pedestrian/Parking), lane props with `Repeat Distance`; one-way defined by drawing direction; parking on undecorated roads; roundabouts (Roads wiki, Road Editor, CS2).
- Fix: `lanes` by segment class; one-way; lane props (Muse already produces them); roundabout tool.

## Blocks and Lots

**G5 — Zone can be painted on any tile, with no depth** (high)
- Observed: `applyTool` only requires land, no road, and no facility on the tile (`sim.ts:311-319`); growth requires `isServed` = 4-neighbor of a connected road (`world.ts:276`, `sim.ts:439`). Result: a zone strip 1 tile from the road grows, but the player can paint a green carpet 10 tiles away, which never grows and is not a block.
- Reference: zoning grid appears with the road, only up to 4 cells (32 m) from the road, aligned to the segment (Zoning wiki, manual).
- Fix: `zoneable` mask (distance ≤ 4 from zoneable road, per segment side); tool only paints inside it; grid render per segment.

**G6 — Lot = 1 tile; no fronts, backs, corners, or sizes** (high)
- Observed: `zone/level` per tile (`world.ts:108-110`); render places one model per tile at center, scaled 0.92-1.12 by hash, `facing()` turns to the first adjacent road in +z, +x, -z, -x order (`scene.ts:588-610`). Catalog has no footprint (`src/sim/catalog.ts`). Blender models are "inside the tile" (`blender/README.md`).
- Reference: buildings 1×1 to 4×4 cells with front on road; corners belong to the owning segment block; households per cell (Zoning wiki, Asset Editor).
- Fix: `Lot {x,y,w,d,front,zone,level}` entity assembled from contiguous zoned tiles in the same block; growth by lot; catalog with `footprint`; Muse produces 2×2 and lot pieces (lawn, fence, garage, parking).

**G7 — Zone render is a floating square per tile** (medium)
- Observed: `zones` = `InstancedMesh` of 0.97 boxes with flat color at `h + 0.04 - 0.5` (`scene.ts:526-532`); does not show grid, distinguish empty lot from construction, or respect curved road.
- Reference: translucent cell grid beside the road, color by type/density, disappearing when a building appears.
- Fix: grid mesh per block (lines + alpha fill), generated from G5 grid.

## Underground and Utilities

**G8 — Services by radius; no pipe or cable network** (high)
- Observed: `updateCoverage` paints a bit by Euclidean radius (`world.ts:308-338`); pump/sewage only require water within ≤ 3 tiles (`sim.ts:291`). Nothing connects pump → building.
- Reference: single pipe network (₡20/cell), building served within ≤ 11 cells of pipe; power building-to-building over short distance + lines; CS2 puts pipes/cables under roads (Water_and_sewage, Electricity, CS2 Roads wiki).
- Fix: `pipes: Uint8Array` per tile (water/sewage/power bits), automatic under roads (CS2 model) + pipe/line tool to connect facility to network; coverage by BFS distance to pipe instead of radius.

**G9 — No underground view** (high)
- Observed: `setOverlay` only enables `overlay` (translucent boxes 0.02 high at `h + 0.12`) (`scene.ts:956-1001`); terrain and buildings stay opaque; there is nothing below ground to show. No key/button.
- Reference: Page Down / V / button next to bulldozer; Water info view shows pipes and currents; translucent terrain with roads as reference.
- Fix: `underground` mode: dark translucent terrain, buildings hidden or ghosted, roads kept at 40% alpha, pipes/cables as colored instanced tubes, pumps/outlets highlighted; V shortcut and HUD button; water/power infoviews open the mode.

**G10 — Infoviews paint tiles, not roads/buildings** (medium)
- Observed: coverage overlay is a carpet of tiles (`rebuildOverlay`), including over grass.
- Reference: coverage painted on roads (green/gray/red) and buildings (blue = connected) (manual, Info_views).
- Fix: color per road (road mesh instance) and per building (`instanceColor`) in infoview; carpet only for land value/pollution.

## Rendering

**G11 — No shadows, no tone mapping, Lambert** (high)
- Observed: no `castShadow`/`shadowMap` in `src/render`; `renderer.toneMapping` is not set (`NoToneMapping`); terrain and roads are `MeshLambertMaterial` with color multiplied 1.3/1.35 (`scene.ts:177, 450`); only `HemisphereLight` + `DirectionalLight` (`scene.ts:164-168`). Sky is a flat color (`scene.background`).
- Reference: CS has directional shadows, LOD, AA, optional DoF; physical lighting with building illumination map (Asset Editor, CS2 options guide).
- Fix: one-cascade directional shadow following camera target (1024/2048 by tier), `MeshStandardMaterial` for terrain/roads, `ACESFilmic` + `SRGBColorSpace`, sky dome with gradient and sun, `low` tier without shadow.

**G12 — 128 px textures and 64 px windows** (high)
- Observed: `public/textures/asphalt.png` and `grass.png` are 128 × 128, `brick.png` 256 × 256 (`blender/make_textures.py`); window atlas 64 × 64 (`src/render/models.ts:279`); grass repeats every 3 tiles (`scene.ts:453`); asphalt every 0.6 u (`scene.ts:645`).
- Reference: 1024² per building, 2048 × 1024 for large, LOD 128² (Asset Editor). User asked for "alta densidade de pixels" (high pixel density).
- Fix: Muse provides 512-1024 detail maps (albedo + normal + roughness) and 512 window atlas; `anisotropy` = device max; mipmaps; coherent repetition by meter (tile = 8 m).

**G13 — Terrain: 1 vertex per tile, color by height, no splat** (high)
- Observed: `PlaneGeometry(n, n, n, n)` (`scene.ts:441`), color by height band (`updateTerrain`, `scene.ts:456-476`), one grass texture; sand is only "h < 0.3". No normal map, no slope material transition, no sidewalk/pavement under buildings.
- Reference: terrain at 16 m resolution, but surface textures by type (grass, pavement, gravel, "ruining") with road `_p`/`_r` masks painting ground around it (Road Editor).
- Fix: terrain shader with 3-4 layers (grass, sand, rock, pavement) mixed by height/slope + mask painted by roads and lots; 2× subdivision near camera, or simply n×2 mesh (128² → 256² vertices is cheap).

**G14 — No LOD or triangle budget** (medium)
- Observed: one `InstancedMesh` per model, capacity `size² × 0.6` (`scene.ts:258`); every model is drawn in full at all distances; trees too; `frustumCulled = false` everywhere.
- Reference: LOD ≈100 tris per growable, billboard for trees, "Level of Detail" option (Asset Editor, CS2 options).
- Fix: two `InstancedMesh` per model (LOD0/LOD1), partition by distance to camera target on rebuild/zoom; tree billboard; 16 × 16 chunk culling.

**G15 — Quality = only pixel ratio** (medium)
- Observed: `QUALITY_PIXEL_CAP = {low: 1, medium: 1.5, high: 2}` (`src/prefs.ts:20`) and frame-time adaptation (`scene.ts:1046`). Nothing else changes between tiers.
- Fix: tier controls shadow (off/1024/2048), AA (MSAA 0/2/4), LOD distance, SSAO/bloom (desktop high only), vegetation density.

## Water

**G16 — Shoreline at tile resolution** (high)
- Observed: `buildWaterInfo` creates a `size × size` texture with `wet` mask per tile and depth `max(0,-h)/2.5` (`src/render/water.ts:5-46`); shader uses `smoothstep(0.2, 0.6, info.a)` and `discard` (`water.ts:108-109`). With `LinearFilter`, the edge becomes a blurred 1-tile step; screenshot shows jagged lake outlines.
- Reference: shoreline is the intersection of the water sheet with terrain (CS uses terrain at 16 m and its own water simulation resolution; visually the line is continuous).
- Fix: shader reads bilinear corner heightmap `(size+1)²` and computes `depth = waterLevel - h(x,z)` per fragment; alpha and foam come from depth, not mask.

**G17 — No normals, no reflection, "glint" without sun direction** (high)
- Observed: color = shallow/deep mix + value noise; "glint" is noise threshold times `uSun` (`water.ts:125-135`); no normal, Fresnel, sky/building reflection; plane opacity 0.9.
- Fix: two normal maps scrolled by flow field (Muse), Fresnel with sky color, Blinn-Phong specular with real `sun` direction, planar reflection only on high tier (desktop); depth controls transparency (0.55 shallow → 0.95 deep).

**G18 — Terrain under water and wet shore** (medium)
- Observed: terrain keeps grass/sand by height at any depth; no darkening or wet band; `isLand` requires corners ≥ 0.05, so there is a "near land" edge with light sand and shallow water without enough foam.
- Fix: in terrain shader, tint by depth (sand → dark green) and wet band 0.3 u above level; shore foam concentrated at `depth < 0.15`.

## Other Gaps Seen in Code (Not Directly Tied to Complaints)

- **G19 — Full rebuild on every revision** (medium): `rebuild()` rebuilds terrain, roads, and all instances (`scene.ts:478-585`) on every `revision`. With nodes/lots/underground this gets more expensive; needs separate revisions (terrain, roads, lots, underground). Already noted in `docs/REVIEW-codex.md` item 10.
- **G20 — Paint mode creates 1-tile segments** (medium): `applyTool("road")` calls `placeRoad` with two identical points (`sim.ts:310`); with nodes, every painted tile would become a node. Paint should become "line with grid snapping" or aggregate contiguous tiles into one segment.
- **G21 — Vegetation without ground variation** (low): trees by hash on free tiles (`scene.ts:500-525`); no tall grass, sidewalk beds, or street trees attached to roads.
