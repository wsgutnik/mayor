# Junction builder — design-vs-code review (read-only)

Repo: `/Volumes/T7/07-Projects/clones` · Date: 2026-10-13 · Reviewer: read-only agent (no repo files edited)
Inputs read in full: `AGENTS.md` (rule 11, lines 49–55), `docs/process/07-junction-builder.md` (07),
`docs/process/06-corridor-parcel-architecture.md` (ADR 06), `.claude/skills/mayor-visual-quality/SKILL.md`,
`src/sim/roads.ts`, `src/render/roads.ts`, `src/sim/corridor.ts`; plus corroborating reads of
`src/sim/world.ts`, `src/sim/traffic.ts`, `src/sim/elevation.ts`, `src/sim/zoneblocks.ts` and the
existing tests (`roads.test.ts`, `render/roads.test.ts`, `corridor.test.ts`, `acute-junction.test.ts`,
`traffic-corners.test.ts`). `src/sim/junction.ts` does **not** exist yet — 07 is unimplemented; everything
below maps 07 against the incumbent `nodeLayout`/`nodePatch` machinery it replaces.

**Verdict up front:** 07 has the right shape (pure builder + `checkJunction` + layered rings) but is not
yet implementable as written. Three blockers must be settled in the design before code: (S0-1) the
sidewalk ring has nowhere to live — `RoadProfile.sidewalk` is `0` and the drawn road width has no room
for it; (S0-2) the acute-corner rule ("keep the arc, clamp to the miter limit, `r ≥ 0.2`") is
arithmetically unsatisfiable below ≈35°; (S0-3) the design is a flat 2-D, straight-arm, single-layer
model, while the graph it must serve has curved Bézier arms, mixed ground/bridge/tunnel nodes and ramp
nodes — none of which 07 mentions. Each user rejection (octagon blob, floating crosswalks, open U dead
ends, no sidewalk wrap, no through markings, acute notches, car corner-cutting) traces to a specific
missing invariant or an incumbent-code behaviour that 07 does not explicitly forbid. Details, numbers
and a build order follow.

Severity key: **S0** = blocks implementation / guarantees a rejected visual; **S1** = wrong geometry in
common cases; **S2** = wrong in hard cases or untestable as specified; **S3** = ambiguity that will
diverge between implementers.

---

## 1. Design flaws and missing invariants in 07

### S0 — blockers

**S0-1 · The sidewalk ring contradicts the only source of truth for widths.**
07:36 specifies kerb/sidewalk `0.07/0.12` (street), `0.09/0.16` (avenue) and 07:48–49 builds concentric
rings `asphalt ⊂ kerbOuter ⊂ sidewalkOuter`. But `src/sim/corridor.ts:67` sets `sidewalk: 0` for every
profile, `corridor.ts:88` collapses `kerbEdge` and `sidewalkEdge` to the same offset (`drawHalf`), and
`corridor.ts:61–62` derives `asphaltHalf = ROAD_DRAW_WIDTH/2 − kerb` — i.e. the entire drawn width
(`src/sim/world.ts:92`: street 0.9, avenue 1.8, highway 2.8) is already spent on asphalt + kerb. There
is no 0.12–0.16 tile left for a sidewalk inside the road footprint. Placing the sidewalk ring outside
`drawHalf` (street outer edge at 0.38+0.07+0.12 = **0.57** from centreline) overflows the rasterised
road tile (`ROAD_TILE_WIDTH` street = 1 tile, half = 0.50, `world.ts:91`) and the corridor setback line
(`corridor.ts:68`: street setback = 0.50 − 0.45 = 0.05; setback line at 0.50), so the new ring would sit
under the first lot row. 07 never says whether the sidewalk (a) carves width out of the asphalt
(asphaltHalf shrinks), (b) widens the road beyond `ROAD_DRAW_WIDTH` (then `world.ts`, `corridor.ts`,
`zoneblocks.ts:70`, props offsets and the rasteriser all change), or (c) reuses the kerb band visually
only (then "sidewalk wraps the corner as one ring", 07:48, is a texture claim, not geometry). Until 07
picks one and restates the profile table, `junction.ts` cannot compute a single ring. Note
`corridor.test.ts:41` currently *locks in* `sidewalk = 0` arithmetic
(`drawHalf + sidewalk + setback + 0.5 = ROAD_TILE_WIDTH/2 + 0.5`), so the fix will intentionally break
that test — it must be named in the change, not discovered.

**S0-2 · The acute-corner recipe is unsatisfiable as stated.**
07:46–47: "Acute corners keep the arc, shorten both arms to the miter limit and insert a short chamfer
between arcs; an arc is never dropped", combined with invariant 07:62 "fillets tangent to both edge
lines and `r >= 0.2`". For a corner with gap angle θ between arm centrelines, equal half-width `h` and
fillet radius `R`, the tangent (trim) distance from the node centre is

```
t(θ) = (h + R) · cot(θ/2)
```

Street (`h=0.38, R=0.45`): t(90°)=0.83, t(45°)=2.00, t(35°)=2.63, t(25°)=3.74, t(15°)=6.30, t(10°)=9.49.
Avenue (`h=0.81, R=0.60`): t(90°)=1.41, t(45°)=3.40, t(25°)=6.36, t(15°)=10.71, t(10°)=16.12.
Highway (`h=1.40, R=1.20`): t(90°)=2.60, t(25°)=11.73.

