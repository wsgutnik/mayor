# Research: shared "road corridor" model for Mayor

Date 2026-10-13. Web content treated as data. Public documentation on Cities: Skylines (CS1/CS2) internals is thin: searches returned mostly forum posts, so CS facts below are marked [verified] only where a page said so, otherwise [anecdotal]. No repository file was edited.

## 0. Diagnosis in Mayor terms (from reading the code)

- `src/sim/roads.ts`: `kerbWidth()` (0.07/0.09) and `halfAsphalt() = ROAD_DRAW_WIDTH/2 - kerb` exist, and `nodeArms/NodeLayout/NodeCorner` already compute fillets for the mesh. So the road *mesh* has a corridor model, but nothing else consumes it.
- `src/sim/zoneblocks.ts:91` sets `lat0 = hw + 0.5` (centre of column 0). The first cell's front edge is therefore at `hw`, i.e. at the asphalt edge, not past kerb + sidewalk. That is the 0.05 tile overlap. Cells are rows of 1-tile cells in the segment frame, so interior cells (no frontage after neighbour clipping) and misaligned rows across junctions follow from per-segment frames with no junction polygon.
- Traffic routes on tiles, hence corner cutting. Props and kerbs each recompute `ROAD_DRAW_WIDTH`-derived offsets.

Root cause: no single owner of "where the road surface, kerb, sidewalk and buildable land begin and end". Fix: one derived `Corridor` structure, computed once per road-graph revision, read by mesh, lots, props and traffic.

## 1. Ranked sources

Licence column is what the page stated; confirm LICENSE file before vendoring anything.

| # | Source | URL | Licence | Borrow | Risk |
|---|---|---|---|---|---|
| 1 | godot-road-generator (TheDuckCow) | https://github.com/TheDuckCow/godot-road-generator | MIT | Data model: RoadPoint = cross-section (lane count, lane width, shoulders) interpolated between points; RoadSegment = unit of work; RoadLane = AI path generated per segment; separate edge/decoration curves (left/centre/right) for props; RoadIntersection built from connected points. Closest architectural match to what we want. | GDScript/Godot, intersection geometry docs thin; lane support at intersections listed "coming soon". Take the data model only. |
| 2 | Clipper2 TS ports (`clipper2-ts`, `clipper2-wasm`, `clipper2-js`) | npm, ports of Angus Johnson's Clipper2 | BSL-1.0 (clipper2-ts, clipper2-wasm verified in listing; clipper2-js unverified) | `inflatePaths` with JoinType round/miter + EndType for offset curves and fillets; intersection/difference for parcel clipping. Integer coordinates: scale by e.g. 1000 and round, which also gives determinism across machines. | Port quality and maintenance differ; third-party benchmark: wasm about 40% faster than TS. WASM complicates PWA/Tauri load; prefer pure TS (`clipper2-ts`) for determinism and iPad. BSL needs only licence text in distribution. |
| 3 | js-angusj-clipper | https://github.com/xaviergonz/js-angusj-clipper | MIT (wrapper) over Clipper 6 (BSL) | Same ops, WASM with asm.js fallback; offset about 0.2 s (wasm) for large benchmark sets. | Async init, extra payload, older Clipper 6. Second choice. |
| 4 | junmer/clipper-lib (JS port of Clipper 6) | https://github.com/junmer/clipper-lib | BSL-1.0 | Offsetting miter/square/round, pure JS, UMD. | No TS types mentioned; old. |
| 5 | polygon-clipping (mfogel) | https://github.com/mfogel/polygon-clipping | MIT | Robust boolean ops (union/intersection/difference/xor), handles touching rings, normalised output, loop guards. Good for "parcel minus corridor" checks and for tests. | Booleans only, no offset. Float coordinates: tolerance behaviour must be tested. |
| 6 | w8r/martinez | https://github.com/w8r/martinez | MIT | Same booleans, fastest in its own benchmark. | Self-reported benchmark; no offset. |
| 7 | ProbableTrain/MapGenerator | https://github.com/ProbableTrain/MapGenerator | LGPL-3.0 (README) | Ideas only: street graph to polygon (block) extraction, polygon shrink, lot subdivision by recursive splitting. TypeScript. | LGPL-3.0: do NOT copy into a closed Tauri bundle; read for algorithm outline, reimplement. |
| 8 | Citybound | https://github.com/citybound/citybound | AGPL-3.0 | Concept: lanes as the simulation primitive, intersections as lane connection sets. | AGPL, Rust. Ideas only, no code. |
| 9 | TM:PE (Cities: Skylines mod) | https://github.com/CitiesSkylinesMods/TMPE | MIT (page says so) | Vocabulary and facts: route = segments (may curve/elevate) joined by nodes; segments contain lanes; lanes indexed per segment with position/direction; per-node lane connections. Wiki: https://github.com/CitiesSkylinesMods/TMPE/wiki/Nodes,-Segments,-Lanes | Wiki text was not retrievable via fetch; model facts from search snippet only. |
| 10 | StreetGen paper (arXiv 1801.05741) | https://arxiv.org/pdf/1801.05741 | paper | Lane + lane interconnection generation from road axes, road surface polygon union with junction handling. | Academic; GIS, PostGIS. Read for method. |
| 11 | Parish & Müller 2001; Aliaga/Vanegas parcel papers (Purdue) | https://www.cs.purdue.edu/cgvlab/papers/aliaga/eg2012.pdf | papers | Block to parcel subdivision; confirms graph-first, geometry-second pipeline. | Subdivision method not verified by me. |
| 12 | CS1 Road Editor / zoning (forums) | https://steamcommunity.com/app/255710/discussions/ | n/a | [anecdotal] 8 m cell; zone depth 4 cells; zone must connect to road; changing segment width moves lanes and props together (dev forum reply). Supports: props are positioned relative to lane/edge, not world constants. | Not authoritative. Already encoded in `docs/process/04-*.md`. |
| 13 | unitycoder/roadcreator | https://github.com/unitycoder/roadcreator | unverified | Intersection created by connecting road end points with adjustable sharpness. | Licence unknown; skip. |

