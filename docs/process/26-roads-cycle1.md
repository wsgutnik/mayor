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
2. **Vehicles in lanes.** Each vehicle keeps a deterministic lane for its travel direction: `routePath` runs per
   lane with lane `id % n`, except trucks and buses, which keep the rightmost lane (`n-1`). Leaders are lane-aware
   with speed-dependent lookahead (braking distance plus the IDM headway term, clamped). No lane changing in this
   cycle: in a diverge, cars may hop laterally to the outer lane at the connector start.
3. **Ramp class (type 6).** One lane, shoulders, no sidewalk. The profile has `junctionMarkings: true`, but
   markings render only at the terminals; gore arms get none. Joins a highway only: the highway segment must be a
   straight 2-point line (a collinear 2-point continuation within 2° counts as straight), the join angle 10–30°
   (about 12° effective lower bound), in the carriageway direction. That node is kind `"merge"` (entry) or
   `"diverge"` (exit): a gore with chevrons and a dashed merge line — painted straight, not curve-aware — a taper
   into or out of the outer lane, no pad, no stop bar, no signal. Ramps do NOT climb in this cycle: the diamond is
   at grade with perpendicular terminals (climbing ramps deferred). The gore nose is the true crossing of the ramp's
   highway-side asphalt edge and the highway outer asphalt edge. Its end stays at least 0.5 tile beyond that
   crossing. Two gore intervals may not overlap on the same carriageway; planning refuses the later ramp as too
   close. Ramp raster outranks avenue/one-way avenue (rank 5 vs 3/4), so a cross road's terminal tiles become
   class 6 (no frontage, no bus stop, speed 5) — intended.
4. **Interchange.** The "Trevo" tool builds a diamond through `planRoad` (cost and checks included): two exits and
   two entries of type 6, one per quadrant, merging/diverging on the correct side for right-hand traffic. Let `X` be
   the true centreline intersection, `h` the highway unit direction, `n` its right normal, and choose cross-road unit
   direction `c` with `dot(c,n)>0` (crossing angle 70--110 degrees). If the non-ground cross-road piece ends at
   distances `e+`/`e-` from `X`, then `d+ = e+ + 2`, `d- = e- + 2`, terminals are
   `T+ = X + c*d+`, `T- = X - c*d-`, and `g = max(d+,d-)/tan(20 degrees) + 2` (no clamp). The highway and ground
   cross-road approaches must physically contain both gores and terminals; otherwise planning returns
   `No room for ramp terminals`.

   Each ramp is one quadratic `P0,C,P2`. Its control `C` is the intersection of the ray from its highway gore at
   20 degrees toward its side and the line through its terminal parallel to `h`. On `+n` (travel `+h`), the exit is
   `X-h*g -> T+` and entry `T+ -> X+h*g`; on `-n` (travel `-h`), the exit is `X+h*g -> T-` and entry
   `T- -> X-h*g`, with the `-n` side's gores staggered 6 tiles further out (`g+6`) so no highway node is a 4-arm gore. A terminal within 1.6 tiles of an existing through node of the cross road (the bridge ramp's ground end) is that node. Thus every highway tangent is 20 degrees, every terminal tangent is perpendicular to the cross
   road, neither ramp crosses the cross-road centreline, and each terminal is exactly a four-ground-arm cross. Ramp
   raster may meet cross-road raster only in the terminal junction tiles. All four ramps stay at grade (no climbing
   profile). Auto grade separation lifts only a local span (~11 tiles) around each highway crossing. Planning
   simulates the four placements in order on a scratch city, so preview cost equals the amount placement spends and
   any refusal is atomic. During raster rebuild, a tile covered by any two-way ground segment has `(dirX,dirZ)=(0,0)`
   even when a one-way segment's wider raster also covers it; one-way raster paint never overrides two-way tiles,
   which preserves every legal movement on the two-way road.
5. **Old saves.** Type ids 1-5 are unchanged; type 6 is accepted by `save.ts`. `SAVE_VERSION` stays 2: saves
   containing a type-6 segment do not open in builds older than this change — older builds reject them as invalid
   (generic invalid-save error, not a version message). Old interchange ramps (type-4 segments) are left as built.
   Highways in old saves render the new 3+3 profile at the same width.

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

## 12. 1B result (2026-10-15, observed)

Branch `agent/r1b-int`. Plan: `docs/superpowers/plans/2026-10-15-roads-1b-highway-ramps-interchange.md`. Built by
parallel Codex/Muse implementers from the §9 task briefs (Tasks 1–7 plus polish and perf passes), integrated by the
lead; every task was reviewed and re-reviewed separately. Section 6 above is aligned to what was built.

