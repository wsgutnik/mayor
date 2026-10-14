# Fable Cities study: what to port into Mayor's junction, lane and quality work

Read-only study, 2026-10-13. Neither repository was edited.
Source: `/tmp/gh-refs/fable-cities` = github.com/rawprogress/fable-cities @ `aea8b10` (2026-09-03), MIT,
"Copyright (c) 2026 raw (github.com/rawprogress)". JavaScript, Three.js, units are **metres**.
Files read in full: `src/modules/roads/{Junctions,RoadMesher,RoadTypes,curves,GeomBuilder}.js`,
`RoadNetwork.js` (graph, heights, pads, lanes), the marking GLSL in `RoadMaterials.js`, `traffic/LaneNetwork.js`,
the claims/IDM parts of `traffic/TrafficSim.js`, `ARCHITECTURE.md`, `PROMPT.md`, `docs/JUDGE_FEEDBACK.md`,
`docs/LOOK_TARGET.md`, `docs/requests/roads.md`, `docs/critique/roads_*.json` and `traffic_*.json`, and `tools/*.mjs`.
Mayor side: AGENTS.md rule 11, `docs/process/07-junction-builder.md` (07), `07a-junction-review.md` (07a),
`.claude/skills/mayor-visual-quality/SKILL.md`, `src/sim/{roads,corridor,traffic}.ts`, `src/render/roads.ts`,
and `src/render/road-material.ts`.

## Verdict

Fable's junction solver is a good **skeleton** for `src/sim/junction.ts`. In about 250 lines it already does four things
07 lacks:

1. It evaluates arm frames on the real curve at the trim distance. This fixes S0-4 (curved arms).
2. Its corner kinds `fillet | flat | round` are exactly the fillet, chamfer and cap constructions 07 needs.
3. It caps each trim at `0.45·L` per segment end. That separates the two ends of a segment (07a S2-1, §2.2) without a
   joint solver.
4. It builds the corner sidewalk as a mitred block corner behind the kerb arc. This is the geometry half of S0-1.

Its markings are procedural on the segment ribbon, keyed by the distance to the trim plus per-end flag bits. That
architecture fixes floating crosswalks, the full-width stop line and marking z-fighting (S1-3, S2-5) structurally. Its
lane graph and Bézier connectors are a drop-in model for S1-4 and 07a §2.7.

Fable does **not** solve these:

- **Width budget for the sidewalk.** Its street is 12 m = 1.5 tiles, and our street is 1 tile. This is a lead
  decision; numbers are in §3.
- **Acute corners on short segments.** When the cap binds, fable silently overlaps and only increments a `badFans`
  counter. Our segments are 8–30 m against its 50–200 m, so the cap will bind in most acute cases.
- **Elevation (S0-3).** Fable has no bridges and no tunnels.
- **The octagon fan.** Fable also triangulates its junction asphalt as a fan from the node centre. Do not port that.

Port the solver, the marking scheme, the pad heights and the lane graph as TypeScript. Do not port the triangulation or
the overlap tolerance.

---

## 0. Units and coordinate mapping (applies to every ported constant)

| Item | Fable | Mayor | Conversion |
|---|---|---|---|
| Length | metres | tiles (1 tile = 8 m, 07:31) | divide every **length** by 8 |
| Plane | XZ, +Y up | XZ, +Y up (tile x maps to x, tile row to z) | identical |
| Right of travel `(dx,dz)` | `r = (-dz, dx)` (`Junctions.js` endFrame) | `n = (-dz, dx)` (`roads.ts` gapSide) | identical, no flip |
| Arm ordering | `atan2(dz, dx)` ascending | `atan2(dz, dx)` ascending (`nodeArms`) | identical |
| Heading | `headingOf = atan2(dx, -dz)`, north = −Z, clockwise | not used | port only as a private helper for turn classification |
| Traffic side | right-hand (`lat > 0` = right of a→b) | right-hand (renderer `lane` offset, scene.ts:1202) | identical |
| Curves | THREE curves, arc-length parametrised (`prepareBase`, 1.5 divisions/m) | quadratic Bézier `pts` + `curvePoints(pts, 0.5)` polyline | need **one** shared arc-length walker (see P2) |

**Absolute tolerances that must be converted explicitly.** They are easy to miss because they look unit-free.

| Fable | Meaning | In tiles |
|---|---|---|
| `0.02` | degenerate corner | 0.0025, then use 1e-3 to match 07 snaps |
| `0.3` | straight run before the fillet tangent | 0.0375 |
| `1.2` | min fillet R | 0.15; **07 floor is 0.2**, keep 0.2 |
| `0.45` | arc chord step | 0.056 |
| `0.5` | round-cap step | 0.0625 |
| `max(0.5, 0.45·L)` | trim cap | `max(0.0625, 0.45·L)` |
| `2.0` | transition taper constant | 0.25 |
| `0.05` / `0.25` | sidewalk min/sliver | 0.006 / 0.031 |
| `maxW = 2.6·sw + 0.4` | mitre clamp | `2.6·sw + 0.05` |
| `14` | height-blend floor | 1.75 |
| `16` | connector handle cap | 2.0 |
| `30` | claim distance | 3.75 |
| `34` | pedestrian connector gap cap | 4.25 |
| `5.5` | crossing threshold | 0.69 |
| `0.08` | min connector length | 0.01 |

