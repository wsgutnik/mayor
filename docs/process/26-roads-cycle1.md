# 26 — Roads cycle 1: one road profile, honest junctions, a real highway

Status: design approved in conversation 2026-10-15 (owner); this spec awaits owner review.
Baseline: main `be1efbd`. Diagnosis with file:line evidence and "before" captures:
`/tmp/mayor-agents/review-baseline-2026-10-15/` (DIAGNOSIS.md, A/B/D/E jpg).

## 1. Problem

Observed in game (reproduced on `be1efbd`, quality high, atlas roads):

| Case | What the player sees | Cause |
|---|---|---|
| A. Avenue → one-way street, straight | Hard square step, no transition, yellow centre dashes on a one-way, arrow in half the width | Straight width change has no pad, no taper, no connectors (`junction.ts:885-907`); one-way uses half the asphalt (`lanes.ts:36-42`) |
| B. Avenue T one-way | Pad reads as a separate plate; kerb bands step at the seam | Atlas ribbons ignore junction trims and run square to the node centre (`roads.ts:265-302`); atlas kerb bands ≠ profile (`make_road_atlas.py:130-132` vs `corridor.ts:60-72`); pad uses another texture and height (`roads.ts:779-799`) |
| C. Highway | Looks like independent one-way roads side by side | Sim 2+2 lanes of 5.6 m; atlas paints 3 equal lanes, no direction separation; low tier paints a third version; no median, barrier or shoulder; vehicles drawn 0.1 tile from the centreline on every road (`scene.ts:1631`) |
| D. Diagonal / slope | Huge irregular pad, "barcode" retaining walls | Mixed-width corners take the larger radius and fall back to chamfer/miter (`junction.ts:445,1044-1318`); wall UVs stretched |
| E. Interchange | Flat pads with white triangle islands; ramps are kerbed one-way streets, all exits | `main.ts:498-540` adds four type-4 segments with `addSegment` (no `planRoad`), all direction 1, flat |
| Tool | Road types unclear | Names only, one-way thumbnails = two-way, "Lanes 2/4" wrong for one-way, monochrome preview with no lanes or arrows, one-way direction set silently by stroke and flipped by redraw |

Root structural cause: road numbers live in six independent tables (`world.ts:124-128`, `corridor.ts:60-114`,
`traffic.ts:13-14`, `junction.ts:52-60`, `make_road_atlas.py:114-164`, `roads.ts:407-430`).

## 2. Goals and non-goals

Goals (cycle 1):
1. One road profile table from which simulation, lane graph, junction builder, atlas textures, low-tier markings, vehicle
   placement and the road card all derive.
2. Junction surfaces with no square plates: ribbons stop at the arm trim in every quality tier; pad and ribbon share
   material, height and kerb band positions.
3. Width and lane-count transitions drawn as a taper with lane-drop markings and valid lane connectors.
4. One-way roads use their full width, carry their direction into the junction, and look one-way.
5. Highway as one coherent 3+3 road with a central barrier and shoulders; a ramp class; an interchange with entries
   and exits that climb.
6. A road tool where the player sees profile, direction, width and cost before confirming, and gets a reason when a
   connection is refused.

Non-goals (later cycles): rail track network (cycle 2), lane changing in traffic, new road classes beyond the ramp
(six-lane avenue, pedestrian street), building assets, thumbnails rendered from models (cycle 6).

## 3. Units and scale

1 tile = 8 m (the corridor convention, `corridor.ts`). The traffic comment claiming 11.3 m (`traffic.ts:309-310`) is
corrected to 8 m; no behaviour depends on it. All widths below are in tiles; metres in brackets.

## 4. Road profile table (1A)

New module `src/sim/roadprofile.ts`, the only place road numbers are written:

