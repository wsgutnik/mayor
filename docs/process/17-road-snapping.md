# 17 — Road snapping (audit and rules)

Owner report (iPad): "o snaping na estrada continua ruim", roads end with "truncations", and building areas must be
dictated by the streets. Owner correction: odd angles stay allowed; guides are optional assists; geometry that cannot be
built validly is refused with a reason, never bent; the road profile (asphalt + kerb + sidewalk + setback, `profileOf`)
is the reference for every offset.

Code: `src/ui/road-snap.ts` (`resolveRoadSnap`, `snapRadiusTiles`, `worldPerPixel`), `src/ui/road-parallel.ts`
(`parallelOffset`, `frontageHalf`), `src/sim/sim.ts` (`teeSpacing`, `TOO_CLOSE_TO_JUNCTION_REASON` in `planRoad`),
`src/sim/roads.ts` (`snapEnd`, `splitSegment`, `nearestOnSegment`), `src/main.ts` (`resolveDraftPoint`).
Audit harness: `src/ui/road-snap-audit.test.ts` (`SNAP_AUDIT=1` prints tables, `SNAP_AUDIT_SVG=<dir>` writes dumps).

## What was wrong (measured on main, d0b8e69)

1. The UI snap only fired when the pointer was literally on a road **tile**, and moved the point to the tile **centre**.
   Off-tile pointers (a finger 0.6-1.3 tiles from a street centreline) were passed through raw; the sim then joined only
   within 0.6 tiles of the centreline, so the road stopped 0.2-0.7 tiles short of the kerb (the "truncation"). On
   diagonals, curves and wide roads the tile centre is not on the centreline, so the end also jumped up to 0.5 tile
   along the road.
2. The radius was fixed in world units (~0.5 tile): 60 px at the nearest zoom, 3.4 px at the farthest.
3. A T could be placed 1.0 tile from an existing junction (both junction keep-outs overlap).
4. Parallel twins were offset by the raw gap (1-3 tiles centre to centre): sidewalks overlapped at gap 1 and no zone
   cell was valid between the pair at any gap.
5. `snapEnd`/`splitSegment` excluded or reused tips by curve **parameter** (3 % / 2 %), so long roads jumped up to a
   tile to their tip and short ones could split into slivers.

## Rules (v2)

**Radius.** Constant on screen: 36 CSS px for touch/pen, 16 px for mouse, converted with
`tiles/px = 2·tan(fov/2)·|camera − point| / viewportHeight`, clamped to [0.25, 6] tiles.

**Priority** (first hit wins, `resolveRoadSnap`):
1. *Node* (junction centre or dead end) within `clamp(radius, 0.6, 1.5)` tiles → the exact node position.
2. *Centreline*: the segment whose **kerb edge** (`profileOf(type).drawHalf`) is nearest, if that edge is within the
   radius → the exact nearest centreline point; the sim splits the road there (T-junction).
3. *Free*: the raw point, with the optional angle (15/45 deg) and length (1/2/4 tiles) guides. Guides are off by
   default; the stroke angle is never changed otherwise. Alt/Option bypasses everything.

With the angle guide on and a centreline target, the end slides along that road to where the guided ray from the
anchor meets it (still exactly on the centreline). The guide measures from the previous leg, else from the tangent of
the road the draft started on, else the map axes.

**Keep-out (refuse, do not bend).** A T may not sit closer to an existing node of the same road than
`teeSpacing = drawHalf(incoming) + max drawHalf(arms at the node) + kerbReturn(existing road)` (street into a street
junction: 0.45 + 0.45 + 0.45 = 1.35 tiles). Inside that span the end joins the node only if the pointer is within the
radius of the node; otherwise the draft is refused with "Too close to a junction" / "Perto demais de um cruzamento".
`planRoad` enforces the same rule, so preview, tap and keyboard agree. Dead ends and single-arm nodes only need the
0.6 merge radius. A centreline foot within 0.6 tiles of a node merges into that node (sim and UI alike).

**Hysteresis.** The target of the previous pointer event keeps winning until the pointer leaves 1.35 x its acquire
radius; a held centreline is not stolen by a node unless the pointer is within the 0.6 merge radius.

