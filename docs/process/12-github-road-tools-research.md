# GitHub research: roads, junctions, lanes, signals, markings for Mayor

Date: 2026-10-13 · Read-only. No repo files edited. Clones are in `/tmp/gh-refs/` (CSUR, Cities2-TrafficLightsEnhancement, TMPE, osm2streets, NodeMarkup, lanemaker, RoadArchitect, streets-gl). SUMO and A/B Street were read through `gh api`.

Mayor context read first: `AGENTS.md` (rule 11), `docs/process/07-junction-builder.md`, `docs/process/07a-junction-review.md`, `src/sim/roads.ts`, `src/sim/traffic.ts` and `src/sim/corridor.ts`.

Scale used throughout: **1 tile = 8 m**. Every number from a reference is converted to tiles (written `t`).

**Licence rule applied:** for GPL, AGPL, LGPL or unlicensed code, only ideas and numbers are reused. For MIT, Apache-2.0 or CC0 code, we may port the code with attribution in `third_party/README.md`. Apache-2.0 also needs a NOTICE line if we port code. Copying *numbers* (lane widths, timings) is fine whatever the licence.

---

## 1. Summary table

| # | Project | Licence | What it does | What applies to Mayor | Effort | Priority |
|---|---|---|---|---|---|---|
| 1 | **citiesskylines-csur/CSUR** | **GPL-3.0** (ideas and numbers only) | Python generator for modular C:S road assets: carriageway grammar, transitions, ramps, node meshes | **Lane-width grid** (3.75 m lane, everything on a 1.875 m half-lane grid); unit widths for kerb, sidewalk, median, parking, barrier and shoulder; transition limits (±1 lane per module, shift ≤1.5 lanes); corner-offset formula (`halfWidth + 3 m`), which matches our 0.83 t trim; speed formula; stop line placed at the lane edge + 0.15 m | S (data table) | **P1** |
| 2 | **CitiesSkylinesMods/TMPE** | **MIT** (can port with attribution) | C:S1 traffic mod: lane connector, priority signs, timed lights, junction restrictions, lane arrows | **Turn classification** by cross product (±0.5 ⇒ 30°/150° bands); **conflict matrix** `DetectCollision`; **same-level priority rules** (left yields to right, left-turners yield; main road beats yield road; a vehicle already leaving the junction keeps priority); **lane-arrow distribution** `DistributeLanes3`; **auto timed-light plans** (per-approach steps, min 3 / max 8, waitFlowBalance 0.3); adaptive step switch `flow − wait < 0`; junction-restriction defaults (U-turn only at dead ends, don't enter a blocked junction, turn on red) | M | **P1** |
| 3 | **slyh/Cities2-TrafficLightsEnhancement** | **No licence** (all rights reserved; ideas only) | C:S2 signal modes: vanilla, split phasing, advanced split, protected turn first, exclusive pedestrian phase | Mode menu for the inspector; adaptive phase picker: `weightedWaiting = occupied · (turnsSinceLastRun / nPhases)^2`, `targetDuration = 10 · avgFlow`, min 2 s / max 300 s, end the phase after 3 low-flow ticks | M | P2 |
| 4 | **a-b-street/osm2streets** (+osm2lanes) | **Apache-2.0** (can port) | OSM → street network with intersection polygons, lane specs, markings | **Trim-to-corners** (adjacent edge intersection, perpendicular projection back to the centreline, keep the max trim); square **terminus** cap of length = road width; **sidewalk corner** polygon (extend inner sidewalk lines and meet them inside the polygon); marking numbers (centre dash 2 m / 1 m gap, lane dash 1 m / 1.5 m, stop line 0.5 m); parking 8 m spots with none in the first or last spot | M | **P1** |
| 5 | **a-b-street/abstreet** (`map_model/src/make/turns.rs`, `traffic_signals`) | **Apache-2.0** (can port) | Traffic simulation with per-lane turns and signals | **Connector curve:** quadratic Bézier whose control point is where the two lane tangents intersect, used when that point lies inside the junction polygon; otherwise a cubic with handles = chord/2; sampled in 5 pieces. **Lane matching** (`remove_merging_turns`). **Signal stage templates** (3-way and 4-way, 2-stage and 4-stage, 30 s fixed stage) | S–M | **P1** |
| 6 | **guotata1996/lanemaker** | **Apache-2.0** (can port) | OpenDRIVE road editor plus simple traffic | **Automatic signal phases from geometric conflicts:** group connectors by incoming road, add non-conflicting ones, then expand each group with every non-conflicting connector (greedy colouring); 15 s per phase. **Lane split** weighted by turn type: straight 1, left 0.99, right 0.5, U-turn 0.01. Junction trim clamp 2–6 m | M | **P1** |
| 7 | **eclipse-sumo/sumo** (netconvert) | **EPL-2.0** (weak copyleft; ideas and numbers) | Reference microsimulator; junction shapes, internal lanes, traffic-light programs | Default numbers (see §3.4): junction radius 4 m, corner-detail 5, crossing width 4 m, sidewalk 2 m, lane 3.2 m, green 31 s, cycle 90 s, left green 6 s, yellow 3 s at ≤50 km/h (+1 s per 10 km/h up to 70), red 5 s, crossing min 4 s plus 5 s clearance, turn-speed limit 5.5 m/s² lateral | S (numbers) | P1 (numbers) |
| 8 | **MacSergey/NodeMarkup** (Intersection Marking Tool) | **MIT** (can port) | C:S1 marking editor: lines, crosswalks, stop lines, fillers | Marking defaults: line 0.15 m, dash 1.5/1.5 m, double-line offset 0.15 m, crosswalk 2 m wide with 0.4 m stripe / 0.6 m gap and 0.3 m offset, stop line 0.3 m, shark teeth 0.5/0.5/0.6 m, filler stripe step 3 m × 0.5 m. "Enter point" model (one point per lane edge at each segment end, lines join points across the node) | S | P2 |
| 9 | **StrandedKitty/streets-gl** | **MIT** (TypeScript; can port) | OSM 3D renderer in WebGL2 | `IntersectionPolygonBuilder.ts`: TypeScript intersection polygon that projects each edge hit onto the opposite edge so both sides trim at the same perpendicular. A good test oracle. Width heuristic: 1 lane = 4 m, otherwise lanes × 3 m | S | P2 (oracle) |
| 10 | **citybound/citybound** | **AGPL-3.0** (ideas only) | Rust city sim with lane-level traffic | Constants: lane 3.9 m, marker 0.3 m, dash 2 m / gap 3 m, switching lane ≥6 m. Car-following by IDM (intelligent driver model) | — | P3 |
| 11 | **ProbableTrain/MapGenerator** | **LGPL-3.0** (TypeScript; ideas only) | Tensor-field streamline road generation | Idea for `maps.ts` procedural maps (major/minor streamlines, dsep/dtest spacing) | L | P3 |
| 12 | **MicroGSD/RoadArchitect** | MIT | Unity spline roads, 3-way and 4-way intersections with turn lanes | Little new: intersection types (all-way stop, light, none), "left turn yields on green" flag | — | P3 |
| 13 | **JadHajjar/RoadBuilder-CSII** | MIT | C:S2 compose roads from lane pieces | Same idea as CSUR's profile grammar; confirms the "profile = ordered lane list" data model | — | P3 |
| 14 | **kianzarrin/NodeController**, **AdaptiveNetworks** (MIT), **CitiesSkylinesMods/HideCrosswalks** (MIT) | NC: none; others MIT | Per-node overrides: node type (Crossing/Middle/Bend/Stretch/UTurn/End), corner offset, no crossing, no markings, sharp corners | Ideas for user overrides in our inspector, and for which diagnostics should become toggles | M | P3 |
| 15 | **krzychu124/Traffic** (TM:PE successor for C:S2) | No licence | Lane connections, priorities in C:S2 | Ideas only; TMPE (MIT) already covers the same ground | — | — |
| 16 | **SeloSlav/spline-based-procedural-dirt-road-system** | MIT, TypeScript | Terrain-aware spline roads, frontage plots, bridges | Frontage plots with rounded corners along splines (ADR 06 lots); terrain conform | M | P3 |
| 17 | OpenTTD (GPL-2), Simutrans (Artistic), Streetmix (now **AGPL-3**; was BSD before the change), pageldev/libOpenDRIVE (Apache-2.0), esmini (MPL-2) | mixed | — | Streetmix segment catalogue for width ideas only. libOpenDRIVE junction/laneLink data model (Apache) if we ever export or import | — | — |

---

## 2. What Mayor has today (the baseline the proposals change)

- **Signals.** `roads.ts:780` `hasSignal` puts a signal on a node with ≥4 arms, or 3 arms with an avenue. `signalPhase` is a 2-phase cycle at 8 s per phase. `armHasGreen` splits arms into N–S and E–W by `|dx| > |dz|`. That is **wrong for diagonal and skewed junctions**: two arms at 40° and 50° land in different phases.
- **Traffic.** `traffic.ts:92` `redCrawl` slows a vehicle to 0.3× when it enters against the phase. There is no yellow, no all-red, no priority at unsignalled nodes, and no lanes. Routes are tile A* through `smoothPath`, `snapToCentrelines` and `roundCorners`, and corners are cut (07a §2.7).
- **Profiles.** `corridor.ts` asphaltHalf is 0.38 / 0.81 / 1.40 t, kerb 0.07 / 0.09 / 0 t, sidewalk 0, lanes 2 / 4 / 4. There are no lane-centre offsets and no median.
- **Junction design (07).** Hermite connectors with tangent 0.55 × chord. 07a found that this spikes in acute cases.

---

## 3. Concrete proposals, mapped to modules

### 3.1 Road profiles on a CSUR-style lane grid (`src/sim/corridor.ts`, prerequisite P1 in 07a §4)

CSUR (GPL; numbers only) builds every cross-section from units on a **1.875 m half-lane grid**. The units are: lane 3.75, median 1.875, bike 2.75, curb 0.5, sidewalk 3.75, barrier 0.9375, channel 1.875, shoulder 1.875, parking 2.75 m.

Mayor's draw widths already fit a grid almost exactly if the urban lane is 3.0 m (osm2lanes `NORMAL_LANE_THICKNESS`; SUMO uses 3.2 m):

| | street (1) | avenue (2) | highway (3) |
|---|---|---|---|
| lane width | 0.375 t (3.0 m) | 0.375 t (3.0 m) | 0.469 t (3.75 m, CSUR) |
| lanes | 1+1 | 2+2 | 2+2 |
| median | 0 (centre line only) | 0.117 t (0.94 m = CSUR barrier/quarter-lane) | 0.234 t (1.875 m) |
| shoulders / barriers | gutter 0.005 t each side | — | shoulder 0.234 t + barrier 0.117 t each side |
| sum vs asphalt today | 0.76 = **0.76** ✓ | 1.50 + 0.117 = **1.617 vs 1.62** ✓ | 1.875 + 0.234 + 0.468 + 0.234 = **2.81 vs 2.80** ✓ |
| lane centres (signed, right-hand traffic, + = right of travel) | ±0.1875 | ±0.246, ±0.621 | ±0.352, ±0.820 |
| kerb | 0.07 (CSUR curb 0.5 m = 0.0625) ✓ | 0.09 | 0 |
| sidewalk (07 S0-1) | 0.12–0.19 t (1.0–1.5 m; osm2lanes 1.5 m, SUMO 2 m) | 0.16–0.25 t | 0 |
| speed (CSUR ground `min(10·(2+nl), 60)` km/h, nl = lanes per direction) | 30 km/h | 40 km/h | 'ex' `max(60, min(10·(2+2nl), 120))` = 60–80 km/h |

The one-way variants (4 and 5) use the same widths with all lanes in one direction. A 2-lane one-way street has centres at ±0.1875 and no centre line. The avenue one-way has 4 lanes plus the 0.117 t median slot, which becomes a dashed-lane gap.

Add to `RoadProfile`: `laneWidth`, `laneCentres: number[]` (signed), `medianHalf`, `shoulder`, `speedKmh`. Test: lane centres are symmetric, the outer lane edge is ≤ asphaltHalf, and no lane overlaps the median.

**Transitions** (07 kind `transition`). CSUR allows ±1 lane per module (`DN_TRANS = 1`), a lateral shift of at most 1.5 lanes per module (`N_SHIFT_MAX`), and one carriageway edge must stay aligned. CSUR modules are 64 m long, which is exactly 8 tiles. CSUR tapers pavement width with **cosine interpolation**.

For Mayor (compressed): street→avenue changes the half-width by 0.43 t per side. Proposal: taper length = `max(1 t, 4·Δhalf)` ≈ 1.7 t, with cosine easing `w(s) = w0 + (w1 − w0)·(1 − cos(πs/L))/2`. Keep the side facing the inside of the bend aligned.

### 3.2 Junction geometry (`src/sim/junction.ts`)

1. **Arm trim as the max of per-side trims, projected perpendicularly** (osm2streets `general_case.rs`, Apache; also streets-gl in TypeScript, MIT). For each adjacent pair of arms, intersect the two facing edge lines. Project the hit perpendicularly onto each arm's centreline. The arm trim is the larger of its two side trims. This closes 07a's per-side-trim ambiguity and gives one trim per arm, which crosswalks and stop lines need. Apply 07's fillet R *after* this, offset by `asphaltHalf + R`.
2. **CSUR corner offset as a cross-check.** CSUR uses `minCornerOffset = halfWidth + 3 m` for roads up to 6 lanes, and `halfWidth + min(2·w/L − 6, 16)` for wider ones. For a street, 0.45 + 0.375 = **0.825 t**. That matches the 0.83 t trim 07a expects for the 4-way street cross, so we can use it as a **test oracle**. Avenue: 0.90 + 0.375 = 1.275 t. Highway (7.5 lanes wide): 1.40 + (2·7.5 − 6)/8 = 2.525 t.
3. **Corner radius.** SUMO `default.junctions.radius` is 4 m (0.50 t), with 5 intermediate corner points (`junctions.corner-detail = 5`). That supports 07's street R = 0.45 t and avenue R = 0.60 t. For tessellation, use 07a's sagitta rule (≤1e-3) but **never fewer than 5 segments per 90° corner**.
4. **Sidewalk corner wrap** (osm2streets `make_sidewalk_corners`, Apache). The outer ring follows the junction polygon between the two arms' outer sidewalk corners. The inner ring is the two inner sidewalk edges extended until they meet, used only when the meeting point lies inside the polygon (otherwise join the two inner endpoints directly). This is exactly the "sidewalk continuous around every corner" requirement. Port it as the fallback for corners where the concentric-ring construction degenerates (acute angles, 07a S0-2).
5. **Dead end** (osm2streets `terminus.rs`). Use a square cap of length `min(roadWidth, 0.4·segLen)`. This matches 07's `square` cap and gives the short-segment rule.
6. **Short segments.** osm2streets has `collapse_short_road` / `collapse_intersection` operations that merge two nodes into one junction. Adopt the idea for 07 rule 9 (merge below about 0.6 t). lanemaker clamps junction trim to [2 m, 6 m] = [0.25 t, 0.75 t] per arm. Use 0.25 t as the hard minimum trim before merging.

### 3.3 Lane connectors and lane arrows (`junction.ts` connectors, consumed by `traffic.ts`)

1. **Turn classification** (TMPE `ExtSegmentEndManager.CalculateArrowDirection`, MIT). Let `c = cross(inDir, outDir).y` and `d = dot`. Then `c ≥ 0.5` ⇒ Left (30°–150°), `c ≤ −0.5` ⇒ Right, otherwise `d > 0` ⇒ Forward and `d ≤ 0` ⇒ U-turn (Turn). For Mayor's x/z frame, check the sign convention once in a test. **Replace `|dx| > |dz|` in `armHasGreen` and `redCrawl` with this classification**, plus the opposite-pair rule (arms within 30° of opposition form an axis).
2. **Connector existence.** Follow A/B Street `make_vehicle_turns` (Apache) and TMPE junction restrictions (MIT): connect every inbound lane to every outbound lane, except **no U-turns unless the node is a dead end** (or a one-way-out node, per TMPE `GetDefaultUturnAllowed`). Then prune with A/B `remove_merging_turns`, per (inArm, outArm, turnType):
   - one source lane → keep all;
   - nSrc = nDst → keep the in-order pairs only (leftmost to leftmost, no crossing);
   - nSrc < nDst → keep all;
   - nSrc > nDst → only the outermost source lane (rightmost for a right turn, leftmost for a left turn).
3. **Lane arrows when an arm has more than one inbound lane** (avenue 2 lanes). TMPE `DistributeLanes3` (MIT) splits source lanes among near/forward/far in proportion to the target lane counts, then hands out the remainder in favour order and ensures no direction gets 0. Special case: with 2 source lanes and 3 directions, the inner lane gets far+forward and the outer lane gets near. For a Mayor avenue, that means lane 1 does left + straight and lane 2 does straight + right. lanemaker's weights (straight 1, left 0.99, right 0.5, U 0.01) are a good tiebreaker. This gives 07's markings stage the arrow decals per lane.
4. **Connector curve** (A/B Street `curvey_turn`, Apache; **replaces 07 step 7's Hermite 0.55 × chord**):
   - P0 is the in-lane point at the in-arm trim, P2 the out-lane point at the out-arm trim.
   - X is the intersection of the two lane tangent lines.
   - If X exists, lies inside the junction asphalt polygon, and the arms are not parallel within 5°: use a **quadratic Bézier (P0, X, P2)**. It is tangent at both ends by construction, and its peak curvature for a 90° street turn is about 1/(lane-offset + trim) ≈ 1.6/t, far under 07's bound of 2/laneWidth = 5.3/t.
   - Otherwise (straight, near-U, or X outside the polygon, which is the acute Y case 07a §2.7 flagged): use a **cubic with handles = |P2 − P0|/2** along each lane direction.
   - Sample 5 pieces for traffic and 16 or more for the containment test.
   - This removes the acute-case blow-up, because the quadratic is used only when X is inside the asphalt.
   - Also apply SUMO's turn-speed limit: `v ≤ sqrt(5.5 m/s² · r)` (`junctions.limit-turn-speed`), ignoring angle changes under 15°. Convert to tiles/s for `ROAD_SPEED`.
5. **Data model** (TMPE `LaneEnd` = (laneId, startNode), MIT): key connectors by `(nodeId, inArm, inLane, outArm, outLane)`. Leave them derived and unsaved (07a: no save-format change). User lane-connector overrides, if ever added, would be optional save fields validated in `save.ts`, as TMPE stores its overrides separately from the defaults.

### 3.4 Signals and priority (`roads.ts` signal API → new `src/sim/signals.ts`; `traffic.ts`)

1. **Phase generation from conflicts** (lanemaker `junction.cpp` greedy grouping, Apache):
   - Two connectors conflict if their sampled curves intersect, unless they start from the same inbound lane end (no conflict) or end in the same out lane (conflict). TMPE's `DetectCollision` table (MIT) is the closed-form shortcut for 4-way cases. For example, when the target goes Forward: an incoming vehicle from Left conflicts unless it turns Right or U; one from Forward conflicts unless it goes Right or Forward; one from Right always conflicts.
   - Phase k starts with all connectors of inbound arm k. Absorb other inbound arms whose connectors don't conflict (typically the opposite arm's straight and right movements). Then expand each phase with every non-conflicting connector from other phases.
   - For a standard 4-way this yields the A/B `four_way_two_stage` (N+S, then E+W, lefts permissive). With protected lefts it yields `four_way_four_stage`. For a T it yields A/B `three_way`: main straight + permissive left, then the side road, with right-on-yield.
   - Skewed and 5-arm nodes come out correct without the N–S/E–W hack.
2. **Timing** (SUMO defaults, EPL; numbers only, converted to game seconds; our phase is 8 game-seconds today):
   - green = max(min green 3, demand-driven) up to max 8 (TMPE auto-TTL: `minTime 3`, `maxTime 8`, `waitFlowBalance 0.3`);
   - **yellow 2 s** (SUMO is 3 s at ≤50 km/h; compress to 2 because our phases are short);
   - **all-red 1 s** (SUMO default 0, but it hides junction-clearing artefacts);
   - protected-left phase 6 s when used (SUMO `tls.left-green.time`);
   - pedestrian minimum 4 s plus 5 s clearance (SUMO) if pedestrians are ever simulated.
   - Cycle target: SUMO's 90 s is too long for gameplay. Use 2 phases × (8 + 2 + 1) = 22 s fixed by default.
3. **Adaptive mode** (optional, behind a node setting):
   - TMPE: after minTime, switch when `meanFlow/waitFlowBalance − meanWait < 0`, with exponential smoothing factor 0.1.
   - TLE (ideas): pick the next phase by priority, then `occupied · (turnsSinceLastRun/nPhases)^2`; target duration `10 · avgFlow`; end the phase after 3 consecutive low-flow ticks.
   - Both need only per-arm queue counts, which `traffic.ts` can count per tile at no allocation cost.
4. **Signal state for vehicles.** Replace `redCrawl`'s 0.3 crawl with stop-at-stop-line. A vehicle stops at the arm's stop-line arclength (from 07 `stopLines`) when the light is red or yellow and it is more than its braking distance away; on yellow it proceeds if already within braking distance. Keep TMPE's "don't enter when blocked" default: wait if the exit tile is over capacity. That removes a gridlock source.
5. **Unsignalled priority** (TMPE `HasPriorityOnSameLevel` + `PriorityRoad`, MIT):
   - The main road is the highest-class near-opposite pair of arms. Those arms are Main; the others are Yield (Stop where sight is poor or the angle is acute).
   - On the same level: **yield to the vehicle from your right** (right-hand traffic), and left-turners yield to oncoming traffic. Across levels, Main always wins. A vehicle already leaving the junction is never forced to stop.
   - Default signal policy stays as today (≥4 arms, or 3 arms with an avenue). A street-only T gets priority signs instead of a light.
6. **Inspector modes** (TLE ideas): Vanilla (protected straight, protected right, permissive left), Split (one arm at a time), Protected-left-first, plus toggles for "turn on red" and "exclusive pedestrian phase". Save as an optional `signalMode?` per node id in `save.ts`.

### 3.5 Lane markings (`junction.ts` markings stage + `render/roads.ts`)

Recommended numbers in tiles. Real-world values are compressed to match our 0.375 t lanes.

| Marking | Value | Source |
|---|---|---|
| line width | 0.02 t (0.15 m) | IMT `DefaultWidth 0.15` |
| centre line between opposite directions (two-way street) | dashed, dash 0.25 t (2 m) / gap 0.125 t (1 m) | osm2streets centre line 2/1 m |
| avenue centre | double solid at ±0.019 t (0.15 m offset) on the median edges, or the raised median | IMT `DefaultDoubleOffset 0.15` |
| lane separator (same direction) | dash 0.19 t (1.5 m) / gap 0.19 t | IMT 1.5/1.5; osm2streets 1.0/1.5; Citybound 2/3 |
| edge line (highway) | solid 0.02 t at asphalt edge − shoulder | CSUR `lane_border 0.15 m` |
| stop line | 0.04 t (0.3 m), inbound lanes only, from the lane edge + 0.019 t to the centre line | IMT stop 0.3 m; CSUR places it at curb + `lane_border` 0.15 m; osm2streets 0.5 m |
| crosswalk | width 0.25–0.30 t (2.0–2.4 m), stripes 0.05 t / gap 0.075 t (pitch 0.125 t; 07 uses 0.11), offset 0.0375 t from the trim | IMT crosswalk 2 m, 0.4/0.6, offset 0.3; SUMO crossing 4 m |
| yield teeth (roundabout entries, Yield arms) | base 0.0625 t, height 0.075 t, gap 0.0625 t | IMT shark 0.5/0.6/0.5 m |
| lane arrows | 0.22 t long (1.75 m), first one 0.6 t before the stop line, then every 2.5 t (20 m) | osm2streets arrows 1.75 m, step 20 m, end buffer 5 m |
| guide dashes through junction | follow the connector curve (§3.3), dash 0.125 / gap 0.125 | — |
| median nose | median ends at the crosswalk outer edge (07 rule 8) | CSUR node median clipped at `lane_border + margin` |

Use IMT's (MIT) **"enter point" model** as the markings stage's internal representation: one point per lane edge at each arm trim, with every line a pair of points. Dashes then stop and resume exactly at trim + crosswalk + gap + stop line, which is 07a §2.3's stack-up.

**Suppression rules** (HideCrosswalks and CSUR `net_ai`): no crosswalks and no signals on bridges, tunnels, elevated roads or highways (CSUR templates set `m_trafficLights: false` for bridge, elevated and tunnel).

### 3.6 Parking (no model today; low priority)

- osm2lanes (Apache): parallel spots 8 m (exactly 1 t) long, `floor(len/8) − 2` spots so none touch the trims, T-marks with 1 m legs; perpendicular spots 3 m wide.
- CSUR `gp` profile puts a 2.75 m (0.34 t) parking lane between the traffic lane and the kerb. That does not fit our street (0.76 t asphalt). It would need a new "avenue with parking" profile, or parking in place of the avenue's outer lanes.
- Cheapest visible win: **parked-car props** at a 1 t pitch along kerbs. Skip the first and last tile after each junction trim, and skip `clearZones`. Pure props, no sim.

---

## 4. Recommended order (fits 07a §4 P0–P7)

### 2026-10-14 implementation note: lane-arrow and controller contracts

Junction arrow decals are derived exclusively from `JunctionLayout.laneArrows`.
For each legal inbound lane, the decal centre is `trim + 0.98 t` along the
outward arm vector (0.60 t before the stop-bar centre) and at that lane's
signed `RoadProfile.laneCentres` offset.  It is a 0.22 t by at-most-0.28 t
quad on `NODE_MARK_LIFT` with `ROAD_CLASS.ARROW`; it therefore shares the
junction patch's marking plane and cannot z-fight the asphalt.

The adaptive-controller pure contract is: green is at least 3 s and at most
8 s, yellow is 2 s, all-red is 1 s.  After minimum green, a strictly higher
`queuedVehicles + 0.3 * accumulatedWaitSeconds` may end green; ties resolve
by phase index.  This makes replay independent of frame timing when ticks are
sub-stepped.  Physical vehicle-route progress is represented by cumulative
polyline arc length (`routeArcLengths`), not point index, when connectors are
spliced: binary lookup selects the preceding point, and equal-length samples
resolve forward.

1. **Profiles (with 07a P1):** add the §3.1 lane grid table to `corridor.ts` (lane centres, median, speed). Tests: symmetry, containment, sum = asphalt within 0.01 t.
2. **Junction trims and fillets (with P2/P3):** osm2streets perpendicular-projection trim, CSUR `halfWidth + 3 m` oracle test (0.825 t street cross), SUMO R = 4 m with ≥5 points per quarter, osm2streets sidewalk-corner fallback for acute corners, square terminus.
3. **Connectors (with P7d, but build them in P3):** TMPE turn classification, A/B existence and lane-matching rules, TMPE `DistributeLanes3` arrows, **A/B quadratic/cubic connector curve** replacing the Hermite. Containment and curvature tests over the 07a hard cases (Y at 25°, avenue+street T, 5-arm).
4. **Markings (with P4):** §3.5 numbers, IMT enter-point model, suppression rules. Screenshots day and night per rule 11.
5. **Signals v2:** conflict-graph phases (lanemaker greedy grouping, TMPE matrix as fast path), yellow 2 s and all-red 1 s, stop-at-stop-line in `traffic.ts`, removal of the `|dx|>|dz|` axis split. Tests: skewed 4-way gets 2 phases, T gets A/B `three_way`, no two green connectors intersect (invariant).
6. **Unsignalled priority:** TMPE main/yield and right-of-way rules, yield teeth rendered.
7. **Adaptive lights and inspector modes:** TMPE flow/wait rule; TLE mode list.
8. **Transitions:** cosine taper; one-lane-per-module rule for avenue↔street.
9. **Parking props:** later.

**Port with attribution** (add to `third_party/README.md`):
- TMPE (MIT): `DistributeLanes3`, the `DetectCollision` matrix, `CalculateArrowDirection`.
- A/B Street and osm2streets (Apache-2.0, needs a NOTICE line): `curvey_turn`, `remove_merging_turns`, trim-to-corners, sidewalk corners.
- lanemaker (Apache-2.0): phase grouping.
- streets-gl (MIT): `IntersectionPolygonBuilder` as a test oracle.
- IMT (MIT): the marking numbers.

**Numbers or ideas only:** CSUR (GPL-3), SUMO (EPL-2), TLE (no licence), Citybound and Streetmix (AGPL), MapGenerator (LGPL), Node Controller and krzychu124/Traffic (no licence).
