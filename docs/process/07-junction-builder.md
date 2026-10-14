# 07 — Junction builder: interface and drawing recipe

Status: accepted 2026-10-13 (design-it-twice: four independent designs compared, one synthesis).
Amendment P0 accepted 2026-10-14 (owner decisions final, settling review 07a blockers S0-1..S0-4 and C1-C4).
Where this amendment and the original text disagree, the amendment wins.
Context: the junctions rendered after ADR 06 step 3 were rejected visually (octagon asphalt blob, floating crosswalks,
open U-shaped dead ends with a stray arc, no sidewalk around corners, no lane markings through the junction, notches at
acute arms). This document is the contract for the replacement.

## Synthesis

- **Public surface (from the minimal design):** three exports in `src/sim/junction.ts`:
  `buildJunction(input)` (pure), `junctionsOf(world)` (cached per `graphRevision`, rebuilds only changed nodes),
  `checkJunction(layout)` (the geometric invariants, used by tests and a debug overlay).
- **Internals (from the flexible design):** a fixed internal stage list (`sortArms → classify → corners/fillets →
  rings → mouths → crosswalks/stop lines → markings → connectors → boundary → verify`); stages are not public API.
  Non-fatal `diagnostics` (beveled corner, dropped crosswalk, shortened radius) are part of the output.
- **Fast common cases (from the common-case design):** closed-form geometry for end, bend, T and cross nodes within
  8 degrees of orthogonal; one shared fillet routine for the template and the general path, plus a seam test sweeping
  +-12 degrees (touch points move < 0.15 m per degree).
- **Drawing recipe and numbers (from the Cities: Skylines/road-design design):** see below; it is the visual contract.

## Output (per node)

`kind` (`end|middle|bend|transition|junction|roundabout`), `centre`, angle-sorted `arms` with `trims` per layer
(`asphalt`, `kerb`, `sidewalk`, `markings`), layered closed CCW rings `asphalt ⊂ kerbOuter ⊂ sidewalkOuter ⊂ boundary`
(1e-3 quantised), `fillets`, `crosswalks`, `stopLines`, `markings` (through-lane guide dashes, yield dashes, edge
lines), `connectors` (lane to lane Hermite splines + hull), `lotAnchors` (where a lot row may start per arm side),
`clearZones` (corner sight triangles), `hash`, `diagnostics`. Consumers: renderer (polygons and strips, ribbons start at
`trims`), lots (`boundary` keep-out + `lotAnchors`), props (`clearZones`), traffic (`connectors`, replacing
`roundCorners`).

## Drawing recipe (tile = 8 m; street asphalt 0.76 tile; two lanes)

| | street | avenue | highway |
|---|---|---|---|
| asphaltHalf | 0.38 | 0.81 | 1.40 |
| kerb / sidewalk | 0.07 / 0.12 | 0.09 / 0.16 | 0 / 0 |
| kerb return radius R (asphalt edge) | 0.45 | 0.60 | 1.20 (taper) |
| R at corners with no turning traffic (one-way) | 0.25 | 0.35 | n/a |
| crosswalk width / stop line gap / thickness | 0.30 / 0.08 / 0.04 | 0.35 / 0.08 / 0.05 | none |
| boundary clearance | 0.10 | 0.10 | 0.25 |
| dead-end bulb radius / neck fillet | 0.90 / 0.30 | 1.20 / 0.40 | n/a |

1. Classify: 1 arm `end`; 2 collinear arms of the same profile `middle` (no node geometry); 2 arms `bend` or
   `transition`; 3+ `junction`; roundabout when requested.
2. Corner between adjacent arms a, b: R = max(R_a, R_b); centre O = intersection of the edge lines offset by
   `asphaltHalf + R`; tangent points P_a, P_b give the asphalt trims. Acute corners keep the arc, shorten both arms to
   the miter limit and insert a short chamfer between arcs; an arc is never dropped.
