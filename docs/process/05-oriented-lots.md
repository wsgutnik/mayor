# 05 — Segment-frame zone cells and oriented lots

Updated 2026-10-12. Architecture spec for replacing tile-grid zoning with **zone blocks owned by road segments** (the CS1
model documented in `04-grids-crossings-drawing.md` §1.2 — formerly `04-grids-cruzamentos-desenho.md` — and
`04-regras.json` G-*) and **oriented lots** (rotated
rectangles in the segment frame), plus the **tile mirror** that keeps every other system working unchanged, the save
format v2, the interaction model, the rendering-resolution upgrade and a dependency-ordered phase plan.
Machine-readable phases: `05-phases.json`.

Conventions: `file:line` references are to the tree at commit `6f8be1a` (307 tests green, `npx vitest run`). "Today"
means that code. Units: 1 tile = 1 world unit = 1 zone cell (= 8 m in CS terms). x/z are ground axes (three.js), `y` in
tile indices is the z axis (`idx(w, x, y)` at `world.ts:209`).

---

## 0. Problem and shape of the solution

Today a road is a free curve (`RoadSegment.pts`, `world.ts:95-114`) rasterised onto tiles (`rasterizeRoad`,
`world.ts:531-554`), but zoning, frontage, lots and buildings live only on the axis-aligned tile grid:

- `applyTool` paints `w.zone[i]` per tile and refuses tiles without frontage (`sim.ts:675-688`);
- `findFrontage` assigns each tile to its nearest road **tile** (Manhattan ≤ 4) with the CS1 tie-breaks already ported
  (nearer road wins, older segment on tie, slope limit, row cut-off) (`blocks.ts:72-124`);
- `planLots` packs axis-aligned 1×1..4×4 rectangles whose front row is at depth 0 (`blocks.ts:183-218`);
- the renderer draws pads as axis-aligned boxes and yaws the building to one of four directions (`lotYaw`,
  `render/lots.ts:6-8`; `scene.ts:667-723`).

A diagonal or curved street therefore gets a staircase of square tiles beside it, pads overlap the asphalt, kerbs float,
and buildings face one of four directions instead of the street. The fix is the CS1 approach: the zone grid is **not a
world grid** but a rectangle of up to 8 × 4 cells per side and per segment, rotated with the segment. Lots are rectangles
of those cells. Everything downstream (recount, coverage, traffic, networks, land value, inspect, saves) keeps reading
tile arrays, which become a **derived mirror** of the cells.

Three invariants carry over from today and must hold at every phase:

1. **No building is ever lost by a derived rebuild.** Today levels live in `w.level` and survive `refreshLots`
   (`sim.ts:428-476`). In the new model levels live in cells and survive block regeneration by nearest-cell migration (§1.6).
2. **Old saves load** (`AGENTS.md` rule 3): v1 saves migrate to cells; v2 saves can still be opened with the flag off (§5).
3. **Determinism**: equal world + seed → equal blocks, lots and mirror (`blocks.test.ts:81` already asserts this for lots).

A feature flag (`prefs.zoning: "tiles" | "oriented"`, §7) selects the old or the new path until cutover.

---

## 1. Data model: zone blocks owned by segments

### 1.1 Types (new file `src/sim/zonecells.ts`, types only, written first so phases can run in parallel)

```ts
import type { ZoneType } from "./world";

/** Which side of the segment (looking from node a toward node b): -1 = left, +1 = right. */
export type Side = -1 | 1;

export const CELL_DEPTH = 4;          // ZONE_DEPTH today (blocks.ts:4); columns 0..3
export const BLOCK_MAX_ROWS = 8;      // G-BLOCK: split segments longer than 8 cells
export const CELL_SLOPE_LIMIT = 1.0;  // ZONE_SLOPE_LIMIT today (blocks.ts:6)

/** A cell address. Stable while the owning segment keeps its id and shape. */
export interface CellRef { seg: number; side: Side; block: number; row: number; col: number }

/** A block is one rectangle of rows × CELL_DEPTH cells on one side of one segment. */
export interface ZoneBlock {
  key: string;                 // `${seg}:${side}:${block}` — map key, never saved as a float
  seg: number;
  side: Side;
  block: number;               // index along the segment, 0 = at node a
  rows: number;                // 1..BLOCK_MAX_ROWS
  /** Arclength (tiles, from node a) of the centre of row r: s0 + r. */
  s0: number;
  /** Lateral offset (tiles, from the centreline) of the centre of column 0; column c is at lat0 + c. */
  lat0: number;
  /** Per-row frame: cell centre of (row, 0) and the unit tangent of the segment there. Length rows*4. */
  frame: Float32Array;         // [ox, oz, tx, tz] per row
  /** Cell state, row-major (index = row * CELL_DEPTH + col). */
  valid: Uint8Array;           // 1 = may hold zone (slope, obstacles, row cut-off, overlap resolution applied)
  zone: Uint8Array;            // ZONE.*; 0 = unzoned. Only meaningful where valid = 1.
  level: Uint8Array;           // 0..3, mirrored from the lot that owns the cell
  lot: Int32Array;             // lot id or -1
  /** Owner segment's creation order for tie-breaks (segment ids are monotonic: roads.ts:408, world.ts:161). */
  age: number;
}

export interface CellPose { x: number; z: number; yaw: number; tx: number; tz: number; nx: number; nz: number }
```

Why a per-row frame instead of one straight rectangle per block: CS1's `CurvedZoneBlocks` approximates a Bézier with
one or two straight blocks per side (§1.2 of 04). With `frame` per row the same structure covers straight segments
exactly (constant tangent) and follows curves without special cases; lots that span several rows check yaw spread
(§2.3). A straight segment's block is still a plain rotated rectangle.

### 1.2 Frame conventions

For a segment with points `pts` (2 or 3, `world.ts:98`), use the arclength parametrisation already available through
`curvePoints(pts, 0.25)` (`world.ts:503-517`) and `segmentLength` (`world.ts:520-525`). Define:

- `C(s)`: centreline point at arclength `s` (linear interpolation between samples).
- `T(s)`: unit tangent (a→b). `N(s) = (-T.z, T.x)`: the unit normal **to the left** of travel.
- Cell `(side, row, col)` centre: `C(s0 + row) + side * (lat0 + col) * N(s0 + row)`.
- Cell square: side 1, axes `T`, `N` at that row. Cell yaw for three.js (`rotation.y`): `Math.atan2(T.x, T.z)` makes the
  model's `+z` point along `T`; the lot facing uses `-side * N` (§2.2).

`lat0` and `s0` follow G-HALFW exactly, expressed in tiles:

| class (`ROAD_TILE_WIDTH`, `world.ts:77`) | hw (tiles) | `lat0 = hw + 0.5` | `s0` | rows |
|---|---|---|---|---|
| street, one-way street (width 1) | 0.5 | 1.0 | 0 (row centres on the node: CS1 "starts 4 m before the node" when `hw % 8 ≠ 0`) | `floor(len + 0.1) + 1` |
| avenue, one-way avenue (width 2) | 1.0 | 1.5 | 0.5 (row 0 spans `[0, 1)`) | `floor(len + 0.1)` |
| highway | — | no blocks (`findFrontage` skips highways today, `blocks.ts:82`; `isServed`, `world.ts:402`) |

With a street on tile centres and axis-aligned, cell centres land on tile centres (`k+0.5 ± 1`, `k+0.5 + r`), so the
new model reproduces today's grid tile-for-tile; `blocks.test.ts:28-62` therefore keep passing through the mirror.
The `+1` row for streets is the one deliberate deviation from CS1: CS1 leaves the last half cell before node b uncovered
(`CreateZoneBlocks.cs:362-381`); here the extra row either lands on the crossing road (invalidated by §1.4 (c)), coincides
with the next collinear segment's row 0 (resolved by §1.5 share rule) or covers the dead-end tile (desired).

Block split (G-BLOCK generalised, because `MAX_SEGMENT_TILES = 60` at `sim.ts:74` allows far more than 16 rows):
`nBlocks = ceil(rows / 8)`; block `b` gets `floor(rows / nBlocks)` rows plus one for the first `rows % nBlocks` blocks
(this is exactly `(rows+1)>>1` / `rows>>1` when `nBlocks = 2`). Block `b` starts at row `sum(rows of blocks < b)`.