```ts
export interface RoadSpec {
  type: RoadType;              // stable save id, never renumbered
  nameKey: string;             // i18n key
  descKey: string;             // i18n key, one sentence for the card
  thumb: string;               // /ui/thumbs/*.jpg
  tileWidth: number;           // grid footprint
  oneWay: boolean;
  lanesPerDir: [fwd: number, back: number]; // back = 0 for one-way
  laneWidth: number;
  medianHalf: number;          // 0 = painted double line or none
  median: "none" | "paint" | "planted" | "barrier";
  shoulder: number;            // per side, asphalt outside the outer lane
  kerb: number;
  sidewalk: number;
  speed: number;               // tiles/s free flow
  capacityPerLane: number;     // vehicles per tile per lane
  cornerRadius: number;
  clearance: number;
  rank: number;                // tile-class priority, replaces numeric `type` comparison
  cost: number; upkeep: number;
  junctionMarkings: boolean;   // crosswalks, stop bars, arrows
  atGradeWith: RoadType[];     // classes it may join at grade
  levels: ("ground" | "bridge" | "tunnel")[];
}
export const ROAD_SPECS: Record<RoadType, RoadSpec>;
```

Derived (computed once, never hand-written): two-way `asphaltHalf = medianHalf + lanesPerDir·laneWidth + shoulder`;
one-way `asphaltHalf = lanes·laneWidth/2 + shoulder` (lanes centred, no median);
`drawHalf = asphaltHalf + kerb`, `laneCentres`, `capacity = capacityPerLane·totalLanes`. A test asserts
`2·drawHalf` equals the drawn width below for every type.

Target values (tiles [m]):

| | 1 Street | 2 Avenue | 3 Highway | 4 One-way street | 5 One-way avenue | 6 Ramp (new) |
|---|---|---|---|---|---|---|
| Footprint | 1 | 2 | 3 | 1 | 2 | 1 |
| Lanes fwd+back | 1+1 | 2+2 | 3+3 | 2+0 | 4+0 | 1+0 |
| Lane width | 0.38 [3.0] | 0.325 [2.6] | 0.40 [3.2] | 0.38 [3.0] | 0.405 [3.2] | 0.45 [3.6] |
| Median | paint | planted 0.16 | barrier 0.10 | none | none | none |
| Shoulder | 0 | 0 | 0.10 [0.8] | 0 | 0 | 0.20 [1.6] |
| Kerb / sidewalk | 0.07 / 0.12 | 0.09 / 0.16 | 0 / 0 | 0.07 / 0.12 | 0.09 / 0.16 | 0 / 0 |
| Drawn width | 0.90 | 1.80 | 2.80 | 0.90 | 1.80 | 0.85 |
| Speed | 3 | 4.5 | 7 | 3 | 4.5 | 5 |
| Capacity per lane | 2 | 2.5 | 5 | 2 | 2.5 | 5 |
| Capacity (derived) | 4 | 10 | 30 | 4 | 10 | 5 |
| Junction markings | yes | yes | no | yes | yes | only where it lands on a city road |
| At grade with | 1,2,4,5 | 1,2,4,5 | 3,6 | 1,2,4,5 | 1,2,4,5 | 1,2,3,4,5 |
| Rank | 1 | 3 | 6 | 2 | 4 | 5 |

Existing widths and footprints are unchanged, so built cities keep their geometry; the highway keeps its 2.8 width
and only its internal division changes. Capacity numbers are a starting point; the traffic matrix test decides.

Consumers rewritten to read the table: `world.ts` (ROAD_* records become views of ROAD_SPECS; tile class by `rank`,
replacing `world.ts:648` and `sim.ts:479`), `corridor.ts` (profile = derived spec), `lanes.ts`, `traffic.ts`
(speed, capacity), `junction.ts` (radius, clearance, markings), `crossings.ts` (at-grade rule), `road-facts.ts`,
`hud.ts` thumbnails.

Atlas: `npm run roads:profiles` writes `public/textures/road/profiles.json` from the table;
`blender/make_road_atlas.py` reads it for band positions (kerb, median, lane lines, shoulder line). A test fails
when the JSON is stale. The low-tier vertex-colour markings (`roads.ts:407-430`) read the same derived offsets.

## 5. Junction surfaces (1A)

