# 03 — Execution Plan: M16 to M22

Updated on 2026-10-12. The order is chosen so each milestone improves the game on its own and opens the next one: first the road network gains nodes (everything else hangs from them), then blocks/lots (depend on segment sides), then underground (depends on network and lots to know who is connected), then water, rendering, and road types/props. Owners: **lead** = Claude (code), **Muse** = Blender assets/textures, **Codex** = tests and review.

Rules for every milestone: simulation stays pure and deterministic (`src/sim`, vitest); renderer only reads state; iPad is the minimum target (instancing, no post-processing outside `high` tier); every milestone closes with a screenshot in `docs/img/` and republication of `docs/mayor-status.html` (the ritual from `PLAN.md`).

---

## M16 — Node Road Network and Intersection Geometry

**Goal.** Corners, intersections, and road ends with their own mesh: continuous asphalt, curb turning the corner with radius, continuous sidewalk, crosswalk and stop line at the curb line, no z-fighting. Solves G1, G2, G3, G20.

**Technical approach.**
1. `src/sim/roads.ts` (new): `RoadNode { id, x, z, segs: number[] }`; `RoadSegment` gains `a: nodeId, b: nodeId` while keeping `pts` and `tiles`. `addSegment(w, type, pts)` snaps endpoints to an existing node (radius 0.6) or to a segment point (split into two segments at the closest curve point, new node); `removeSegment` merges degree-2 nodes when both sides have the same class. `nodeArms(w, node)` returns arms sorted by angle with class `halfWidth` (`ROAD_DRAW_WIDTH/2`) and endpoint tangent (Bézier derivative).
2. Paint mode (`applyTool("road")`) accumulates dragged tiles and, on `pointerup`, calls `placeRoad` with a simplified polyline (Douglas-Peucker, tolerance 0.3) instead of one segment per tile.
3. `src/render/roads.ts` (new, extracted from `buildRoadGeometry`): each segment ribbon is shortened to `cornerOffset = max(neighbor arm halfWidth) + radius`; each node with degree ≥ 2 gets an asphalt polygon from arm-edge intersections; curb fillet between consecutive arms with `r = 0.25` (street) / `0.4` (avenue), 6 segments; sidewalk as parallel strip to the fillet; degree 1 = cul-de-sac (semicircle); degree 2 with different classes = transition. Crosswalk and stop line per arm, at `halfWidth` from node center, only on degree ≥ 3 nodes and street/avenue arms. One `lift = 0.06` for the whole network; markings at `+0.004`.
4. Materials: asphalt and sidewalk as `MeshStandardMaterial` with `map` + `normalMap` (Muse), UV by meter along the ribbon (`u = distance / 8`, transverse `v` 0..1) so asphalt does not swim on curves.
5. `connected`/traffic stay tile-based in this milestone (no rule change); `traffic.ts` reads `segment.a/b` only to orient cars at nodes (smoothed heading).

**Acceptance criteria.**
- A cross, a T, and a 90° street curve show continuous asphalt, curved curb on all corners, and sidewalk without holes; rotating the camera shows no flicker in any intersection.
- Crosswalk sits exactly between the two curbs of the arm, ≤ 0.1 u from the node line; a T has three crosswalks.
- Loose road end finishes in a cul-de-sac; street meeting avenue transitions without a step.
- Painting 12 dragged tiles creates 1 segment (inspect `world.segments.length`), not 12.
- `npm test`: deterministic snap/split/merge; removed segments leave no orphan node.

**Owner.** lead (data and geometry), Muse (1024 asphalt/sidewalk textures with normal, node props: traffic light, stop sign — used in M21), Codex (`roads.ts` tests and render `roads.ts` review). **Depends on:** —.

---

## M17 — Blocks and Lots (zone blocks)

**Goal.** Zoning only within ≤ 4 cells of a zoneable road, grid aligned to the segment, 1×1, 2×1, and 2×2 lots facing the road, resolved corners, backs meeting in the middle of the block. Solves G5, G6, G7.