3. Rings: asphalt arcs radius R; kerb R + kerb; sidewalk R + kerb + sidewalk (concentric: sidewalk wraps the corner as
   one ring); boundary = sidewalk outer inflated by clearance. Kerb and sidewalk trims equal the asphalt trim.
4. Crosswalk: rectangle across the mouth from the trim outward by its width, stripes = round(asphalt / 0.11). Stop
   line after the crosswalk, only across inbound lanes. Lane dashes stop before the stop line and resume after it.
5. Through guide dashes across the polygon for straight pairs; yield dashes at roundabout entries.
6. Dead end: `square` cap (flat asphalt end, kerb and sidewalk wrap it as a U with outer fillets of kerb + sidewalk;
   no asphalt semicircle, no arc inside the road) or `bulb` cul-de-sac.
7. Connectors: Hermite from lane centre at the in-arm markings trim to the out-arm's, tangents 0.55 x chord.

### P7 lane-graph amendment (implemented)

`src/sim/lanes.ts` derives lane connectors from the final, budgeted asphalt
ring, not from road tiles.  Tile is 8 m.  For each legal inbound/outbound lane
pair it samples a cubic Bézier with handles `min(0.46 * chord, 2.0)` tiles and
`clamp(ceil(chord / 0.2), 3, 14)` pieces.  A candidate is retained only when
every sample lies inside the asphalt polygon and its discrete curvature is at
most `2 / min(laneWidth)`.  Straight movements rank-match proportionally;
outer lanes own near turns; ordinary junctions reject U-turns.  The same pass
exports per-inbound-lane turn sets for arrow marking consumers.  This is
derived, unsaved data and is bounded by arms² × lanes² × 14 samples.
8. Mixed classes: the larger radius wins; the avenue median ends at the crosswalk, never in the polygon.
9. Short segments: R shrinks linearly when `segLength < 2t`; below ~0.6 tile the node merges (middle).

## Invariants (asserted by `checkJunction` and the test suite)

Close approaches use a minimum 5° mouth gap.  Below it the renderer treats
the gap as merged; no ring may use a negative trim, and every emitted ring is
simple.  A mixed-width offset tangent behind its node is replaced by the
budgeted chamfer station.  Kerb-band triangulation is accepted only when its
triangle area differs from `outer - inner` by at most `max(0.02, 5%)`; an
invalid band is drawn below the asphalt patch.

Rings closed, CCW, simple; nested; arm centreline at trim lies on the ring (1e-3); fillets tangent to both edge lines
and r >= 0.2; crosswalk and stop-line quads inside asphalt ∪ ribbon and non-overlapping; no triangle with area < 1e-5
or angle < 5 degrees; kerbs never inside asphalt and never crossing an arm mouth; sidewalk closed around every convex
corner of kerbed arms; connectors inside asphalt ∪ ribbons with matching tangents and curvature <= 2/laneWidth;
determinism, arm-order and rotation invariance; full rebuild = incremental rebuild; 100 random nodes < 10 ms.

## Amendment P0 — settled blockers (2026-10-14)

### P0.1 Profile table with sidewalk outside the kerb (settles S0-1)

Owner decision: the sidewalk lives OUTSIDE the kerb by widening the profile.
`ROAD_DRAW_WIDTH` is unchanged (asphalt + kerb). All units are tiles (1 tile = 8 m).

| type | tileHalf | drawHalf | asphaltHalf | kerb | sidewalk | sidewalkEdge | setback | setbackLine |
|---|---|---|---|---|---|---|---|---|
| street (1, 4) | 0.50 | 0.45 | 0.38 | 0.07 | 0.12 | 0.57 | 0.00 | 0.57 |
| avenue (2, 5) | 1.00 | 0.90 | 0.81 | 0.09 | 0.16 | 1.06 | 0.00 | 1.06 |
| highway (3) | 1.50 | 1.40 | 1.40 | 0.00 | 0.00 | 1.40 | 0.10 | 1.50 |

Definitions (in `src/sim/corridor.ts`, the single source of truth):