Not found: a usable three.js junction library with a clear licence; no result worth ranking. SUMO (EPL-2.0 per its project; not verified here) is the reference for lane-graph traffic and IDM/Krauss car following, but is C++ and heavy: use for concepts (lane links, junction internal lanes, foe/request matrices), not code.

Recommendation: implement the corridor geometry in-house on top of existing `NodeLayout`; take `clipper2-ts` (BSL-1.0, pure TS) only for offset/clip operations; use polygon-clipping or martinez only in tests as an independent oracle.

## 2. Recommended architecture

One derived, never-saved structure `CorridorSet`, rebuilt incrementally per dirty segment/node when `roads.revision` changes. Units: tiles (world units), consistent with the rest of the sim. Determinism: all geometry computed in float64, then quantised to 1/1024 tile before any consumer sees it; no Math.random; iteration ordered by id.

```ts
/** Lateral layout of one road class, centreline outward. Single source of widths. */
export interface RoadProfile {
  type: RoadType;
  lanes: LaneDef[];          // from centreline outward, per side mirrored
  asphaltHalf: number;       // sum of lane widths
  kerb: number;              // kerbWidth(type)
  sidewalk: number;          // 0 for highways
  setback: number;           // gap sidewalk edge -> lot front edge (can be 0)
  /** Derived: lateral offsets from centreline */
  edge: { asphalt: number; kerbOuter: number; sidewalkOuter: number; lotFront: number };
}
export interface LaneDef {
  index: number;             // 0 = innermost on the right side
  width: number;
  dir: 1 | -1 | 0;           // along segment, against, parking/none
  kind: "drive" | "parking" | "bus" | "median";
  centre: number;            // lateral offset of lane centre
}

/** Per-segment corridor: profile + arc-length-parametrised offset curves. */
export interface SegmentCorridor {
  seg: number; rev: number;
  profile: RoadProfile;
  /** Arc-length table of the centreline, for exact slicing. */
  s: Float32Array;           // cumulative length per sample
  /** Offset polylines at profile.edge.* for left (-1) and right (+1). Already trimmed by junctions. */
  offsets: Record<"asphalt"|"kerbOuter"|"sidewalkOuter"|"lotFront", [Pt[], Pt[]]>;
  sTrimA: number; sTrimB: number;     // arc length consumed by junction polygons
  lanes: LaneSpline[];
}

/** Node geometry: arm cut lines + fillet arcs; supersedes NodeLayout consumers. */
export interface JunctionPolygon {
  node: number;
  asphalt: Pt[];             // closed ring, arms + round fillets
  kerbRing: Pt[];
  sidewalkRing: Pt[];
  lotRing: Pt[];             // outer boundary at lotFront, used to clip parcels
  arms: { seg: number; end: "a"|"b"; cutS: number; left: Pt; right: Pt }[];
  corners: { aArm: number; bArm: number; centre: Pt; r: number }[]; // fillets
}

/** A buildable parcel: oriented lot clipped to free land. */
export interface Parcel {
  id: number;                // stable: hash of (seg, side, sliceIndex, depthIndex)
  seg: number; side: -1 | 1;
  ring: Pt[];                // 4..6 vertices, after clipping
  frontEdge: [Pt, Pt];       // lies exactly on offsets.lotFront (within 1e-3)
  frontS: [number, number];  // arc interval on the segment
  yaw: number;               // tangent at mid arc
  depth: number; width: number;
  hasFrontage: boolean;      // false => never offered for zoning
}

/** Vehicle path primitive: cubic Hermite / polyline of a single lane or junction connector. */
export interface LaneSpline {
  id: string;                // `${seg}:${laneIndex}` or `${node}:${inArm}:${outArm}:${laneIdx}`
  pts: Pt[]; len: number; s0: number;
  from: string | null; to: string[];     // lane graph links
  speed: number; width: number;
}
```

