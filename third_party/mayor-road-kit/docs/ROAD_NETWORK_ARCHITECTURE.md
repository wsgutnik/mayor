# MAYOR — road system v2: project architecture

## Existing game (verified read-only in GitHub on Oct 12, 2026)

- `cities-skylines-2/src/sim/world.ts`: `RoadSegment`, rasterization, three classes (street/avenue/highway), up to 3 grid tiles wide. Road class raster is the source of collision, access, connectivity, and simplified traffic.
- `cities-skylines-2/src/render/scene.ts`: ribbon-geometry roads, rebuilt on any changed `world.revision` along with terrain/buildings; no imported road GLBs, no rendered bridges/overpasses.
- `cities-skylines-2/src/sim/sim.ts`: `planRoad` rejects paths over water; bulldozing a road deletes full intersecting stored segments. Changes need tests.
- `cities-skylines-2/src/sim/traffic.ts`: A* pathfinding uses 4-neighbour tile graph, not directional lane graph. Speed by road class; network junction rules are not expressed.

**Keep the proven legacy simulation while replacing the surface visuals and networking incrementally.** Do not drop in a GLB and assume the traffic or grade separation is solved.

## Recommended layers

1. **Geometric network**: vertices/edges with lane-direction graphs, elevation and splines. Each edge refers to a `profileId`, local control points, road elevation mode (`ground`, `bridge`, `tunnel`) and material variants.
2. **Topology**: endpoints snap to nodes; intersections split edges; connected 2D paths at *different elevations never join*. Implement node and edge ID persistence.
3. **Surface mesher**: sweep profile along 3D spline with bevels, roadbed, curbs, sidewalks, markings and guardrails. For static junctions use parameterised patch triangulation. Blend in the provided GLB modular pieces for prototypes and endpoints.
4. **Per-lane routing**: directed lane IDs, turn connectors, yield rules, signal phase and movement restrictions. Vehicle pathfinding on the lane graph, not uniformly on a tile raster.
5. **Legacy adapter**: rasterise right-of-way and access into `world.road` for existing zoning/civic sim; convert/retain old road segments for backward-compatible saves.
6. **Render/GPU**: reuse GLB geometry and materials with `InstancedMesh` where a repeated straight prefab is appropriate; generate curves/intersections in runtime geometry; separate dirty revisions `terrainRevision`, `networkRevision`, `buildingsRevision`, `overlayRevision`.

## Data sketch

```ts
type ElevationMode = 'ground'|'bridge'|'tunnel';
interface RoadProfile {
  id: string;
  laneWidthM: number;
  forward: number;
  backward: number;
  sidewalkM: number;
  medianM: number;
  permitted: ('car'|'bus'|'tram'|'bicycle'|'pedestrian'|'service')[];
}
interface RoadEdge {
  id: string;
  a: string;
  b: string;
  profileId: string;
  controlXZ: { x: number; z: number; y: number }[];
  elevation: ElevationMode;
  speedKph: number;
}
interface LaneLink { fromLaneId: string; toLaneId: string; cost: number; allowed: boolean }
```

## Suggested implementation gates

- Phase A: add `roadProfiles.ts`, profile/tested geometry metadata, and visual modular pieces from `public/models/roads/*.glb`, preserving legacy roads. Test a straight and 90° curve in engine.
- Phase B: break segments at crossing nodes, add `snapping` and preview of grades; fix bulldoze to delete only the targeted subsegment and preserve other connected paths.
- Phase C: pedestrian crossings, turn lanes, traffic lights, give-way, bus and bike lanes; introduce per-lane routing.
- Phase D: bridge/overpass/tunnel (allow crossing above water when bridge mode), validate support and ramp gradients, avoid accidental grade-separated connections.
- Phase E: LOD/mesh-batching, moving signals, improved terrain cuts, island routes and route selection analytics.

## Visual / Blender contract

- Asset source: 38 original low-poly GLBs in this kit, coordinates **glTF Y-up**, unit 1 = **1 metre**. Blender importer converts them to **Blender Z-up**.
- Standard straight prefab length is **20 m**; highways typically 30 m. Profile widths vary; consult `manifest.json` rather than assuming a fixed 10 m tile.
- Asset local origin at centre of road segment; metadata `connections` are **Y-up** local anchors. GLB mesh geometry will not snap to an arbitrary world spline without transformation or procedural sweeping.
- MAYOR's current simulation uses approx 1 tile world unit as an abstract unit; **do not** assume 1 tile = 1 metre. Introduce `metresPerTile` as a central constant and scale geometry uniformly.
- Source textures: pack uses **procedural vertex colours**, no third-party PBR content. Optional CC0 texture upgrades from Poly Haven/ambientCG.

## Suggested repository destinations

```
cities-skylines-2/
  art/roads/blender/                  # source .blend (generated on local Blender)
  art/roads/catalog/manifest.json
  public/models/roads/*.glb         # asset runtime preview; subset after optimising
  src/render/road-mesh.ts            # future spline mesher
  src/sim/road-network.ts            # future lanes/nodes/topology
  src/sim/road-network.test.ts
  docs/ROAD-ART-PIPELINE.md
```

## Non-negotiable tests

- straight / curve / T / 4-way at correct node positions, no loose ends
- disjoint overpass intersections at different elevations
- zoning and service access near roads, but never across a disconnected bridge
- save/load roundtrip with legacy v1 road network and new versioned road graph
- bulldozing one half does not erase unrelated sections or leave floating transit stops
- traffic routing obeys directed lanes, U-turn rules, pedestrian crossings, capacity
- iPad benchmark at 128² and 256² under dynamic building growth