**Parallel twin.** Centreline offset = `2·frontageHalf(type) + 2·gap`, `frontageHalf = drawHalf + sidewalk + setback`
from the profile; `gap` = lot cells (1 tile deep) kept on **each** road, 1-4. Street gap 2 → 5.14 tiles; avenue
gap 2 → 6.12 tiles.

**Preview.** The end's attach point gets a flat white puck (red when refused); the hint appends "Joins junction" /
"Joins road" (pt-BR "Liga ao cruzamento" / "Liga à via"); a refused tap shows the translated reason and keeps the draft.

**Zones** (already correct on main, now asserted): cells are the segment frame — column 0 starts at
`frontageHalf(type)` and is 1 tile deep, so avenue cells sit exactly `frontageHalf(2) − frontageHalf(1)` (0.49) farther
out than street cells; painting at any road angle picks cells on the painted side only; painting with no road frame
within reach is refused ("Zones must be within 4 tiles of a road").

## Overlap rules (v3, owner report "esta truncando ainda um pelo outro")

Owner screenshot (iPad, rainy night): a long road with two sets of lane dashes side by side (a second road lying
slightly rotated over the first), lot kerbs and zone cells across the asphalt. Cause on main: `planRoad` validated
ends, spacing and terrain but never the new centreline against same-layer roads, and `addSegment` only made nodes at
transverse crossings, so a stroke drawn along, over or 0.3 tile beside an existing road was accepted as a second,
unconnected segment. `addSegment` also skipped crossings within 0.6 of an existing node, so a road drawn straight
through a T or cross passed it without connecting.

Rules (`placementIssue` in `src/sim/roads.ts`, applied by `planRoad` to each piece against its own layer, so the
preview, tap, keyboard, parallel pair and `placeRoad` agree; never applied by `addSegment` or the load path, so old
saves load unchanged). First hit wins; every refusal names what to do instead (`trReason` appends the hint):

| # | Rule | Reason (en / pt-BR) |
|---|---|---|
| 1 | Both ends within `DUPLICATE_END_TOL` = 0.3 tile of one same-layer segment's ends (either direction). Exceptions: redrawing a one-way road over itself (documented direction flip) and paving one whole segment's path with a wider class (widened in place, never doubled). | "Road already exists here" / "Já existe uma via aqui" + "use Upgrade road to change its class" |
| 2 | An interior crossing (or a pass through an existing node) meets a same-layer road at 2-20 degrees (`MIN_CROSSING_ANGLE_DEG` = 20). | "Crossing angle too sharp" / "Ângulo de cruzamento fechado demais" + "cross at 20° or more, or end on the road to make a junction" |
| 3 | The new centreline lies inside `D = footprintHalf(new) + footprintHalf(other)` (asphalt + kerb + sidewalk, from `profileOf`; street + street = 1.14 tiles) of a same-layer road for more than `OVERLAP_MAX_RUN` = 0.6 tile, outside the junction disc `D / sin(angle) + 0.1` of every meeting with that road. A meeting flatter than 2 degrees has no disc: that road is being run along, not joined. Samples whose nearest point is the other road's tip (end on) are rule 5/6 territory. | "Overlaps another road" / "Sobrepõe outra via" + "use Upgrade road to change its class, or draw it parallel, clear of the sidewalk" |
| 4 | A T foot on a segment side, or an arm leaving an existing node, meets a same-layer road under 20 degrees (the 5 degree "Road leaves this junction too close to another road" check still runs first). | "Crossing angle too sharp" |
| 5 | A free end (no node or segment within the 0.6 merge radius) stops with its asphalt + kerb inside the **side** of another road's asphalt + kerb. | "Overlaps another road" |
| 6 | Mirror of 5: an existing dead end stops inside the side of the new road's asphalt + kerb without the new road meeting that node. | "Overlaps another road" |

Graph fix (`addSegment`): a crossing within 0.6 of an existing node that is not one of the new road's own end nodes
now cuts the new road at that node (the T becomes a cross, the cross a 5-arm node); before, the road passed through
disconnected. On the legacy load path (saves without node ids) this heals such crossings too.

