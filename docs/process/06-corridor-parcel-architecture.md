# ADR 06 — Road corridor and parcel architecture

Status: accepted for incremental implementation (2026-10-13). Evidence and sources: [06-corridor-parcel-research.md](06-corridor-parcel-research.md).

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

## Library choice

Polygon offset/clip: a Clipper2 TypeScript port (BSL-1.0) behind a thin adapter; `polygon-clipping` as an independent
oracle in tests only. No code from Citybound (AGPL) or MapGenerator (LGPL).
