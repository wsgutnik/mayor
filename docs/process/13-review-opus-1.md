# Mayor adversarial review (opus-1), read-only

Repo at commit bcfc67a. I edited no repo files. The scratch tests live in `/tmp/mayor-review-opus1/`, with their own
`vitest.config.ts` and a symlink to the repo's `node_modules`. To run one:
`npx vitest run --config /tmp/mayor-review-opus1/vitest.config.ts --disableConsoleIntercept <name>`
from the repo root. Every number below comes from those runs (Node, Apple Silicon desktop). An iPad will be slower.

Severity: S0 is a crash or data loss. S1 is a visible defect or broken behaviour in normal play. S2 is a defect that
needs a specific but reachable input, or a budget breach. S3 is minor or dead code.

---

## Priority 1: junction.ts, render/roads.ts, earclip.ts, lanes.ts, signals.ts

### F1 [S1] Lane graph drops most connectors because endpoints sit on the asphalt boundary
`src/sim/lanes.ts:37-39` (`endpoint`) and `lanes.ts:63` (`pts.every(p=>pointInPolygon(p,asphalt))`).
- Each connector's first and last points sit at `trim`, which is exactly on the mouth edge of the asphalt ring.
  `pointInPolygon` uses a half-open crossing rule, so mouth points on the +x and +z arms come out as "outside".
- Scenario: a plain street x street cross (`lanes2.test.ts`) should give 4 arms x 3 turns = 12 connectors. It gives
  **2** (one right, one left). Avenue x street and avenue x avenue also give 2. Lane arrows appear on only 2 of 4 arms.
  `lanes3.test.ts` shows the cause: on the (1,0) and (0,1) arms the endpoint at trim tests `inside=false`, and the same
  point moved 1e-3 into the pad tests `inside=true`.
- The existing test `lanes.test.ts` only asserts `connectors.length > 0`, so it hides this.
- Fix: put the endpoints at `trim - 1e-3`, or test only the interior samples plus a `distToRing <= 1e-3` tolerance.
  Add a test that a cross gives exactly 12 connectors and 4 arms with arrows.

### F2 [S1] Lane offsets are mirrored at end "b": inbound lanes from both ends land on the same side of the road
`src/sim/lanes.ts:30-39`, and the renderer copies the same convention at `src/render/roads.ts:705-711`.
- `laneCentres` are measured in the segment frame (a→b; negative means right of a→b, `corridor.ts:17`).
- `endpoint` applies them along `(-dz,dx)` of the arm's outward direction. That direction is +a→b at end "a" and −a→b
  at end "b", so the frame flips between the two ends.
- Scenario: in a cross, the inbound connector at an end-"b" arm starts at segment-frame lateral **+0.19**. The corridor
  rule says a→b traffic must be at x<0. Inbound lanes from end "a" are also on the +x side, so the two directions
  overlap.
- The same flip makes `li === 0` (the left-turn lane) the outermost lane at end "b".
- Separate inconsistency in the conventions: `corridor.ts:190` calls `(-tz,tx)` "left", but `classifyTurn`
  (`signals.ts:99`) calls that direction "right". For travel north (0,-1), east (1,0) classifies as "right".
- Fix: map lanes into the arm frame with `armOff = end==="a" ? x : -x`, then sort inner to outer so index 0 is the
  innermost lane. Use the same mapping in `junctionLaneArrows`. Settle the left/right naming in `corridor.ts`.

### F3 [S2] Stop bar and turn arrows sit on opposite halves of the road; one-way roads are ignored
`src/render/roads.ts:661-668` (and the atlas version at 642-645) against `roads.ts:705-711`.
- The stop bar always covers outward-frame lateral [−0.92·hw, 0]. The arrows sit at +x at end "a" and at −x at end "b".
- Measured (`lanes2.test.ts`): at every end-"a" arm the stop bar centre is at −0.17 and the arrows at +0.19, so they
  are on opposite halves. Avenue: −0.37 against +0.32/+0.65.
- `LaneArm` has no `oneWay` or `dir`. One-way types reuse the symmetric two-way `laneCentres` (`corridor.ts:93`). So
  exit-only one-way arms still get inbound connectors and arrows, and their stop bars cover only half the width.
