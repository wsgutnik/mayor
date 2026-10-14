# GitHub research: roads, junctions, traffic — ideas, algorithms, data for Mayor

Author: Muse (read-only research). Date: 2026-10-14.
Scope: what Mayor (proprietary, `package.json: private:true`, no LICENSE → treat as closed) can
**adapt with attribution** (MIT/Apache-2.0/BSD/ISC/Boost) vs use as **ideas/numbers only**
(GPL/AGPL/EPL/MPL/no-license). No repo files were edited; checkouts live in `/tmp/gh-refs/`
(shared scratch; some clones pre-existed from parallel research and were used read-only).

Mayor context read: `AGENTS.md`, `docs/process/07-junction-builder.md`,
`src/sim/roads.ts`, `src/sim/traffic.ts`, `src/sim/corridor.ts`.
**Note:** `docs/process/07a-junction-review.md` (named in the task) does not exist in this worktree;
`docs/process/` only goes up to `07-junction-builder.md`.

Mayor baseline numbers (tile = 8 m): street draw 0.9 tile, asphaltHalf 0.38 (6.08 m asphalt,
2 lanes ≈ 3.04 m each); avenue draw 1.8, asphaltHalf 0.81 (12.96 m, 4 lanes ≈ 3.24 m);
highway draw 2.8, asphaltHalf 1.40 (22.4 m, 4 lanes ≈ 5.6 m — very wide, see P4);
kerb 0.07/0.09/0; signals: global 2-phase NS/EW, 8 s per phase, red-crawl factor 0.3, no yellow.

## Master table

Legend: **A** = can adapt code with attribution (permissive) · **I** = ideas/numbers only.