If a miter limit `t_max` caps the trim, tangency forces `R_eff = t_max·tan(θ/2) − h`. With the incumbent
limit (`roads.ts:675`, `miterLimit = clamp(radius + 1.5·fillet, 0.85, 1.8)`, i.e. ≈1.0 street / ≈1.8
avenue), a 25° street corner gives `R_eff = 1.0·tan(12.5°) − 0.38 = −0.16` — *negative*: no tangent arc
exists at any radius ≥ 0, let alone ≥ 0.2. Even with `t_max = 1.8`, `R_eff(25°, street) = 0.02 < 0.2`.
The invariant set {tangent arc, r ≥ 0.2, trim ≤ miter limit} is jointly satisfiable only for
θ ≥ 2·atan((h+0.2)/t_max) ≈ **35° (street, t_max=1.8)**. 07 gives no value for "the miter limit"
(the incumbent's formula is not referenced), no chamfer length/angle, and no statement of which
invariant yields when they conflict. This is exactly the incumbent failure — `roads.ts:735–749` clamps
the trim and flags `beveled`, then `render/roads.ts:612` *drops the arc* (`if (c.beveled …) return []`)
— which produced the rejected acute notches. 07 must replace the slogan with a construction, e.g.:
solve `R_eff` from the *segment-bounded* trim allowance (see §2.2), emit diagnostic `radius-shrunk`
when `R_eff < R`, and define the chamfer as the segment joining the two *clamped* tangent points only
when `R_eff < 0.2`, with the `r ≥ 0.2` invariant explicitly scoped to non-chamfered corners.

**S0-3 · No elevation, no Y, no layer separation.**
07's output (07:23–27) is pure plan-view: `centre`, rings of `Pt {x,z}`. The real graph is layered:
`segElevation` (`world.ts:106–107`) ∈ {ground, bridge, tunnel}; `addSegment` only creates crossing
nodes within one elevation (`roads.ts:432–435`) but `snapEnd` (`roads.ts:201–216`) snaps an endpoint to
*any* nearest node regardless of elevation, so mixed nodes (the ramp links of `world.ts:614–630`,
`roadLink`) exist by design. `nodeArms` (`roads.ts:584–603`) returns all arms indiscriminately;
only signals filter (`groundArms`, `roads.ts:771–777`). 07's `classify` (07:43–44) and stage list
(07:13–14) never mention elevation. Consequences an implementer must guess at: Does a ground+bridge
node get a ground junction polygon, a deck polygon, both, or none? (`corridorsOf` already answers a
different way — it *skips* non-ground segments entirely, `corridor.ts:180`.) What Y does a ring vertex
take on a bridge ramp, where deck height varies continuously (`bridgeProfile`/`deckYAt`,
`world.ts:707–727`; lift 0.5 over a ≥2-tile ramp)? The renderer today answers badly: `nodePatch`
(`render/roads.ts:665–692`) samples `groundY` for every vertex, while a bridge ribbon samples deck
height (`render/roads.ts:743–745`) — a junction patch at a ramp node is guaranteed sunken or floating
by up to the 0.5 deck lift. 07 needs, at minimum: a per-node layer key (elevation of the arms it may
join), a rule that crosswalks/stop lines/guide dashes are emitted only for ground, kerbed arms, and a
`y` (or a height-sampler contract) per ring. Without this the "bridge ramp" hard case in AGENTS.md:53
is unbuildable, not merely untested.

**S0-4 · Arms are modelled as straight rays; real arms are curves.**
07 speaks of "the edge lines" of an arm and trims as distances from the centre. The incumbent
`endTangent` (`roads.ts:567–578`) takes the direction tip→control-point of a quadratic Bézier, and the
ribbon then walks the *curve* by arclength (`render/roads.ts:126–159, 213–215`). A junction ring built
on the straight tangent ray and a ribbon built on the curve diverge laterally by ≈ `κ·s²/2` at trim
distance `s` (curvature κ). At an avenue trim s=1.41 on a modest curve (radius 5 tiles, κ=0.2) that is
0.20 tile — two hundred times the 1e-3 seam invariant (07:61). 07 must define an arm as the corridor
centreline samples (`corridor.ts:117–129`, noting they are sampled at 0.5 step with central-difference
tangents, `corridor.ts:123–125`) with trims as *arclengths* along them, and edge points taken from the
offset polylines (`corridor.ts:131–162`) — or explicitly restrict junctions to the first sample's
tangent and bound the admitted curvature. Silence here reproduces today's gap/overlap at every curved
junction (the "curve" hard case, skill SKILL.md:20–21).

### S1 — wrong in common cases

**S1-1 · Fillet radius is per-node today, per-corner in 07 — but 07's own table is not the code's.**
Incumbent: one global `fillet = max(0.25, …cornerRadius)` (`roads.ts:673`) with
`cornerRadius` = 0.25 street / 0.4 everything else (`roads.ts:36–38`). 07:37 wants R = 0.45 street /
0.60 avenue / 1.20 highway taper, 0.25/0.35 at no-turn (one-way) corners, and 07:45 `R = max(R_a, R_b)`
*per corner*. So even the orthogonal 4-way street cross — the acceptance image at 07:69 — is drawn
today with R=0.25 instead of 0.45, one reason it reads as a blob with pinched corners rather than a
"rounded cross with four equal kerb returns". 07 is right, but it should say explicitly that
`cornerRadius` and the single-`fillet` field of `NodeLayout` (`roads.ts:641`) are deleted, because a
contributor who keeps them "for compatibility" keeps the defect. The one-way reduction (R=0.25) is
also unimplementable in the stated stage order: whether a corner carries turning traffic is known only
after connectors are enumerated, but 07:13 runs `corners/fillets` *before* `connectors`. Either move
connector *pair enumeration* (not geometry) ahead of fillets, or drop the one-way radius distinction.

**S1-2 · Trim symmetrisation and the centre-fan are the octagon blob; 07 doesn't forbid either.**
Two incumbent behaviours manufacture the rejected blob and will survive any reimplementation that
only replaces the ring math:
(a) `roads.ts:752–757` forces `trimA.neg = trimA.pos = max(…)` per arm — the larger corner's trim is
imposed on the straight-through side, pushing ribbons back symmetrically and inflating the patch.
07:23 promises "trims per layer" and 07:49 "kerb and sidewalk trims equal the asphalt trim", but never
states trims are **per side** and must *not* be symmetrised; its own invariant list omits it.
(b) `render/roads.ts:686–691` triangulates the patch as a fan from the node centre, and
`junctionDebugGeometry` (`render/roads.ts:629–633`) falls back to `l.radius * 0.55` when a trim is 0,
inventing an octagon-ish ring for straight/bend nodes. 07 says rings are output, but says nothing
about triangulation: a centre fan over a ring whose arcs are discretised at
`ceil(Δangle/0.18)` (`render/roads.ts:617`) creates exactly the faceted blob at game zoom, and fan
triangles at acute corners violate 07's own "no angle < 5°" invariant while no current test checks the
asphalt fan (see §3). 07 should mandate: ring → earcut/constrained triangulation with a Steiner centre
only when the ring is star-shaped w.r.t. it, arc step bounded by sagitta (see §2.5), and a ban on
fallback radii — a missing corner must be a diagnostic, never invented geometry.

**S1-3 · Crosswalk/stop-line placement is under-determined in the one case that matters (asymmetry).**
07:50: crosswalk "rectangle across the mouth from the trim outward by its width". Which trim — the
arm's own centreline trim, the max of its two side trims, or the fillet tangent? On a mixed
avenue+street arm the two side trims differ (each side belongs to a different corner, 07:45 R from the
larger neighbour). If the rectangle starts at the smaller side trim, its inner corner on the other side
floats over the junction arc (the rejected "floating crosswalk"); if at the larger, a gap of ribbon
shows between arc and zebra on the near side. The incumbent picks `max(trimK)+0.1` from the *node
centre along the arm ray* (`render/roads.ts:557`) and draws the stop line across the **full** width
(`render/roads.ts:584–591`, ±0.92·hw), contradicting 07:51/07:70 "only across inbound lanes". 07 also
omits: crosswalk lateral extent (incumbent ±0.92·hw — inside the kerb? to the kerb face?), stripe pitch
beyond `round(asphalt/0.11)` (07:50 — "asphalt" undefined: full width 2h gives 7 stripes street / 15
avenue; the incumbent non-atlas path uses `round(hw·9)` stripes of a different size, `render/roads.ts:571`),
z-order/lift (incumbent: markings at `ROAD_LIFT+0.004` sit *below* the node patch at `+0.02`,
`render/roads.ts:14–17` — any crosswalk part under the patch is hidden, the rest floats at a different
height; 07 has no lift contract at all), and suppression rules (highway arms, bridge/tunnel arms,
roundabout entries, arms whose segment is too short — see §2.2). A buildable rule is: crosswalk inner
edge at `max(side trims) + kerb-face offset`, rectangle clipped against `asphalt ∪ ribbon` in
`checkJunction` (07:62 gestures at this but "ribbon" is renderer geometry the pure builder doesn't
own — the union must be defined from corridor offsets, or the invariant is untestable in `src/sim`).

**S1-4 · "Markings through the junction" and connectors lack a lane model.**
07:52 (guide dashes for straight pairs) and 07:55 (Hermite connectors, "tangents 0.55 × chord") presume
lane centrelines that no profile defines: `RoadProfile` (`corridor.ts:9–24`) has `lanes` count
(2 street / 4 avenue / 4 highway, `corridor.ts:70`) but no lane offsets, no median width (the renderer
hardcodes a 0.16 half-width median strip, `render/roads.ts:344`), no statement of right-hand traffic
or of which side is inbound for a given arm end (`a`/`b`, `seg.dir`, `roads.ts:122–125`). Without lane
offset = f(profile, lane index) in `corridor.ts`, every consumer re-derives it — the exact disease
ADR 06:11 diagnosed. Further gaps: which ordered arm pairs get connectors (U-turns? left across
oncoming avenue lanes? pairs forbidden by one-way `dir`?), guide-dash geometry (width, dash/gap,
offset from lane centre, behaviour when the "straight" pair is off by 10° — the template seam, 07:17),
and the curvature invariant's `laneWidth` (07:64) is nowhere defined (street: 0.76/2 = 0.38 ⇒
κ ≤ 5.26/tile, radius ≥ 0.19 tile — is that the intent for a 90° Hermite with 0.55·chord tangents?
It must be verified by sampling, see §2.4, not asserted). Finally, 07:28 says connectors *replace*
`roundCorners` (`traffic.ts:367–384`, a (1,2,1)² blur on tile routes that cuts corners by up to
≈0.2 tile with no knowledge of carriageway width — the rejected car corner-cutting), but gives no
migration invariant (e.g. "every connector sample inside asphalt ∪ ribbons, sampled at 0.1") nor a
fallback for routes that cross nodes the builder classified `middle`/`roundabout`.