1. **Ribbons honour trims in every tier.** The atlas branch of `roads.ts` stops each ribbon at its arm trim and
   applies the corner trims exactly as the low tier does. No ribbon vertex lies inside the pad polygon.
2. **One surface.** Pad asphalt uses the ribbon asphalt material and the ribbon height (0.06); kerb and sidewalk
   bands of the pad take positions from the profile so the seam is continuous (offset error ≤ 1e-3).
3. **Mixed widths.** Each corner radius comes from the narrower of its two arms (one-way arms use their own spec).
   Chamfer and miter fallbacks remain only for corners that cannot fit, and each fallback emits a diagnostic code.
4. **Transitions (taper).** A node whose two arms are collinear (≤ 10°) with different specs becomes kind
   `"taper"`: an asphalt trapezoid of length `L = clamp(6·|ΔasphaltHalf|, 0.6, 3)` taken from the wider arm,
   kerb and sidewalk lines interpolated along it, the dropped lane marked with a merge arrow and dashed edge line,
   and lane connectors mapping lanes proportionally (dropped lanes merge into the adjacent lane). Taper between
   two-way and one-way is allowed only when the direction is consistent; otherwise the planner refuses with a reason.
5. **One-way at junctions.** `buildJunction` passes `oneWay` and `dir` of every arm to the lane builder; inbound
   one-way arms get a full-width stop bar, outbound ones none; one-way markings have no centre line.
6. **Refusal reasons.** When a legal movement yields no connector (`lanes.ts:86-87`), the junction emits
   `connector-missing` with the arm pair; the planner surfaces it in the hint line. When a plan cannot build a
   junction (at-grade rule, direction conflict, too acute), `planRoad` returns a reason string from i18n.

## 6. Highway, ramps and interchange (1B)

1. **Highway rendering.** Three lanes per direction, white dashed lane lines, solid edge lines at the shoulders,
   a concrete Jersey barrier on the median as a merged extruded mesh along the ribbon (instanced per segment,
   no per-frame allocation). Atlas and low tier draw the same thing from the profile. Bridges keep parapets.
2. **Vehicles in lanes.** Render offset = a lane centre from the profile for the vehicle's travel direction;
   the lane index is deterministic per vehicle id (`id % lanesPerDir`) until lane changing exists. Same for buses
   (removes the hard-coded 0.14). Trucks prefer the outer lane.
3. **Ramp class (type 6).** One lane, shoulders, no sidewalk, no junction markings. Joins a highway only at a
   shallow angle (≤ 30°); that node is kind `"merge"` (entry) or `"diverge"` (exit): a gore with chevrons, a
   taper into or out of the outer lane, no pad, no stop bar, no signal. The ramp may climb: its elevation profile
   interpolates from the highway grade to the deck height of the cross road; maximum grade 8 %.
4. **Interchange.** The "Trevo" tool builds a diamond through `planRoad` (cost and checks included): two exits and
   two entries of type 6, one per quadrant, merging/diverging on the correct side for right-hand traffic, landing on
   the cross road with an ordinary junction. Refusal reasons for no room, water, slope.
5. **Old saves.** Type ids 1-5 are unchanged; type 6 is accepted by `save.ts`. Old interchange ramps (type-4
   segments) are left as built. Highways in old saves render the new 3+3 profile at the same width. Saves with a
   type-6 segment do not open in builds older than this cycle (documented in the changelog).

## 7. Road tool (1C)

1. **Card per profile** (Roads flyout): name, one-line description, a cross-section strip drawn from the spec
   (lanes, arrows per direction, median, shoulders, sidewalks), lanes per direction, width in metres, speed,
   capacity, cost and upkeep. One-way and ramp get their own thumbnails (unused `rd-ramp.jpg` is reviewed first).
2. **Preview.** The draft ribbon is drawn with lane lines and direction arrows from the spec, translucent green or
   red; for one-way, arrows show the stroke direction before release. A "Reverse direction" action replaces the
   silent flip-on-redraw; redraw of an existing one-way no longer flips it.