- Fix: draw the stop bar from the same inbound-lane mapping as F2. Pass oneWay and dir into `LaneArm`: no inbound lanes
  on exit-only arms, and a full-width stop bar on entry-only arms.

### F4 [S1] Negative trims on mixed-width convex corners make every ring self-intersect
`src/sim/junction.ts:864-876` (asphalt layer) and `893-903` (outer layers).
- The arc corner is recomputed with `lineHit` and `footOnLine`, and the result is not clamped. `finalizeConvex` clamps
  with `Math.max(0, …)`, but the ring construction does not use those clamped trims. This breaks the contract stated
  at the top of the file ("trims … always >= 0").
- Scenario (`degen3.test.ts`): an avenue arrives from the west, and two streets leave east at 0° and 30°. The avenue's
  `trimNeg.asphalt` is **−0.482**. The asphalt, kerb, sidewalk and boundary rings all self-intersect (checkJunction
  reports "self-intersection at edges 28,30", among others). The ring folds back on itself at x=32.5:
  z 33.31 → 31.69 → 32.12.
- The angle sweep (`degen.test.ts`, avenue plus a street pair) fails at **every** angle from 4° to 45°. At 25° the kerb
  band triangulates to area 1.72 against an expected 0.60.
- Fix: clamp `tA` and `tB` to at least 0. When the clamped arc no longer reaches tangency, fall back to the miter path,
  as `miterCorner` does. Add the avenue + street-pair sweep at 4–60° to `acute-junction.test.ts`.

### F5 [S1] Arms closer than about 4° produce bow-tie or non-nested rings
`src/sim/junction.ts:826-828`, the merged/straight branch: both layer points are taken at t=0 with each arm's own offset.
- Scenario (`degen.test.ts`): a Y whose two arms are 2° or 2.9° apart. With any mix of street and avenue, the asphalt,
  kerb and sidewalk rings all self-intersect ("edges 0,2"). `triangulateRing` then covers **3x** the ring area
  (street/street at 2°: 0.0148 against 0.0049).
- At 3.1° and 4°: "asphalt vertex outside kerb", "asphalt/kerb edges cross". At 3.1° the kerb ring's area is smaller
  than the asphalt ring's (−3.34 net).
- Fix: when a gap is merged, fold the two arms into one mouth (outer edge from the outer arm, shared trims), or reject
  the placement. Raise the robust threshold until the sweep passes, which needs at least 5°.

### F6 [S1] The band fallback has no area guard, so kerb triangles cover the asphalt even when checkJunction passes
`src/render/earclip.ts:626-638` (`bandCompute` takes `clipBand` results by minimum angle only).
- Scenario (`degen2.test.ts`): a street from the west, and an avenue Y at 35°. `checkJunction` passes. But the
  asphalt→kerb band covers 5.772 tile² against an expected 1.110, and **4.88 tile²** of its triangles have centroids
  inside the asphalt ring.
- The band is emitted at `bandLift`, above the asphalt patch, so grey kerb triangles paint over the junction asphalt.
- Fix: apply the strip's area guard to each clip candidate (|got−want| ≤ max(0.02, 5%)) and return null when none pass.
  Then see F7 for what null does.

### F7 [S1] The "stacked underneath" fallback is actually drawn on top of the asphalt
`src/render/roads.ts:781-792`.
- When `triangulateBand` returns null, the full kerb or sidewalk ring is emitted at `bandLift = NODE_ASPHALT_LIFT + 0.004`.
  That is **above** the asphalt patch at `NODE_ASPHALT_LIFT`, even though the comment says "stacked underneath …
  hidden by the inner surface".
- Scenario: the avenue + street-pair Y at 3.1° returns a null band (`degen.test.ts`). The whole pad renders kerb grey.
- Fix: emit the fallback below the asphalt (`NODE_ASPHALT_LIFT - 0.004`, which is still above ribbon lift), or draw it
  first with polygonOffset.

### F8 [S2] Road rebuild far exceeds the 10 ms iPad budget (rule 4)
- Measured (`perf.test.ts`): a 96x96 grid with 285 nodes and 480 segments.
  - After a graph edit, `junctionsOf` takes **25–48 ms**.
  - `buildRoadNetworkGeometry` then takes **60–111 ms** with atlas.
  - A warm rebuild with no graph change still takes **23 ms**.