**S1-5 · Dead ends: the design names two caps but dimensions neither, and ignores pads/self-loops.**
07:54 + table 07:41: `square` cap (flat end, kerb+sidewalk U-wrap, outer fillets of kerb+sidewalk) or
`bulb` (radius 0.90 street / 1.20 avenue). Missing: cap plane position (at the node centre? at the
trim? beyond it — the incumbent `deadEnd` fans a semicircle of radius `hw` *beyond* the tip plus a kerb
annulus, `render/roads.ts:526–550`, which is precisely the rejected "open U with stray arc");
U-wrap fillet radius formula when the arm arrives curved (tip tangent from the last Bézier sample);
which cap is chosen when (user setting? profile? 07:44 says classify `end` but the square/bulb choice
appears from nowhere); bulb clearance (bulb Ø 1.8 tiles on a 1-tile-wide street raster — it *will*
overlap adjacent lots/props; no boundary/clear-zone rule); and the zero-length pad segment
(`roads.ts:355–363`, `a === b`, `pts = [p,p]`) whose node has **zero** arms under `nodeArms`
(`roads.ts:590` skips `roughLength < 1e-6`) — 07's "1 arm ⇒ end" (07:43) never fires for the most
common painted dead end, which the renderer special-cases as a 1×1 quad (`render/roads.ts:732–740`).

**S1-6 · Classification is incomplete where the graph is messiest.**
07:43–44: `end` (1 arm), `middle` (2 collinear, same profile), `bend`/`transition` (2 arms),
`junction` (3+), roundabout "when requested". Unspecified: collinearity tolerance (incumbent merge
uses dot > −0.996 ≈ 175°, `roads.ts:495`; layout straight-skip uses |gap−π| < 0.09 rad ≈ 5.2°,
`roads.ts:697` — two different numbers, 07 adopts neither); `transition` vs `bend` discriminator
(profile differs? elevation differs? one-way 4 vs street 1 — same base, different lanes/direction);
duplicate/coincident arms (incumbent skips gap < 0.02 rad, `roads.ts:696`; upgrade ghosts from
`roads.ts:394–405` can produce them); 5+ arms (in the skill's hard-case list, absent from 07);
self-loop segments (`a === b` with real length); roundabout source of truth — `world.roundabouts[]`
(`world.ts:131, 185`) plus `seg.roundabout` flags plus 4 ring nodes each of degree 3
(`stampRoundabout`, `roads.ts:874–922`): per-node classification sees ring nodes as ordinary
junctions/bends, so "roundabout when requested" needs a node→roundabout lookup 07 doesn't define.

### S2 — hard cases / testability

**S2-1 · `junctionsOf` caching is specified past the point of feasibility.**
07:11: "cached per `graphRevision`, rebuilds only changed nodes". `graphRevision` is a single global
counter bumped by every mutation (`roads.ts:61–63`); identifying *changed* nodes requires diffing the
previous node/segment set, and a node's layout depends on its neighbours through shared-segment trim
budgets (§2.2) — the dirty set is the node plus its 1-ring (arguably 2-ring when a neighbour's R
shrinks). None of this is stated; nor is the cache's memory bound or its behaviour when
`graphRevision` is absent on old saves (`roads.ts:48` defaults 0). The invariant "full rebuild =
incremental rebuild" (07:65) is untestable until "incremental" is defined.

**S2-2 · Quantisation vs tangency tolerances don't close.**
Rings are "1e-3 quantised" (07:24) and the centreline-at-trim must lie on the ring "1e-3" (07:61), and
fillets must be "tangent to both edge lines" (07:61–62). Quantising a tangent point to the 1e-3 grid
moves it up to 0.71e-3 off the edge line; quantising the arc centre independently breaks tangency by
a similar amount — the two tolerances stack to ≈1.4e-3 > 1e-3. Either quantise *then* re-derive
(centre from quantised tangent points), or state tangency tolerance as 2e-3. Arc discretisation is
unspecified: chord sagitta `R(1−cos(Δ/2))` at the incumbent Δ=0.18 rad is 0.0018 (R=0.45) — already
over 1e-3; holding sagitta ≤ 1e-3 requires Δ ≤ 2·acos(1−1e-3/R) ≈ 0.13 rad (R=0.45), 0.09 rad (R=1.2).

**S2-3 · The template/general seam test is too weak to catch the blob returning.**
07:16–18: closed forms within 8° of orthogonal, seam sweep ±12°, "touch points move < 0.15 m per
degree". Units: the project works in tiles (07:31 "tile = 8 m", so 0.15 "m" = 0.019 tile/deg — or did
the author mean 0.15 tile/deg, which permits a 1.8-tile discontinuity across the seam?). Even read
charitably it bounds only touch-point *drift*, not ring area, crosswalk position, trim sign flips, or
diagnostic flapping at 8°±ε. Require instead: layout(θ) continuous in θ across the boundary for trims,
ring Hausdorff distance, and crosswalk inner edge, sampled every 1° from −12° to +12°, plus identical
`kind` classification on both sides.