**Technical approach.**
1. `src/sim/zoning.ts` (new): `buildZoneBlocks(w)` generates cells per street/avenue segment and side `(cx, cz, side, depthIdx 0..3, segId)` following the curve (samples every 1 u, normal to tangent). Rasterizes to `zoneable: Uint8Array` (bit per tile; side/owning segment = closest; tie = higher class, then lower id). Recomputed when `segments` changes. Tile with road or facility is never zoneable.
2. `applyTool(res|com|ind)` refuses tile outside `zoneable` ("Zona precisa estar a até 4 quarteirões de uma rua" / "Zone must be within 4 blocks of a road"). Marquee drag paints rectangle ∩ `zoneable`.
3. `Lot { id, x, y, w, d, front: 0..3, zone, level, variant }` in `World.lots`; `growLots(w)` tries 2×2 → 2×1 → 1×1 for zoned tiles without lots, with front on the depth-0 tile of the owning block; corner lot chooses the higher-class arm. `level`, `CAPACITY`, `USAGE` sum by lot × area. Per-tile `zone`/`level` remain derived mirrors for infoviews, saves, and existing tests.
4. Catalog (`src/sim/catalog.ts`): `footprint: [w, d]`; `zoneEntries(z, l, footprint)`.
5. Render: `zones` becomes block-grid mesh (0.03 lines + alpha 0.35 fill, color by zone) in `src/render/zones.ts`; building centered on lot and rotated by `front`; `placeModel` receives the lot. Lot pieces (lawn, fence, garage, parking spot) as instances per lot.
6. Save: `lots` serialized; old saves migrate by creating 1×1 lots from tiles with `level > 0`.

**Acceptance criteria.**
- Painting a zone 6 tiles from any road is refused with a message; 4 tiles is accepted.
- On a straight road with 8 tiles of depth on each side, cells appear as a grid attached to the road; on a curved road the grid follows the curve without 1-tile stair-stepping.
- 10×10 block with surrounding roads: 4 cells per side zoned, 2×2 middle not zoneable.
- After 60 days with demand > 0, 2×2 lots exist (`world.lots.filter(l => l.w === 2)`), with model facing the frontage road; corner lot between street and avenue faces the avenue.
- `npm test`: `buildZoneBlocks` coverage (straight, curve, T, corner), deterministic `growLots`, save migration.

**Owner.** lead+muse (lead: sim/render; Muse: 2×2 models for R2/R3/C2/I2 inside 2×2 u, lot pieces). Codex: tests and review. **Depends on:** M16.

---

## M18 — Water/Sewage/Power Networks and Underground View

**Goal.** Real pipes and cables under roads (CS2 model), manual facility-to-network connection, coverage by pipe distance (≤ 11 tiles, CS1), and an underground mode (V key / button) that shows it all. Solves G8, G9, G10.

**Technical approach.**
1. `src/sim/utilities.ts` (new): `pipes: Uint8Array` per tile, bits `PIPE_WATER | PIPE_POWER` (sewage uses the water network, as in CS1). Building street/avenue gives both bits to segment tiles; highway only power. New "Cano" (Pipe) and "Linha de energia" (Power line) tools (₡20/tile) paint bits on tiles without road.
2. `updateCoverage`: for POWER/WATER/SEWAGE, BFS over network tiles from facilities (pump, water tower, power plant, substation, sewage outlet); reached network tiles are `energized/watered`; building/lot covered if any tile is Chebyshev distance ≤ 11 (water) or adjacent to energized tile/lot (power building-to-building, radius 2). Supply/demand stays as is. Civic services remain radius-based in this milestone.
3. Render `src/render/underground.ts`: `underground` mode in `CityRenderer`: terrain as dark translucent clone (`transparent, opacity 0.35, color 0x1b2230, depthWrite false`); buildings/trees/vehicles hidden; roads opacity 0.4. Pipes = `InstancedMesh` cylinders (r 0.08) per tile + spherical junction, colors water `#2ea8e8`, power `#f2c230`; reached tiles glow (emissive), unreached gray. Utility facilities remain visible with halo. Muse pieces replace cylinders when loaded.
4. HUD: "Subsolo" (Underground) button beside Infoview, V key; opening water or power infoview enters the mode automatically; coverage painted on roads (green/gray) and buildings (blue = connected) instead of tile carpet.
5. Save: `pipes` serialized; old saves generate bits from `road`.