- Causes:
  1. `junction.ts:1372-1383` rebuilds every layout on any `graphRevision` bump. Every ring array is therefore new, so
     the identity-keyed caches in `earclip.ts:79-89` (and the band and strip caches) all miss. The cache comment says
     edits only change nearby junctions, but that reuse never happens.
  2. `scene.ts:2029-2031` → `rebuild()` → `rebuildRoads()` runs on every `world.revision` bump (zoning, growth), even
     when the graph has not changed.
  3. `roads.ts:890` and `915` call `w.segments.find` inside per-node and per-arm loops, which is O(nodes·arms·segs).
- Fix: rebuild only the dirty 1-ring and reuse unchanged layout objects (P7 in the file comment). Key `rebuildRoads` on
  graphRevision, terrain and atlas. Use `segById`.

### F9 [S2] A degenerate curve control point gives a zero tangent and the junction collapses
`src/sim/roads.ts:569-580`: `|| 1` turns a zero-length leg into the tangent (0,0).
- Scenario (`zero.test.ts`): `addSegment(w, 1, [{30.5,32.5},{30.5,32.5},{40.5,45.5}])` on a through street. It is
  accepted, and arm 3 has `dx=dz=0`. The T layout has "asphalt: not CCW (area 0.000000)" and "repeated vertex", so no
  patch is drawn and the junction shows a hole.
- Fix: take the tangent from the first point that differs from the tip (or from the curve derivative), and reject
  zero-tangent control points in `addSegment` and `planRoad`.

### F10 [S3] Straight joints with a kink up to 5.2° overlap or leave a gap
`junction.ts:760-777` emits no rings for "middle" and straight-transition nodes, and the ribbons end square to their own
tangent (`roads.ts:343-354`). `tryMergeNode` (`roads.ts:497-509`) only merges straight two-point pairs above 175°. So
curved pairs, different classes, or fixed segments can keep a kink of up to `STRAIGHT_TOL` (0.09 rad). The result is
a wedge where both ribbons overlap at the same `ROAD_LIFT` (z-fighting) on the inner side, and a ground-coloured gap on
the outer side. Fix: miter both ribbon ends to the bisector at middle nodes.

### Checked and found sound (priority 1)
- Cache invalidation: undo, redo and load all go through `deserialize` and create a new `World`, so the WeakMap caches
  start fresh (`main.ts:165-179`).
- Type and elevation upgrades bump `graphRevision` (`sim.ts:572`), and `retile` bumps it on every geometry edit
  (`roads.ts:162-165`). `toggleOneWayAt` does not bump it, but layouts do not read `dir`; that becomes a problem only
  once F3 is fixed.
- `junctionsOf` is deterministic (sorted nodes and arms).
- signals.ts is pure and deterministic. The adaptive controller is not wired up.
- No per-frame allocation in the junction or road paths: they run only on rebuild.

## Priority 2: traffic.ts

### F11 [S1] Two cars can block each other forever
`src/sim/traffic.ts:458`: `if (long < -0.2) continue;` lets a car *behind* (long in [−0.2, 0)) count as a leader.
- Scenario (`deadlock.test.ts`): two cars on the same street route at progress 3.0 and 3.1, both v=0. After 60 s of
  `tickTraffic` both are still at p=3.000/3.100 with v=0 and stuck=true, and completed=0. Each treats the other as its
  leader (gap < 0, which clamps to `IDM_GAP_FLOOR`, which gives `IDM_DEC`).
- The same thing can happen where two routes merge onto one tile with heading dot > 0.3. There is no stuck timeout, so
  the pair blocks the whole queue behind it for good.
- Fix: require `long > 0`, or `long >= 0` with an id tie-break. Also add a stuck-time despawn as a backstop.

### Checked and found sound (priority 2)
- Per-tile buckets cannot overflow: `next` is sized to at least 2x the vehicle count before the substeps, and nothing
  spawns during them.
- Stepping is sequential and seeded, so it is deterministic.
- Vehicles are not saved, so traffic does not affect old saves.
- Minor: `tickTraffic` allocates `alive[]` and `transit.filter` every tick (S3).

## Priority 3: zoneblocks.ts and orientedlots.ts
- The DP packer always has a feasible width-1 choice. Kept lots are re-validated with `shapeFits`. Seeding uses
  `s.rngState`, which is constant (the world seed, `sim.ts:165`). I found no overlap or hole bug I could reproduce.