3. **Readout.** Cost, length, slope, lanes and direction, and the junction or refusal reason.
4. **Upgrade.** Upgrading continues across collinear segments of the same class up to the next junction, so a
   partial upgrade no longer leaves square steps; where a class change stays, a taper is drawn (section 5.4).
5. Mouse and touch: every action above works with tap (iPad) and click; cancel, undo and redo are verified for
   draw, reverse, upgrade and interchange.

## 8. Verification

Headless (Vitest, must stay green; `npx tsc --noEmit` clean):
- `roadprofile.test.ts`: derived widths equal footprints; lanes sum to asphalt; every consumer table equals the spec
  (no second source); `profiles.json` fresh.
- Ribbon mesh invariants on the real atlas branch (`buildRoadNetworkGeometry(..., {atlas:true})`): no ribbon vertex
  inside a pad; pad/ribbon seam gap ≤ 1e-3; no overlapping triangles; no sliver triangles (min angle ≥ 2°).
- Taper: monotonic width, connectors for every lane, merge arrow present.
- One-way: connectors correct for `dir` 1 and −1 at T, cross and taper.
- Highway–ramp merge/diverge: gore present, no pad, connectors into the outer lane; interchange plan valid and all
  four movements routable by `routePath`.
- Traffic gridlock matrix (`5ae4fb3` tests) stays flowing with the new capacities.
- Save round trip for types 1-6 and an old save with a type-4 interchange.

Showcase / scenario: `src/dev/scenario.ts` gains `?scenario=roads` with the cases A-E plus lane reduction, 4-way,
parallel close roads, bridge and tunnel ramps, grade separation, upgrade of a built road, and fixed camera presets
(`__scenario.shot(name, "game" | "close")`) so before/after captures use the same camera. SVG dumps of every case
include the ribbon mesh.

Visual gate (lead, AGENTS rule 11): every scenario case at game zoom and close, day and night, before and after,
same camera; screenshots in the cycle report.

Performance: road network rebuild time measured on the roads scenario and on a 96×96 saved city before and after;
must stay under 10 ms per rebuild on the Mac; barrier meshes add no draw call per segment (one merged mesh per tier).
FPS on iPad is not claimed without a device run.

## 9. Delivery and ownership

| Step | Owner | Files (exclusive while running) | Depends on | Accept when |
|---|---|---|---|---|
| 1A.0 Profile table + tests | Lead (Claude) | `src/sim/roadprofile.ts`, `roadprofile.test.ts`, `world.ts` ROAD_* views | – | table + derivation tests green, no behaviour change except tile rank |
| 1A.1 Sim: lanes, one-way, taper, reasons | Codex (`gpt-5.6-terra`) | `corridor.ts`, `lanes.ts`, `junction.ts`, `crossings.ts`, `traffic.ts` constants | 1A.0 | junction/taper/one-way tests green |
| 1A.2 Render: trims, single surface, taper drawing, atlas from JSON | Codex (`gpt-5.6-terra`) or Muse spark | `render/roads.ts`, `road-material.ts`, `blender/make_road_atlas.py`, `public/textures/road/*` | 1A.0 (parallel with 1A.1, taper drawing after 1A.1 geometry lands) | mesh invariants green; lead visual gate A, B, D |
| 1A.3 Scenario + dumps | Lead | `src/dev/scenario.ts`, showcase cases | 1A.0 | before captures with fixed cameras |
| 1B.1 Highway profile render + barrier + vehicle lanes | Codex | `render/roads.ts`, `render/scene.ts` vehicle offsets | 1A merged | visual gate C |
| 1B.2 Ramp class, merge/diverge, interchange | Codex (`gpt-5.6-sol` if terra stalls) | `sim/*` roads, `main.ts` interchange handler, `save.ts` | 1A merged | interchange routable; visual gate E |
| 1C UI: cards, preview, reverse, readout, upgrade run | Codex (`gpt-5.6-luna`) | `ui/*`, `i18n.ts`, `render/scene.ts` preview only | 1B merged | touch + mouse walkthrough by lead |