What changed:
- Highway render: 3 lanes per direction with a concrete Jersey barrier mesh that reuses the ribbon's end stations
  (no 0.25 sampling on straights), lamps every 3 tiles on the barrier (twins) plus singles on ramp outer sides;
  pads share the ribbon's asphalt tone, the median reads as concrete.
- Ramp class (type 6): one lane, shoulders, no sidewalk; `junctionMarkings: true` in the profile but markings
  render only at the terminals. Ramps join only straight 2-point highway segments at 10–30° (about 12° effective
  lower bound) in the carriageway direction; the node becomes kind `"merge"`/`"diverge"` with chevrons and a dashed
  merge line (painted straight, not curve-aware). Ramps do NOT climb: at-grade diamond, climbing deferred.
- Trevo interchange through `planRoad` (cost and checks included): four at-grade ramps with perpendicular
  terminals, `-n` gores staggered 6 tiles out; refused atomically with reasons (`No room for ramp terminals`, …).
  Auto grade separation lifts only a local span (~11 tiles) around each highway crossing.
- One-way raster paint never overrides two-way tiles (`(dirX,dirZ)=(0,0)` on tiles any two-way ground segment
  covers); this also fixed the pre-existing one-way-street-into-avenue direction on main.
- Traffic: every vehicle keeps a lane (`id % n`; trucks/buses rightmost, `n-1`); lane-aware leaders with
  speed-dependent lookahead; routes stay monotone along travel; red-light queues on every lane.
- Markings (crosswalk, stop bar, one-way arrow) packed into one 512×896 atlas: the road shader stays at 11 custom
  samplers, under the 16 texture-unit limit. The source images `crosswalk.png`, `stop_bar.png`, `arrow_oneway.png`
  still ship in `public/textures/road/` because the atlas test verifies them pixel-exact against the pack.
- `?scenario=interchange`: diamond interchange scene with fixed `interchange`/`gore` cameras (`game`/`close`).
- RangeError fix (pre-existing crash, not a 1B regression): `findLayeredPath` compares `Math.fround` g-values
  because g is stored float32 — without it a diagonal avenue re-relaxes forever (`Invalid array length`).
- Test hygiene: report-only timing tests run only with `MAYOR_PERF=1` and write under `os.tmpdir()`; road tests
  emit no console output and write no files by default; `agent-report/` is gitignored.
- Saves: `SAVE_VERSION` stays 2. Saves containing road type 6 do not open in builds older than this change;
  older builds reject them as invalid (generic error, no version message).

Verification: `npx tsc --noEmit` clean; `npm run ci` green at the branch head (1261 passed, 7 skipped — 4 of them
`MAYOR_PERF`-gated timing tests — 2 todo, 147 files, plus the vite build). `?scenario=interchange` reproduces the
diamond. Same-camera hard-case shots (day/night, game/close) were taken once by the lead; re-verification of the
polish pass and the deferred M2/M3/M5 minors is still open (final-review item 2a).

Measured (Mac, warm median of 10, `MAYOR_PERF=1` dense 96×96 city with 2 interchanges, baseline `18a5b89` → 1B):
road geometry rebuild atlas 6.48 → 8.30 ms, low tier 7.72 → 9.84 ms (both < 10 ms; single samples up to 15.9 atlas /
11.3 low); `junctionsOf` after a one-segment edit 1.10 → 1.11 ms; `tickTraffic(0.1)` at 260 vehicles 2.83 → 3.98 ms
(+25…41% across reruns; the 1B scene also has +24% segments from the 2 interchanges, 111 → 138); layouts +4 diverge
+4 merge. On the saturated avenue-spine traffic fixture: tick +31% (2.04 ms at 260 cars), completed trips 623 → 440
(ghost overlaps removed), abandoned 66 → 102 (spawn clearance follow-up; knob: spawn demand/capacity). Tap-time
`planInterchange` 21 ms + `placeInterchange` 29 ms on an empty 96×96 (populated city unmeasured). FPS, iPad and
Windows results are unmeasured.

Still open (1C or later): ramp/gore rules are not revalidated when the highway is edited later; order dependence
(highway drawn after the avenue auto-bridges, then the interchange is refused — draw the highway first); no lane
changing; refusal-text nits (`Not on a highway` for ramps, `Overlaps` for a side street just outside the span edge,
hill/tunnel span ignored when a highway is also crossed); street→ramp upgrade skips the strand check; legacy 1A
diamond nodes refuse unrelated upgrades; spawn clearance follow-up (parked). Traffic IDM constants still assume
about 11.4 m per tile while the corridor uses 8 m.