- `asphaltHalf = drawHalf - kerb`; `kerbEdge = drawHalf`.
- `sidewalkEdge = drawHalf + sidewalk`.
- `setback = max(0, ROAD_TILE_WIDTH/2 - (drawHalf + sidewalk))`.
- `setbackLine = sidewalkEdge + setback`.

Consequences (stated so no implementer re-derives them):

- Street and avenue sidewalks overflow the road tile (`0.57 > 0.50`, `1.06 > 1.00`):
  the first lot row fronts at `setbackLine` (0.57 / 1.06), and at the junction
  `boundary` where the boundary is larger (see P0.5). This intentionally breaks
  `corridor.test.ts` (`drawHalf + sidewalk + setback + 0.5 = TILE/2 + 0.5`); the
  test is updated in the same change as the profile.
- Highway has no kerb, sidewalk, crosswalk, stop line or lot frontage.
- Prop offsets are measured from the centreline and must clear `sidewalkEdge`:
  `signal = sidewalkEdge + 0.08`, `hydrant = sidewalkEdge + 0.14`,
  `streetlight = bench = planter = sidewalkEdge + 0.20`. Signals, hydrants and
  shelters on the old `drawHalf +` offsets would stand on the new sidewalk.
- Rings are `asphalt ⊂ kerbOuter ⊂ sidewalkOuter ⊂ boundary`, exact uniform
  outward offsets of each other. At a convex corner the fillet centre O sits
  outside the asphalt, so concentric arcs around O have SMALLER radii outward:
  asphalt `R`, kerbOuter `R − kerb`, sidewalkOuter `R − kerb − sidewalk`,
  boundary `R − kerb − sidewalk − clearance`. (The original 07:48 "R + kerb"
  is wrong: that circle crosses the kerb edge line instead of touching it, and
  would strand the kerb arc inside the asphalt.) Concentric arcs keep equal
  trims per side (07:49 stands): every layer's tangent point sits at the same
  arclength, own lateral. A layer whose radius would fall below 0.05 MITERS
  (follows its own edge lines to their intersection; detail on
  `chamfered-corner`): a chamfer at the asphalt stations would swing past the
  neighbouring mouth on acute wedges, while the miter is a single consistent
  corner. (The asphalt layer itself chamfers below R 0.2.)
  Mixed-profile corners (unequal kerbs) cannot share one tangent circle: each
  layer solves its own centre from its own edge lines with
  `ρ = R − max(Δa, Δb)` (Δ = layer lateral minus asphalt lateral), and trims
  are recorded per layer (07:23 already provides for per-layer trims).

Lane model (settles the S1-4 "no lane model" gap for P1):

- Right-hand traffic. For a segment directed a→b with unit tangent t and left
  normal n = (-tz, tx): lanes on the negative-n (right) side travel a→b, lanes
  on the positive-n side travel b→a. One-way types (4, 5) use `seg.dir`
  (1 = a→b, -1 = b→a) for every lane.
- `medianHalf`: street 0, avenue 0.16 (matches the renderer median strip),
  highway 0. Lane width fills the asphalt outside the median:
  `laneWidth = 2 * (asphaltHalf - medianHalf) / lanes`.
- `laneCentres` (signed lateral offsets, negative = right of a→b):
  - street (2 lanes, width 0.38): `[-0.19, +0.19]`.
  - avenue (4 lanes, width 0.325 outside a 0.16 median):
    `[-0.6475, -0.3225, +0.3225, +0.6475]`.
  - highway (4 lanes, width 0.70): `[-1.05, -0.35, +0.35, +1.05]`.
  - one-way variants share their base class geometry; direction comes from
    `seg.dir`, not from the sign of the centre.
- Inbound lanes for an arm at node N: the lanes whose travel direction points
  away from N (vehicles leave the junction on them) are outbound; lanes
  pointing toward N are inbound. Stop lines cover inbound lanes only.

### P0.2 Acute-corner construction (settles S0-2)