**Acceptance criteria.**
- Pump 6 tiles from road without pipe: buildings have no water; drawing pipe to road connects all within ≤ 11 tiles of any network tile.
- V key: translucent terrain, pipes under all roads, manual pipe visible, buildings hidden; V again returns.
- Cutting a road in the middle: the half without pump turns gray underground and buildings lose water within ≤ 2 days.
- 60 fps on iPad in underground mode with a city of 2,000 road tiles (instances ≤ 4,000).
- `npm test`: network BFS, distance 11, save migration, unchanged demand/supply.

**Owner.** lead (sim/render/HUD), Muse (underground and utility pieces already in production), Codex (`utilities.ts` tests, review). **Depends on:** M16, M17.

---

## M19 — Water with Continuous Shoreline, Normals, and Reflection

**Goal.** Shoreline follows terrain (no tile jaggies), color by depth, sun specular, sky reflection by Fresnel, foam only on shores and rapids, wet/darkened terrain under water. Solves G16, G17, G18.

**Technical approach.**
1. `src/render/water.ts`: `uHeight` = `(size+1)²` float (or normalized RG16) `DataTexture` from `heights` corners, bilinear; in fragment `depth = 0.0 - h(x,z)`; `alpha = smoothstep(0, 0.12, depth) * 0.95`; `foam = (1 - smoothstep(0, 0.2, depth)) * noise + strength * crest`. Per-tile mask disappears.
2. Normals: two tileable 512 normal maps (Muse) scrolled by existing flow field (`info.gb`) with current two-phase crossfade; `N = normalize(n0 + n1)`; Blinn-Phong with real `uSunDir` from `setAtmosphere`, `shininess 160`; Fresnel Schlick with `uSky`; `high` + desktop: planar reflection (512 render target) mixed by Fresnel; lower tiers: sky only.
3. Terrain: `MeshStandardMaterial` with `onBeforeCompile` tinting `h < 0` (sand → `#2b4a3a` at 2 u) and painting a wet band for `0 < h < 0.25`.
4. `isLand`/shore correction: no sim change; render stops depending on per-tile `wet`.

**Acceptance criteria.**
- Medium-zoom lake screenshot: continuous outline without steps; foam band only on shallow edge.
- Day cycle: sun glint tracks sun position and disappears at night.
- River biome: foam and normals follow flow; still lake has no foam in the middle.
- iPad: ≥ 55 fps with water filling the screen in `medium`; Mac `high` turns on reflection and shows reflected buildings.

**Owner.** lead (shaders), Muse (tileable 512 normal maps, foam texture), Codex (performance and `buildWaterInfo` review). **Depends on:** —.

---

## M20 — Lighting, Materials, Terrain, LOD, and Quality Tiers

**Goal.** Rendering with shadows, tone mapping, high-density textures, layered terrain, and LOD, with three tiers that actually change cost. Solves G11-G15, G19.

**Technical approach.** `src/render/lighting.ts` sets `ACESFilmic`, `SRGB`, one directional shadow cascade following `rig.target` (1024 medium / 2048 high, none on low), and a sky dome. Terrain/roads move to `MeshStandardMaterial`; Muse provides 512 window atlas and 1024 detail maps; max anisotropy. `src/render/terrain.ts` uses a `2n × 2n` mesh with 4 layers (grass, sand, rock, pavement) by height/slope + masks from roads/lots. LOD1 exported by Blender (`--lod`, ≤ 100 tris, texture 128) becomes a second `InstancedMesh`; distance split at `> 45 u`, tree billboard in LOD1, 16×16 chunks. `revision` becomes `{terrain, roads, lots, utilities}`. `QUALITY_PROFILE` controls shadow/MSAA/LOD/vegetation/SSAO.

