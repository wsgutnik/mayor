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

## Invariants (tests)

- Every stroke end within kerb + radius attaches (or is refused with a reason): 0 dangling ends, at all three zooms.
- Attached ends lie on the centreline (< 1e-3 tile), 0 segments shorter than 1 tile, 0 node pairs within 0.05.
- No new T closer than `teeSpacing` to an existing junction.
- Approach angle change from snapping < 12 deg (only the end's slide onto the road); free strokes unchanged.
- Hysteresis sweep across a parallel pair: <= 2 target switches.
- Parallel pair: every interior row keeps exactly `gap` valid cells on the inner side.
- Resolver cost: 0.27 ms per pointer event on a 313-segment grid.

## Known gaps

- Touch has no hover: the iPad sees the snap puck only after the first tap (one-finger drag pans with the road tool).
  A press-drag-release draft on touch would show it before committing; not done here.
- No ghost for the start point before the first tap (the hover tile is shown instead).
- Not yet looked at in the running game (agent runs are headless); the lead must check day/night, game zoom and
  close-up, including the keep-out refusal and the puck colour.