Algorithms

1. Profile: `RoadProfile` table replaces ad-hoc `ROAD_DRAW_WIDTH`/`kerbWidth`/`halfAsphalt` and the prop offsets; the old functions become thin wrappers reading it (no behaviour change at step 1).
2. Offset curves: sample the centreline at fixed arc step (0.25 tile), offset along the normal, then clean self-intersections at inside bends with Clipper2 `inflatePaths` (round join) on the ribbon polygon. Exposes `offsets.*`.
3. Junctions: keep the existing arm sort and fillet maths from `nodeArms/NodeLayout`; generalise to one ring per layer (asphalt, kerb, sidewalk, lot) by running the same fillet at radius `r + layerOffset`. The trims `sTrimA/B` come out of this, so segment ribbons, lots, and lanes all start at the same arc length.
4. Parcels: slice `lotFront`..`lotFront+depth` strip by arc length at lot width steps; each slice is a quad between two normals; clip with Clipper2 difference against all `JunctionPolygon.lotRing` and neighbouring corridors' `sidewalkOuter` rings (spatial hash by tile). Corner lots get 5-6 vertices. Drop slices with area below 40% of nominal or with no front edge on a `lotFront` curve. Interior-lot gaps vanish because every parcel is generated from a corridor edge by construction; "interior" cells are simply not created.
5. Lane splines: one per lane per segment from `profile.lanes[i].centre` offset curve between `sTrimA` and `sTrimB`; junction connectors as quadratic/cubic Bezier from the end of incoming lane to the start of outgoing lane (tangent-continuous), turn-radius implied by the fillet. Vehicles keep A* on the segment graph, but position along `LaneSpline` instead of tile centres.
6. Props: placed by (seg, s, lateral kind) via `offsets.*`; junction props from `JunctionPolygon.corners`. No prop reads a width constant.

Integration with existing oriented model: `ZoneBlock` rows/cols stay as the *zoning-cell* abstraction and the tile mirror stays; only `lat0` changes to `profile.edge.lotFront + 0.5` and block frames are trimmed with `sTrimA/B`. Parcels are the geometric truth for lots; cells map onto them. This keeps `zonecells.ts` contracts and saves unchanged.

## 3. Migration plan (5 small steps)

Each step: `npx tsc --noEmit`, `npx vitest run` green, no save format change before step 4; save stays optional-field only.