Angles (`0.15°` collinear, `40°` shrink knee, `30°/150°` turn classes) and ratios (`0.45`, `0.46`, grade `0.06`) carry
over unchanged.

---

## 1. Junction solver vs 07 and the 07a S0 blockers

### 1.1 What `Junctions.js` actually does (`computeJunction`, `solveCorner`)

1. **Ends.** One end per segment end at the node. They are sorted by the angle of the curve tangent **at the node**.
2. **Fixed point, at most 12 iterations.** Each pass re-evaluates every end's frame `endFrame(seg, end, trim)`, meaning
   the point and tangent **on the curve at arclength = trim**. It then solves each CCW-adjacent corner (i's right edge,
   j's left edge). Trims only grow. Each trim is capped at `max(0.5 m, 0.45·segLength)`. The loop stops when no trim
   grows by more than 1 mm.
3. **The corner kind depends on the wedge angle `δ`:**
   - **`fillet`** (δ < 180° and the edge lines intersect).
     - Radius: `R = max(1.2, min(R_i, R_j)·clamp(δ/40°, 0.4, 1))`. Full radius down to 40°, then linear shrink to 40 %.
     - Tangent distance: `td = R / tan(δ/2)`.
     - It requires the mouth edge point to sit at least `td + 0.3` from the apex. Otherwise it raises `needTrim` by the
       shortfall.
     - Points emitted: mouth edge point A, then tangent point T_i, then the arc (`n = max(5, ceil(R·sweep/0.45))`), then
       T_j, then B.
     - Every point carries the outward normal and a **sidewalk width `w`**. `w` is the distance along the normal from the
       kerb arc to the **mitre** of the two sidewalk outer lines (`rayPolyline`), clamped to `[0.05, 2.6·sw + 0.4]`. The
       result is a round kerb with a square block corner behind it, as in a real street.
   - **`flat`** (collinear within 0.15°, or parallel offset edges). A straight A→B connector.
     - When widths or types differ, both trims are forced to `|Δcw|·1.2 + |Δsw|·0.6 + 2 m` so the width change tapers.
   - **`round`** (reflex wedge on the outside of a bend, or a **dead end** with k = 1, sweep π).
     - An arc around the node from A to B with interpolated radius. The endpoints are snapped exactly to the mouth edge
       points.
4. **Per-end outputs.**
   - `trimA/B`, kind `dead | inter | cont`, and `cap` (whether the median and rails terminate).
   - Median gap: avenue 4.6 m at intersections, 0.8 m at dead ends.
   - Flag bits:
     - `8`: crosswalk.
     - `16`: stop line. Set when there are 3 or more vehicle arms.
     - `1/2/4`: left, straight and right turn arrows. Derived from the other arms' relative heading: |rel| ≤ 30° is
       straight, 30–150° is left or right.
     - `32`: dead end, no markings.
5. **Pad plane.** `pad = k ≥ 3 || any trim > 0` (RoadNetwork `_nodeGradient` / `_applyPads`).
   - The node gets a least-squares gradient: arms' natural slopes clamped to ±0.12, ridge regularisation λ = 0.35, and
     the pad grade clamped to 6 %.
   - Each arm's height profile is smoothstep-blended onto that plane over `max(14 m, 1.5·trim)`.
   - The corner points sit on the plane, with the mouth residuals blended in so they meet the ribbon vertices exactly.
   - The solve order is: natural heights, then trims, then gradient, then blend, then re-solve.
6. **Mesher (`buildJunctionPieces`).**
   - Asphalt ring = each mouth's **own cross-section vertices** (`mouthRows`) + the corner interior points. The ribbon end
     station is emitted at exactly `s = trim`, so the seam is watertight **by shared construction**, not by a tolerance.
   - Corner sidewalks are the edge profile (kerb 0.2 m + sidewalk + verge skirt) swept along the corner points with
     variable `w`.
   - k = 2 with lanes (`buildTransitionPad`): a loft between the two corner polylines. It is resampled at the union of
     both polylines' arclength fractions, and the union of the mouth profile breakpoints, so it stays watertight against
     the corner strips.
   - Otherwise the ring is **fan-triangulated from the node centre**, and `ringIsSimple` only bumps a debug counter.

### 1.2 Blocker-by-blocker mapping

| 07a item | Does fable solve it? | What ports | What we must add |
|---|---|---|---|
| **S0-1** sidewalk ring has no home | **Geometry yes, width budget no.** The sidewalk is inside the road width (local 12 m = 2×(3.8 asphalt + 0.2 kerb + 2.0 sidewalk)) | corner sidewalk via `w` sampled to the mitre with clamp `2.6·sw + 0.05` tiles. The kerb strip and the asphalt ring share points, so the ring is always closed | pick a width budget (§3, option A recommended). Update `corridor.ts` `sidewalk` and `corridor.test.ts:41` in the same commit |
| **S0-2** acute recipe unsatisfiable | **Partly.** Fillet shrink `R·clamp(δ/40°, 0.4, 1)` + fixed-point trims + 0.45·L cap. When the cap binds, the tangent point lies **outside** the mouth and the ring folds back over the ribbon (overlap, counted in `badFans`) | the shrink rule, the iteration, and `flat` as the chamfer construction | (a) After capping, solve `R_eff = (t_cap − 0.0375)·tan(δ/2) − h`. If `R_eff ≥ 0.2`, refillet. If not, emit `flat` (chamfer A_i→A_j) and the diagnostic `chamfered`. (b) **New: a minimum angle when drawing.** Overlap-free geometry needs `t ≥ h·cot(δ/2)` (apex distance) with `t ≤ 0.45·L`. Refuse (or snap) gaps below `δ_min = 2·atan(h / (0.45·L))`: street h = 0.38 gives L=2: **45.8°**, L=4: **23.8°**, L=8: 12°; avenue h = 0.81 gives L=4: **48.4°**. Today `planRoad` has no angle guard (grep shows none) |
| **S0-3** elevation, ramps, Y | **No.** No bridges or tunnels; `bridgeA/B` means median continuity | the pad plane solves the *hill* hard case (non-planar fan, 07a §2.8) | per-layer layouts and ramp policy, as 07a P0(iii)/P6 |
| **S0-4** arms are rays, real arms curve | **Yes.** `endFrame` evaluates point and tangent on the curve at the trim. Edge lines are tangent at the **mouth**, not at the node. The ring starts at the ribbon's own end vertices, so the seam error is 0 | `endFrame` pattern + shared mouth rows | a single arc-length walker in `src/sim/corridor.ts`, used by both the junction builder and `render/roads.ts` `ribbon` (today `sampleCurve`/`makeWalker` are private in the renderer) |
| S1-1 per-corner R | yes, per corner. **Uses `min(R_i, R_j)`** where 07 says `max` | — | lead decision. Recommend `min` below 60°, `max` at 60° and above (trims at 25°: street-avenue 3.0 vs 5.4 tiles) |
| S1-2 octagon fan / symmetrised trims | trims are per end (one value, not per side); no invented radii; **still a centre fan** | ring construction (mouth rows + corner points) | earcut via `THREE.ShapeUtils.triangulateShape` (no new dependency) in render; `checkJunction` asserts simple, CCW, no triangle < 5° or < 1e-5 |
| S1-3 crosswalk / stop-line placement | **Yes, structurally.** Zebra band at d ∈ [0.8, 3.8] m from the trim (on the ribbon, never on the seam). 0.5 m stripes on a 1 m pitch, clipped at `cwHalf − 0.15`. Stop bar d ∈ [4.8, 5.3] m, **incoming half only**, starting at `medianHalf + 0.2`. Lane lines cut at 4.2 m (5.9 m on the incoming side). Dashes go solid within 14 m. Arrows centred at 10 m | `rd_endMarks` + lane-cut logic (GLSL) | the vertex attribute `aRoad = (lat, along, dA, dB)` + end flags in `road-material.ts`; numbers scaled (§3) |
| S1-4 lane model | **Yes**: `laneOffsets`, `laneWidth`, `medianHalf`, lane graph, connectors | see §2 | lane offsets in `RoadProfile` |
| S1-5 dead ends | **round cap only.** A semicircle of radius `cwHalf` beyond the node; kerb and sidewalk swept on the same points (closed U, no stray arc); markings off (flag 32) with the wheel-wear fade over 9 m | round cap as 07's third cap (`round`, between `square` and `bulb`) | square and bulb caps; zero-length pads (07a S1-5) |
| S1-6 classification | `k=1` dead; `kv ≥ 3` inter (vehicle arms only; paths ignored); else cont; collinear tolerance 0.15° | vehicle vs path arm split | elevation, roundabout lookup, minimum-gap merge (07a) |
| S2-1 incremental caching | the 0.45·L cap means a node's layout depends only on its own arms plus their segment lengths, so the dirty set is the touched nodes (fable re-solves exactly `_touchedNodes`) | pattern | `junctionsOf` dirty set = endpoints of added, removed or reshaped segments |
| S2-2 arc sagitta | 0.45 m step = 0.056 tile: sagitta at R = 0.45 is **0.00088** (meets 1e-3). At R = 0.2 it is 0.0020 (fails) | step | `n = max(5, ceil(sweep / min(0.056/R, 2·acos(1 − 1e-3/R))))` |
| S2-5 lift / z-fighting | markings are shader paint on the asphalt, so there is no marking lift at all | scheme | removes `MARK_LIFT` and the stop-bar and crosswalk texQuads |
| S3-3 median | k = 2 same-type continuation carries the median across (`bridgeCentre`). Elsewhere the median stops `centreGap` before the trim (avenue 4.6 m = **0.575 tile**). Every free end tapers to a nose over `min(9 m, 0.42·len)` with profile `1 − (1−t)²` | nose + gap rule | — |

**07 recipe changes suggested by this study:**

- Crosswalk setback from the trim: 0.8 m = **0.10 tile** in fable. This stops a zebra from ever sharing the seam.
- Curvature of the arm is handled by mouth-frame tangents.
- The trim cap `0.45·L` ensures the remaining ribbon is at least 0.1·L.
- The minimum drawing angle `δ_min(L, h)` above.

---

## 2. Lane graph, connectors and yielding vs `src/sim/traffic.ts`

| Aspect | Fable | Mayor today | Port? |
|---|---|---|---|
| Path model | lanes = offset polylines of the trimmed segment (`_lanePoints`, every 4 m = 0.5 tile), plus Bézier connectors per allowed lane pair | tile A* (`findLayeredPath`), then moving average, then `snapToCentrelines`, then `roundCorners` ((1,2,1)² blur, up to about 0.2 tile of corner cutting, 07a §2.7) | **Yes**: connectors replace `roundCorners` |
| Connection rules (`laneGraph`) | classify the out-arm against the travel direction: S if \|rel\| ≤ 30°, U if ≥ 150°, else L/R. S connects rank-matched lanes (the last lane fans to the extra lanes). L only from rank 0 to out[0]. R only from rank n−1 to out[last]. Fallbacks: any non-U, then any. Dead end: U-turn into the back lanes. Pedestrians: any in to any out | none (tiles) | **Yes**, as `laneGraph(w)` cached by `graphRevision` |
| Connector geometry (`bezierConnector`) | cubic from the in-lane end to the out-lane start, handles `h = min(0.46·d, 16 m)`; `steps = clamp(ceil(d/1.6 m), 3, 14)`; `d < 0.08 m` gives a straight connector | — | **Yes**. Scaled: `h = min(0.46·d, 2.0)`, `steps = clamp(ceil(d/0.2), 3, 14)`. 07 says 0.55·chord; fable's 0.46 has lower peak curvature at 90°. Keep 07a's containment and curvature tests |
| Speed on curves | `makePoly`: `v ≤ sqrt(3.4 m/s² / κ)`, floor 2.6 m/s, then a backward braking pass at 1.6 m/s² | constant `ROAD_SPEED` × congestion factor | optional (P8) |
| Junction control | `node.conflict[k×k]` from **actual polyline crossings** (`polysCross`) or a shared out-lane. Unsignalised: first come first served by `key = time + yieldDelay`, with `yieldDelay = [0, 0.35, 1.5, 2.2][turn] + (4 − rank)·0.55` s (straight, right, left, U). Claims within 30 m; stale after 7 s; "don't block the box" (exit's first car `s < len + half + 2.5` and `v < 1.6` means wait) | `redCrawl`: binary 0.3 crawl factor against the signal phase; no yielding at unsignalised nodes; no conflicts | **Later** (P8). Needs per-vehicle position on a connector, which we have (`progress`) |
| Signals | signalised if `maxRank ≥ 3` and ≥ 3 approaches. Phases pair **opposite approaches** (`dot < −0.55`). `green = 7.5 + 1.1·n` s, amber 2.6 s, all-red 1.1 s. Deterministic FNV desync per node id | fixed 8 s toggle, NS/EW by `|dx| ≤ |dz|` (breaks on diagonal grids). Signalised if 4+ arms, or 3 with an avenue | **Yes, cheap**: opposite-pair phases + desync in `signalNodes` and `signalPhase` |
| Routing cost | A* over elements, `len/speed + (connector ? 1.2 + 0.9·turn : 0)` | tile A* with `crossCost` load | keep ours. Add the turn penalty when connectors exist |

How to fit this into Mayor without rewriting traffic:

1. Keep tile A* and the congestion model.
2. After `snapToCentrelines`, replace each junction-node crossing in the route with the connector polyline from
   `junction.ts` / `lanes.ts`. Look it up by (node, inSeg, outSeg) and pick the lane by rank.
3. Delete `roundCorners`.
4. Then tighten `traffic-corners.test.ts` from "< 2 % of samples off road tiles" to "100 % of samples inside
   asphalt ∪ ribbons" (07a P7d).

---

## 3. Road cross-section data

All numbers in tiles (fable metres ÷ 8).

| | Fable local | Fable avenue | Fable highway | Mayor now street / avenue / highway | 07 street / avenue / highway |
|---|---|---|---|---|---|
| total width | 1.50 | 3.00 | 4.00 | draw 0.90 / 1.80 / 2.80; raster 1 / 2 / 3 | — |
| asphalt half `cwHalf` | 0.475 | 1.125 | 1.925 (incl. 0.36 shoulder) | 0.38 / 0.81 / 1.40 | 0.38 / 0.81 / 1.40 |
| median half | 0 | 0.1875 | 0.20 | 0 / 0.16 (render hardcode) / ? | — |
| kerb | 0.025 (17 cm high, 3-tone AO) | 0.025 | 0 (verge 0.0875) | 0.07 / 0.09 / 0 | 0.07 / 0.09 / 0 |
| sidewalk | 0.25 | 0.35 | 0 | **0** (corridor.ts:67) | 0.12 / 0.16 / 0 |
| lane width | 0.475 | 0.469 | 0.4375 | — | — |
| lane centres | ±0.2375 | ±0.42, ±0.89 | ±0.47, ±0.91, ±1.34 | — | — |
| corner radius R | 0.375 | 0.75 | 1.00 | 0.25 / 0.4 / 0.4 (`cornerRadius`) | 0.45 / 0.60 / 1.20 |
| min R | 0.15 | 0.15 | 0.15 | — | 0.2 |
| crosswalk band from trim | [0.10, 0.475] | same | none | trim + 0.1 ± 0.16 (overlaps the patch) | [0, 0.30] |
| stop bar from trim | [0.60, 0.66], incoming half | same | none | full width | gap 0.08, thickness 0.04 |
| arrows | centred 1.25, about 0.33 long | same | none | — | — |
| median gap at a junction | — | 0.575 | 0.75 | — | "ends at the crosswalk" |
| lamp pole | cwHalf + 0.106, spacing 4 tiles | same | median mast, spacing 5.75 | `drawHalf + 0.2` | — |

**Option A for the S0-1 lead decision (recommended).** Fit the sidewalk *inside* the existing raster width, keeping
fable's proportions scaled to our tile. With this option:

- `ROAD_TILE_WIDTH`, the setback line, the zoning and lot fronts at 0.50 / 1.00 / 1.50, and `zoneblocks.ts` all keep
  their numbers.
- Only `asphaltHalf` narrows.

| type | asphaltHalf | median half | kerb | sidewalk | drawHalf = tile/2 | lanes (centre) | R | min R |
|---|---|---|---|---|---|---|---|---|
| street | **0.32** | 0 | 0.025 | 0.155 | 0.50 | 1 per direction (±0.16) | 0.375 (fable) or 0.45 (07) | 0.2 |
| avenue | **0.75** | 0.125 | 0.025 | 0.225 | 1.00 | 2 per direction (±0.28, ±0.59) | 0.75 or 0.60 | 0.2 |
| highway | 1.40 | 0.10 | 0 | 0 (verge 0.10) | 1.50 | 2 per direction (±0.43, ±1.08) | 1.0 / taper | — |

Cost of option A:

- The street carriageway narrows 0.76 → 0.64 tile (5.1 m: two 2.55 m lanes, still plausible).
- `ROAD_DRAW_WIDTH` becomes 1.0 / 2.0 / 3.0.
- Props offsets move to `drawHalf − sidewalk/2`, so they sit on the sidewalk.
- `corridor.test.ts:41` changes in the same commit.

The other option, the sidewalk *outside* the raster as 07a P0 discusses, moves `lat0` and pushes zoning into ADR 06
step 4 (07a C2). Option A sidesteps that.

**Acute trims under fable's shrink rule.** `t = (h+R)·cot(δ/2) + 0.0375`, R floor 0.15. Format: δ: R / t.

| profile | 90° | 60° | 45° | 25° | 15° |
|---|---|---|---|---|---|
| street (07 numbers) | 0.45 / 0.87 | 0.45 / 1.48 | 0.45 / 2.04 | 0.28 / 3.02 | 0.18 / 4.29 |
| street (option A) | 0.38 / 0.73 | 0.38 / 1.24 | 0.38 / 1.72 | 0.23 / 2.54 | 0.15 / 3.61 |
| avenue (07 numbers) | 0.60 / 1.45 | 0.60 / 2.48 | 0.60 / 3.44 | 0.38 / 5.38 | 0.24 / 8.01 |

With the cap `0.45·L` and L = 2 tiles (t_max 0.9), every street corner sharper than about 88° (07 numbers) or 78° (option A) binds; at L = 4 the thresholds are about 50° and 43°. This is why the
`R_eff`/chamfer fallback and the drawing-angle guard in §1.2 are mandatory for Mayor, not optional.

---

## 4. Their critique / judge loop: gates worth adopting

What they run (`PROMPT.md`, `tools/*.mjs`, `docs/critique/*.json`):

1. **Verification tooling before features.**
   - `tools/check.mjs` exits 1 on any console error or failed module.
   - `tools/shot.mjs` loads the app, waits for `ready`, sets a camera preset and an hour, and writes a PNG plus a JSON log
     (errors, fps, draw calls, triangles).
   - Every module has `?showcase=<name>` staging "honest, representative, no cherry-picked angles" scenes with named
     presets (`roads_detail`, `roads_deadend`, `roads_transition`, `roads_night`, ...). The default is a **low sun at
     16.2 h** (shadows about 1.9× object height), never noon.
2. **A separate critic agent that writes no code.**
   - Its own screenshots at several hours and zooms.
   - An anchored 0–10 scale: 10 = indistinguishable, 8.5 = AAA with nits, 7 = good indie, 5 = programmer art.
   - **Pass = ≥ 8.5 and zero console errors.** At most 4 rounds per builder.
3. **A fixed critique JSON schema.**
   `{score, pass, summary, perf{fps, drawCalls, triangles, consoleErrors}, screenshots[], strengths[], issues[{severity: blocker|major|minor, description, evidence, suggestion}]}`.
   The evidence must cite **screenshot pixel boxes and `file:line`**. Suggestions carry numbers.
4. **The critic re-verifies builder claims.** Example quotes: "contrary to the report", "builder's AFTER numbers
   reproduce exactly", "claim verified".
5. **Measured image metrics, not adjectives.**
   - Tonal-seam detection: luminance std of the junction fan vs the abutting segment, 0.0164 vs 0.0668, "4x flatter".
   - `lookmeasure.py` compares luminance and chroma percentiles against reference frames.
   - `matstats.mjs` reports the material roughness distribution.
6. **Runtime invariant counters**, for example `network.badFans` for non-simple junction rings.
7. **Persisted state** in `docs/STATUS.json` plus unedited critique history.
8. **Blind A/B final gate.** Ours vs reference frames, labels shuffled. They lost every round 0–4, but the gap narrowed
   from 3.4 to 2.5.

Adopt for Mayor, mapped to rule 11 and the skill:

- **G1 · Junction showcase.** `?showcase=junctions` (or `window.__city.showcase('junctions')`) stages the 12 skill hard
  cases at fixed coordinates: 4-way, T, Y 25°, 5-arm, dead end square, round and bulb, bend, avenue + street, one-way,
  curve, hill, bridge ramp, roundabout. Each case gets presets `<case>_game` (game zoom) and `<case>_close`, at hours
  16.2 and 21.0. This removes "which angle?" from every report.
- **G2 · Shot script.** One script writes `shots/junctions/<case>_<zoom>_<hour>.png` + `.json` (console errors,
  `checkJunction` diagnostics counts, draw calls, triangles). The lead currently does visual passes by hand (AGENTS.md
  "Muse and Codex do not run browser tests"). A headless script lets agents attach real images. It needs puppeteer or
  playwright as a dev dependency (none today), which is a lead decision. The fallback is the Claude Browser pane driven
  through `window.__city`.
- **G3 · Invariants are failures, not counters.** Fable's `badFans` is a soft counter. Ours: `checkJunction` failures
  fail vitest, and a debug overlay shows a live count in `window.__city.junctionDiagnostics`. The run must show **0**
  non-simple rings, 0 slivers, 0 overlaps.
- **G4 · Critic agent with an anchored rubric.**
  - Codex `-s read-only` or Muse.
  - Writes `docs/critique/junctions_rN.json` in the schema above.
  - Pass ≥ 8.5, 0 blockers, 0 console errors.
  - ≤ 4 rounds before escalating to the lead.
  - Must re-verify the builder's numbers. Rule 11's zero-tolerance list maps 1:1 to `severity: blocker`.
- **G5 · Image metrics for the defects that were rejected.**
  - (a) fan vs ribbon luminance-std ratio ≤ 1.5 (tonal seam).
  - (b) Marking pixels inside the asphalt mask = 100 % (floating).
  - (c) Kerb-mask continuity around every corner (sidewalk wrap).
  - All computed on the G2 PNGs.
- **G6 · Blind A/B against `screenshots/`.** The Cities: Skylines references are already local and out of git. Use it
  as the milestone gate, not per change.

---

## 5. Port plan, prioritised and mapped to our files

Attribution goes in `NOTICE.md` (text in §6) plus a header in each ported file:
`// Portions adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10): <file>#<function>`.
Effort is in agent-days (Muse spark-1.3 or Codex), tests included.

### P0 · Design amendments to 07 (lead, 0.5 d). Blocks everything.

1. **Sidewalk.** Width budget option A (§3 table), or the lead's alternative.
2. **Acute corners.** Fable shrink `R·clamp(δ/40°, 0.4, 1)`, then cap `0.45·L`, then `R_eff`, then `flat` chamfer +
   diagnostic. Corner R = `min` below 60° (decision).
3. **Drawing-angle guard** `δ_min = 2·atan(h/(0.45·L))`. Refuse or snap in `planRoad`; show it in the HUD ghost.
4. **Marking stack** from the trim: zebra [0.05, 0.35] (07 width + fable setback scaled down to save budget), stop bar
   [0.43, 0.48] incoming half only, arrows only when ribbon ≥ 2 × 1.6 tiles.
5. **Dead ends.** Caps `square | round | bulb`, default `round` (fable).
6. **Hill.** Pad-plane height contract.

### P1 · `src/sim/corridor.ts` profile completion (0.5 d)

- Add `laneCentres: number[]`, `laneWidth`, `medianHalf`, `cornerRadius`, `minRadius`, and real `sidewalk`.
- Add a cap kind and crosswalk/stopline flags per type. These carry the role of fable `RoadTypes.js` fields
  `crosswalks`, `stopLines`, `centreGap`, `laneOffsets`, `arrowLanes`.
- Move `sampleCurve` and `makeWalker` from `render/roads.ts` into an exported `segWalker(seg)` that returns
  `{len, at(s) → {x, z, dx, dz}}`. This is the single arc-length source for junctions, ribbons, lanes and lots.
- **Tests:** profile table; lane centres inside the asphalt and clear of the median; walker length = `segmentLength`
  ±1e-3.

### P2 · `src/sim/junction.ts` core port (2 d). Fixes S0-4 and S1-2 (ring).

| Our function | Ported from | Notes |
|---|---|---|
| `endFrame(walker, end, t)` | `Junctions.js endFrame` | point + tangent at arclength t, oriented away from the node; no Y |
| `lineIntersectAB`, `rayPolyline` | `Junctions.js` | verbatim, typed |
| `solveCorner(ei, fi, ej, fj, k, opts)` | `Junctions.js solveCorner` | units ÷8; R floor 0.2; returns `{kind, needTrimI, needTrimJ, pts:{x,z,nx,nz,w}[], diagnostics}`; heights removed (P6) |
| `solveArms(node)` | `computeJunction` loop | 12 iterations, monotone, cap `max(0.0625, 0.45·arclength)`; then the `R_eff` / chamfer pass (new) |
| `endMarks(arm, others)` | `computeJunction` flags block | flags 8/16/1/2/4/32, median gap, `cap` |
| `buildJunction(input)` | — | assembles rings `asphalt ⊂ kerbOuter ⊂ sidewalkOuter ⊂ boundary` from corner points + mouth cross-sections; quantised 1e-3 after construction (07a S2-2) |
| `checkJunction(layout)` | `RoadMesher ringIsSimple`, `polygonArea` | plus all 07 invariants |
| `junctionsOf(w)` | `RoadNetwork._finishMutation` re-solve pattern | cached by `graphRevision`; dirty set = endpoints of changed segments |

- **Tests:** 4-way street cross (four equal returns, trims 0.87 ± 1e-3 with 07 R), T, bend, curved arm (seam 0 against
  `segWalker`), rotation 30°, arm-order shuffle, sidewalk closed around every convex corner.

### P3 · Acute, short and reflex cases (1.5 d). Fixes S0-2.

- Y 25° street on L = 2 and L = 8; avenue-street 25°; 5-arm; two crosses 1.0 and 1.66 apart; duplicate arms 3°.
- Assert no ring self-intersection when the cap binds (fable fails this; ours must not).
- The `planRoad` angle guard in `src/sim/roads.ts` / `sim.ts` with a test on δ_min.
- Flip `acute-junction.test.ts` from logging to an assertion (07a §3.4).

### P4 · Markings on ribbons (2 d). Fixes S1-3 and S2-5.

- `src/render/roads.ts` `ribbon()` emits the attribute `aRoad = (lat, along, dA, dB)` + `aEnd = (flagsA, flagsB)`.
  `Geo` gains two attributes.
- `src/render/road-material.ts` ports `rd_box1`, `rd_endMarks` (zebra, incoming stop bar, arrow SDF), the lane-line cut
  (`cut` at dA < 0.525/0.74) and the "solid within 1.75 tiles" rule. Write it in GLSL directly; the shader is ours.
- Delete `zebra()` texQuads and the stop and arrow quads; delete `MARK_LIFT`.
- **Tests:** CPU mirror `endMarkAt(lat, d, side, flags)` in sim, used by unit tests (inbound-only stop bar on a one-way
  arm, zebra inside `cwHalf − 0.019`).

### P5 · Caps, transitions, medians (1 d)

- `round` cap from `solveCorner` k = 1. Add `square`/`bulb`. Pads: a zero-length segment gives a square cap of profile
  width, replacing the 1×1 quad at `render/roads.ts:732–740`.
- `transitionLoft()` ← `buildTransitionPad` (`arcFractions`, `sampleAtFractions`, lateral fraction union).
- Median nose `min(1.125, 0.42·len)` with profile `1 − (1−t)²`, gap 0.575 (avenue), taken from `buildSegmentPieces`.
- **Tests:** cap closed; no ring vertex strictly inside the asphalt except the cap edge; loft watertight against both
  corner strips (1e-3).

### P6 · Pad heights (1 d). Fixes the hill case and part of S2-5.

- `padPlane(node, armSlopes)` ← `_nodeGradient` (λ 0.35, slope clamp ±0.12, grade clamp 0.06).
- `blendToPad(seg)` ← `_applyPads` (blend `max(1.75, 1.5·trim)`, smoothstep).
- Render: `groundY` for junction rings, crosswalk corners and ribbon samples near nodes comes from `padY(x, z)`.
- **Tests:** ring vertices coplanar ±1e-3 on a 0.3/tile slope; ribbon end Y = ring Y at mouths.
- Elevation layers (S0-3) stay as 07a P6. Fable has nothing for this.

### P7 · Lanes and connectors (2 d). Fixes S1-4 and car corner-cutting.

- New `src/sim/lanes.ts`:
  - `lanesOf(seg)` ← `_refreshLanes` (offset from `segWalker` between trims, every 0.5 tile).
  - `laneGraph(w)` ← `laneGraph` connection rules (S/L/R/U classes, rank matching, fallbacks), cached by
    `graphRevision`.
  - `connector(inLane, outLane)` ← `bezierConnector` (h = min(0.46·d, 2.0)).
  - `conflicts(node)` ← `polysCross`.
- `traffic.ts`: `routePath` splices connectors at junction nodes; delete `roundCorners`.
- Signals: opposite-approach phase pairs + FNV desync in `roads.ts` `signalNodes` / `signalPhase` (replaces the
  `ns = |dx| ≤ |dz|` axis test).
- **Tests:** every connector sample (33 per connector) inside asphalt ∪ ribbons; curvature ≤ 2/laneWidth; diagonal-grid
  phases pair opposite arms.

### P8 · Optional: yielding and curve speed (2 d)

- Claims at unsignalised nodes ← `_intent` / `_resolveClaims` / `cmpClaim`: claim distance 3.75 tiles, stale after 7 s,
  `yieldDelay` table, don't block the box.
- `makePoly` curve speed `sqrt(LAT_ACC/κ)`, re-derived in tiles/s for `ROAD_SPEED` 3 / 4.5 / 7.
- Needs a vehicle position on the connector; keep `MAX_VEHICLES = 260` and an allocation-free loop.

### P9 · Quality loop (1.5 d, can run in parallel with P2)

- G1 showcase, G2 shot script (lead approves the dev dependency), G4 critic prompt + JSON schema in
  `/tmp/mayor-agents/critic-junctions.md`, G5 metrics script.
- Wire `docs/critique/` into the status page.

**Total:** about 12 agent-days for P1–P7 + P9; P8 adds about 2. Critical path: P0 → P1 → P2 → P3 → P4. P5 and P6 can
run in parallel after P2; P7 after P2.

---

## 6. NOTICE.md addition (MIT requires the notice in copies or substantial portions)

```markdown
## Third-Party Code (MIT)

Parts of the junction solver (`src/sim/junction.ts`), lane graph (`src/sim/lanes.ts`), road-marking shader
(`src/render/road-material.ts`) and transition loft (`src/render/roads.ts`) are adapted from
**Fable Cities**, https://github.com/rawprogress/fable-cities (commit aea8b10), translated to TypeScript and
rescaled from metres to tiles.

MIT License — Copyright (c) 2026 raw (github.com/rawprogress)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Copy the license text verbatim from `/tmp/gh-refs/fable-cities/LICENSE` when applying, not from this report. The repo's
own "no license chosen" status is compatible with including MIT code.

---

## 7. Risks

1. **Scale mismatch (highest).** Fable segments are 50–200 m (its showcase grid is 110 m), so its cap rarely binds and
   it never staged a short acute case. Our segments are 1–4 tiles (8–32 m), so the cap binds for most corners below
   about 88° on a 2-tile street (50° on a 4-tile street). Mitigation: `R_eff` + chamfer + drawing-angle guard + the P3 tests.
2. **Missed metre constants.** Every absolute length in §0 must be converted. Put them in one `JUNCTION_TUNING` object
   with tile units and a unit test that pins the converted values.
3. **Fan triangulation.** Fable's centre fan is our rejected octagon. Port the ring, not the fan.
4. **Overlap tolerated as a counter.** `badFans` must become a `checkJunction` failure.
5. **Two curve models.** The fable mouth and ribbon share THREE's analytic curve. We must make `segWalker` the only
   arc-length source; otherwise seams return at the κ·s²/2 level (07a §2.4).
6. **Per-end vs per-side trims.** Fable has one trim per end. 07 promises per-side trims. Fable avoids the gap by
   emitting the straight A→T run inside the corner. Keep the single per-end trim (simpler, watertight) and amend 07.
7. **Shader markings vs atlas textures.** P4 replaces the `ROAD_CLASS` CROSSWALK, STOP_BAR and ARROW quads. Night and
   wet looks need re-checking (G1 at 21.0 h). The iPad cost is per-fragment ALU on the road material only (fable runs
   at 274 fps desktop with far heavier shaders).
8. **Elevation untouched.** Ramps, bridges and tunnels need our own design (07a P6). Do not let a port claim the
   bridge-ramp hard case.
9. **min-vs-max corner radius** differs between fable and 07. Decide explicitly in P0, or implementers will diverge.
10. **License hygiene.** The NOTICE entry and per-file headers land in the same patch as the first ported function.

---

## 10-line summary

1. Fable's `Junctions.js` (MIT, 250 lines) is the right skeleton for our `src/sim/junction.ts`. Port it as TypeScript with every length ÷ 8 (metres to tiles).
2. Trims measured on the real curve plus shared mouth vertices fix curved-arm seams (S0-4) exactly. The 0.45·L cap separates the two ends of a segment (S2-1).
3. Corner kinds fillet/flat/round give us fillet, chamfer and dead-end caps; the mitred sidewalk (clamp 2.6·sw) gives the sidewalk ring geometry (S0-1).
4. S0-1's width budget is unsolved: their street is 1.5 tiles. Option A fits a 0.155 sidewalk inside our 1-tile street (asphaltHalf 0.32), so lots and raster stay put.
5. Acute corners (S0-2) are only partly solved. Their shrink `R·clamp(δ/40°, 0.4, 1)` still needs 3.0 tiles at 25° on a street, and when capped they silently overlap.
6. We must add the R_eff/chamfer fallback and a drawing guard δ_min = 2·atan(h/(0.45·L)): 45.8° at L=2, 23.8° at L=4.
7. Markings painted in the shader on the ribbon (zebra 0.10–0.475 tile from the trim, stop bar incoming-only, flags 8/16/1/2/4/32) remove floating crosswalks and marking lift (S1-3, S2-5).
8. Their lane graph plus Bézier connectors (h = min(0.46·d, 2 tiles)) replace our `roundCorners`. Opposite-pair signal phases with desync are a cheap win. Claims/yield is optional.
9. Do not port their centre-fan triangulation, overlap-as-counter or anything elevation-related (they have no bridges or tunnels). S0-3 stays ours.
10. Adopt their quality loop: junction showcase, shot script, a no-code critic with an anchored 0–10 scale (pass ≥ 8.5, 0 errors), JSON issues with pixel/file evidence and measured image metrics. Estimate: about 12 agent-days for P1–P7 + P9.