- [S3] `zoneblocks.ts:546`: `migrateCells` calls `nearestCell`, which scans every cell of every block, once per
  migrated cell. That is O(cells²) on large shape changes. `tileIndex` is available to narrow the search.

## Priority 4: render (vehicles, shadows, environment, window light)

### F12 [S2] Night windows get per-pixel noise instead of one lit state per window
`src/render/window-light.ts:136-141, 166-167`.
- `vWinLocal = floor(position/0.02)*0.02` is computed per vertex, but it is an ordinary interpolated varying.
- When a window quad spans more than one 0.02-tile cell (a 1 m pane is about 0.125 tile), the fragments of one pane get
  smoothly varying input to `fract(sin(…)*43758)`. The lit state, colour and brightness then vary within the pane.
- The CPU mirror test cannot catch this, because it takes the hash as an input.
- Fix: bake a per-window id attribute (UV2 or a vertex colour in `blender/`) and hash that.

### F13 [S3] `applyMaterialTargets` env intensity is dead code
`road-material.ts:308` → `material-targets.ts:16`. In three r186, `WebGLRenderer.js:2736-2738` overwrites the
`envMapIntensity` uniform with `scene.environmentIntensity` whenever `material.envMap === null` and a scene environment
is set. The 0.6 cap and `environmentIntensityNight` therefore have no effect.

Checked: the HDRI IBL does fade with the day. `scene.ts:1332` gives 0.05 at night and 0.55 at noon, so there is no
night regression.

### F14 [S3] `uEnvComp` is effectively a constant 1.5x
`scene.ts:1452-1453`. Daytime envI is at most 0.55, so `min(1.5, 1/envI)` is always 1.5. It drops to 1.0 only at
exactly envI = 0.05 (full, dry night). So vehicles always get 1.5x indirect specular, with a step when night begins.
Either define the compensation properly or remove it.

Shadow tuning and vehicle-fx: no defects found. vehicle-fx only allocates in its constructor.

## Priority 5: save.ts

### F15 [S2] A change in validity rules makes old saves unloadable
`src/sim/save.ts:316-321` (`hydrateSavedLots`) and `302-308` (`copySavedCells`).
- Cell validity is recomputed at load time from the current rules: `buildZoneBlocks` → `applyValidity`,
  `junctionDiscs` and `cornerRadiusFor`.
- If any saved lot cell is now invalid, the loader throws `SaveError("damaged")` for the whole city instead of dropping
  that lot.
- Validity rules have changed before (ef1c8f2, "9-point cell validity"), so any future tweak turns old saves with lots
  on edge cells into load failures. That violates AGENTS rule 3.
- Fix: drop or trim lots and cells that no longer fit, and report them (as `migrateCells` already does) instead of
  throwing.

`OrientedLot.build` is validated correctly as optional and in [0,1] (`save.ts:263`), and defaults to 1 on hydrate.

---

## Summary
1. F1/F2 [S1]: the lane graph is mostly empty (2 of 12 connectors in a basic cross), and lane sides are mirrored at end "b".
2. F3 [S2]: the stop bar is on the opposite half from the arrows at end-"a" arms; one-way roads are ignored.
3. F4 [S1]: mixed-width corners produce negative trims; avenue + street-pair forks self-intersect at every angle from 4° to 45°.
4. F5 [S1]: arms under about 4° apart produce bow-tie or non-nested rings, and earclip overcovers them 3x.
5. F6/F7 [S1]: the unguarded band fallback paints kerb grey over the asphalt, and the null fallback covers the whole pad.
6. F11 [S1]: two cars within 0.2 tile of each other block forever (measured), and there is no stuck timeout.
7. F8 [S2]: a road rebuild takes 85–160 ms after an edit and 23 ms warm on desktop, against a 10 ms budget; the caches never reuse across edits.
8. F9 [S2]: a degenerate curve control point gives a zero tangent and a junction with no patch.
9. F12 [S2]: window hashes are interpolated per pixel, not per window; F15 [S2]: a validity drift makes old saves unloadable.
10. Checked and found sound: cache invalidation on undo/load/upgrade, signals determinism, HDRI night fade, OrientedLot.build validation.