1. **Profile table, no behaviour change.** Add `src/sim/corridor.ts` with `RoadProfile` and `profileFor(type)`; route `kerbWidth/halfAsphalt/cornerRadius` and the render prop offsets through it. Test: all old function outputs identical for every `RoadType`.
2. **SegmentCorridor + offsets.** Build offset polylines and arc tables for every segment (cached by segment revision, deterministic quantisation). Render mesh may optionally read them behind a debug flag. Test: offset distance error under 1e-3 away from bends; length monotonic.
3. **JunctionPolygon.** Lift `NodeLayout` to layered rings and expose `sTrimA/B`; renderer uses it for kerb and sidewalk. Test: rings closed, no self-intersection, sidewalk ring contains kerb ring contains asphalt ring.
4. **Parcels replace zone-block geometry.** `lat0` moves to `lotFront` (setback exactly as profile); arc slicing and clipping produce `Parcel`; `ZoneBlock` frames trimmed by corridor; cells whose parcel has no frontage are marked invalid. Save: bump nothing; v2 cell addresses stay; lots migrate by `migrateCells`. This step needs a visual check by the lead and a one-time re-lot of existing saves behind `prefs.zoning`.
5. **Lane splines for traffic and props.** Vehicles interpolate along `LaneSpline` with connector Beziers; props and kerbs placed via corridor offsets. Tile A* unchanged (routing graph), only the geometric path differs, so simulation state and traffic outcomes stay deterministic and testable.

## 4. Acceptance tests (measurable)

Fixtures: straight, 45 degree diagonal, S-curve, T, 4-way, 5-way, Y fork, roundabout-ish loop, plus the worst existing save at 96x96. All tests run in vitest, deterministic seed.

1. **Front edge at setback**: for every parcel, both endpoints of `frontEdge` are within 1e-3 tile of the `lotFront` offset curve, and distance to asphalt edge equals `kerb + sidewalk + setback` within 1e-3.
2. **No overlap**: zero area of intersection (tolerance 1e-4 tile^2) between any parcel ring and (a) any `SegmentCorridor` asphalt/kerb/sidewalk ring, (b) any `JunctionPolygon` rings, (c) any other parcel. Use polygon-clipping as independent oracle.
3. **No interior lots**: 100% of parcels have `hasFrontage` and `frontEdge` length at least 70% of lot width; count of valid zoned cells without owning parcel equals 0 (today: measured 15-20% interior).
4. **Junction alignment**: for each 4-way junction, front edges of opposite-side parcels across the junction lie on one line (collinear within 1e-3) when arms are colinear; row phase continuity: parcel arc start on adjacent segments differs by a multiple of lot width from `sTrim`.
5. **Kerb and prop snapping**: every prop lies within 1e-3 of its declared offset curve; kerb mesh vertices lie on `kerbOuter` offset within 1e-3; mesh vertex count budget unchanged (iPad: rebuild under 10 ms at 96x96, asserted with a coarse timing guard).
6. **Vehicle paths inside lane polygons**: sample every 0.1 tile along each realised vehicle path; 100% of samples lie within the union of lane ribbons and junction connector ribbons (lane width), and lateral deviation from its lane spline under 0.15 tile; zero samples inside any parcel.
7. **Determinism**: same world + seed produces byte-equal corridor hash (quantised coordinates) on two builds, and across incremental vs full rebuild.
8. **Save compatibility**: all fixtures in `src/sim/__fixtures__`/old saves load; building count before/after migration may only decrease where a lot was provably overlapping asphalt, and that decrease is reported (log + test with explicit allowed list).
9. **Performance**: full corridor rebuild at 96x96 under 25 ms desktop, incremental dirty-segment rebuild under 4 ms; no allocation in per-frame vehicle spline sampling (reuse buffers).

## 5. Main risks

- Float robustness in offsetting inside tight bends: mitigate with Clipper2 integer grid (scale 1024) and discarding micro-slivers.
- Existing buildings sit on old lot geometry; step 4 needs the migration report and a user-visible "relot" note.
- Licence hygiene: take no code from LGPL/AGPL repos (MapGenerator, Citybound). Clipper2 ports require BSL-1.0 notice in `third_party/README.md`.
- WASM variants add payload and async init; stay with pure TS unless profiling demands it.
