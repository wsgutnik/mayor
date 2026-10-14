# ADR 06 — Road corridor and parcel architecture

Status: accepted for incremental implementation (2026-10-13). Evidence and sources: [06-corridor-parcel-research.md](06-corridor-parcel-research.md).
Amendment P0 accepted 2026-10-14 (junction review 07a C1-C6 reconciliation; owner decisions final).
Where this amendment and the original text disagree, the amendment wins.

## Problem (measured)

On a test city with a diagonal avenue, a curved street and junctions (oriented zoning, 142 lots):

- the front edge of a lot sits 0.05 tile from the drawn asphalt edge (median); the lot's own kerb strip, centred on that edge, overlapped the road kerb (fixed: strip pulled 0.07 inside the lot);
- about 10% of lots are 2–3 tiles from any road: interior lots with no street frontage, drawn as islands;
- road mesh (`src/render/roads.ts`), zone cells (`src/sim/zoneblocks.ts`), props (`src/sim/props.ts`) and routes (`src/sim/traffic.ts`) each derive widths and offsets on their own;
- vehicles followed tile centres until the centreline snap of 2026-10-13 (`routePath`); junction corners are still tile-based.

## Decision

Introduce one derived, unsaved **corridor model** that every consumer reads:

```ts
RoadProfile       // by road type: lanes, asphalt half-width, kerb, sidewalk, setback, prop offsets
SegmentCorridor   // per segment: centreline samples, left/right edge polylines at each profile offset
JunctionPolygon   // per node: polygon with fillets, arms, stop-line positions
Parcel            // oriented rectangle: front edge on the setback curve, frontage width, depth, owner segment
LaneSpline        // per lane: spline, direction, connectors across junction polygons
```

Constraints: derived from `world.segments` and `world.nodes` only (never saved; saves keep zone cells and lots);
geometry quantised to 1e-3 for determinism; incremental rebuild keyed by `graphRevision`.

## Migration (each step ships behind green tests, saves unchanged until step 4)

1. `RoadProfile` table, no behaviour change; renderer, props and zone blocks read it instead of local constants.
2. `SegmentCorridor` offset curves; props and kerbs snap to declared offsets.
3. `JunctionPolygon` from the existing arms/fillets in `roads.ts`; clip cells and props against them.
4. Parcels replace zone-block geometry (`lat0` at kerb + sidewalk + setback, frontage slicing by arc length); interior lots are not generated.
5. Lane splines drive traffic and prop placement along lanes; routes stay inside lane and connector polygons.

## Acceptance (automated)

- every parcel front edge within 1e-3 of the setback distance of its owning corridor;
- zero parcel/corridor/junction polygon intersections (independent check with a polygon clipping library);
- zero parcels without frontage;
- parcel alignment continuous across junctions;
- props and kerbs lie on their declared offset curves;
- vehicle polylines stay inside lane and connector polygons;
- full rebuild equals incremental rebuild; old saves load with a migration report; rebuild within the iPad budget.

## Amendment P0 — profile, arclength and parcel/junction reconciliation (2026-10-14)

### P0.1 Profile (shared with 07 P0.1)

`RoadProfile` is the single source of widths and carries, per road type:
`asphaltHalf`, `kerb`, `sidewalk` (0.12 street, 0.16 avenue, 0 highway),
`drawHalf`, `setback = max(0, ROAD_TILE_WIDTH/2 - (drawHalf + sidewalk))`,
`lanes`, `laneCentres` (signed, right-hand traffic), `medianHalf` (0 street,
0.16 avenue, 0 highway) and `propOffsets` measured from the centreline outside
`sidewalkEdge = drawHalf + sidewalk`. Corridor offsets are
`asphaltEdge = asphaltHalf`, `kerbEdge = drawHalf`,
`sidewalkEdge = drawHalf + sidewalk`, `setbackLine = sidewalkEdge + setback`.
Street `setbackLine` is 0.57 and avenue 1.06: both overflow the road tile by
design, and the first lot row fronts there (mid-block) or at the junction
`boundary` where the boundary is larger (near nodes).

### P0.2 Corridor-arclength convention (C4)

Every longitudinal position shared between the junction builder and parcels is
a corridor arclength `s` from the node along the corridor centreline samples:
trims, crosswalk/stop stations, `lotAnchor.s`, connector endpoints, frontage
slicing origins. Chord distances are forbidden on curves; on straight arms the
two coincide. Junction rings terminate on corridor offset-polyline points at
matched `s`.

### P0.3 Step 4 blocked on lotAnchors; boundary clipping (C1-C3)

- Step 4 (parcels) is BLOCKED on junction P0-P4: it must not be implemented
  against the step-4 `lat0` formula alone. Per arm side,
  `lotAnchor.s >= s_boundary` (maximum corridor arclength of any `boundary`
  vertex on that side); parcels on one segment satisfy both ends,
  `s in [anchorA, L - anchorB]`. This changes `blocksForSegment`, not just
  `junction.ts`: rows are truncated at the far node, and the row origin `s0`
  becomes the anchor.
- The clipping polygon for cells, parcels and props is the junction
  `boundary` (07 P0.5), not the asphalt ring. Acceptance "zero
  parcel/corridor/junction polygon intersections" means zero intersections
  with the corridor `setbackLine` ribbons mid-block AND with `boundary` near
  nodes.
- Corner exception to "every parcel front edge within 1e-3 of the setback
  distance": within `lotAnchor` of a node the boundary governs. Implementers
  must not "fix" corner lots back onto the straight setback line.
- Step 3 "clip cells and props against JunctionPolygon" means `boundary`;
  props additionally respect `clearZones` (sight-triangle legs 2.5 street /
  3.5 avenue; signal/streetlight offsets are void inside them).

### P0.4 Layer and oracle notes (C5-C6)

- Parcels never front highways or elevated segments. Anchors and clear zones
  are emitted only for ground, kerbed arms; a ramp node's bridge arm
  contributes keep-out only in its own layer and must not sterilise ground
  frontage.
- The zero-intersection acceptance is checked by an independent polygon oracle
  (`polygon-clipping` in tests only, per the library choice); `checkJunction`
  remains a self-check and cannot be the oracle for step 4.

## Library choice

Polygon offset/clip: a Clipper2 TypeScript port (BSL-1.0) behind a thin adapter; `polygon-clipping` as an independent
oracle in tests only. No code from Citybound (AGPL) or MapGenerator (LGPL).