Replaces 07:46-47 ("keep the arc, clamp to the miter limit, an arc is never
dropped") and scopes the `r >= 0.2` invariant.

Corner inputs: gap angle θ between arm centrelines, arm half-widths h_a, h_b,
nominal corner radius R = max(R_a, R_b) from the recipe table (street 0.45,
avenue 0.60, highway 1.20 taper; one-way no-turn corners 0.25/0.35 once
connector-pair enumeration is available — until P4 the full R applies).

1. Offset-line intersection (asymmetric-correct): each arm's edge line is offset
   by its OWN `h + R`. The fillet centre O is the intersection of the two
   offset lines; tangent distances t_a, t_b are measured from the node centre
   along each arm. Equal-width closed form: `t(θ) = (h + R) · cot(θ/2)`.
2. Joint two-end trim budget (the binding constraint): for a segment of
   corridor arclength L between nodes N1, N2 with trims t1, t2 on the same
   side: `t1 + t2 + minRibbon <= L`, with `minRibbon >= 0` for geometry and
   `>= 0.72` (crosswalk 0.30 + gap 0.08 + stop 0.04 + dash restart) when both
   ends carry crosswalks. Both ends solve jointly:
   `t_i <- min(t_i, max(0, L - minRibbon) · t_i/(t1 + t2))`,
   then `R_eff,i = t_i · tan(θ_i/2) - h_i`.
   `segLength` is corridor arclength (`segmentLength`), never chord.
3. Radius floor and chamfer: solve `R_eff` from the segment-bounded trim
   allowance. Emit diagnostic `radius-shrunk` when `R_eff < R`. When
   `R_eff < 0.2`, the corner is CHAMFERED: the arc is replaced by the straight
   segment joining the two clamped tangent points, with diagnostic
   `chamfered-corner` (carrying θ, t_a, t_b, R_eff). The `r >= 0.2` invariant
   applies to non-chamfered corners only; chamfered corners assert instead that
   the chamfer segment joins the two tangent points within 2e-3.
4. Diagnostic codes (stable strings, renderer-visible fallbacks mandated):
   `radius-shrunk`, `chamfered-corner`, `trim-clamped`, `crosswalk-dropped`,
   `stopline-dropped`, `min-gap-merged`, `layer-excluded`, `non-ground-node`,
   `pad-node-deferred`, `short-segment`. A shared segment always reserves a
   0.12-tile visible asphalt ribbon. If its post-solve ribbon is below 0.72,
   both endpoint layouts emit `short-segment`; the renderer suppresses their
   independent crosswalks, stop bars and through guides on that segment.
   Dropping order when the budget binds below the floor:
   shrink R → drop crosswalk → drop stop line → chamfer, each step diagnosed.
5. Reflex (concave) gaps > 180°: inner arc tangent at both ray starts (s = 0),
   centre at the intersection of the two edge perpendiculars (per layer, own
   laterals), NOT a miter: the edge-line miter of a 90° bend sits behind the
   node (negative trims, ribbons overlapping behind the node), while the arc
   keeps trims at 0, the node strictly inside, and the inner kerb return
   rounded as built. Asymmetric reflex corners (unequal profiles) and inner
   radii below 0.05 chamfer straight from ray start to ray start with detail
   on `chamfered-corner`. (An earlier draft specified miter + `offset·4`
   spike clamp with code `concave-clamped`; P2 implementation proved the
   miter geometrically unsound for bends and replaced it. The code is
   retired.)
6. Minimum gap: arms closer than 3° emit `min-gap-merged` and the corner uses
   the wider arm's edge (no sliver wedge). Gaps < 0.02 rad that are exact
   duplicates keep the incumbent skip but must diagnose.
7. The old per-node `miterLimit = clamp(radius + 1.5·fillet, 0.85, 1.8)` is NOT
   the acute limit; it survives only as a fallback when neighbour context is
   unavailable, and its use emits `trim-clamped`. The per-node constants
   `cornerRadius` and the single-`fillet` field of `NodeLayout` are deleted
   when the renderer migrates (P7); nothing in `junction.ts` reads them.

Satisfiability note: {tangent arc, r ≥ 0.2, trim ≤ allowance} is jointly
satisfiable only for θ ≥ 2·atan((h+0.2)/t_max) ≈ 35° (street, t_max = 1.8).
Below that the construction chamfers by rule — the notch is replaced by a
diagnosed chamfer, never by a dropped arc.

### P0.3 Elevation policy (settles S0-3)

1. Layouts are per layer, keyed by node id (never by spatial hash: a ground
   node and a bridge node may share one (x, z)). `buildJunction` classifies
   and rings the GROUND arms only (mirroring `groundArms`); non-ground arms
   are listed in `excludedArms` with diagnostic `layer-excluded`.
2. Ground-only markings: crosswalks, stop lines and guide dashes are emitted
   only for ground, kerbed arms. Highway, bridge and tunnel arms never carry
   them; roundabout entries carry yield dashes instead (P6).
3. Ramp-link node (ground + bridge arms sharing one node): the ground ring
   excludes the bridge arms; the bridge ribbon runs to the node centre with
   per-vertex deck heights (`deckYAt`), never through a ground-sampled patch.
   No junction polygon is drawn at deck height in P2-P5; the deck polygon, if
   wanted, is a P6 decision.
4. Tunnel arms never participate in a surface junction; the portal contract
   stays with the renderer. A node with no ground arms produces no surface
   layout (`kind: "non-ground"`, empty rings, diagnostic `non-ground-node`).
5. Height contract: layouts are 2-D. The renderer samples `groundY` per ring
   vertex and per crosswalk corner (never a per-node constant Y), and deck
   height per ribbon vertex on bridge arms. `checkJunction` stays 2-D. Lift
   ordering (renderer, P7): asphalt < kerb < markings < junction patch, with
   separations that forbid the incumbent 0.004 burial.
6. `junctionsOf` skips non-ground segments the same way `corridorsOf` does;
   signals already filter to ground arms and are unchanged.

### P0.4 Corridor-arclength convention (settles S0-4 and C4)

All longitudinal positions are corridor arclengths `s` measured from the node
along the segment's corridor centreline samples (`corridor.ts`, 0.5 step):

- trims (per arm, per side, per layer), crosswalk inner edge, stop-line
  position, dash stop/resume stations, `lotAnchor.s`, connector endpoints.
- For straight arms arclength equals centreline distance; for curved arms each
  side uses its own offset-polyline arclength (factor 1 ∓ κh). Junction rings
  terminate ON corridor offset-polyline points at matched `s`, never on
  straight-ray constructions: the seam invariant (ring edge meets ribbon edge
  within 1e-3) is measured against the corridor offsets.
- Curve-through-node (split Bézier with collinear endpoint tangents) must
  classify `middle`: the collinearity tolerance (5.2°, |gap − π| < 0.09 rad,
  the incumbent layout value) is tighter than any curve tangent change the
  classifier may see, and the tolerance is asserted by test.

### P0.5 Lot anchors, boundary clipping, clear zones (settles S2-4 and C1-C4)

1. Per arm side, `lotAnchor.s >= s_boundary`, where `s_boundary` is the maximum
   corridor arclength of any `boundary` vertex on that side. Rows start at the
   anchor, never inside the boundary.
2. Parcels on one segment satisfy BOTH ends: buildable `s ∈ [anchorA, L −
   anchorB]` (arclengths from ends A and B; L is the corridor arclength).
   Single-origin row counting is wrong at the far node and must be replaced
   when ADR 06 step 4 lands.
3. The clipping polygon for cells, parcels and props is `boundary`
   (sidewalkOuter inflated by clearance: 0.10 street/avenue, 0.25 highway).
   Clipping to asphalt strands lots on the sidewalk; clipping to kerb strands
   them on the sidewalk ring.
4. Corner exception to ADR 06 acceptance ("front edge within 1e-3 of the
   setback distance"): within `lotAnchor` of a node the boundary governs and
   the setback line does not apply. Mid-block fronts stay on the setback line.
5. `clearZones` are corner sight triangles with legs 2.5 tiles (street) /
   3.5 (avenue) along each arm's sidewalk edge from the corner point, clipped
   to `boundary ∪ sidewalk`. Props and signals are excluded inside them.
6. Anchors and clear zones are emitted only for ground, kerbed arms; elevated
   arms contribute keep-out only in their own layer (C5).

### P0.7 Dead-end square cap (P2 decision; bulb is P5)

Cap plane at the node centre; ribbons end `B = max(kerb + sidewalk, 0.1)` before
it (street 0.19, avenue 0.25), so end trims are `+B` (positive into the
segment, like every trim). Asphalt ring is the sharp rectangle (no arc inside
the road); kerb/sidewalk/boundary wrap the tip as a U with outer quarter arcs
of radius kerb / kerb+sidewalk / kerb+sidewalk+clearance around the cap
corners. `B` is subject to the same two-end budget as any trim (P0.2 item 2).

Straight transitions (two collinear arms, different profiles) are a hard
width step with NO patch in P2: both ribbons butt at the node, the narrower
cap inside the wider. A taper over a stated length is P5. Bent transitions
(non-collinear, different profiles) build like bends (asymmetric convex arc,
chamfered reflex).

### P0.6 Invariant amendments (quantisation, seam, triangulation)

- Trims are PER SIDE and must NOT be symmetrised (`trimA.neg = trimA.pos =
  max(...)` is forbidden: it manufactures the blob). Ring mouths, however,
  route via the MAX trim of the arm (along the low-side edge out to the high
  station, across at the high station): a diagonal or min-routed mouth leaves
  a gap on the high side or a zero-area spike, while the max-routed mouth
  keeps every per-side trim point on its ring and merely runs the low-side
  ribbon under the patch (hidden: the patch rides above the ribbons by lift).
  Collinear mouth/back edges shared across layers are therefore legal nesting,
  not crossings. The mouth station is shared across arc/chamfer/straight
  layers (max over sides and layers); mitered outer layers route via their
  own miter stations (their across-edges sit past the shared mouth, in
  disjoint station ranges, so no layer cuts another).
- Rings are 1e-3 quantised; tangency is then asserted at 2e-3 (quantisation of
  centre and tangent points stacks to ≈1.4e-3, so 1e-3 cannot close).
- Arc discretisation step obeys the sagitta bound `sagitta <= 1e-3`:
  Δ ≤ 2·acos(1 − 1e-3/R) (≈0.13 rad at R = 0.45, 0.115 at 0.60, 0.082 at 1.20).
- Triangulation is earcut/constrained over the ring with a Steiner centre only
  when the ring is star-shaped w.r.t. it; centre fans with fallback radii are
  banned — a missing corner is a diagnostic, never invented geometry.
- Template/general seam (P3): layout(θ) continuous across the 8° template
  boundary for trims, ring Hausdorff distance and crosswalk inner edge,
  sampled every 1° from −12° to +12°, with identical `kind` on both sides.
- `hash`: FNV-1a over the quantised ring vertices, trims and kind, serialised
  in arm-angle order (stable across input arm order). Determinism and
  save/load-hash-stability tests compare this hash.
- Performance fixture (for P7): the skill hard-case set × 10 rotations, seeded
  RNG, `buildJunction` and `checkJunction` timed separately; the "100 nodes <
  10 ms" budget is measured on that fixture, warm cache.

## Visual acceptance (day and night, game zoom and close up)

4-way street cross reads as a rounded cross with four equal kerb returns; crosswalks start at the return tangents and
sit on asphalt that continues under them; stop lines only on inbound halves; dashes stop and resume around them; the
sidewalk is continuous around every corner; a dead end shows a flat or bulb cap wrapped by kerb and sidewalk with no
arc in the road; T and Y have no notch; an avenue-street T keeps the avenue kerb straight across the mouth.