Curves: nothing special; rows follow `C(s)`. For a quadratic Bézier with a sharp bend, outer cells splay apart and inner
cells overlap each other; overlap inside one block is resolved by the same rule as between blocks (§1.5, "same col →
lower row wins") so a tight inner curve simply has fewer valid cells, like CS1.

### 1.3 Generation (new file `src/sim/zoneblocks.ts`)

```ts
export interface ZoneBlockSet {
  graphRevision: number;                   // world.graphRevision this was built for (roads.ts:61-63)
  blocks: Map<string, ZoneBlock>;
  bySeg: Map<number, ZoneBlock[]>;
  /** Spatial index: tile index -> block keys whose cells' centres or corners touch that tile. */
  tileIndex: Map<number, string[]>;
}

/** Build every block for every zoneable ground segment. Pure: never touches w.zone/level/lots. */
export function buildZoneBlocks(w: World, prev?: ZoneBlockSet): ZoneBlockSet;

/** Geometry only: one segment's blocks with valid=0, zone=0 (used by buildZoneBlocks and the preview). */
export function blocksForSegment(w: World, seg: RoadSegment): ZoneBlock[];

export function cellPose(b: ZoneBlock, row: number, col: number): CellPose;
export function cellCorners(b: ZoneBlock, row: number, col: number, out: Float32Array): void; // 4 × (x,z)
export const cellIndex = (row: number, col: number): number => row * CELL_DEPTH + col;
```

Zoneable segments: `segElevation(seg) === "ground"` (`world.ts:93`) and `baseRoadType(seg.type) !== 3`
(`world.ts:86`); pads (`a === b`, zero length, `roads.ts:262-364`) produce no blocks.

`buildZoneBlocks` order: (1) `blocksForSegment` for each zoneable segment in ascending `seg.id` (= age);
(2) validity mask per block (§1.4); (3) overlap resolution across blocks (§1.5); (4) migration of zone/level/lot from
`prev` (§1.6). Cost target: 2 000 segments on 128×128 in < 15 ms (same budget as `blocks.test.ts:111`); the spatial
`tileIndex` keeps step (3) near-linear.

### 1.4 Validity mask (G-VALID; `CalcBlock1Patch.cs:141-255` ported)

A cell is invalid when any of the following holds, tested in this order; `valid` is written per cell:

- (a) **slope**: `|heightAt(centre) − heightAt(C(s0+row))| > CELL_SLOPE_LIMIT` (`heightAt`, `world.ts:741-749`).
  Today's rule compares tile heights (`blocks.ts:93`); sampling the terrain at the cell centre and at the road point of
  the same row is the same test at sub-tile precision.
- (b) **out of map or water**: any of the four corners outside `[0, size]²`, or `!isLand(tileOf(centre))`
  (`world.ts:238`). Today: `planLots` requires `isLand` (`blocks.ts:196`).
- (c) **road and junction surface** (Z1, rewritten in the zone-attach fix). Every cell is tested at 9 samples (centre;
  corners and edge midpoints pulled 7 % toward the centre) against the *physical* surface, never the road raster:
  - own segment, and any segment that continues it straight through a shared node (tangents anti-parallel within
    `STRAIGHT_TOL`): invalid when a sample is `< drawHalf + sidewalk` from the centreline. Depth 0 therefore always
    touches its own sidewalk;
  - any other ground segment: invalid when a sample is `< drawHalf + sidewalk + ROAD_CLEARANCE (0.075)` from its
    centreline. The distance uses **flat caps** at an end whose node has a junction layout (the polygon below covers
    the node area); a round cap there removed the row across the through road from a T stem;
  - every junction layout (`junctionsOf(w)`): invalid when a sample is inside its `sidewalkOuter` ring (asphalt, kerb
    returns and corner sidewalk). Nodes with >= 3 ground arms but no layout fall back to the disc
    `max(drawHalf + sidewalk + cornerR)`;
  - the tile raster (`blocksBuilding(tileOf(centre))`) only for decks and non-ground roads (`roadSurface == 0` or
    `roadDeck != 0`). (The old shortcut that skipped the analytic test above 1000 ground segments is gone since zperf,
    §1.9: the indexed exact path is fast enough at any size.) The raster
    marks every tile a centreline touches; on a diagonal such a tile reaches ~1.4 tiles from the centreline, so the
    old centre-tile test rejected the depth-0 cell of every other row beside its own road and the cut-off (e) then
    emptied the row: the "zone floats off the road" defect. Tunnels never invalidate (`isTunnelTile`).
- (d) **facility**: `w.facility[tileOf(centre)] !== 0` (today: `blocks.ts:196`, `sim.ts:460`).
- (e) **row cut-off** ("no cell without road access", CS1's 7-iteration loop): for `col = 1..3`, if `valid[row][col-1] === 0`
  then `valid[row][col] = 0`. Only the cells behind the first invalid cell of a row (in depth order) are removed;
  never the cells in front of it.

Validity never depends on zone state, so painting zones never regenerates blocks (same split as today's
`frontageCache` vs `blockCache`, `blocks.ts:220-244`).

### 1.5 Overlap and corner resolution (G-SHARE, G-OVERLAP, G-INHERIT; `CalcImpl2Patch.cs:39-293`)

Final rule (Z3 + zone-attach fix, `resolveOverlaps` in `zoneblocks.ts`): a greedy independent set over every valid
cell, sorted once by

1. **depth** = `lat0 + col`, the lateral distance of the cell centre from its own centreline (exact on straight and
   curved frames): the cell nearer its own road wins a contested area, so where two roads' blocks meet each cell
   goes to the nearest centreline and the split follows the bisector of a wedge;
2. ties (equal depth: two depth-0 cells in an acute wedge, the cell at an inner T corner) go to the **older segment**
   (`age` = segment id), then side, row (`s0 + row`), col, key.

A cell is kept when it does not conflict with an already kept cell: centre distance `< 0.8`, point-in-quad either
way, or SAT overlap deeper than 1e-3 (shared edges are not overlaps). Conflicts are searched in a 5 x 5 bucket
neighbourhood, because two overlapping unit cells on rotated frames can have centres two buckets apart (a 3 x 3
search let overlapping lots through). Frame neighbours (same segment, side and col, `|row| <= 1` apart) never
conflict. Because depth order visits col k-1 of a row before col k, a cell whose col k-1 neighbour is not kept is
dropped instead of reserving space it could never use (the reservation left grass between a block and the kerb of
the rival road). Dropped cells get 3 re-admission passes in the same order.

Removed: the CS1 col band (`col <= 1` beats `col >= 2`, then wider road, then age). Under it an older road's depth-1
cell evicted a younger road's depth-0 cell, the cut-off emptied that row, and the younger road showed grass along its
kerb with zoned cells floating one or two cells away (the owner's Y-fork report).

Consequences, all measured by `src/sim/zone-attach.test.ts` (Y fork, curve, acute 25 degree Y, T, bend):

- on every road side, every frontage station whose depth-0 cell is clear of other roads and junction polygons is
  zoned right behind the sidewalk (cover 1.000, gap 0), except stations whose depth-0 cell lost a fair tie to an
  equally near cell of another road ("contested", reported separately: inner T corners, the tip of acute wedges);
- no zoned cell is nearer another road's setback line than its own by more than 0.5 tile;
- no zoned cell sample is inside any road body or junction polygon; `checkLots` reports 0 overlaps;
- validity is independent of segment order; a save round trip keeps every zoned cell and lot.

3. **Inherit zone** (`d² < 0.5625`, both `col ≤ 3`, both valid, exactly one zoned): copy the zone to the unzoned one. This
   only runs during painting (§4), not during generation, so loading a save cannot spread zones.

Corner rule (G-CORNER): there is no corner lot type. The cell at a corner belongs to the block that won in (1)/(2) and its
lot faces that block's road. This replaces `frontage.corner` (`blocks.ts:95-96`); `blocks.test.ts:38` ("deterministic
corner ownership") must be re-expressed against `cellAt(tile)` (§3.2).

### 1.6 Regeneration and migration when roads change

Blocks are keyed by segment id, and `splitSegment` (`roads.ts:169-198`) gives the right half a **new id** and shortens
the left one; `tryMergeNode` (`roads.ts:483-517`) deletes one segment and re-points the other; `removeSegment`
(`roads.ts:520-533`) drops one. Therefore cell addresses are **not** stable across road edits. Zone state survives by
**migration by nearest cell**:

```ts
/** Copy zone/level/lot from old cells to the nearest new valid cell (centre distance ≤ MIGRATE_RADIUS = 0.75). */
export function migrateCells(prev: ZoneBlockSet, next: ZoneBlockSet): MigrationReport;
export interface MigrationReport { moved: number; dropped: CellRef[]; lotsBroken: number[] }
```

Rules: a new cell takes the old cell whose centre is nearest; if two old cells map onto one new cell the one with the
higher `level` wins, then the older block; an old zoned cell with no new valid cell within radius is **dropped** (and
reported — the UI toasts "N zone cells lost to the new road" via `i18n`). Unchanged segments (same id, same `pts` and
`type`: compare a shape key `${type}|${pts.map(p=>`${p.x},${p.z}`)}`) are copied verbatim, so the common case
(building a street elsewhere) moves nothing. Lots are re-attached in §2.4.

Trigger: the set is rebuilt lazily when `w.graphRevision` differs from `ZoneBlockSet.graphRevision`. Facility placement
and bulldoze also change validity ((d) above) so they must bump a new counter `w.obstacleRevision` that the block cache
also keys on (today `dirtyZones` bumps `zoneRevision`, `sim.ts:423-426`; the oriented path adds the obstacle counter so
zone painting alone still does not regenerate).

### 1.8 Zone/road invariant and the single reconciliation point (task zinv)

**Invariant** (checked after every operation by `checkZoneInvariant`, `src/sim/zoneinvariant.ts`): no zoned cell, lot,
rendered pad or kerb strip touches the physical road surface; no zone state exists outside valid cells; mirror tiles
and lots derive from valid zoned cells only; no lot overlaps another. The surface (`src/sim/roadsurface.ts`) is what
the player sees as road: asphalt + kerb + sidewalk (`drawHalf + sidewalk`) swept along every ground centreline, cut
flat at nodes that have a junction layout, plus every junction `sidewalkOuter` ring. Classic tile mode uses the
`kerb` surface (asphalt + kerb, junction `kerbOuter`): a 1-tile street is drawn 1.14 tiles wide, so every tile beside
it overlaps the sidewalk by 0.07, which classic zoning always accepted; tiles are also tested 0.1 inset because the
kerb return of every block corner cuts ~0.08 into the corner tile. Asphalt never is accepted.

**One place.** `reconcileZones(s)` (`sim.ts`) runs after every road mutation (place, upgrade, bulldoze, roundabout,
interchange), every zone or obstacle mutation and every load (`deserialize` marks lots dirty, `refreshDerived` syncs):

- oriented: cells that are not valid lose zone, level and lot (`scrubCells`), lots are replanned from valid zoned cells
  only (kept lots must still fit, see below), and the tile mirror is rewritten from those cells and lots;
- tiles: a zoned tile on a road, facility, water, the `kerb` surface or beyond the zoning depth loses its zone
  (`scrubTiles`, CS1: zones vanish under and beside removed roads), then lots are rebuilt.

**Validity additions (§1.4 c).** Junction rings are tested exactly against the cell quad (pulled 3 % in), not only at
the 9 samples: a kerb-return vertex poked into cell edges between samples. Other roads are tested exactly too (capsule
per centreline piece, rectangle for a piece ending flat at a layout node), because a round end or a crossing
centreline bulged between samples by more than `ROAD_CLEARANCE`. Curved rows get 4 extra corner samples (3 % in): on
the trapezoids of tight curves a corner reached the own road between the 7 % samples. Straight rows keep 9 samples
(the corners sit exactly on the kerb line).

**Lots (§2.3).** A lot is drawn as one rigid rectangle (`lotPose`: pads, kerb strip, ground plan, building). On a
straight stretch it is exactly the union of its valid cells; on a curve it leaves that union, so the planner asks a
footprint gate (`PlanOpts.rectOk`, exact rectangle-vs-surface test, 0.015 edge band, 0.005 slack) for curved shapes
and skips rows no shape can use instead of ending the run there. Kept lots carry `construction` and `landmark`
(they were dropped on every replan). New lot ids are remapped in one pass (in-place renaming re-pointed already renamed
cells at the next lot when more lots were planned than the id gap).

**Migration (§1.6).** A zoned cell migrates only to a new cell whose road runs within 15 degrees of its own (parallel
or anti-parallel): splits, merges and small reshapes keep their zones; a road drawn across a zoned block leaves its own
cells unzoned (CS1), instead of inheriting rotated cells and lots from the old grid.

**Mode switch.** `setZoningMode` (main.ts applies the preference on every load/new city/undo) migrates tile zones to
the nearest valid cell instead of silently dropping them.

**Renderer.** Oriented lots draw only what the lot list holds (every lot is road-free by the gate). Classic lot kerb
strips sit 0.06 inside the lot and are drawn only within 0.2 of a road's setback line and off the surface (on
diagonals classic kerbs were drawn on tile edges up to a tile away from the ribbon). `orientedKerb` sits 0.075 behind
the front edge (its face 0.015 inside, outside the band validity keeps off junction rings).

### 1.9 Incremental, exact rebuilds (task zperf)

A road or zone edit must not hitch the iPad (AGENTS rule 4). `buildZoneBlocks` and `reconcileZones` keep the exact
rules above but stop recomputing the whole city on every edit; results are byte-identical to the pre-zperf code
(`src/sim/zone-perf.diff.test.ts` runs the frozen copy in `src/sim/zone-oracle/` through `zoneHooks` and compares zone
blocks, valid/zone/level/lot bytes, tile index, lots and mirror after every operation of the random scenarios, the
benchmark fixtures, facility on/off, terrain pokes and natural terrain). What is cached, per world:

- **Block templates** per segment (frame, edge) while the segment's id, type and points stay; per template the cell
  geometry (centres, Float32 corners, area test, slope road points, tile boxes).
- **Road test bits** (§1.4 c) per block, reused unless a road that can be a candidate of one of its cells (raster within
  2 tiles of a cell tile) changed type/points/tiles/flat ends, a junction ring or disc near it changed, or its own
  segment's straight continuations changed. Exact tests use per-road chunk boxes and squared-distance pre-checks; the
  sampled arithmetic is unchanged.
- **Terrain bits** per template, reused unless a heights grid point or tile (facility, raster, deck, tunnel) the test
  reads changed since the previous build (snapshots compared on every build: heights change without a revision).
- **Conflict neighbours** of §1.5 per template cell (symmetric, purely geometric, alive cells only), recomputed only near
  templates that appeared, vanished or changed their alive cells. The greedy order is emitted in linear time when the
  distinct depths are > 1e-6 apart (otherwise the tolerant comparator sort runs as before).
- `corridorsOf` reuses unchanged segment corridors; `roadSurface` reuses curve shapes and buckets pieces in chunks;
  lot-rectangle answers (`lotRectOnRoad`) are remembered per surface and carried over edits that cannot reach them.
- `tileIndex` is built on first read from a snapshot; migration uses a bucket index with the linear scan's tie rule.

`ZPERF=1 npx vitest run src/sim/zone-perf.bench.test.ts` prints ms per phase per fixture; an always-on guard keeps a
road edit and a 2000-tile repaint on the 96x96 grid fixture under a loose 40 ms.

### 1.7 World fields (additive, `world.ts:143-207`)

```ts
export interface World {
  // ... existing ...
  /** Oriented zoning (05): authoritative when prefs.zoning === "oriented". Not saved as such; see save v2. */
  zoning: "tiles" | "oriented";
  cells?: ZoneBlockSet;          // derived cache, rebuilt from segments + saved cell state
  olots?: OrientedLot[];         // authoritative lots in the oriented mode
  nextOLotId: number;
  obstacleRevision: number;      // bumped by facility/bulldoze edits
}
```

`generateWorld` (`world.ts:284-323`) initialises `zoning: "tiles"`, `nextOLotId: 1`, `obstacleRevision: 1`; `newCity`
(`sim.ts:133`) sets `zoning` from the caller (main.ts passes `prefs.zoning`).

---

## 2. Oriented lots

### 2.1 Type (`src/sim/zonecells.ts`)

```ts
export interface OrientedLot {
  id: number;
  /** Anchor cell: block and the (row, col) of the lot's front-left cell. */
  seg: number; side: Side; block: number; row: number; col: number;
  /** Size in cells: w along the road (rows), d into the block (cols). 1..4 each. */
  w: number; d: number;
  zone: ZoneType;
  level: number;              // 0 empty, 1..3
  /** Derived pose: centre and yaw such that a model's +z faces the road. Recomputed from the block, never saved. */
  cx: number; cz: number; yaw: number;
  /** Mirror: tile indices whose centre lies inside the lot's rectangle (≥ 1, see §3). Derived. */
  tiles: number[];
}
```

`depthFromRoad` (today `WorldLot.depthFromRoad`, `world.ts:139-140`) is `col`. The 1×1 fallback lots that today cover
zoned tiles the planner skipped (`sim.ts:455-473`) exist in the new model as lots with `col > 0` only when the cells in
front of them are valid and zoned differently (row cut-off already removed inaccessible cells).

### 2.2 Pose and facing

```ts
export function lotPose(b: ZoneBlock, lot: Pick<OrientedLot, "row" | "col" | "w" | "d">): { cx: number; cz: number; yaw: number };
export function lotCorners(b: ZoneBlock, lot: OrientedLot, out: Float32Array): void;   // 4 × (x,z), CCW
export function lotContains(lot: OrientedLot, b: ZoneBlock, x: number, z: number): boolean;
```

Centre = mean of the four cell centres `(row, col)`, `(row+w−1, col)`, `(row, col+d−1)`, `(row+w−1, col+d−1)`.
Facing: the lot faces its own road, i.e. direction `F = −side · N(s_mid)`. The GLB models have their base at z = 0 and
front at −Y in Blender (`AGENTS.md` rule 7, `blender/README.md`), which the glTF exporter turns into **+z** in three.js
(`render/lots.ts:5` relies on the same fact). So `yaw = Math.atan2(F.x, F.z)`: this is `lotYaw` (`render/lots.ts:6-8`)
with a continuous `F` instead of a four-way `facing`. A corner lot never faces two roads; it faces the block that won
its cells (§1.5).

### 2.3 Planner (`src/sim/orientedlots.ts`)

```ts
export interface PlanOpts { rng: () => number; keep?: readonly OrientedLot[] }
/** Deterministically cover zoned, valid, lot-less cells of every block with front-fronting lots. */
export function planOrientedLots(set: ZoneBlockSet, opts: PlanOpts): OrientedLot[];
```

Algorithm, per block (ascending `key`), front row first:

1. **Persistence pass**: for each lot in `opts.keep` whose anchor block still exists and whose `w × d` cells are all valid,
   zoned with `lot.zone` and share `lot.level`, re-emit it unchanged (same id). This is what keeps a 2×2 level-3 lot a
   2×2 level-3 lot across any rebuild (invariant 1).
2. **Shapes**: for the remaining front cells (`col = 0`, zoned, valid, `lot = −1`), try shapes in the order
   `[4,4] [4,2] [2,2] [2,1] [1,2] [1,1]` (widths 4, 2, 1 preferred, depth = min(zoned depth, 4), as 04 §1.3 recommends;
   `[3,3]` only for `zone !== RES && level ≥ 2` to keep `blocks.test.ts:88` semantics). The seed shuffles the **order of
   front cells** within a block (Fisher–Yates, as `blocks.ts:206`), never the shape order (04 §1.3: removing today's
   `rotate` at `blocks.ts:211`).
3. A shape fits when all its cells are valid, zoned identically, same level, lot-less, **and** the yaw spread across its
   rows is ≤ 6° (`|atan2(T_r) − atan2(T_r0)|`): on tight curves only 1-row-wide lots form.
4. **Extend backward** (today's `extendLots`, `sim.ts:484-516`): after the pass, each lot grows one column at a time while
   the next column's cells match zone/level and are lot-less, up to `d = 4`.
5. Anything zoned and still lot-less at `col > 0` becomes a 1×1 lot (today's fallback, `sim.ts:455-473`).

```ts
/** Lots whose whole front edge touches a connected, non-highway surface road (today: blocks.ts:247-260). */
export function lotsReady(w: World, set: ZoneBlockSet, lots: readonly OrientedLot[]): Set<number>;
```
Readiness: `col === 0` and `w.connected[tileOf(C(s_row))]` for every front row (`updateConnectivity`, `world.ts:362`).

### 2.4 Lot lifecycle

- `refreshOrientedLots(s)` (in `sim.ts`, the oriented twin of `refreshLots`): `set = getZoneBlocks(w)`; migrate; plan with
  `keep = w.olots`; write `block.lot[]` and `block.level[]`; rebuild the mirror (§3). Ids: new lots take `w.nextOLotId++`;
  kept lots keep theirs. Ids are never reused within a save (today `refreshLots` resets `nextLotId = 1` at `sim.ts:442`;
  the oriented path must not, because v2 saves carry lot ids).
- `setOLotLevel(w, lot, level)` mirrors into `block.level` for the lot's cells and into `w.level` for `lot.tiles`.
- Growth (`step`, `sim.ts:801-833`) iterates `w.olots` with `lot.tiles` in place of the `x..x+w, y..y+h` footprint loop
  (`sim.ts:809-819`); nothing else in `step` changes.

### 2.5 Building placement with arbitrary yaw

`render/lots.ts` gains frame-based twins (old functions stay for the flag-off path):

```ts
export interface LotFrame { cx: number; cz: number; yaw: number; w: number; d: number }
/** World positions of the composed 1x1 models: one per cell up to 2x2, else a centred 2x2 cluster (as lotModelCells). */
export function orientedModelCells(f: LotFrame): { x: number; z: number }[];
/** Kerb strip along the front edge: centre, length along the road, thickness. */
export function orientedKerb(f: LotFrame): { x: number; z: number; len: number; yaw: number };
export function orientedPad(f: LotFrame): { x: number; z: number; sx: number; sz: number; yaw: number };
```

`scene.ts` places each model with `dummy.position.set(x, heightAt(x, z) + 0.04, z); dummy.rotation.set(0, yaw, 0)`
(`placeLotCell`, `scene.ts:919-931`, already takes a yaw; only the cell positions change). Shadows (directional
`PCFSoftShadowMap`, `scene.ts:230-235`) and AO (vertex colours baked in the GLB, `glb-models.ts:38-47`) are rotation
independent. Pads and kerbs become rotated instances of the same unit `BoxGeometry` (`scene.ts:316-325`):
`scale.set(sx, 0.06, sz); rotation.y = yaw`. The depth shade (`depthShade`, `render/lots.ts:58-60`) uses `col`.

Terrain under a rotated pad: the pad sits at the mean `heightAt` of its corners plus 0.03; the lot's cells are already
slope-limited (§1.4 a), and `applyTool` flattens the tiles it zones today (`flattenTile`, `sim.ts:682`). In the oriented
path flatten the tiles under the painted cell's centre (`levelTiles([tileOf(centre)])`, `world.ts:755-769`), which keeps
neighbouring road tiles step-free.

---

## 3. Tile mirror

### 3.1 Why

These readers consume `w.zone`, `w.level`, `w.lotAt`, `w.lots` per tile and must keep working untouched in phase 1
(grep of non-test sources at `6f8be1a`):

| Reader | Call sites | Reads | Migrate later? |
|---|---|---|---|
| recount | `sim.ts:715-734` | zone, level (+cover, landValue per tile) | no: per-tile capacity is what the mirror is for |
| growth step | `sim.ts:803-833`, `lotsReadyToBuild` `blocks.ts:247` | lots, cover over footprint | **yes, phase 3** (iterate `olots`, `lot.tiles`) |
| refreshLots / extendLots / lotsOutOfSync / setLotLevel | `sim.ts:441-545` | zone, level, lotAt, lots | **replaced** in oriented mode |
| applyTool bulldoze/zone/facility | `sim.ts:599, 632, 636-637, 651, 679, 683-684` | zone, level | **replaced** in oriented mode (§4) |
| placeRoad clears ground | `sim.ts:393-394` | zone, level | oriented: clears cells under the new road via §1.6 migration (dropped cells) |
| networks (utility demand, candidates) | `networks.ts:178-187` | zone, level (+`findFrontage`) | later: use cells' front tile instead of `frontage.road` |
| land value | `world.ts:482-489` | zone, level | no |
| traffic lists | `traffic.ts:300-303` | zone, level | later: one trip source per lot, not per tile |
| transit riders | `transit.ts:139-142` | zone, level | no |
| inspect | `inspect.ts:70-78` | zone, level, lotAt, lots | **phase 6**: describe the cell/lot under the pointer |
| save | `save.ts:78-79, 87, 185-188, 200-205` | zone, level, lots | **phase 4** |
| props | `props.ts:55` | lotAt | no (mirror keeps props off lots) |
| renderer | `scene.ts:638, 670, 776` | zone, lots, level | `:670` **phase 5**; `:638` (tree scatter) and `:776` (warnings) stay on the mirror |
| blocks (old path) | `blocks.ts:151-209` | zone, level | flag-off only |

Tests touching these fields (counts of matches): `lots.test.ts` 31, `sim.test.ts` 15, `networks.test.ts` 5,
`save.test.ts` 4, `blocks.test.ts` 3, `elevation.test.ts` 2, `inspect.test.ts` 2, and one each in
`grade-separation`, `m21`, `roads`, `transit`, `traffic` tests. With the flag off they run unchanged; the oriented path
gets its own tests (phase acceptance lists) and, after cutover, the tile-poking tests (`lotsOutOfSync` exists for them,
`sim.ts:518-534`) are rewritten to paint through `applyTool`.

### 3.2 Rasterisation (`src/sim/mirror.ts`)

```ts
/** Rewrite w.zone, w.level, w.lotAt and w.lots from cells and oriented lots. Idempotent. */
export function rasterizeMirror(w: World, set: ZoneBlockSet, lots: readonly OrientedLot[]): void;
/** Cell whose centre tile is `tile`, if any (the inverse map the mirror writes). */
export function cellAt(w: World, tile: number): CellRef | null;
/** Nearest valid cell to a ground point, within `radius` tiles of its centre. */
export function nearestCell(set: ZoneBlockSet, x: number, z: number, radius: number): CellRef | null;
```

Rules:

- **Centre rule for cells**: cell → `tileOf(centre)`. The tile takes the cell's zone and level. Two cells on one tile
  (possible on curves and 45° roads): smaller `col` wins, then smaller `age`, then smaller `row`. Cells whose centre tile
  is a road tile never win (they are invalid anyway by §1.4 c).
- **Majority rule for lots**: `lotAt[tile] = lot.id` for every tile whose centre is inside the lot's rectangle
  (`lotContains`), **plus** the centre tiles of all its cells, so a 1×1 lot on a 45° road still owns exactly one tile. If
  two lots claim a tile (slivers on curves), the lot owning the cell that won the tile keeps it. `lot.tiles` is that set.
- `w.lots` (legacy `WorldLot[]`) is filled with `{ id, x, y, w, h: AABB of lot.tiles, facing: snapped 4-way facing from
  yaw, zone, level, depthFromRoad: col }` so untouched readers (and `save.ts` v1 writer when the flag is off) still see a
  plausible lot; `scene.ts:670` stops reading it in phase 5.
- Mirror tiles that are road/facility/water are never written (`blocksBuilding`, `w.facility`, `isLand`).
- Everything else derived (`cover`, `connected`, `landValue`, `nets`) is computed from the mirror as today; the mirror is
  rewritten whenever cells, lots or levels change, before `updateCoverage` (`world.ts:429`) runs.

`cellAt` is a `Int32Array(size²)` of packed `(blockIndexInSet << 6 | row << 2 | col)` kept inside `ZoneBlockSet`, rebuilt
with the mirror, so the renderer's warning diamonds (`scene.ts:773-786`) and the inspector can go from tile to cell in O(1).

---

## 4. Interaction

Today: `bindInput` picks a tile per pointer sample and emits 4-connected `lineTiles` between samples
(`input.ts:62-68, 21-35`); `main.ts:347-353` calls `applyTool(state, tool, tile.x, tile.y)`; hover is an axis-aligned
box (`scene.ts:1323-1329`); picking is a terrain raycast (`scene.ts:1187-1198, 1309-1321`).

### 4.1 Input hook (`src/input.ts`, additive)

```ts
export interface InputHooks {
  paint(tile: Tile, first: boolean): void;                 // unchanged, flag-off path
  /** Oriented zoning: every ground point of the stroke, resampled every 0.5 tiles. */
  paintPoint?(p: { x: number; z: number }, first: boolean): void;
  // ...
}
```
`paintAt` uses `r.pickPoint` and emits `paintPoint` for points along the straight line between the previous and current
pick at 0.5-tile steps (so a fast drag along a diagonal street still touches every cell), then falls back to `paint`
when `paintPoint` is absent. `lineTiles` stays for roads-by-paint compatibility tests (`input.test.ts`).

### 4.2 Zone tools (`src/sim/sim.ts`, oriented path)

```ts
export interface ZoneBrush { radius: 0 | 1 | 2 }   // 0 = one cell, 1 = 3-cell diameter, 2 = 5
export function applyZoneAt(s: CityState, zone: ZoneType | 0, x: number, z: number, brush: ZoneBrush): ToolResult;
```

- Pick: `nearestCell(set, x, z, 0.75)`; none → `{ ok: false, reason: "Zones must be within 4 tiles of a road" }` (same
  i18n key as `sim.ts:681`). Brush: all valid cells of **any block** whose centre is within `radius + 0.5` of the picked
  cell's centre.
- Set `zone`, `level = 0` on cells that change; charge `COST.res` per changed cell (`sim.ts:32`); flatten
  `tileOf(centre)`; bump `w.zoneRevision`, set `w.lotsDirty`, `w.coverageDirty`, `w.revision++` (today's sequence,
  `sim.ts:682-692`). Apply G-INHERIT (§1.5 (3)) to unzoned neighbours of the painted cells only when the brush radius is 0
  (CS1 behaviour: a single cell beside another block's zoned cell inherits).
- Painting a cell that already has that zone is free and `ok` (`sim.ts:679`).
- Drag along a segment: the stroke resampling in §4.1 already lands on consecutive rows; no segment-locking is needed.
  Optional later: shift/second-finger "lock to the first block" (open question Q6).

### 4.3 Bulldoze

`bulldozeAt(s, x, z)`: order of precedence as today (`sim.ts:597-643`): stop → road → facility → lot/cell. On a cell: if
`cell.lot ≥ 0` the whole lot's level is set to 0 (building removed, as `lots.test.ts:152` asserts) and the clicked cell's
zone is cleared; the other cells keep their zone and are re-planned on the next `syncLots`. Charge `COST.bulldoze` once.

### 4.4 Hover, inspect, preview

- `CityRenderer.setHoverCell(pose: CellPose | null, color)`: the hover mesh (`scene.ts:298-303`) gets
  `rotation.y = pose.yaw`; a second instanced mesh shows the brush footprint (up to 25 cells).
- `CityRenderer.pickCell(clientX, clientY): CellRef | null` wraps `pickPoint` + `nearestCell`.
- Inspect (`describeTile`, `inspect.ts:38-88`): new `describeAt(s, x, z)` resolves the cell under the point, then its
  lot (`block.lot`), and returns the same `TileInfo` shape with `x, y` = `tileOf(centre)` so `Inspector` (`ui/inspector.ts`)
  is unchanged. `area = lot.w * lot.d`.
- Road preview: when a road is being drawn (`updatePreview`, `main.ts:231-249`), also draw the ghost blocks
  `blocksForSegment(w, { type, pts })` as faint rotated outlines (reuses the zones instanced mesh with a translucent
  colour), so the player sees where lots will go before committing. Cheap: ≤ 2 × (60/8) blocks.

---

## 5. Save format v2

Today: `SAVE_VERSION = 1`; `zone`/`level` as base64 tile arrays, `lots: WorldLot[]`, strict `validateStructure`
(`save.ts:6-39, 97-159`); loading rejects `f.v !== SAVE_VERSION` (`save.ts:168`).

### 5.1 File

```ts
export const SAVE_VERSION = 2;
interface SaveFileV2 extends Omit<SaveFileV1, "v" | "zone" | "level" | "lots" | "nextLotId"> {
  v: 2;
  zoning: "oriented";
  /** One entry per block that has at least one zoned cell. Cells are row-major rows×4. */
  cells: { seg: number; side: -1 | 1; block: number; rows: number; zone: string /* b64 */; level: string /* b64 */ }[];
  lots: { id: number; seg: number; side: -1 | 1; block: number; row: number; col: number; w: number; d: number; zone: 1 | 2 | 3; level: 0 | 1 | 2 | 3 }[];
  nextOLotId: number;
  /** Tile mirror, kept so a flag-off client (or v1 tooling) can still open the file. */
  zone: string; level: string;
}
```

Positions are **never** saved for cells or lots: they are re-derived from `segments` (saved verbatim already,
`save.ts:81`) so a round trip is bit-exact and float drift cannot desynchronise blocks from roads. Deterministic ids:
blocks are addressed by `(seg, side, block)`; lot ids are the saved integers; `nextOLotId ≥ max(id) + 1` is enforced on
load like `nextSegmentId` (`save.ts:196`).

### 5.2 Validation (extend `validateStructure`, same `bad()` idiom, `save.ts:97-159`)

- `cells`: array; every `seg` in `segIds`; `side ∈ {−1, 1}`; `block` integer ≥ 0; `rows ∈ 1..8`; `zone`/`level` decode to
  exactly `rows*4` bytes with values ≤ 3; no duplicate `(seg, side, block)`.
- `lots`: ids positive integers, unique; `(seg, side, block)` exists in `cells`; `row + w ≤ rows`, `col + d ≤ 4`,
  `1 ≤ w, d ≤ 4`; zone/level in range; **no two lots share a cell** (replace today's tile `taken` test, `save.ts:143-157`).
- `zone`/`level` mirror strings: present and `n*n` bytes (as today, `save.ts:185-188`).

### 5.3 Load paths

```ts
export function deserialize(json: string): CityState;        // accepts v1 and v2
export function migrateV1Cells(w: World): MigrationReport;    // tiles -> cells by nearest valid cell
```

- **v1 → oriented**: load as today through tiles, then `set = buildZoneBlocks(w)`; for each tile with `zone ≠ 0`, pick
  `nearestCell(set, x+0.5, y+0.5, 0.75)` that is valid and unzoned; copy zone and level; tiles with no cell are dropped
  (reported). Then plan lots with `keep` derived from v1 `lots` mapped through their anchor tile's cell (so a saved 2×2
  stays 2×2 when all four tiles map to adjacent cells). Levels come from cells, so no building is lost unless its tile had
  no valid cell (a tile zoned beside a road that is now a tunnel, etc.).
- **v1 → tiles** (flag off): exactly today.
- **v2 → oriented**: segments → nodes (`rebuildNodes`, `roads.ts:918`) → `buildZoneBlocks` → copy saved cell bytes into
  blocks whose geometry matches (`rows` must equal; otherwise migrate by nearest from a temporary block built from the
  saved rows, and report) → lots → mirror → `refreshDerived` (`sim.ts:778-788`). The nodes step is mandatory: the
  loader calls `adoptNodes(w)` (saved a/b ids, no renumbering) before `buildZoneBlocks`, because validity reads the
  junction layouts. Building against the nodes left over from `newCity()` gave other junctions, the saved lots then
  contained "invalid" cells and were cleared with their zone (Y fork: 8 of 338 zoned cells lost per round trip).
  Saved zone bytes are copied for every cell; a cell that is valid under the current rules keeps its zone, and only
  lots containing a now-invalid cell are discarded and replanned.
- **v2 → tiles** (flag off): read the `zone`/`level` mirror strings, rebuild lots from zoning (today's "pre-lot save"
  path, `lots.test.ts:193`). Lossy on diagonals but opens.
- Writer: flag on → v2; flag off → v1 (unchanged). `storage.ts` untouched. `save.test.ts:63` (`v: 99` rejected) stays.

---

## 6. Rendering resolution upgrade

What exists: procedural window texture 64 px canvas, `anisotropy = 2` (`models.ts:276-292`); kit textures are 128–256 px
greyscale PNGs (`blender/make_textures.py:44-151`) loaded with `anisotropy = 4` (`kit-materials.ts:26-39`,
`scene.ts:202-209`); HD variants exist only for terrain and road (`make_textures_hd.py:7-9`: 1024² general, 2048²
terrain; `public/textures/*_hd.png`); shadow map 1024/2048 by tier, pixel caps 1/1.5/2 (`prefs.ts:19-38`,
`scene.ts:1383-1390`); max anisotropy is queried (`scene.ts:214`) but only the road atlas uses it. Pads are flat boxes
with a vertex tint (`scene.ts:690-708`).

### 6.1 Proposals (code; owner codex unless noted)

| # | Change | Where | Budget note (iPad = A12–M1 class, Safari) |
|---|---|---|---|
| R1 | `QualityProfile` gains `aniso: 2 \| 4 \| 8 \| 16`, `tex: "sd" \| "hd"`, `shadow: 0 \| 1024 \| 2048 \| 4096`, `padTex: boolean` | `prefs.ts:23-38`; `prefs.test.ts` monotonic checks extended | 4096 shadow only when `renderer.capabilities.maxTextureSize ≥ 8192` **and** not iOS (64 MB depth target); iPad high stays 2048 |
| R2 | Kit textures by tier: `texture(name)` loads `${name}_hd.png` when `tex === "hd"` and it exists, else the SD file | `kit-materials.ts:26-39`, `scene.ts:1372-1413` (`setQualityCap`) | 19 patterns × 512² RGB ≈ 19 MB uncompressed with mips on hd; sd stays ~3 MB |
| R3 | Window texture 64 → 256 px, drawn with a frame, sill and two-tone glass; glow map matches; `anisotropy = profile.aniso` | `models.ts:276-292` | negligible |
| R4 | Anisotropy everywhere from the profile (`min(profile.aniso, maxAniso)`), not literal 2/4 | `scene.ts:207`, `kit-materials.ts:33`, `terrain-splat.ts`, `road-material.ts` | free on Apple GPUs up to 8 |
| R5 | Plot material: pads use a `MeshLambertMaterial` with `map: plot.png` and world-space UVs (`onBeforeCompile`: `vUv = (instanceMatrix * position).xz`) so a rotated pad shows kerb line, gravel and grass at 1 repeat per tile regardless of yaw/scale | `scene.ts:324` (zones mesh material), new `render/plot-material.ts` | one 512² texture |
| R6 | HD ground under lots: a `surface` mask (`Uint8Array((size*4)²)`, 4 texels per tile) rasterised from lot OBBs (plot) and road ribbons (pavement band 0.5 tile, R-GROUNDMASK) fed to the terrain splat as a 4th layer weight | new `render/surface-mask.ts`, `terrain-splat.ts` shader, `scene.ts` rebuild | 512² R8 texture for 128 maps; rebuild < 2 ms |
| R7 | Pixel density tiers: keep 1 / 1.5 / 2 (`QUALITY_PIXEL_CAP`); add `"ultra"` = 3 **desktop only** (Tauri) hidden on iPad; `adaptResolution` (`scene.ts:1351-1369`) unchanged | `prefs.ts`, `menu.ts:190-200` | ultra is opt-in; never default |
| R8 | LOD for far lots: pads and kerbs join the LOD partition (`updateLod`, `scene.ts:1440-1486`): beyond `lodDist` pads are hidden (count shrink) and kerbs dropped; buildings already collapse to `lodBox` | `scene.ts` | removes ~2 × lots instances from far draw |
| R9 | Textures as KTX2/ASTC (04 §3.2 item 4) | later; needs `KTX2Loader` + `gltf-transform` in `npm run assets` | only after measuring `renderer.info.memory.textures`; open question Q8 |

Texture memory targets (04 §3.2 item 7): ≤ 64 MB medium, ≤ 128 MB high on iPad, measured via
`renderer.info.memory.textures` exposed in `lodStats()` (`scene.ts:1430-1433`).

### 6.2 Blender / art side (`blender/`, owner muse or codex-with-python3; no Blender needed for textures)

- `make_textures.py`: parametrise sizes; emit `name.png` (today's sizes) **and** `name_hd.png` at 512² (plaster, brick,
  roof_tile, concrete, paving, wood, metal, glass_curtain, gravel; `window.png` 256² with 2 × 2 lit cells, `window_glow`
  matching); add `plot.png` 512² (light concrete with a darker kerb band along `v = 0..0.08` and grass elsewhere) and
  `plot_hd.png` 1024². Keep each < 1.5 MB (`make_textures_hd.py:14` rule). `build_all.py:55-61` already copies every PNG
  from `blender/textures/` to `public/textures/`, so no code change is needed for the copy.
- `lib.PATTERN` (`lib.py:92-110`) keeps the repeat sizes; the game chooses the file, not Blender.
- AO: stays baked per vertex (`COLOR_0`, read by `glb-models.ts:38-47`); no texture AO. Optional later: bake an ORM
  texture per hero model (B-BAKE), not needed for this spec.
- Models: no change; lots are rotated 1×1 or 2×2 footprints of existing GLBs (rule 7 holds).
- `glb-assets.test.ts`: add a test that every `*_hd.png` has an SD sibling and is ≤ 1.5 MB, and that `plot.png` exists.

---

## 7. Feature flag and rollback

- `Prefs.zoning: "tiles" | "oriented"` (default `"tiles"` until phase 8), persisted by `loadPrefs/savePrefs`
  (`prefs.ts:45-69`) with the same defensive parsing; a select in the "Jogabilidade" tab of `menu.ts:180-233`
  (`i18n` keys: "Zoning", "Tile grid (classic)", "Street-aligned lots (new)").
- `main.ts`: `useCity` sets `state.world.zoning = prefs.zoning`; changing the pref on a running city calls
  `setZoningMode(state, mode)` which converts in place: tiles → oriented runs `migrateV1Cells`; oriented → tiles
  rasterises the mirror and runs today's `refreshLots`. Both directions are total (lossy on diagonals), so rollback is one
  preference change plus a reload of the autosave.
- Every oriented entry point is a branch on `w.zoning`: `applyTool` (zone tools, bulldoze), `syncLots`, `placeRoad`
  (clear-under-road), `serialize`, `describeTile`, the renderer's lot block and the input hook. Nothing in the tiles path
  is edited except these branches, so `git revert` of a phase cannot break the classic game.

---

## 8. Phases

Each phase is sized for one engineer in its own worktree for 30–60 minutes (`AGENTS.md` "Como os agentes são
disparados"). Owners: **codex** (gpt-5.5; runs `npx tsc --noEmit` and `npx vitest run`; no Blender, no browser),
**muse** (Blender/art; quota-limited, so every muse task has a codex fallback), **lead** (merge with `git apply --3way`,
`npm run ci`, visual check on the dev server via `window.__city`). Files listed under *owns* are disjoint between phases
marked parallel; shared files name the exact function.

| # | Phase | Owner | Depends on | Parallel with |
|---|---|---|---|---|
| P0 | Contracts and flag | lead | — | — (30 min, unblocks everything) |
| P1 | Zone blocks core | codex | P0 | P2, P6, P7 |
| P2 | Oriented lot planner | codex | P0 | P1, P6, P7 |
| P3 | Mirror and sim wiring | codex | P1, P2 | P4 (after P3 API lands), P6, P7 |
| P4 | Save v2 and migration | codex | P3 | P5, P6, P7 |
| P5 | Oriented rendering | codex (lead checks visually) | P2, P3 | P4, P6, P7 |
| P6 | Interaction | codex | P3, P5 | P4, P7 |
| P7 | Resolution upgrade (code) | codex | P0 | P1–P6 |
| P8 | HD textures (art) | muse → codex fallback (python3 only) | — | everything |
| P9 | Cutover and cleanup | lead | P1–P8 | — |

**P0 — Contracts and flag (lead).** Goal: everyone compiles against the same types. Owns: `src/sim/zonecells.ts`
(types and constants from §1.1, §2.1, exactly as written), `src/prefs.ts` (+`zoning`), `src/ui/menu.ts` (select),
`src/i18n.ts` (3 keys), `src/sim/world.ts` (fields of §1.7, initialised), `src/main.ts` (pass `prefs.zoning` to
`newCity`/`useCity`). API: the types file. Tests: `prefs.test.ts` round-trips `zoning`; `sim.test.ts` asserts
`newCity().world.zoning === "tiles"`. Rollback: pure additions.

**P1 — Zone blocks core (codex).** Goal: §1.2–1.6 as pure functions. Owns: `src/sim/zoneblocks.ts`,
`src/sim/zoneblocks.test.ts`. API: `buildZoneBlocks`, `blocksForSegment`, `cellPose`, `cellCorners`, `cellIndex`,
`migrateCells`, `nearestCell` (moved here from §3.2 since it needs only the set). Acceptance tests: (a) a straight
axis-aligned street through tile centres yields cell centres equal to the tiles `findFrontage` marks today (compare
against `getFrontage(w)` on the same world); (b) a 12-row street gives 2 blocks of 6; 20 rows → 3 blocks 7/7/6;
(c) a 45° street has 4 valid columns on both sides and no cell centre on a road tile; (d) a T-junction: the crossing
street's cells over the junction are invalid, the corner cell belongs to the older segment; (e) two parallel streets
6 tiles apart: no shared cells; 4 tiles apart: inner cells shared, nearer road wins; (f) slope and row cut-off
(port `blocks.test.ts:128`); (g) migrate: split a zoned street at its middle with `addSegment` and assert every zoned
cell survives with the same zone/level and `dropped.length === 0`; (h) 2 000 segments on 128² < 15 ms; (i) determinism.
Rollback: file is unused until P3.

**P2 — Oriented lot planner (codex).** Goal: §2.2–2.3. Owns: `src/sim/orientedlots.ts`, `src/sim/orientedlots.test.ts`,
and the pure helpers in `src/render/lots.ts` §2.5 (`orientedModelCells`, `orientedKerb`, `orientedPad`; additive) with
`src/render/lots.test.ts` additions. Build fixtures with `blocksForSegment` from P1's **interface** (if P1 is not merged
yet, a tiny hand-built `ZoneBlock` fixture in the test is acceptable). Acceptance: (a) a fully zoned 8×4 block becomes two
4×4 lots at level ≥ 2 commercial, and 2×2/2×1/1×1 for residential level 0; (b) persistence: `keep` with a 2×2 level-3
lot is re-emitted with the same id after re-planning; (c) a lot never spans rows whose yaw differs by > 6°;
(d) `lotPose` yaw points toward the road: for a street along +x with a lot on the left side, `yaw` equals
`lotYaw({facing:{dx:0,dy:+1}})` or its mirror as appropriate — pin the sign in the test; (e) `orientedModelCells` for 2×2
returns the four cell centres rotated by yaw; (f) determinism.

**P3 — Mirror and sim wiring (codex).** Goal: §3 and the oriented branches in `sim.ts` behind `w.zoning`. Owns:
`src/sim/mirror.ts`, `src/sim/mirror.test.ts`, `src/sim/sim.ts` (functions `refreshOrientedLots`, `syncLots` branch,
`applyZoneAt`, `bulldozeAt`, `applyTool` dispatch, `placeRoad` clear-under-road branch, `step` footprint loop →
`lot.tiles`, `setOLotLevel`), `src/sim/world.ts` only if a derived field is missing. API: `rasterizeMirror`, `cellAt`,
`getZoneBlocks(w)` (cached by `graphRevision` + `obstacleRevision`), `applyZoneAt`, `bulldozeAt`. Acceptance (all with
`zoning = "oriented"`): (a) paint a diagonal street's cells, `step` 200 days with power and water → buildings grow and
`recount` population equals the tile-mode city built on the equivalent axis-aligned street; (b) `lotsOutOfSync`-style
check: mirror is idempotent (`rasterizeMirror` twice → same arrays); (c) bulldozing a cell with a level-2 lot zeroes the
lot and clears exactly that cell's zone; (d) building a road across a zoned block drops only the cells under it and keeps
the others' levels; (e) all existing tests still pass with the flag off (`npx vitest run` 307+).

**P4 — Save v2 and migration (codex).** Goal: §5. Owns: `src/sim/save.ts`, `src/sim/save.test.ts`. API: `SAVE_VERSION = 2`,
`deserialize` accepting v1/v2, `migrateV1Cells`. Acceptance: (a) oriented city round-trips bit-exact (cells, lots, ids,
mirror, then 60 identical `step`s, as `save.test.ts:41-50`); (b) a v1 file (fixture from `builtCity()` serialised with the
flag off) loads in oriented mode with population within 2 % after 60 days and zero dropped cells on axis-aligned roads;
(c) a v2 file loads with the flag off; (d) damaged `cells`/`lots` (overlapping lots, bad side, rows ≠ bytes) throw
`SaveError`; (e) counters stay above stored ids; (f) size stays under the localStorage budget (`save.test.ts:44`).

**P5 — Oriented rendering (codex; lead visual).** Goal: §2.5 and §4.4 hover in `scene.ts`. Owns: in `src/render/scene.ts`
only the lot block of `rebuild()` (`scene.ts:667-729`), `placeLotCell`, `setHover`/new `setHoverCell`, new `pickCell`;
`src/render/lots.ts` consumers. When `w.zoning === "oriented"`, iterate `w.olots`: pads/kerbs as rotated instances,
models via `orientedModelCells` + `lotPose.yaw`, depth shade by `col`, plot under multi-cell built lots. Acceptance:
`render/lots.test.ts` for the new helpers; a headless check that `rebuild()` with 500 oriented lots sets
`zones.count`, `kerbs.count` and building counts equal to the tile path for the same axis-aligned city (instance counts
are observable without WebGL via the `InstancedMesh` counters in a jsdom-free unit test of the helper that computes
them — factor the per-lot instance computation into a pure function `lotInstances(w, lot)` so it can be tested). Lead
confirms on the dev server: diagonal street, curved street, T-junction, no pad on asphalt, buildings face the kerb.

**P6 — Interaction (codex).** Goal: §4.1–4.3 and inspect. Owns: `src/input.ts` (+`paintPoint`), `src/input.test.ts`,
`src/main.ts` (zone tools → `applyZoneAt`, bulldoze → `bulldozeAt`, hover → `setHoverCell`, inspect → `describeAt`,
road preview ghost blocks), `src/sim/inspect.ts` (+`describeAt`), `src/sim/inspect.test.ts`, `src/ui/hud.ts` (brush
size buttons 1/3/5 in the Zones flyout, optional), `src/i18n.ts` keys. Acceptance: `input.test.ts` asserts the stroke
resampling emits points every ≤ 0.5 tiles; `inspect.test.ts` describes a lot on a 45° street with the right area and
headcount; manual: painting along a diagonal street fills consecutive cells without gaps.

**P7 — Resolution upgrade, code (codex).** Goal: §6.1 R1–R5, R8. Owns: `src/prefs.ts` (`QualityProfile` fields; P0 adds
`zoning` first — rebase), `src/prefs.test.ts`, `src/render/kit-materials.ts`, `src/render/models.ts`
(`makeWindowTextures`), `src/render/plot-material.ts` (new), `src/render/terrain-splat.ts` and `src/render/road-material.ts`
(anisotropy from a parameter), and in `src/render/scene.ts` **only** the constructor texture loader (`scene.ts:202-220`),
`setQualityCap` (`scene.ts:1372-1413`) and `updateLod` (`scene.ts:1440-1486`). Acceptance: `prefs.test.ts` monotonic
`aniso`/`shadow`/`tex`; a unit test that `textureName("brick", "hd")` → `brick_hd` and falls back when the HD file is
absent (inject the existence check); `lodStats()` reports texture memory. Lead measures on iPad: medium ≤ 64 MB textures,
≥ 30 fps on the 96² demo city.

**P8 — HD textures, art (muse; codex fallback with `python3 blender/make_textures.py`).** Goal: §6.2. Owns:
`blender/make_textures.py`, `blender/textures/*.png` (new `_hd` and `plot*`), `public/textures/*` (via `build_all.py`
copy or a manual copy), `src/render/glb-assets.test.ts` additions. Acceptance: every SD texture has an `_hd` sibling
≤ 1.5 MB, `plot.png`/`plot_hd.png` exist, the window texture is 256² with matching glow. No TypeScript except the test.

**P9 — Cutover and cleanup (lead).** Flip `defaultPrefs().zoning` to `"oriented"`; `newCity` default; convert the
`sim.test.ts`/`lots.test.ts` tile-poking cases to paint through `applyZoneAt`; update `README.md`, `PROGRESS.md`
(M26 → done), the status artifact; file follow-ups for the "later" readers in §3.1 (traffic per lot, networks via cells).
Keep the tiles path for one release, then delete `blocks.ts` paths that only the flag-off branch uses.

---

## 9. Risks and open questions

| # | Risk / question | Recommendation |
|---|---|---|
| Q1 | **Avenue raster is off-centre**: a width-2 road at a tile-centre axis rasterises tiles `k, k+1` (`world.ts:549`), so its asphalt (±0.9) and its raster are asymmetric; cells at `lat0 = 1.5` half-overlap one raster tile on one side. | Accept: the raster tile is only a sim mark; §1.4 (c) samples the cell **centre**, which lands outside. Document; do not move avenue axes (would break saves). |
| Q2 | **Curve self-overlap** on tight Béziers produces few valid inner cells and odd outer gaps. | Same as CS1; acceptable. Expose `MIN_CURVE_RADIUS` in the road tool later (04 §1.1 suggests 1-tile minimum segments anyway). |
| Q3 | **Migration drops zone on reshaping roads** (a street redrawn 1 tile over loses its lots). | Report dropped cells in a toast; keep `MIGRATE_RADIUS = 0.75` (a full tile would steal neighbours' cells). Consider refund of zone cost for dropped cells (cheap, friendly). |
| Q4 | **Two cells on one tile** on 45° roads: the mirror's centre rule hides one cell from recount/networks, so a diagonal block's capacity is slightly under-counted (≈ 15 % of cells). | Accept for phase 3; fix in the "later" readers (§3.1) by iterating cells/lots instead of tiles. Note the bias in `PROGRESS.md`. |
| Q5 | **Networks** (`networks.ts:162-190`) key demand by `frontage.road[tile]` from `findFrontage`, which stays tile-based; on diagonals a mirror tile may have no tile frontage although its cell does. | In P3, have `rasterizeMirror` also write a derived `w.frontTile: Int32Array` (road tile under `C(s_row)`) and let `updateNetworkCoverage` prefer it when `zoning === "oriented"`. Small, contained. |
| Q6 | **Brush locking to one segment** during a drag (CS2-like). | Not in P6; the 0.5-tile stroke resampling already stays on the street the pointer follows. Revisit after playtest. |
| Q7 | **`WorldLot` legacy shape in `w.lots`** keeps 4-way `facing`, misleading for rotated lots. | Only the renderer reads `facing`, and P5 stops reading `w.lots` in oriented mode. Delete `w.lots` from the oriented save (not written in v2) and from readers at P9. |
| Q8 | **KTX2/ASTC** (R9) and SDF markings (04 §3.2) are bigger than this spec. | Measure first (`renderer.info.memory.textures` via P7). If medium > 64 MB on iPad, open a separate spec; otherwise PNG `_hd` is enough. |
| Q9 | **Save size**: v2 adds ~ (rows×4×2 bytes per zoned block) + lots; a 128² city with 1 500 zoned blocks adds ≈ 100 KB b64 before the mirror. | Keep the mirror (needed for flag-off), drop `lots` legacy array from v2, and test against the budget in `save.test.ts:44`. If over, compress `cells` with a run-length pass. |
| Q10 | **Three.js yaw sign** (`atan2(T.x, T.z)`) vs the GLB −Y front. | Pin in P2 test (d) against `lotYaw` on an axis-aligned fixture; lead verifies one diagonal street visually before P6 starts. |
| Q11 | **Muse quota** for P8. | `make_textures.py` is numpy/PIL only; codex can run it. Blender is not needed for any texture in this spec. |
| Q12 | **Perf of overlap resolution** with 2 000 segments. | Spatial `tileIndex` bounds candidate pairs to neighbouring blocks; budget asserted in P1 (h). If it fails, resolve only blocks whose AABBs intersect (same idea CS1 uses with its 92 m cut-off). |