Unchanged: bridges, tunnels and other layers keep crossing without nodes (rule checks use `segElevation`); the
ground ramps of an elevated stroke are checked as ground pieces, the joints between deck and ramps are not ends.
Zones: on main a placed road already invalidated the oriented cells under it (`applyValidity` keeps
`drawHalf + sidewalk + 0.075` from every other ground road) and the lot planner drops lots on invalid cells (built
ones included; there is no refund rule in the sim); tile mode zeroes zone and level under the road raster. The new
tests assert it (no zoned cell invalid or on asphalt + kerb, no lot rectangle on it, before and after 30 steps).

Cost: `placementIssue` with bounding-box pruning and exact straight segments is 0.1-1.3 ms per call on a 393-segment
grid (the rest of `planRoad` is 4-13 ms there).

## Invariants (tests)

- Every stroke end within kerb + radius attaches (or is refused with a reason): 0 dangling ends, at all three zooms.
- Overlap (`src/sim/road-overlap.test.ts`): no pair of same-layer ground segments has footprints overlapping for
  any length outside a shared node's junction disc; plan and place agree on every case; legacy overlapping saves
  round-trip unchanged.
- Attached ends lie on the centreline (< 1e-3 tile), 0 segments shorter than 1 tile, 0 node pairs within 0.05.
- No new T closer than `teeSpacing` to an existing junction.
- Approach angle change from snapping < 12 deg (only the end's slide onto the road); free strokes unchanged.
- Hysteresis sweep across a parallel pair: <= 2 target switches.
- Parallel pair: every interior row keeps exactly `gap` valid cells on the inner side.
- Resolver cost: 0.27 ms per pointer event on a 313-segment grid.

## Guides (v4)

Guides are a visual assist, never a constraint. While a road draft has an anchor,
the overlay offers world-axis rays at 45-degree multiples and, when the anchor is
on a road, the same fan relative to that road's tangent (parallel, perpendicular
and diagonals). The optional 15-degree fan is retained through the legacy Angle
setting. A cursor only moves to a ray when it is within 4 degrees; outside that
cone its odd angle is left untouched. The cone grows to roughly 14–18 screen px
at close touch distances. The currently chosen ray remains held until 1.35 times
the acquire cone to prevent flicker.

Priority remains node, centreline T, guide, free. Shift or Alt/Option temporarily
suspends guides on desktop; touch disables them with the Guides toggle. The toggle
is stored with `mayor:road-snap`, defaults on for old stored values, and does not
change saves. A placement refusal is still produced by `planRoad`; guide geometry
never bends a road around a keep-out or overlap.

### Overlay recipe

`src/render/road-guides-overlay.ts` draws the assist as one preallocated
`LineSegments` call, with `depthTest: false`, `depthWrite: false`, render order
24, and every vertex lifted `max(terrain, waterline) + 0.18` tiles. Rays are
6 tiles long, dashed 0.32 on / 0.26 off; their road-kit cyan is dimmed unless
active, where it is near white. A continued segment additionally draws a
1.05-tile, 12-chord shortest-turn amber arc; its degree value lives in the
existing road readout. The end gets two 0.44-tile cross ticks (white node,
blue segment, pale free), and 0.36-tile chevrons repeat every 1.35 tiles along
the pending direction. The fixed 1,800-vertex store covers the maximum 24
15-degree rays plus arc, ticks, and chevrons without allocation; inactive
guides set draw range to zero. Pure ray and arc recipes are asserted to 1e-8.

## Known gaps

- Overlap rules: two dead ends facing each other tip to tip closer than their footprints (the tile-paint idiom: a road
  drawn from tile 3 next to the 3-tile entry stops 1.0 from the entry's cap) are tolerated, not refused or joined;
  60+ existing fixtures and tile-adjacent painting rely on it, and the tile raster joins them for traffic. Their caps
  overlap by up to 0.24 tile (street + street) or 0.35 (street + avenue).
- A free end may still stop on another road's sidewalk band (between asphalt + kerb and the footprint) by up to
  0.24 tile; only asphalt + kerb intrusion is refused (rule 5).

- Touch has no hover: the iPad sees the snap puck only after the first tap (one-finger drag pans with the road tool).
  A press-drag-release draft on touch would show it before committing; not done here.
- No ghost for the start point before the first tap (the hover tile is shown instead).
- Not yet looked at in the running game (agent runs are headless); the lead must check day/night, game zoom and
  close-up, including the keep-out refusal and the puck colour.
