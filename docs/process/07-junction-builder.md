# 07 — Junction builder: interface and drawing recipe

Status: accepted 2026-10-13 (design-it-twice: four independent designs compared, one synthesis).
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
8. Mixed classes: the larger radius wins; the avenue median ends at the crosswalk, never in the polygon.
9. Short segments: R shrinks linearly when `segLength < 2t`; below ~0.6 tile the node merges (middle).

## Invariants (asserted by `checkJunction` and the test suite)

Rings closed, CCW, simple; nested; arm centreline at trim lies on the ring (1e-3); fillets tangent to both edge lines
and r >= 0.2; crosswalk and stop-line quads inside asphalt ∪ ribbon and non-overlapping; no triangle with area < 1e-5
or angle < 5 degrees; kerbs never inside asphalt and never crossing an arm mouth; sidewalk closed around every convex
corner of kerbed arms; connectors inside asphalt ∪ ribbons with matching tangents and curvature <= 2/laneWidth;
determinism, arm-order and rotation invariance; full rebuild = incremental rebuild; 100 random nodes < 10 ms.

## Visual acceptance (day and night, game zoom and close up)

4-way street cross reads as a rounded cross with four equal kerb returns; crosswalks start at the return tangents and
sit on asphalt that continues under them; stop lines only on inbound halves; dashes stop and resume around them; the
sidewalk is continuous around every corner; a dead end shows a flat or bulb cap wrapped by kerb and sidewalk with no
arc in the road; T and Y have no notch; an avenue-street T keeps the avenue kerb straight across the mouth.