**S2-4 · Boundary, lotAnchors and clearZones are outputs without geometry.**
07:26–27 lists `lotAnchors` ("where a lot row may start per arm side") and `clearZones` ("corner sight
triangles"); no formula follows. Sight triangle legs (by class? by R? 07 gives none), anchor measured
along the arm curve from where (boundary's longitudinal extent — see §5), on which side, and how a
consumer combines anchors from *both* ends of one segment are all missing. Props/lots cannot consume
an undefined output; today they consume corridor offsets + `nodeLayout` trims only
(`props.ts:40–58`, `zoneblocks.ts:69–93`), so these fields will either be dead or re-invented per
consumer — ADR 06's original disease (ADR 06:11).

**S2-5 · No z/lift, terrain or night contract.**
Rule 11 (AGENTS.md:52–53) requires day *and* night inspection; markings are textures/classes in the
atlas path (`render/roads.ts:42–50, 560–569`). 07 never states lift ordering (asphalt < kerb <
markings < junction patch, with minimum separations to avoid z-fighting — incumbent gaps are only
0.004–0.02 world units, `render/roads.ts:14–17`), how ring vertices take terrain height on a slope
(per-vertex `groundY` makes rings non-planar; a fan over a non-planar ring twists), or that crosswalk
quads must follow the same height field as the asphalt beneath them (the literal cause of "floating").

**S2-6 · Performance invariant is unmeasurable as written.**
"100 random nodes < 10 ms" (07:65): random over what distribution (arm counts? angles? classes?),
including `checkJunction` or not, on what hardware (iPad budget, AGENTS.md:42, is the real gate),
cold or warm cache? The incumbent `nodeLayout` is O(arms² )-ish per node with line intersections per
corner (`roads.ts:691–751`); a ring builder with arc subdivision and polygon simplicity checks is
heavier. Specify the fixture (e.g. seeded RNG, the §3 hard-case set × 10 rotations) and measure
`buildJunction` + `checkJunction` separately.

### S3 — ambiguities that will fork implementations

- **S3-1** "Shorten both arms to the miter limit" (07:47) — the miter limit of *what*: a constant, the
  incumbent `roads.ts:675` formula, or the neighbouring segment's budget (§2.2)? Each gives different
  visuals.
- **S3-2** "R shrinks linearly when `segLength < 2t`" (07:58) — linear in what variable, `t` of which
  end, solved simultaneously for both ends or greedily? And "below ~0.6 tile the node merges (middle)"
  — a pure derived builder cannot merge graph nodes; incumbent merge is a graph mutation with strict
  preconditions (`tryMergeNode`, `roads.ts:482–517`: same type, same elevation, not one-way/fixed,
  >175°). If the builder merely *renders* it as middle while the graph keeps the node, signals
  (`hasSignal`, `roads.ts:780–783`), traffic and saves still see a junction. Say which.
- **S3-3** Median: "ends at the crosswalk, never in the polygon" (07:57) — on an avenue-through arm of
  a T (avenue continues, street joins), does the median run *through* the junction along the avenue?
  Acceptance 07:72 ("avenue kerb straight across the mouth") implies the through carriageway is
  uninterrupted, which contradicts a blanket "never in the polygon" for the median *and* for guide
  dashes of the through pair. Define per-pair, not per-node.
- **S3-4** `hash` (07:27): hash of what, which algorithm, stable across arm input order? Needed before
  anyone can write the determinism test (07:65).
- **S3-5** Highway "1.20 (taper)" (07:37) and "taper" corners: a taper is not a radius. Length, rate
  and where tapers apply (highway×highway only? highway×ramp?) undefined; at-grade highway junctions
  are refused upstream anyway (`crossings.test.ts:65–80`), so state that highway arms reach
  `junction.ts` only at ramps/merges, if that is the intent.
- **S3-6** Diagnostics (07:15): names three examples ("beveled corner, dropped crosswalk, shortened
  radius") with no code list, no severity, and no rule for what the renderer does with each. The
  incumbent's single `beveled?: boolean` (`roads.ts:633`) shows where this ends: renderer silently
  drops geometry. Every diagnostic that alters geometry needs a mandated visual fallback.

---

## 2. Concrete numeric and geometric risks

### 2.1 Acute angles (the Y / A-junction)

Using `t(θ) = (h+R)·cot(θ/2)` (§1, S0-2), with the design's own numbers:

| gap θ | street t (h .38, R .45) | avenue t (h .81, R .60) | highway t (h 1.40, R 1.20) |
|---|---|---|---|
| 90° | 0.83 | 1.41 | 2.60 |
| 60° | 1.44 | 2.44 | 4.50 |
| 45° | 2.00 | 3.40 | 6.28 |
| 35° | 2.63 | 4.47 | 8.25 |
| 25° | 3.74 | 6.36 | 11.73 |
| 15° | 6.30 | 10.71 | 19.75 |
| 10° | 9.49 | 16.12 | 29.72 |

Risks, in order:
1. **Trim exceeds the arm's segment.** Painted streets are routinely 1–4 tiles long; a 25° street arm
   needs 3.74 tiles *on each side's corner budget before the crosswalk* (crosswalk adds ≈0.42 more,
   §2.3). Uncapped, the junction swallows the whole block; capped (incumbent), the arc is dropped and
   the notch appears (`roads.ts:736–749`, `render/roads.ts:612`). 07 must define the coupled
   shrink (§2.2) — there is no reading of 07:47+07:58 that produces a number today.
2. **The reflex side.** Any node whose arms cluster (e.g. a bend, or a Y with one gap > 180°) has a
   reflex (concave) gap. The incumbent handles it at `roads.ts:701–717`: the branch is entered when
   `gap > π`, but its only trimming action is guarded by `gap < 150°` (`roads.ts:703`) — a condition
   that can never hold when `gap > 180°`, so the guard is dead and concave corners get *no* kerb geometry from the
   corner loop and rely on ribbon overlap. 07's ring model actually fixes this (a simple polygon has
   both convex and concave vertices), but 07 never says concave vertices take a miter (intersection of
   edge lines), a fillet of what radius, or how the sidewalk ring stays simple when the concave miter
   spike exceeds the arm width. Miter spike length for the inside of a bend grows as
   `h / sin(θ_bend/2)`; at a 25° direction change the spike is ≈ 4.6·h ≈ 1.75 tiles (street) — it will
   cross the opposite edge and self-intersect the ring unless clamped (incumbent corridor code already
   clamps offset miters at `offset·4`, `corridor.ts:135, 154–158`; 07 should adopt a named limit).
3. **Near-duplicate arms.** θ → 0 (two arms 3° apart, reachable by freehand drawing): t → 28 tiles
   (street). 07 has no minimum-gap rule (merge arms? refuse corner? treat as one wide arm?). Incumbent
   skips gap < 0.02 rad ≈ 1.1° (`roads.ts:696`) silently, leaving ribbon overlap to chance.
4. **Asymmetric acute corners** (avenue h=0.81 meeting street at 25°): `R = max` (07:45) with unequal
   half-widths makes the two tangent distances differ; the closed form is the intersection of the two
   offset edge lines (incumbent `roads.ts:720–732` does this correctly in principle). 07's recipe text
   ("centre O = intersection of the edge lines offset by asphaltHalf + R", 07:45–46) is ambiguous
   about *whose* asphaltHalf offsets which line when a≠b — one line per arm, each offset by *that
   arm's* h + R, is the only consistent reading; say so.

### 2.2 Short segments (two junctions on one short arm)

The binding constraint 07 never writes: for a segment of arclength `L` between nodes N₁, N₂,
`trim(N₁, arm) + trim(N₂, arm) + minRibbon ≥ L`, where minRibbon ≥ 0 for geometry and
≥ ≈0.72 (crosswalk 0.30 + gap 0.08 + stop 0.04 + dash restart) if both ends carry crosswalks.
Numbers: two orthogonal street crosses consume 2×0.83 = **1.66** tiles before any ribbon exists; two
avenue crosses 2×1.41 = **2.82**. A 1-tile painted link (the common case from `addPad` joins,
`roads.ts:341–351`, and grid blocks) is therefore *entirely* junction at street size. 07:58 ("R shrinks
linearly when segLength < 2t; below ~0.6 the node merges") cannot be implemented as a per-node rule:
shrinking R at N₁ changes t at N₁ only, so both ends must solve jointly, e.g. iterate
`t_i ← min(t_i, max(0, L − minRibbon) · t_i/(t₁+t₂))` then `R_i ← t_i·tan(θ_i/2) − h_i`, floor R at
0.2, and when the floor binds, drop crosswalk → drop stop line → diagnostic, in that order. Note the
collision with graph constants the design ignores: `SNAP_RADIUS = 0.6` (`roads.ts:17`) already merges
endpoints closer than 0.6, and split thresholds (`roads.ts:172–173`, t<0.02/t>0.98) can mint segments
of ≈0.3 tiles between a crossing node and an end node — under every threshold in 07:58, with no
specified behaviour. Also `segLength` must be *arclength along the curve* (`segmentLength`,
`world.ts:561–566`), not chord: on a tight Bézier the chord understates L by 10–20%.

### 2.3 Crosswalk/stop-line stack-up (why they float today)

Per-arm longitudinal budget from the node centre (orthogonal street, design numbers):
trim 0.83 → crosswalk [0.83, 1.13] (width 0.30) → gap 0.08 → stop line [1.21, 1.25] (thickness 0.04) →
first dash after ≈1.25. Avenue: [1.41, 1.76] → stop [1.84, 1.89]. The incumbent instead places the
zebra *centre* at `max(trimK) + 0.1` with half-width 0.16 (`render/roads.ts:557, 563`) — i.e. the
zebra starts 0.06 *before* its own nominal position and overlaps the fillet arc region, where the
asphalt surface is the raised node patch (lift +0.02) while the zebra rides at +0.004
(`render/roads.ts:15–17`): the overlapping part is buried, the rest is coplanar-adjacent to ribbon
asphalt — visually "floating". 07 fixes the *longitudinal* story (start at trim) but, per S1-3, not
the side-asymmetry, lateral extent, lift or clip. Test that would have caught it: sample the crosswalk
quad's four corners + centre against `asphalt ∪ ribbon` *and* assert its lift exceeds the asphalt
lift everywhere beneath it (see §3).

### 2.4 Curves

- Arm direction: incumbent uses tip→control chord (`roads.ts:570–575`). For a quadratic Bézier that
  direction is exactly the endpoint tangent direction, so angle is fine — but the *tangent point*
  computed on the straight ray is not on the curved edge. Edge offset curves of a Bézier are not
  Béziers; the corridor already approximates them by sampled offset polylines with miter clamping
  (`corridor.ts:131–162`). Junction rings must terminate at corridor offset-polyline points at matched
  arclength, not at ray constructions, or the 1e-3 seam invariant fails by the κ·s²/2 term (§1, S0-4):
  κ=0.5 (radius 2 tiles, the tight curve in `corridor.test.ts:77`), s=0.83 ⇒ lateral error 0.17.
- A curved arm's *inside* edge shortens and outside lengthens; per-side trims in arclength differ by
  factor (1 ∓ κh). 07's single per-arm trim concept (even per-side, 07:23) must be arclength per side
  along the offset polyline, or kerb ribbons (which walk centrelines, `render/roads.ts:256–290`) will
  shear against the ring.
- Curve-through-node: a 3-point segment split at a crossing (`splitSegment`/`splitPts`,
  `roads.ts:84–94`) produces two arms whose endpoint tangents are collinear with the original curve —
  classification must see `middle`, but any tolerance looser than the curve's tangent change across
  the node misclassifies it as `bend` and grows a patch over a continuous curve.

### 2.5 Arc discretisation and slivers

Sagitta bound (§1, S2-2): Δ_step ≤ 2·acos(1 − 1e-3/R): R=0.45 ⇒ 0.133 rad; R=0.60 ⇒ 0.115 rad;
R=1.20 ⇒ 0.082 rad. The incumbent 0.18 rad step (`render/roads.ts:617`) yields sagitta 0.0018–0.0049 —
visible faceting at close zoom (rule 11 inspects close up) and a ring that is *not* within 1e-3 of the
true fillet it claims to be tangent to. Conversely, fan triangulation from the centre over a fine ring
creates triangles with apex angle = Δ_step at radius ≈ R: at an acute corner the centre-fan triangles
near the chamfer routinely fall under area 1e-5 / angle 5° (07:62) — the incumbent only tests the kerb
lift for this (`roads.test.ts:261–282` filters lift 0.078), never the asphalt fan at 0.080.

### 2.6 Elevation layers and bridge ramps

- **Mixed node (ramp link).** Ground arm + bridge arm share a node (`world.ts:618–630`). Deck height
  at the node is `y0` (shore height) by construction (`bridgeProfile`, `world.ts:707–714`), rising
  with smoothstep slope up to `1.5 × 0.5 / ramp0` ≈ 0.375/tile over the first `ramp0 ≥ 2` tiles. A
  ground junction trim (0.83–1.41) sits *inside* the ramp: the bridge ribbon's height there is
  `deckYAt(s)` while a ground-sampled patch is lower by up to ≈0.3. Any junction polygon at such a
  node must be built per-layer with per-vertex Y from the deck sampler, or the bridge arm must be
  excluded from the ground polygon and its ribbon extended to the node centre (no patch) — 07 must
  choose; today `nodePatch` chooses wrong by omission (`render/roads.ts:686–690`, groundY only, and
  `layoutOf` is computed for bridge segments too, `render/roads.ts:742–755`).
- **Grade-separated crossings** produce *coincident centres*: a ground node and a bridge node can sit
  at the same (x,z) (crossing without a node is the norm, `roads.ts:429–443`, but stamped roundabouts
  and snapped ends can coincide). `junctionsOf(world)` keyed by node id is safe; any spatial hashing
  by centre (a temptation for `clearZones`/props) is not. 07 should state id-keying.
- **Tunnels:** portal geometry is renderer-built at segment tips (`render/roads.ts:503–521, 722–728`);
  a tunnel arm at a node must classify the node as *not* a surface junction for that arm. 07's silence
  plus `nodeArms` including tunnel arms means a naive implementation draws a junction disc over a
  portal.
- **Highway arms** reach nodes only via merges/ramps (at-grade highway crossings are refused or
  grade-separated upstream — `crossings.test.ts:65–91`). Crosswalks/stop lines/sidewalks must be
  suppressed by *profile* (kerb = 0 is the incumbent signal, `roads.ts:748`), and 07:37's highway
  "crosswalk: none" must become a classify-level rule, not a drawing note.

### 2.7 Connectors and corner-cutting (vehicles)

Hermite with tangent magnitude 0.55·chord (07:55): for a 90° lane-to-lane turn the chord between lane
points at the two markings trims is ≈ √2 · (trim + laneOffset) ≈ 1.7 tiles (street), giving tangent
length ≈0.94. Peak curvature of that cubic (sampled, κ = |x′y″−y′x″|/(x′²+y′²)^1.5) must be checked
against 07:64's `2/laneWidth`; with street laneWidth 0.38 the bound is κ ≤ 5.26 (radius ≥ 0.19) —
comfortable at 90°, but for the *acute* pair in a Y (turn angle 155° between an arm and its
near-opposite) the chord shrinks toward the lane-offset difference (≈0.1–0.4) while the direction
reverses: tangent magnitude → 0.55·small, endpoint curvature spikes roughly as `2·tangent/chord²`,
easily > 20/tile, and the spline can exit the asphalt wedge entirely. 07 needs: connector existence
matrix (which turns are offered), a minimum-chord/U-turn rule, sampled containment
(`connector ⊂ asphalt ∪ ribbons`, 33 samples minimum) as a *builder* invariant rather than a hope,
and the `roundCorners` retirement test (§3) — tile-route corner-cutting (`traffic.ts:378–379` moves
the corner point to the (1,2,1) centroid, up to ≈0.25 tile inward per pass pair) is a traffic-layer
defect that junction connectors only fix if `routePath` actually consumes them per node; 07:28 asserts
the replacement but no interface (connector lookup by (node, inArm, outArm)) is defined.

### 2.8 Slopes and terrain

Mayor terrain is a heightfield (`heightAt`, `world.ts:782–790`); hard case "hill" (SKILL.md:20). Ring
vertices at per-vertex ground height + fixed lift produce a non-planar patch; on a 0.3/tile slope the
ring (radius ≈1.4 avenue) spans ≈0.85 of height variation. Crosswalk quads are emitted flat per arm
(`render/roads.ts:87–92` samples groundY per corner — good) but a junction *polygon* from 07 has no
height field at all. State it: layout is 2-D; renderer samples `groundY` per ring vertex and per
crosswalk corner (never a per-node constant Y), and `checkJunction` stays 2-D. One sentence in 07
prevents a whole class of "floating on hills" defects.

---

## 3. Test gaps against AGENTS.md rule 11

Rule 11 (AGENTS.md:49–55) demands, for anything drawing junctions: (a) a documented design, (b)
headless geometric invariant tests (no gaps, no overlaps, no slivers, snaps within 1e-3), (c) visual
inspection day **and** night, game zoom and close-up, on the hard cases (acute junction, dead end,
curve, avenue+street, bridge ramp), with screenshots or SVG dumps in the report. The skill
(SKILL.md:19–22) extends the hard-case list: 4-way, T, Y at 25°, 5 arms, dead end (square *and* bulb),
2-arm bend, avenue+street, one-way arm, curve, hill, bridge ramp, roundabout.

### What exists (credit where due)

| Area | Coverage today | File |
|---|---|---|
| Node trims exist, deterministic | cross trims > 0.3; straight joint trims = 0; acute bevel deterministic, trims ≤ miterLimit | `roads.test.ts:258–301` |
| Rendered mesh sanity | finite, deterministic byte-equal rebuild, centre covered, fixed lift set, zebra only at 3+ arms | `render/roads.test.ts:103–167` |
| Acute mouth coverage | arm-mouth points at d = 0.4/0.9/1.4 covered by asphalt triangles; no zero-area asphalt slivers (area > 1e-9) | `render/roads.test.ts:169–212` |
| Kerb placement | kerb points on/outside asphalt boundary in 4 scenarios (acute avenue, dead end, bend, cross+one-way T); SVG dumps written to `/tmp/junc2` | `render/roads.test.ts:214–259` |
| Sliver control | kerb-lift triangles: area > 1e-5 and min angle ≥ 5° | `render/roads.test.ts:261–282` |
| Vehicles on road | grid+diagonal routes: < 2% of sampled points off road *tiles*; `roundCorners` unit test | `traffic-corners.test.ts` |
| Corridor profiles | profile arithmetic vs `ROAD_DRAW_WIDTH`; offset lines at declared distances ±1e-3; tight curve finite | `corridor.test.ts:34–92` |

### Gaps (each is a rule-11 failure if junction.ts ships without it)

1. **No test of the thing 07 specifies.** There is no `junction.ts`, no `checkJunction`, and no test
   names a ring, a crosswalk quad, a connector or a boundary. Every 07:59–65 invariant is currently
   asserted *nowhere*: ring simplicity/CCW/nesting, fillet tangency, crosswalk ⊂ asphalt∪ribbon,
   sidewalk closure around convex corners, connector containment/curvature, rotation/arm-order
   invariance, full = incremental rebuild. (07:65's "100 random nodes < 10 ms" likewise.)
2. **Asphalt fan slivers untested** — the skinny-triangle test filters to kerb lift 0.078 only
   (`roads.test.ts:277`); the junction fan at 0.080 (the rejected blob's own triangles) has no
   area/angle floor, despite 07:62 requiring one for *all* triangles.
3. **Dead end asserts nothing about the cap.** The dead-end scenario exists only as an SVG dump inside
   the kerb test (`roads.test.ts:224–229`); no test checks cap closure, absence of interior arcs, or
   kerb/sidewalk wrap — the exact rejected defect ("open U, stray arc") can regress freely. Pads
   (zero-length segments) have no geometry test at all.
4. **The acute test measures but does not assert.** `acute-junction.test.ts:115–118` logs overlapping
   zoned cells and asserts only `cells.length > 20`; the comment at :115 concedes "the ADR 06 target
   is zero; this records the current state". Against rule 11(b) ("no overlaps") this is a known-red
   invariant left as a console log — the junction change that claims to fix acute arms must flip this
   to `overlappingPairs = 0` / `cellCentresInsideAsphalt = 0`, or say why not.
5. **Crosswalk quality untested beyond vertex colour counts.** `roads.test.ts:133–153` counts white
   vertices; nothing checks crosswalk position vs trim, containment on asphalt, stop-line
   inbound-only placement, dash stop/resume, or lift ordering (floating is a *height* defect; no test
   compares marking lift to the asphalt lift beneath it).
6. **Missing hard cases entirely:** Y at 25° as a *junction geometry* case (the acute tests cover
   zoning fallout, not rings), 5 arms, bulb dead end, curve-through-node, hill/slope node, bridge-ramp
   node, roundabout entries/yield, one-way arm stop-line side, avenue-through-T median continuity,
   short-segment pair (two junctions ≤1.66 tiles apart, §2.2), mixed-elevation node. The skill's list
   (SKILL.md:20–21) is the checklist; today roughly 4 of 12 cases have any geometry assertion.
7. **Invariance tests absent:** rotation (rebuild the same cross rotated 30° and compare rings up to
   rotation), arm-order permutation (`node.segs` insertion order shuffled), translation, and
   quantisation snap (ring vertices on the 1e-3 grid) — all required by 07:65, none present.
   Incumbent determinism tests compare a layout to itself (`roads.test.ts:294–295`), which cannot
   catch order-dependence.
8. **No SVG/screenshot evidence discipline.** `dumpSvg` (`roads.test.ts:68–91`) writes 4 scenarios to
   `/tmp/junc2` as a side effect of a kerb test — not asserted, not covering dead-end square/bulb,
   Y-25°, 5-arm or ramp, and not referenced by any report. Rule 11(c) visual pass (day+night, two
   zooms) is the lead's by AGENTS.md:63, but the agent-side deliverable — SVG dumps *of the hard
   cases* — should be an explicit test artifact list, not a by-product.
9. **Performance gate undefined in tests:** no timing test for 100 nodes (07:65) and no regression
   budget vs the iPad 10 ms rebuild (AGENTS.md:42). `junctionsOf` incremental equality (07:65) has no
   test because incremental is undefined (S2-1).
10. **Save/rebuild stability:** `rebuildNodes` round-trips exist (`roads.test.ts:218–257`), but no
    test asserts junction output (hash) is identical after a save/load cycle — the cheapest guard
    that the derived model stays derived (ADR 06:26).

Minimum test file to accompany `junction.ts` (contributor: write these *first*, they encode §1–§2):
`src/sim/junction.test.ts` with one describe per hard case above, each asserting the full
`checkJunction` invariant set plus case-specific numbers (e.g. 25° Y: `diagnostics` contains the
expected radius-shrink, ring simple, trims satisfy §2.2 budget against the actual segment lengths).

---

## 4. Prioritised implementation order for `src/sim/junction.ts`

Contributor-ready. Each step lands green (`npx tsc --noEmit`, `npx vitest run`) before the next;
steps 0–1 are *design* fixes — do not start geometry until they merge.

**P0 · Settle the three blockers in the docs (07 amendment + ADR 06 note).**
Decide and write down: (i) sidewalk home — recommended: keep `ROAD_DRAW_WIDTH` fixed, declare the
sidewalk as the outer part of the existing kerb band *visually* is **not** acceptable (07 demands a
ring); the honest option is widening the profile: `sidewalk` 0.12/0.16 added outside `drawHalf`,
`setback` recomputed as `ROAD_TILE_WIDTH/2 − (drawHalf + sidewalk)` floored at 0, with the street
consequence (0.50 − 0.57 < 0 ⇒ sidewalk overflows the tile into the setback — state that lots then
front at 0.57 + clearance, see §5) — whichever is chosen, one table in 07 and matching numbers in
`corridor.ts` (ii) acute construction replacing 07:46–47 (formula in §2.2: joint two-end shrink,
R floor 0.2, chamfer definition, diagnostic codes); (iii) elevation policy (per-layer layouts keyed by
node id + elevation; ground-only markings; bridge arms excluded from ground rings, ribbons run to
centre at ramp nodes). *Tests:* none (docs), but update `corridor.test.ts:41` expectation in the same
commit as the profile change, never before.

**P1 · Profile completion in `src/sim/corridor.ts`.**
Add per-type `sidewalk` (from the P0 decision), lane centre offsets (`laneCentres: number[]`, signed,
right-hand traffic stated), median half-width for avenue, and `layerOf(seg)` reuse of `segElevation`.
This extends ADR 06 step 1/2 rather than inventing constants in `junction.ts` (skill rule 2,
SKILL.md:15–16). *Tests:* profile table test per type; lane centres symmetric, inside asphaltHalf,
clear of median.

**P2 · Pure builder skeleton + checker, orthogonal cases only.**
`junction.ts`: types (`JunctionLayout`, `JunctionArm` with per-side arclength trims per layer,
quantised `Pt`), `buildJunction(world, nodeId)` handling `end` (square cap), `middle`, `bend`,
`transition`, and 3–4 arm junctions whose gaps are within 8° of the template angles, one shared fillet
routine (per-corner `R = max(R_a, R_b)`, offset-line intersection per arm's own h, §2.1.4).
`checkJunction(layout, world)` implementing 07:61–65 as amended (tangency tolerance 2e-3 post-quantise,
S2-2; arc step by sagitta ≤ 1e-3, §2.5). `junctionsOf(world)` as a *full* rebuild cached by
`graphRevision` (defer incremental to P7). *Tests:* `junction.test.ts` — 4-way street cross (four equal
returns, trims 0.83 ± quantise), T, bend, dead-end square; ring CCW/simple/nested; determinism;
rotation invariance at 30°.

**P3 · General angles: acute, reflex, 5+ arms, short segments.**
Gap-sorted general path: convex fillets, concave miters with named spike clamp, minimum-gap rule
(arms closer than 3°: diagnostic + treat wider arm's edge), the two-end trim budget solver of §2.2
(needs neighbour layouts — build per-node with segment-length context, not per-node isolation), R
shrink + chamfer + diagnostics from P0. Seam sweep test ±12° every 1° (S2-3). *Tests:* Y at 25°
(street and avenue+street), 5-arm, two crosses 1.0 and 1.66 tiles apart, duplicate-arm node; flip
`acute-junction.test.ts` overlap assertions to zero if the zoning side is in scope, else file the
follow-up explicitly (do not leave the log-only assertion claiming progress).

**P4 · Markings: crosswalks, stop lines, guide dashes, median termination.**
From P1 lane geometry: crosswalk inner edge at max(side trims), lateral extent kerb-face to kerb-face,
inbound-only stop lines (arm direction from `seg.oneWay/dir` + end), dash stop/resume around the
stack-up of §2.3, through-pair guide dashes (pair = arms within 8° of opposition, per-pair median rule
S3-3), suppression by profile/elevation (highway, bridge, tunnel, roundabout entries → yield dashes
instead). *Tests:* containment of every marking quad in asphalt∪ribbon (corridor-defined ribbon),
inbound-half check on a one-way arm, avenue+street T (avenue kerb straight across the mouth, median
continuous through, guide dashes present — the anti-"no markings through" test).

**P5 · Dead ends completed + curves.**
Bulb cap (clearance vs boundary, §5), U-wrap fillets from tip tangent, pad-node handling (zero-length
segment ⇒ square cap of profile width, replacing the renderer's 1×1 quad special case,
`render/roads.ts:737`), curved arms end-to-end (trims as offset-polyline arclengths from `corridor.ts`;
junction ring terminates on corridor offset points). *Tests:* square and bulb caps (closed rings, no
interior arc — assert no ring vertex strictly inside the asphalt ring except the cap edge), curved
junction seam ≤ 1e-3 against corridor offsets, curve-through-node classified `middle`.

**P6 · Elevation: ramp, bridge, tunnel, roundabout nodes.**
Per-layer layout selection (ground arms only for surface junctions, mirroring `groundArms`
`roads.ts:772`); bridge-arm nodes get no ground polygon (ribbon-to-centre) or a deck-Y polygon per the
P0 decision; tunnel arms excluded, portal contract with renderer; roundabout lookup via
`world.roundabouts` + `seg.roundabout`, yield dashes at entry arms, ring nodes classified so the ring
reads as circulation, not four junctions. *Tests:* ground×bridge crossing (no node, no geometry),
ramp-link node (no floating patch: every patch vertex Y = deck sampler Y at its (x,z) when the arm is
a bridge arm), tunnel crossing, stamped roundabout (island keep-out, entries).

**P7 · Consumers, caching, traffic — in dependency order.**
(a) Renderer: consume rings/markings from `junction.ts`; delete `nodePatch`/`junctionDebugGeometry`
fan + fallback radius and the `deadEnd` semicircle (`render/roads.ts:526–550, 599–692`) — keep
`nodeLayout` only as a shim until this lands, then delete `roads.ts:605–767` wholesale so two sources
of truth cannot drift. Enforce lift ordering from P0 (markings strictly above the asphalt beneath
them). (b) Lots/props: consume `boundary` + `lotAnchors`/`clearZones` (§5 formulas) — after P3/P4,
since anchors depend on final trims. (c) `junctionsOf` incremental rebuild with the 1-ring dirty set
(S2-1) + full=incremental test. (d) Traffic: connector lookup by (node, inArm, outArm), sampled
containment + curvature check in the builder, `routePath` consumes connectors at junction nodes,
`roundCorners` deleted; re-run `traffic-corners.test.ts` with the off-road threshold tightened from
tile-based 2% to connector-polygon containment. *Tests:* per consumer, plus 100-node < 10 ms timing
test with the fixture defined in P0, and save/load hash stability (§3.10).

**Explicitly not in scope for the contributor** (lead decisions, flag don't invent): grid/parallel
snapping tools, Clipper2 adoption (ADR 06:49 — tests may use `polygon-clipping` as oracle only),
any save-format change (junction output stays derived/unsaved, ADR 06:26).

---

## 5. ADR 06 step 4 (setback, junction clipping) vs the junction design

ADR 06 step 4 (ADR 06:34): "Parcels replace zone-block geometry (`lat0` at kerb + sidewalk + setback,
frontage slicing by arc length); interior lots are not generated", with acceptance (ADR 06:39–42):
parcels within 1e-3 of the setback distance, **zero parcel/corridor/junction polygon intersections**,
alignment continuous across junctions. Incumbent reality: `zoneblocks.ts:69–71, 91–93` computes
`hw = drawHalf + sidewalk(0) + setback`, `lat0 = hw + 0.5` (first cell *centre*; front edge at
`lat0 − 0.5 = hw`), and `s0` (longitudinal row origin) as `hw < 1 ? 0 : 0.5` — a constant with no
relation to any junction. Step 3 (ADR 06:33) promised to "clip cells and props against
`JunctionPolygon`"; that clipping does not exist in code today (no clip library in `package.json`;
`polygon-clipping` is sanctioned as test oracle only, ADR 06:49–50). Conflicts, ranked:

**C1 (S0) · Step 4's frontage line and 07's boundary disagree by construction near corners.**
Step 4 places parcel fronts on the *segment's* straight setback line. 07's `boundary`
(sidewalkOuter inflated by 0.10, 07:41, 49) is a *node* polygon whose corner arcs bulge diagonally
outside both arms' straight sidewalk edges. A parcel sliced by arc length along the segment (step 4)
with its front on the setback line will intersect the boundary near every corner unless its row start
is pushed past the boundary's longitudinal extent along that arm. 07's `lotAnchors` (07:26) is clearly
meant to be that push, but with no formula (§1, S2-4) step 4 as written cannot satisfy ADR 06:40's
zero-intersection acceptance. Required reconciliation (write it into both docs): per arm side,
`lotAnchor.s ≥ s_boundary`, where `s_boundary` is the maximum arclength along the corridor centreline
of any boundary vertex on that side, and parcels on one segment must satisfy *both* ends
(`s ∈ [anchorA, L − anchorB]`), which step 4's single-origin slicing (`zoneblocks.ts:93, 107`:
rows counted from `s0` in one direction) does not model — rows are also truncated at the far node.
This is the single largest hidden cost in 07: it changes `blocksForSegment`, not just `junction.ts`.

**C2 (S0) · The sidewalk decision (S0-1) moves `lat0`.**
Step 4's `lat0` is defined from kerb + sidewalk + setback. Today sidewalk = 0 and street setback =
0.05, so fronts sit at 0.50 from the centreline. If 07's sidewalk (0.12) is added outside the kerb,
the setback line that keeps lots off the sidewalk moves to ≥ 0.57 (+ 07's 0.10 boundary clearance ⇒
0.67 at junction corners vs 0.57 mid-block — itself a discontinuity step 4 must absorb, see C1). If
instead the sidewalk is carved from the asphalt, `asphaltHalf` shrinks and every lane/crosswalk
number in 07 changes. Either way ADR 06 step 4 cannot be implemented "as accepted" until 07's P0
decision lands; implementing step 4 first (its number precedes the junction work in no dependency
sense — ADR 06's own step 3 already depends on junction polygons) would bake in fronts that the
junction boundary then violates. Order: junction P0–P4 → step 4. ADR 06's step list (ADR 06:31–35)
implies 3 (junction) before 4 (parcels); 07 should say explicitly that step 4 is *blocked* on
`lotAnchors`, since a contributor reading ADR 06 alone will start at step 4's `lat0` formula.

**C3 (S1) · "Junction clipping" (step 3) has three candidate polygons in 07 and ADR names one.**
ADR 06:21, 33 speaks of a single `JunctionPolygon … with fillets`. 07 outputs four nested rings plus
`boundary` (07:24). Which one clips cells and props? Clipping parcels to the *asphalt* ring leaves
lots standing on the sidewalk ring; clipping to `boundary` is the only choice consistent with ADR
06:40 — but then mid-block parcels (front at setback line 0.50, street) and corner parcels (front
effectively at boundary 0.67 near the node) follow different rules, and step 4's "front edge within
1e-3 of the setback distance of its owning corridor" (ADR 06:39) is *false at corners by design*.
The acceptance line needs a corner exception ("except within `lotAnchor` of a node, where the
boundary governs"), or implementers will "fix" corner lots back onto the setback line and recreate
lots-touching-kerbs (SKILL.md:25). Props have the same issue via `clearZones` (undefined, S2-4):
signal/streetlight offsets (`corridor.ts:76`, drawHalf + 0.08) place poles inside the corner
sidewalk arc unless clipped by name.

**C4 (S1) · Arc-length slicing vs straight-ray trims disagree on curves.**
Step 4 slices frontage "by arc length" (ADR 06:34) — along the curved corridor. 07's trims/anchors,
if built on straight arm rays (the current text), are chord distances. On a curve these differ by the
κ·s²/2 family of errors (§2.4): a lotAnchor computed in ray distance and consumed in arc length
misplaces the first lot row by up to ~0.2 tile on tight curves, re-opening corner overlaps that
`acute-junction.test.ts` measures. Both docs must denominate longitudinal positions in *corridor
arclength from the node* — which also forces junction arms to be corridor sample chains (S0-4), not
rays. One shared convention, stated in 07, consumed by step 4.

**C5 (S2) · Highway and elevated segments: step 4 excludes them, 07 doesn't say.**
Parcels never front highways or elevated segments (`zoneblocks.ts:79–81`: ground only, base ≠ 3), so
07's highway boundary clearance 0.25 (07:41) has no parcel consumer — harmless, but 07's
`lotAnchors`/`clearZones` for highway/ramp arms would be dead output, and worse, a ramp node's
*ground* arms do front parcels while its bridge arm's boundary (drawn at ground by a naive builder,
S0-3) would wrongly sterilise them. State in 07: anchors/clear zones emitted only for ground, kerbed
arms; elevated arms contribute keep-out only in their own layer.

**C6 (S2) · Determinism of the intersection oracle.**
ADR 06:40 demands zero intersections "independent check with a polygon clipping library" and ADR
06:49–50 reserves Clipper2 for production, `polygon-clipping` for tests. Neither is in
`package.json` today. 07's `checkJunction` is self-checking geometry (a builder checking itself can
share its own bug — cf. the review rule that a check built from the assumption under test proves
nothing). Budget the test-only oracle dependency as part of P3/P7, or the zero-intersection
acceptance for step 4 remains unverifiable and `acute-junction.test.ts` stays a log file (§3.4).

---

## Appendix — incumbent behaviours that must not survive the rewrite

| Rejected visual | Incumbent cause (file:line) | 07 clause that must kill it |
|---|---|---|
| Octagon blob at 4-way | centre fan + fallback radius `l.radius*0.55`; global R=0.25 street | `render/roads.ts:629–633, 686–691`; `roads.ts:673` → per-corner R (07:37,45), no invented geometry (S1-2) |
| Floating crosswalks | zebra centre at trimK+0.1 overlapping raised patch; lift 0.004 < patch 0.02; full-width stop line | `render/roads.ts:557, 563–591`; lifts `roads.ts`/`render/roads.ts:14–17` → 07:50–51 + lift contract (S1-3, S2-5) |
| Open U dead end, stray kerb arc | semicircle fan + annulus beyond tip; pad quad special case | `render/roads.ts:526–550, 732–740` → 07:54 square/bulb caps (S1-5) |
| No sidewalk wrap | `sidewalk: 0`; kerb strips only between corners, dropped when inside asphalt | `corridor.ts:67, 88`; `render/roads.ts:644–661` → concentric rings (07:48) after P0 (S0-1) |
| No markings through junction | dashes stop at ribbon trims; patch covers centre; no guide dashes exist | `render/roads.ts:300–327, 665–692` → 07:52 guide dashes (S1-4) |
| Acute-arm notches | trim clamped to miterLimit, arc dropped when `beveled` | `roads.ts:735–749`; `render/roads.ts:612` → acute construction (S0-2) |
| Car corner cutting | (1,2,1)² blur on tile routes, carriageway-agnostic | `traffic.ts:367–384` → connectors replace `roundCorners` (07:28, 55) with containment invariant (§2.7) |

*End of report.*