**Acceptance criteria.** Noon buildings cast shadows; evening shadows lengthen; `low` has no shadow. Close facade zoom shows crisp brick/asphalt on iPad 2× DPR. Terrain has sand only at shore, rock on slopes > 35°, pavement around sidewalks and lots. At 80 u, `renderer.info.render.triangles` drops ≥ 50% versus no LOD; 3,000-lot city: iPad `medium` ≥ 45 fps, Mac `high` ≥ 60 fps. Painting 1 zone does not rebuild roads.

**Owner.** lead+muse (Muse: detail maps, window atlas, LOD export in `build_all.py --lod`), Codex (benchmark and review). **Depends on:** M16, M17.

---

## M21 — Road Types, One-Way, Roundabout, Traffic Lights, and Sidewalk Props

**Goal.** CS road vocabulary: 2-lane street, 4-lane avenue with median, highway with barrier and ramps, one-way, roundabout tool, traffic light/stop sign by class rule, poles, hydrants, benches, and sidewalk trees attached to segment. Solves G4, G21.

**Technical approach.** `RoadSegment.oneWay?: boolean` (a→b); `lanes` by class in `src/sim/roads.ts`; `traffic.ts` respects one-way in A* and uses lanes for offset. Node gets `trafficLight` when ≥ 1 arm is avenue and degree ≥ 3, `stopSign` on street arms entering avenue. "Rotatória" (Roundabout) tool radius 2/3 u creates 4 one-way street arc segments and connects existing arms. `laneProps`: pole every 6 u alternating sides, tree every 4 u on "rua arborizada" (tree-lined street), hydrant every 12 u, bench near park; instantiated in `src/render/props.ts`. Upgrade tool changes segment class while keeping nodes.

**Acceptance criteria.** One-way street drawn A to B: cars only A→B; A* does not use reverse edge. Street × avenue: traffic lights on 4 corners and stop sign on street; street × street: none. 4-arm roundabout works with correct circulation and no crosswalk inside the ring. Avenue has median and double poles; tree-lined street has trees every 4 u that affect lots within 1 tile.

**Owner.** lead, Muse (traffic light, sign, barrier, median, street trees — already in production), Codex (one-way A* tests). **Depends on:** M16, M20.

---

## M22 — Scene Polish: Vegetation, Districts, and Camera

**Goal.** Close the "Cities: Skylines" feel: grass cards near the camera, district borders, lower orbit camera with terrain collision, rain-wet asphalt, and final screenshot review of `docs/img/` against `screenshots/`.

**Technical approach.** Instanced grass (crossed cards, 2,000 instances within 20 u of target, `medium+` only); `districts: Uint8Array` + district painting with line border on terrain; `camera.ts` minimum pitch 0.15 with minimum height over terrain; asphalt lower `roughness` in rain. No new sim except `districts`.

**Acceptance criteria.** Screenshot comparable to `screenshots/steam-0x.jpg` at low framing; grass visible only nearby; unchanged FPS on `low`.

**Owner.** lead+muse, Codex (review). **Depends on:** M20, M21.

---

## Order Summary and What the User Sees First

| Milestone | Visible delivery | Complaint addressed |
|---|---|---|
| M16 | Real corners and intersections | roads without corners |
| M17 | Zoning grid attached to road, 2×2 lots facing the road | blocks |
| M18 | Pipes/cables and V key | underground view |
| M19 | Smooth-shore water, sun glint, and reflection | water |
| M20 | Shadows, 1024 textures, layered terrain, LOD | weak rendering |
| M21 | One-way, roundabout, traffic lights, poles/trees | roads (complement) |
| M22 | Grass, districts, low camera | polish |