Each agent works in `/tmp/mayor-wt/<name>` on `agent/<name>`; the lead applies patches with `git apply --3way`,
runs `npm run ci` between merges, and does every browser check. No commit or push without the owner's request.

A cycle step is done only with: integrated code, tests, before/after captures with equal camera (day and night),
save round trip, rebuild timing, and this document updated to what was observed.

## 10. Risks

- Highway capacity change (20 → 30) shifts traffic balance; mitigated by the gridlock matrix test and an ingame
  check at population ~9000.
- Atlas regeneration needs Blender headless; if unavailable to the agent, the lead runs it.
- Ramp elevation reuses the bridge deck system (`elevation.ts`); if interpolated decks are not supported, 1B.2
  first adds a sloped-deck span type, scoped in its plan.
- Taper geometry on curves: limited to collinear arms in this cycle; curved transitions refuse with a reason.

## 11. 1A result (2026-10-15, observed)

Branch `agent/roads-render` (sim work from `agent/roads-sim` merged in). Plan:
`docs/superpowers/plans/2026-10-15-roads-1a-profiles-junctions.md`. Implemented by the lead (tables, consumers,
scenario), Codex `gpt-5.6-terra`/`gpt-5.6-sol` and, after the Codex quota ran out, Claude Opus implementers; every task
was reviewed and re-reviewed by separate reviewers.

What changed:
- `src/sim/roadprofile.ts` is the single road table; `world.ts`, `corridor.ts`, `traffic.ts`, `junction.ts`,
  `road-facts.ts` and the atlas (`profiles.json`, `npm run roads:profiles`, `blender/make_road_atlas.py`) read it.
  Tile class uses `rank` (a one-way street no longer outranks an avenue or highway).
- One-way roads use their whole width; lanes are listed left to right of travel on every arm (this also fixed the
  pre-existing reversed order on two-way arms at end `a`); junctions receive each arm's direction; redrawing a one-way
  rebuilds its junctions.
- Straight width changes are `taper` junctions: a trapezoid of length `clamp(6·Δ, 0.6, 3)`, left-aligned lanes, the
  rightmost lanes drop (merge arrow, dashed boundary) or are added; lane lines and the centre separator continue
  through it; medians end in a rounded nose. Opposing one-ways get `taper-direction-conflict` and the planner refuses
  with "One-way direction conflicts with the road it joins". Missing legal movements become `connector-missing`.
- Atlas ribbons stop at one across-mouth station per arm side shared by asphalt, kerb and sidewalk; pad and ribbon
  share one height and material tone; same-height overlap is 0 (was 0.18–2.6 tile² per junction); pad triangles are
  refined to ≥ 2.4°.
- Highway texture: 3 lanes per direction, barrier strip, shoulder edge lines (the 3D barrier is 1B). No crosswalks,
  stop bars or lane arrows on highway arms. Inbound one-way stop bars span the full width.
- Bridges (owner request): 1.1 m concrete barrier that fades out at grade, retaining faces on ramps, slab edge and
  underside, plain concrete that no longer samples the road atlas, no shadow patch on the road below; tunnel portals
  use the same concrete.

Verification: `npx tsc --noEmit` clean; full suite green (see CHANGELOG for the count). Same-camera before/after:
`docs/img/roads-1a/compare-roads.jpg`, `compare-bridges.jpg`, night `after-close-night.jpg`; all 48 shots per state
in `/tmp/mayor-agents/roads-1a-shots/` (local). `?scenario=roads` + `__scenario.shot(name, "game" | "close")`
reproduces every case. Warm road rebuild on the dense test grid: 6.1–6.7 ms (budget 10 ms); Mac only, no iPad
measurement.

Still open (moved to 1B/1C or later): 3D highway barrier and lighting, ramp class and interchange (case E still the
old diamond), vehicles in their lanes, road tool card/preview; deferred minors listed in the SDD ledger summary of
the cycle report (water-shadow ends, pad dash phase, bridge-continues cap rule for mismatched types, rain darkening of
pad bands). Traffic IDM constants still assume about 11.4 m per tile while the corridor uses 8 m.