| Project | License | V | What it is | What applies to Mayor | Effort | Pri |
|---|---|---|---|---|---|---|
| [citiesskylines-csur/CSUR](https://github.com/citiesskylines-csur/CSUR) | GPL-3.0 (LICENSE file) | I | Procedural CS1 road-asset framework: cross-section = unit list, modules base/shift/trans/ramp | Unit-composition profile model; width table (lane 3.75, median 1.875, curb 0.5, sidewalk 3.75, shoulder/parking 1.875/2.75 m); transition-as-start/end-unit-lists; reversible naming | S | P0 data |
| [CitiesSkylinesMods/TMPE](https://github.com/CitiesSkylinesMods/TMPE) | MIT (LICENSE file) | A | CS1 traffic mod: lane connector, arrows, priority, timed/manual lights, restrictions | LaneArrows + LaneConnection model; JunctionRestrictionFlags (6); PriorityType Main/Stop/Yield; timed steps min/max + flow/wait adaptive (FlowToWait 0.8); sim types None/Manual/Timed | M | P0 model |
| [slyh/Cities2-TrafficLightsEnhancement](https://github.com/slyh/Cities2-TrafficLightsEnhancement) | **none** (no LICENSE file) | I | CS2 mod: per-junction signal-mode presets | Per-node pattern enum (Vanilla/Split/Protected-turn/Custom + ExclusivePed/kerbside-green/give-way flags); actuated-green idea; ped duration multiplier | S | P1 model |
| [a-b-street/abstreet](https://github.com/a-b-street/abstreet) | Apache-2.0 | A | Rust traffic-planning sim+game (map_model + sim) | **Turn model + geometry** (`curvey_turn`: quad-bezier via lane-line miter, cubic fallback, 5 samples); `remove_merging_turns` 1:1 matching; `verify_vehicle_connectivity`; signal policy generators (2/3/4-stage, split, greedy, ped); stage sync pass | M–L | P0 top |
| [a-b-street/osm2streets](https://github.com/a-b-street/osm2streets) | Apache-2.0 (LICENSE file) | A | OSM→lanes/intersections splitter (Rust + JS/wasm bindings) | IntersectionKind (MapEdge/Terminus/Connection/Fork/Intersection); IntersectionControl; TrafficConflict (Uncontested/Diverge/Merge/Cross); Movement=(road,road); `trim_to_corners` edge-collision trim; zebra/stop/parking marking renderers | M | P0 top |
| [a-b-street/osm2streets osm2lanes](https://github.com/a-b-street/osm2streets) | Apache-2.0 | A | Lane-spec parser + default widths (same repo) | Width data w/ sources: driving 3.0 typical / 2.0 alley / 2.44 narrow / 3.66 highway; bike 1.5–2.0; bus 3.05–3.66; parking 2.13–3.0; sidewalk 1.5–1.83; shoulder 0.5; curb 0.1 m | S | P0 data |
| [StrandedKitty/streets-gl](https://github.com/StrandedKitty/streets-gl) | MIT (LICENSE file) | A | **TypeScript** OSM 3D renderer (WebGL2) | **195-line TS junction-polygon builder** (edge-intersection + projection + alpha-sort, directly portable); Road/Intersection graph model; ribbon RoadBuilder w/ UV-follow option | S | P0 top |
| [MacSergey/NodeMarkup](https://github.com/MacSergey/NodeMarkup) (Intersection Marking Tool) | MIT | A | CS1 junction-marking editor | Full marking catalog: 8 line styles + stop variants, shark teeth, zigzag; fillers (stripe/grid/chevron/solid); 8 crosswalk styles; LineTypes Regular/Stop/Crosswalk/Lane; Enter-point anchoring; Style + Intersection templates | M | P1 |
| [JadHajjar/RoadBuilder-CSII](https://github.com/JadHajjar/RoadBuilder-CSII) | MIT | A | CS2 runtime road-composer mod | RoadConfig = ordered lane-group list (Car/Bike/Bus/Parking/Median/Shoulder/Sidewalk/…); LaneSectionType Vehicles/Tracks/Medians/Edges/Misc; per-segment override vs edit-all; save-embedded customs | M | P1 model |
| [guotata1996/lanemaker](https://github.com/guotata1996/lanemaker) | Apache-2.0 (LICENSE file) | A | C++/Qt OpenDRIVE road editor + traffic sim | Junction trim 2–6 m; max curvature 1/4; bridge clearance 5 m; Gipps follow (τ=1.5, a=3, b=−8, s0=4 m); phase→lanes cyclic signals; junction connecting-road generation; spatial indexer | M | P1 |
| [MicroGSD/RoadArchitect](https://github.com/MicroGSD/RoadArchitect) | MIT (LICENSE file) | A | Unity procedural roads + dynamic intersections | **Signal defaults: green 10 s, left-turn 5 s, yellow 2 s, all-red 1 s**; 3-way/4-way × (all-way-stop / TL1 / TL2 / none); turn-lane widening types; Timed vs Sensor (actuated) modes | S | P0 data |
| [eclipse-sumo/sumo](https://github.com/eclipse-sumo/sumo) | EPL-2.0 (+ GPL-2 dual) | I | Microscopic traffic sim; netconvert junction builder | Junction radius default **4 m**; join distance 10 m; keep-clear default true; sidewalk 2.0 / bike 1.0 / crossing 4.0 m; crossing speed 2.78 m/s; junction-type catalog (incl. right-before-left, all-way-stop); tls.min-dur 5 s, NEMA yellow 3 s, all-red 0 | S | P1 data |
| [citybound/citybound](https://github.com/citybound/citybound) | AGPL-3.0 | I | Rust actor-model city builder (dead, design-rich) | IntersectionPrototype (area + in/out connectors/arm + connecting_lanes[(in,out)]); role classify (straight<30°, inner/outer turn, U-turn by proximity+opposition); LanePrototype+`morphable_from` rebuild idea; IDM reference | S | P1 ideas |
| [carla-simulator/carla](https://github.com/carla-simulator/carla) | MIT | A | Autonomous-driving sim, OpenDRIVE-based | `MapBuilder`+`MeshFactory`+`Junction`+`LaneSection`+`Signal` architecture for OpenDRIVE→mesh; lane-topology signal model | L | P2 |
| [cityflow-project/CityFlow](https://github.com/cityflow-project/CityFlow) | Apache-2.0 | A | C++ large-scale RL traffic env | Engine/roadnet/vehicle split; lane-link signal phases; vehicle car-following reference for later micro-sim | L | P2 |
| [Farama-Foundation/HighwayEnv](https://github.com/Farama-Foundation/HighwayEnv) | MIT | A | Python driving-decision envs (IDM+MOBIL) | **IDM numbers**: a_max 6, comfort +3/−5 m/s², jam gap 5 m+len, T 1.5 s, δ 4; MOBIL lateral policy reference | S | P2 data |
| [pageldev/libOpenDRIVE](https://github.com/pageldev/libOpenDRIVE) | Apache-2.0 | A | C++ OpenDRIVE parser/router | OpenDRIVE lane/section/junction data shapes if Mayor ever exports xodr | M | P3 |
| [DLR-TS/xodr](https://github.com/DLR-TS/xodr) | Apache-2.0 | A | C++ OpenDRIVE object structure | Same as above, lighter-weight alternative | S | P3 |
| [esmini/esmini](https://github.com/esmini/esmini) | MPL-2.0 | I | Minimal OpenSCENARIO/OpenDRIVE player | Controller/OSC layering ideas only (file-copyleft, avoid code) | – | P3 ref |
| [movsim/traffic-simulation-de](https://github.com/movsim/traffic-simulation-de) | GPL-3.0 | I | JS Treiber/Klenke micro-sim (web demo) | IDM+MOBIL in-browser proof + parameter ranges; no copy | S | P2 ref |
| [klemola/liikennematto](https://github.com/klemola/liikennematto) | BSD-3-Clause | A | Elm roads-first traffic-mat toy | Roads-only gameplay loop; smooth turning + signals + lot parking + rerouting in tiny codebase; lot-anchoring concept | S | P2 ideas |
| [OpenTTD/OpenTTD](https://github.com/OpenTTD/OpenTTD) | GPL-2.0 (COPYING.md) | I | Transport sim | Signal-block/path-signal *concepts* for rail later; PBS idea only | – | P3 ref |
| [CytopiaTeam/Cytopia](https://github.com/CytopiaTeam/Cytopia) | GPL-3.0 | I | C++ city builder | LOD/terrain interplay notes only; weak road model | – | – |
| [Quboid/CS-MoveIt](https://github.com/Quboid/CS-MoveIt) | MIT | A | CS1 move/align tool | Node-drag + align/slope tooling UX for a future road editor; low junction value | M | P3 |
| [boformer/NetworkSkins](https://github.com/boformer/NetworkSkins) | MIT | A | CS1 per-segment road skins | Per-segment skin override list (pillars/lights/trees) → Mayor propOffsets/skin variants | S | P2 |
| [MacSergey/NodeController30](https://github.com/MacSergey/NodeController30) | **none** | I | CS1 node editor (corner radius, crosswalk, slope) | Per-corner radius + crossing toggle UX ideas only | S | P2 ideas |
| [MacSergey/NetworkMultitool](https://github.com/MacSergey/NetworkMultitool) | **none** | I | CS1 network multi-edit | Batch-edit UX ideas only | – | – |
| [guotata1996/roadbuilder](https://github.com/guotata1996/roadbuilder) (Unity) | **none** (404 on license API) | I | Unity simcity road foundation (same author as lanemaker) | Study lanemaker (Apache) instead; this one ideas-only | – | – |
| [3DStreet/3dstreet](https://github.com/3DStreet/3dstreet) | AGPL-3.0 (LICENSE file) | I | Web 3D street visualizer | Street-section viz ideas only | – | – |
| [streetmix/streetmix](https://github.com/streetmix/streetmix) | AGPL-3.0 (was BSD-3 pre-2022) | I | Street cross-section editor | Segment-catalog UX ideas only (do not touch code) | – | – |
| [AngusJohnson/Clipper2](https://github.com/AngusJohnson/Clipper2) + [countertype/clipper2-ts](https://github.com/countertype/clipper2-ts) | Boost-1.0 | A | Polygon boolean/offset lib + TS port | Ring union/difference/offset for junction.ts if analytic rings prove brittle | S | P1 tool |
| [velipso/polybooljs](https://github.com/velipso/polybooljs) | MIT | A | Small JS polygon booleans | Lighter alternative to Clipper for junction rings | S | P1 tool |
| [mapbox/earcut](https://github.com/mapbox/earcut) | ISC | A | JS polygon triangulation | Already inside three.js; use for junction polygon → mesh | S | P0 tool |
| [iShape-Rust/iOverlay](https://github.com/iShape-Rust/iOverlay) | Apache-2.0 | A | Fast Rust polygon booleans | Algorithm reference (and option if a Rust/WASM core ever lands) | – | P3 ref |
| [georust/geo](https://github.com/georust/geo) | MIT/Apache-2.0 dual | A | Rust geospatial ops | Offset/buffer/boolean algorithm reference | – | P3 ref |
| [paperjs/paper.js](https://github.com/paperjs/paper.js) | MIT (LICENSE.txt) | A | JS vector geometry | Boolean path ops fallback in pure JS | S | P1 tool |
| [MacSergey/AdaptiveNetworks](https://github.com/MacSergey/AdaptiveNetworks) | MIT | A | CS1 adaptive-network helper lib | Minor: network-adaptation helpers | – | – |
| [fullike/RoadBuilder](https://github.com/fullike/RoadBuilder) | MIT | A | Unreal road design tool | UE-specific; low value for Mayor | – | – |

## Detailed findings (numbers + file pointers)

### A. The three assigned projects

**A1. CSUR (GPL-3.0 → ideas/numbers only).** `core/csur.py`:
- `LANEWIDTH = 3.75 m`; unit widths: LANE 3.75, MEDIAN 1.875, BIKE 2.75, CURB 0.5,
  SIDEWALK 3.75, BARRIER 0.9375, CHANNEL/SHOULDER/WEAVE 1.875, PARKING 2.75, HALFSHOULDER 0.9375 m.
- Cross-section = ordered unit list; a road piece = (start units, end units, x-offsets).
  Module inference (`core/assets.py`): same lanes+offset → base; same count, shifted → **shift**;
  1-block count change → **transition** (EMPTY taper units pad the difference); multi-block
  change → **ramp** (median→CHANNEL gore conversion in `get_ramp`/`get_access`, max 2-lane ramps).
- Roadside templates per mode (`CSURFactory.roadside`): `g` = median/bike/curb/sidewalk,
  `gc` compact, `gp` parking, `ex` expressway (3×halfshoulder+barrier), `e/b/s/t` elevated/bridge/slope/tunnel.
- Standard piece length 64 m; `csur.ini` mesh margins (lane_border 0.15, deck_margin 0.175…).
- Human-readable reversible names (`CSUR 4D2R=…`) — good debug-string idea for Mayor profiles.
- Takeaway: Mayor's `RoadProfile` should become a unit list, and `transition` nodes are just
  CSUR shift/trans pieces on a 1–2 tile scale.

**A2. TMPE (MIT → adaptable with attribution).**
- `TMPE.API/Traffic/Enums/`: `JunctionRestrictionFlags` = AllowUTurn, AllowNearTurnOnRed,
  AllowFarTurnOnRed, AllowForwardLaneChange, AllowEnterWhenBlocked, AllowPedestrianCrossing;
  `PriorityType` = None/Main/Stop/Yield; `LaneArrows` = Forward/Left/Right flags;
  `LaneEndTransitionType` = Invalid/Default/LaneConnection/Relaxed;
  `TrafficLightSimulationType` = None/Manual/Timed.
- Lane connector = per-node source-lane→target-lane sets (`LaneConnectionManager` + subgroup
  per Road/Track), consumed by `RoutingManager` pathfinding; arrows gate default connectivity.
- Timed lights (`TrafficLight/Impl/TimedTrafficLights*.cs`): program = ordered steps, each with
  **minTime/maxTime + flow/wait adaptation** (`StepChangeMetric`: Default/FirstFlow/FirstWait/
  NoFlow/NoWait; `FlowWaitCalcMode` Mean/Total; default `FlowToWaitRatio = 0.8`);
  yellow = end-transition, red+yellow = start-transition; node groups share programs.
- Takeaway: copy the *vocabulary* (restriction flags, priority enum, sim types) nearly verbatim
  into `roads.ts`/`traffic.ts`; timed steps are the Phase-2 signal model.

**A3. Cities2-TLE (no license → ideas only).** `GUIDE.md` + `Components/CustomTrafficLights.cs`:
- Per-junction `Patterns` enum: Vanilla / SplitPhasing / ProtectedCentreTurn / CustomPhase, plus
  flag bits ExclusivePedestrian / AlwaysGreenKerbsideTurn / CentreTurnGiveWay; ped duration multiplier.
- Only resequences; durations stay actuated ("smart extends green while flowing").
- Takeaway: ship 3–4 *named presets* per node before any custom programmer (matches RA's TL1/TL2 too).

### B. Rust geometry + traffic (abstreet family, Apache-2.0 → adaptable)

**B1. A/B Street `map_model` turns** (excerpt `abst_turns.rs`, upstream `map_model/src/make/turns.rs`):
- Generate every (incoming lane × outgoing lane) pair, then filter: road restrictions →
  lane restrictions → `remove_merging_turns` (L/R only) → connectivity verify w/ fallback.
- U-turns only at dead-ends (except divided-highway merge override).
- 1:1 lateral-order matching (leftmost→leftmost by lane offset); 1:many allowed; many:1 keeps
  curb lane only. Straight = lane headings within **5°**.
- Geometry `curvey_turn`: quadratic Bézier through the **infinite-line intersection** of the two
  lane-end headings when it falls inside the intersection polygon; else cubic with control arms
  **dist/2** along headings; 5 samples. Degenerate/zero-length safe w/ straight fallback.
- Takeaway: this is the `connectors` algorithm for `junction.ts`, including the exact fallback ladder.

**B2. A/B Street signals** (excerpt `abst_ts.rs`, upstream `map_model/src/traffic_signals/`):
- `ControlTrafficSignal { stages, offset }`; `Stage { protected_movements, yield_movements, type }`;
  `TurnPriority::{Protected,Yield}`; movement-level (from-lane,to-lane) granularity incl. crosswalks.
- Generators best-first: two-stage (NS/SS pairs, yield lefts, right-on-red) → three-stage (T:
  main straights protected, stem yields, ped protected) → four-stage (protected lefts) →
  half-signal (2 roads: **60 s vehicles / 10 s peds**) → degenerate → lagging-green →
  stage-per-road (split phasing) → greedy → all-walk-then-yield. All validated; min crosswalk
  time enforced per stage; LHT/RHT handled by swapping L/R; `turn_on_red` map flag gates yields.
- `synchronize()`: flips stage order of adjacent 2-stage signals whose protected flows feed each other.
- Takeaway: port the generator ladder + Stage model; Mayor needs only 2/3/4-stage + ped + split.

**B3. osm2streets geometry** (`osm2streets/src/geometry/*.rs`, `intersection.rs`):
- Case split mirrors Mayor 07: `degenerate` / `terminus` / `on_off_ramp` / `pretrimmed` / `general_case`.
- `general_case::trim_to_corners` (3+ roads): sort arms → adjacent edge pairs → edge-polyline
  collision nearest the node → perpendicular projection back to the *original* centerline →
  keep the longest surviving centerline (minimal trim); loop-road guard via endpoint comparison;
  then `polygon_from_corners`. Works on curves, not just straight arms.
- `IntersectionKind`: MapEdge/Terminus/Connection/Fork/Intersection; `IntersectionControl`:
  Uncontrolled/Signed/Signalled/Construction; `TrafficConflict`: Uncontested/Diverge/Merge/Cross;
  `Movement = (RoadID, RoadID)`; `Crossing { kind: Unmarked/Marked/Signalized, has_island }`.
- Markings (`render/`): sidewalk corners, zebra/unmarked crossings, stop lines, 3 parking-line
  styles (parallel/diagonal/perpendicular), path outlines.
- Takeaway: adopt the Kind/Control/Conflict/Movement vocabulary; `trim_to_corners` is the
  general-case trim behind 07's fillet recipe; markings list = Phase-2 scope.

**B4. osm2lanes widths** (`osm2lanes/src/lib.rs`, Apache-2.0, sources cited in comments):
driving 3.0 typical / 2.0 alley / 2.44 (8 ft) narrow / 3.66 (12 ft) highway; bike 1.5–2.0
(UK LTN 1/20); bus 3.05–3.66 (NACTO); parking 2.13–3.0 (7 ft–full lane); sidewalk 1.5–1.83;
shoulder 0.5; curb buffer 0.1; verge/footway 2.0; shared-use 3.0 m.

### C. TypeScript (streets-gl, MIT → adaptable)

**C1. `streets-gl/src/lib/road-graph/IntersectionPolygonBuilder.ts`** (195 lines, whole file read):
sort arms by angle → for each adjacent pair intersect left edge-line of arm *i* with right
edge-line of arm *i+1* (edges extended +width/−16 m to force hits) → project each hit across
the road width → alpha-sort along each edge → polygon = first hits per side + trim points;
`trimTo` per arm. Sharp corners (no fillets), min 3 arms, no dead-end/curve handling.
Takeaway: port this *structure* into `junction.ts` general junction case, then replace corner
points with 07 fillet arcs and add terminus/curve cases (osm2streets `terminus.rs` + trim logic).

**C2. `streets-gl` graph + mesh**: `Road` (width + linked vertices, closed-loop aware),
`Intersection` (center + directions + polygon + per-arm `trimmedEnd`), `RoadBuilder.build`
(ribbon mesh with `uvFollowRoad`, per-side builds, closed-loop pop). No junction tests exist
(jest covers render-graph only) — Mayor's invariant suite (`checkJunction`) has no TS precedent
to copy; keep the 07 list.

### D. Mods with directly reusable models (all MIT → adaptable)

**D1. NodeMarkup / IMT** (`IMT/MarkingItems/`): item tree Marking → Lines (Regular/Stop/Crosswalk/Lane
line-types, rule = guide-point pairs), Fillers (contour+vertices), Crosswalks, Points; `Enter`
anchors (NodeEnter/SegmentEnter) bind markings to arm mouths. Style catalog: lines Solid/Dashed/
DoubleSolid/DoubleDashed/SolidAndDashed/**SharkTeeth**/DoubleDashedAsym/ZigZag/Pavement (+Prop/Tree/
Text/Decal/Network render modes); same family for stop lines; fillers Stripe/Grid/**Chevron**/Solid
(+Asphalt/Pavement/Grass/Gravel surface fillers); crosswalks Zebra/DoubleZebra/ParallelSolid/
ParallelDashed/Ladder/Solid/ChessBoard/Decal/Existent. Templates: named Style templates +
whole-Intersection templates. Takeaway: Mayor `markings` = subset (solid/dashed/double/shark-teeth,
stop-line, zebra/ladder, chevron filler) with Enter-style mouth anchoring; templates later.

**D2. RoadBuilder-CSII** (`RoadBuilder/Domain/`): runtime road = `RoadConfig` (ordered lane-group
list) of `LaneConfig/TrackConfig/PathConfig/FenceConfig`; groups: Car/Bike/Bus/Parking/Median/
Shoulder/Sidewalk/Pole/Tram/Train/Subway/Empty; `LaneSectionType` Vehicles/Tracks/Medians/Edges/
Misc; `LaneOptionType` incl. LaneWidth/TwoWay; per-segment override vs Edit-All-Instances;
customs embedded in save + auto thumbnails. Takeaway: CSUR's unit list expressed as game UX —
this is the shape of a future Mayor road editor + save format.

**D3. RoadArchitect** (`GSDRoadIntersection.cs`, MIT): 3-way/4-way × control (all-way-stop / TL1 /
TL2 / none); turn-lane widening (NoTurnLane/TurnLane/BothTurnLanes); Timed vs Sensor lights;
fixed sequence with **separate left-turn phase: green 10 s / left 5 s / yellow 2 s / all-red 1 s**.
Takeaway: default timings + turn-lane widening idea (pocket lanes before the stop line).

**D4. MoveIt (Quboid/CS-MoveIt, MIT)** and **NetworkSkins (boformer, MIT)**: node-drag/align/slope
tooling UX; per-segment skin-override lists → Mayor prop/skin variants per segment. Low junction
value, noted for the editor phase.

### E. Simulators (numbers + architecture)

**E1. SUMO (EPL-2.0 → numbers/ideas only).** `NBFrame.cpp` defaults: junction turning radius **4 m**;
junction join distance **10 m**; keep-clear default true; sidewalk 2.0 / bike 1.0 / crossing 4.0 m;
crossing/walking speed 2.78 m/s (10 km/h); default edge speed 13.89 m/s (50 km/h); junction types
traffic_light/priority/right_before_left/left_before_right/traffic_light_right_on_red/priority_stop/
allway_stop/…; TLS: static default, actuated available, min phase 5 s, NEMA yellow 3 s, all-red 0,
yellow-min-decel 3.0 m/s².

**E2. lanemaker (Apache-2.0 → adaptable).** `xodr/constants.h`: trim 2–6 m, max curvature 1/4
(min radius 4 m), snap 3 m @100 m view, ε 1 cm, elevation step 2 m, bridge clearance 5 m.
`traffic/vehicle.cpp` Gipps: τ 1.5 s, a 3, b −8 m/s², static gap 4 m. `traffic/signal.*`:
phase→lanes map, cyclic round-robin. Junctions = OpenDRIVE connecting roads between in/out
road-endpoints. Takeaway: trim/clearance numbers + the s/t lane-following formulation for vehicles.

**E3. Citybound (AGPL-3.0 → ideas only).** `transport_planning/`: `IntersectionPrototype`
(area + incoming/outgoing connectors per arm-side + `connecting_lanes[(inArm,outArm)]`);
role = straight (<**30°**) / inner_turn / outer_turn / U-turn (same-spot + opposed heading);
`LanePrototype(LinePath, timings)` + `morphable_from` (≈0.05/0.1 tolerance) to skip rebuilds;
`descartes::ArcLinePath` geometry; IDM car-following (`microtraffic/`, textbook params).
Takeaway: connector-key shape + role taxonomy + morph-based incremental rebuild.

**E4. HighwayEnv (MIT → adaptable).** `highway_env/vehicle/behavior.py` IDM:
a_max 6.0, comfort +3.0/−5.0 m/s², jam gap 5 m + length, T 1.5 s, δ 4.0; MOBIL lateral policy
same file. Takeaway: calibrated micro-sim numbers when Mayor outgrows tile-flow.

**E5. CARLA (MIT) / CityFlow (Apache-2.0) / libOpenDRIVE (Apache-2.0, C++) / DLR xodr (Apache-2.0, C++).**
CARLA `road/` (MapBuilder/MeshFactory/Junction/LaneSection/Signal) = the reference OpenDRIVE→mesh
pipeline; CityFlow `engine/roadnet/vehicle` = large-scale signal sim split; the two xodr libs cover
future import/export. All Phase-3+; no code pulled.

**E6. liikennematto (BSD-3, Elm).** Roads-first toy: smooth turning, signals, lot parking,
rerouting, tiny codebase. Concept reference for lot-anchoring + playful scope control.

### F. No-go / dead ends (verified)

- No maintained **three.js road/junction library** exists (`road threejs` search = Crossy Road
  clones). streets-gl (raw WebGL2) is the closest TS geometry reference.
- No mature **TS city builder with junctions** (`citybuilder language:TypeScript` = unstarred stubs).
- No maintained **xodr/OpenDRIVE JS/TS parser** found; osm2streets-js is Rust→wasm bindings,
  not hand-written TS.
- `movsim` JS, OpenTTD, Cytopia, 3dstreet, streetmix, citybound: copyleft — concepts only.
- TLE, NodeController30, NetworkMultitool, guotata1996/roadbuilder, micropolis mirror:
  **no license detected → all-rights-reserved, ideas only.**

## Concrete proposals mapped to Mayor modules

All meters assume tile = 8 m. Yield signs: Mayor drives on the **right** (verify before mirroring
any LHT-default geometry; abstreet/TLE both parameterize driving side — do the same).

### P0-1 `src/sim/junction.ts` (new): classification + polygon + trims

1. Adopt `IntersectionKind`-style classify: `end | middle | bend | transition | fork | junction`
   (≈ 07 kinds + osm2streets Fork for ramps; MapEdge only if maps need it).
2. General-case polygon: port streets-gl `IntersectionPolygonBuilder` (MIT) structure, then apply
   07 fillets at each corner point (R = max of arms) instead of sharp corners; terminus case from
   osm2streets `terminus.rs` idea (flat/bulb cap, kerb+sidewalk U-wrap).
3. Trim rule: minimal trim = longest surviving centerline (osm2streets); clamp trims to
   **0.25–0.75 tile (2–6 m, lanemaker)**; merge nodes closer than **~1.2 tile (≈10 m, SUMO)**.
4. Keep 07 ring nesting + 1e-3 quantisation; if analytic rings get brittle, pull in
   `clipper2-ts` (Boost) for union/offset and keep three's built-in earcut for triangulation.
   Effort: M. Priority: first.

### P0-2 `connectors` (junction.ts output → traffic.ts replaces `roundCorners`)

Port abstreet Turn pipeline (Apache-2.0, adapt with attribution):
1. Data: `Turn { id: (nodeId, inArm, inLane, outArm, outLane), type: Straight|Right|Left|UTurn,
   geom: Pt[] }`, keyed `(inArm,outArm)` like Citybound/abstreet Movement.
2. Generate all (in-lane × out-lane) pairs; classify by heading delta (straight < 5°,
   or < 30° Citybound-style if 5° proves twitchy — test both); U-turns at dead-ends only.
3. Prune with `remove_merging_turns` (L/R): 1:1 lateral match, 1:many open, many:1 curb-lane-only;
   then `verify_vehicle_connectivity` (every in/out driving lane keeps ≥1 same-type turn), fallback
   to unfiltered set with a diagnostic.
4. Geometry `curvey_turn`: quadratic Bézier through the lane-heading miter point if inside the
   asphalt polygon, else cubic with control arms **dist/2** (≃ 07's Hermite 0.55×chord — unify on
   **0.5×chord**); 5–8 samples; dedup; curvature ≤ 2/laneWidth check stays.
5. Per-lane maneuvers: add TMPE-style `LaneArrows` (MIT) once connectors exist (default: all legal).
   Effort: M. Priority: with P0-1 (traffic.ts switches `routePath` to connectors).

### P0-3 signals (`roads.ts` signals + `traffic.ts` redCrawl)

Stage model (abstreet, Apache-2.0) with RA/TLE numbers:
1. `SignalMode` per node (default auto): `twoStage | tStage | protectedLeft | split | pedScramble | none`,
   each a movement-level program `{ protected: Movement[], yield: Movement[] }[]` + offset.
2. Defaults (adapt, attribute): green **8–10 s**, left-turn phase **5 s**, **yellow 2 s**,
   **all-red 1 s**, ped-exclusive **10 s**; replace red-crawl-only with full stop at stop line
   during red (keep crawl 0.3 as congestion fallback, not signal compliance).
3. Right-on-red allowed as yield movement in two-stage (config flag `turnOnRed`, default on).
4. Phase 2: TMPE timed steps (MIT: min/max + flow/wait metric, FlowToWait 0.8) + abstreet
   neighbor `synchronize()`; actuation bounds min 4–5 s / max 20 s.
   Effort: S (presets) → M (timed). Priority: presets with junctions; timed later.

### P1 lane markings (renderer + junction.ts `markings`)

NodeMarkup subset (MIT), mouth-anchored (Enter-style) at 07 trims:
lines solid/dashed/double/shark-teeth + stop-line variants; crosswalks zebra (default) + ladder;
chevron gore filler at forks; edge lines. Stop-line placement: **after** crosswalk on inbound
lanes only; guide dashes through the polygon for straight pairs. Templates later.
Effort: S–M. Priority: right after geometry (visual acceptance needs it).

### P1 road profiles (CSUR-like widths in `corridor.ts` + catalog)

Proposed width table (meters → tiles @8 m/tile), blending CSUR (I), osm2lanes (A), SUMO (I):

| Element | Street | Avenue | Highway |
|---|---|---|---|
| Driving lane | 3.0 m (0.375) | 3.25 m (0.406) | 3.66 m (0.4575) |
| Lanes | 2 | 4 | 6 (3+3 + median) — fixes today's 5.6 m lanes |
| Median | none (double line) | 1.9 m (0.234) | 1.9 m + barrier |
| Shoulder | — | — | 1.9 m outer (0.234) |
| Kerb | 0.5 m (0.0625) | 0.5 m | — |
| Sidewalk | 1.5 m (0.1875) | 1.5 m | — |
| Parking lane (opt) | 2.5 m (0.3125) | 2.5 m | — |
| Bike lane (opt) | 2.0 m (0.25) | 2.0 m | — |
| Kerb return R | 3.6 m (0.45, keep 07) | 4.8 m (0.60, keep 07) | 9.6 m taper (1.20, keep 07) |
| No-turn corner R | 2.0 m (0.25, keep 07) | 2.8 m (0.35, keep 07) | — |
| Crosswalk / gap / stop thickness | 2.4 / 0.64 / 0.32 m (keep 07) | 2.8 / 0.64 / 0.40 m | none |
| Dead-end bulb R / neck | 7.2 / 2.4 m (0.90/0.30, keep 07) | 9.6 / 3.2 m | — |

Profile = ordered unit list (CSUR idea, RoadBuilder-CSII MIT shape); transition/shift pieces for
`transition` nodes; per-segment skin overrides (NetworkSkins MIT) for props.
Effort: M. Priority: after junctions render (changes draw widths → re-tune raster).

### P2 traffic behavior (later)

- Priority: TMPE `PriorityType` Main/Stop/Yield per arm (MIT) + restriction flags
  (no-U-turn, no-enter-blocked, no-lane-change-straight first); all-way-stop + right-before-left
  presets (SUMO catalog idea).
- Car-following: IDM-Lite with HighwayEnv numbers (MIT) when leaving tile-flow; Gipps
  (lanemaker) as alternative; keep 1.5 s headway / 4–5 m jam gap family.
- Parking: roadside bays from profile + TMPE AdvancedParking concepts; lot-anchored stalls
  from `lotAnchors`.
- Keep-clear junctions by default (SUMO) once vehicles queue.

## Recommended order

1. **P0-1 junction.ts** (classify + polygon + trims + rings) with `checkJunction` invariants.
2. **P0-2 connectors** (abstreet pipeline) + traffic.ts routePath switch; add LaneArrows default-all.
3. **P0-3 signal presets** (twoStage/tStage/protectedLeft/split/ped) + RA timings + stop lines.
4. **P1 markings** (NodeMarkup subset) + **P1 profiles** (width table + unit lists + transitions).
5. **P2** priority signs/restrictions → timed/actuated signals + sync → IDM-Lite → parking.
6. **P3** OpenDRIVE export (libOpenDRIVE/xodr shapes), editor tooling (MoveIt/NetworkSkins ideas).

## License handling for the lead

- Safe to adapt **with attribution headers**: TMPE, NodeMarkup, RoadBuilder-CSII, abstreet,
  osm2streets(+osm2lanes), streets-gl, lanemaker, RoadArchitect, CARLA, CityFlow, HighwayEnv,
  libOpenDRIVE, DLR xodr, liikennematto, Clipper2/clipper2-ts, polybooljs, earcut, iOverlay,
  georust/geo, paper.js, MoveIt, NetworkSkins, AdaptiveNetworks (all MIT/Apache-2.0/BSD/ISC/Boost).
- **Ideas/numbers only** (do not copy code): CSUR (GPL-3.0), citybound (AGPL-3.0), OpenTTD
  (GPL-2.0), movsim JS (GPL-3.0), Cytopia (GPL-3.0), 3dstreet (AGPL-3.0), streetmix (AGPL-3.0),
  SUMO (EPL-2.0), esmini (MPL-2.0), TLE / NodeController30 / NetworkMultitool /
  guotata1996/roadbuilder / micropolis-mirror (**no license found**).
- Excerpt files in `/tmp/gh-refs/` (`abst_ts.rs`, `abst_turns.rs`, `sumo_NBFrame.cpp`) are
  upstream copies left by parallel research; verified against the descriptions above
  (Apache-2.0 / EPL-2.0 respectively) — same handling as their repos.


