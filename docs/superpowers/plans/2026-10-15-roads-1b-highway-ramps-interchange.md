# Roads 1B — Highway, Ramps, Interchange and Vehicles in Lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The highway reads and behaves as one 3+3 road with a real central barrier and lights, a ramp road class
joins it through merge/diverge gores, the "Trevo" tool builds a diamond interchange with two entries and two exits
through the planner, and every vehicle drives in a real lane.

**Architecture:** Type 6 (ramp) is added to `ROAD_SPECS` and every type enumeration. Ramps are the only class that may
meet a highway at grade, at a shallow angle; such nodes get a new junction kind `"merge"`/`"diverge"` (gore, through
lanes kept, ramp lane tied to the outer lane). A pure `planInterchange` lays the diamond with ramp terminals on the
ground part of the cross road. Vehicle routes are offset into a lane in the simulation (`routePath` with a lane index),
so the renderer no longer adds a fixed lateral shift.

**Tech Stack:** TypeScript, Three.js, Vitest, Python 3 + PIL/numpy (`blender/make_road_atlas.py`).

**Spec:** `docs/process/26-roads-cycle1.md` section 6 (1B) and section 8; 1A result in section 11. Base: `main` at
`18a5b89`.

## Deviation from the spec (owner to confirm when reviewing this plan)

Spec 6.3 says a ramp "may climb ... from the highway grade to the deck height of the cross road". Today a bridge
segment always takes both end heights from the terrain (`makeDeckSampler`, `bridgeProfile` in `world.ts:749-781`);
there is no per-segment end height, so a ramp that lands on a deck is a new elevation model. This plan builds the
standard **diamond with at-grade terminals**: the cross road already rises over the highway on its own bridge (auto
grade separation) and comes back to the ground; ramp terminals are ordinary junctions on that ground part. No ramp
climbs. Climbing ramps (needed later for flyovers and cloverleafs) become a separate task with an end-height field on
`RoadSegment`.

## Global Constraints

- 1 tile = 8 m. Widths in tiles.
- Road type ids 1-5 never change; type 6 = ramp is new; old saves load; saves with type 6 do not open in builds before
  this cycle (CHANGELOG note).
- Ramp spec: 1 lane, laneWidth 0.45, shoulder 0.20, no kerb, no sidewalk, drawWidth 0.85, tileWidth 1, one-way,
  speed 5, capacityPerLane 5, cornerRadius 0.45, clearance 0.25, rank 5, cost 60, upkeep 9, median "none",
  junctionMarkings true (only where it lands on a city road; none at merge/diverge).
- A ramp may meet a highway at grade only at an angle between 10° and 30°; city roads (1, 2, 4, 5) still never meet a
  highway at grade ("Highways need an interchange").
- Highway barrier: concrete Jersey profile 0.10 tile tall (≈0.8 m), base width 0.12, top width 0.05, centred on the
  median; merged into the road mesh with the PLAIN class; no per-segment draw call.
- Highway lights: twin-arm lamp on the barrier every 3 tiles of highway; ramps get a single lamp on the outer edge every
  3 tiles; reuse `lampMesh` and `streetLightFx` capacity.
- Vehicles: lane = deterministic per vehicle (`id % lanesInDirection`), trucks and buses use the rightmost lane;
  render adds no lateral offset; `updateVehicles`, `placeVehicle`, `vehicleSampleY` stay allocation-free
  (`scene-vehicles.test.ts`).
- Gore: chevron paint, solid line along the gore edges, dashed line along the merge length; merge length
  `clamp(6 * rampAsphaltHalf / tan(angle), 2, 8)` tiles.
- `npx tsc --noEmit` clean; `npm run ci` green with the default test timeout after every task.
- iPad budget: rebuild < 10 ms warm on the dense test grid; no per-frame allocation.
- UI strings through `src/i18n.ts` (English text as key, PT dictionary).
- Commits on `agent/*` branches in `/tmp/mayor-wt/<name>`; `main` only on the owner's request.

## Review Focus

1. A ramp drawn against the highway's travel direction (an entry merging into the wrong carriageway): expect the
   planner to refuse with "Ramp joins the highway against its direction". Test in Task 3.
2. Bulldozing one ramp of an interchange: the remaining ramps, the highway and the cross road keep valid junctions
   (no orphan merge node, no throw). Test in Task 6.
3. Interchange where a terminal would land on water, a building or within 4 tiles of another junction: refused with a
   reason, nothing built, money unchanged, undo stack unchanged. Test in Task 6.
4. Old save with the 1A-era flat type-4 diamond: loads, renders, and the new interchange tool can still be used beside
   it. Test in Task 6.
5. Vehicles entering a junction from a lane-offset route: the spliced connector starts on the vehicle's lane (no
   sideways jump > 0.05 tile at the connector start). Test in Task 7.

---

## Ownership and order

| Task | Content | Owner | Exclusive files | After |
|---|---|---|---|---|
| 1 | Ramp type plumbing | Lead | `roadprofile.ts`, `world.ts`, `corridor.ts`, `elevation.ts`, `save.ts`, `sim.ts:623`, `inspect.ts`, `props.ts`, `lanes.ts:34`, `junction.ts:1756`, `hud.ts:112,575-578`, `i18n.ts`, tests enumerating types | – |
| 2 | Ramp atlas texture and render class | Implementer A | `scripts/export-road-profiles.ts`, `blender/make_road_atlas.py`, `public/textures/road/*`, `road-material.ts`, `render/roads.ts` (`ROAD_CLASS`, `roadClassFor`) | 1 |
| 3 | Crossing and planner rules for ramps | Implementer B | `crossings.ts`, `sim.ts` planRoad, `roads.ts` placementIssue angle, `road-snap.ts` connectable | 1 |
| 4 | Merge/diverge junction kind | Implementer B | `junction.ts`, `lanes.ts` | 3 |
| 5 | Highway barrier, gore paint, highway and ramp lights | Implementer A | `render/roads.ts`, `render/scene.ts` lamp loop | 2, 4 |
| 6 | Diamond interchange through the planner | Implementer B | new `src/sim/interchange.ts`, `main.ts` stampInterchangeAt, `tool-state.ts` hint, `dev/scenario.ts` case E | 4 |
| 7 | Vehicles in lanes | Implementer C | `traffic.ts` routePath/planLeg, `render/scene.ts` updateVehicles | 1 (parallel with 2-6; scene.ts lamp loop vs vehicle code: different functions, merge with --3way) |
| 8 | Scenario, captures, gate, docs | Lead | `dev/scenario.ts` new shots, docs | all |

---

### Task 1: Ramp type plumbing (type 6)

**Files:**
- Modify: `src/sim/world.ts:122-136` (`ROAD`, `RoadType`, `isOneWayType`, `baseRoadType`, add `isMotorway`)
- Modify: `src/sim/roadprofile.ts:47-67` (add entry 6)
- Modify: `src/sim/corridor.ts:54-60`, `src/sim/elevation.ts:4`, `src/sim/save.ts:193`, `src/sim/sim.ts:623`,
  `src/sim/inspect.ts:40`, `src/sim/props.ts:89,122,129,130,140`, `src/sim/traffic.ts:290`, `src/sim/lanes.ts:34`,
  `src/sim/junction.ts:1756`, `src/render/roads.ts:74`, `src/ui/hud.ts:112,575-578`, `src/i18n.ts`
- Modify: `src/sim/world.ts:474`, `src/sim/blocks.ts:82,133,141,256`, `src/sim/orientedlots.ts:322`,
  `src/sim/zone-oracle/orientedlots.ts:327`, `src/sim/zoneblocks.ts:135`, `src/sim/zone-oracle/zoneblocks.ts:155`,
  `src/sim/traffic.ts:1239`, `src/sim/transit.ts:35` (use `isMotorway` where the rule is "no frontage / no stops")
- Test: `src/sim/ramp-type.test.ts`; update `roadprofile.test.ts`, `corridor.test.ts`, `roadprofile-consumers.test.ts`,
  `src/ui/road-facts.test.ts` type lists

**Interfaces:**
- Produces:
  ```ts
  export const ROAD = { NONE: 0, STREET: 1, AVENUE: 2, HIGHWAY: 3, ONEWAY_STREET: 4, ONEWAY_AVENUE: 5, RAMP: 6 } as const;
  export type RoadType = 1 | 2 | 3 | 4 | 5 | 6;
  export const ROAD_TYPES: readonly RoadType[] = [1, 2, 3, 4, 5, 6];
  export const isOneWayType = (t: RoadType): boolean => t === 4 || t === 5 || t === 6;
  /** Class a road draws and behaves like; the ramp is its own base. */
  export const baseRoadType = (t: RoadType): 1 | 2 | 3 | 6 => (t === 4 ? 1 : t === 5 ? 2 : t);
  /** Roads without frontage, stops or street furniture: highway and ramp. */
  export const isMotorway = (t: number): boolean => t === 3 || t === 6;
  ```
  `ROAD_SPECS[6]` as in Global Constraints with `nameKey: "Ramp"`, `descKey: "Ramp, 1 lane with shoulders. Joins a highway at a shallow angle."`,
  `thumb: "/ui/thumbs/rd-ramp.jpg"`. `BRIDGE_SPAN_LIMIT[6] = 12`.

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/ramp-type.test.ts
import { describe, expect, it } from "vitest";
import { ROAD, ROAD_TYPES, baseRoadType, isMotorway, isOneWayType, ROAD_COST, ROAD_DRAW_WIDTH } from "./world";
import { derive, specOf, rankOf } from "./roadprofile";
import { profileOf } from "./corridor";
import { ROAD_CAPACITY } from "./traffic";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad } from "./sim";
import { serialize, deserialize } from "./save";

describe("ramp road type 6", () => {
  it("has the spec values", () => {
    const s = specOf(6), d = derive(6);
    expect(ROAD.RAMP).toBe(6);
    expect(ROAD_TYPES).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.lanesPerDir).toEqual([1, 0]);
    expect(s.laneWidth).toBe(0.45);
    expect(s.shoulder).toBe(0.2);
    expect(s.kerb + s.sidewalk).toBe(0);
    expect(2 * d.drawHalf).toBeCloseTo(0.85, 9);
    expect(ROAD_DRAW_WIDTH[6]).toBe(0.85);
    expect(ROAD_CAPACITY[6]).toBe(5);
    expect(ROAD_COST[6]).toBe(60);
    expect(rankOf(6)).toBe(5);
    expect(isOneWayType(6)).toBe(true);
    expect(baseRoadType(6)).toBe(6);
    expect(isMotorway(6) && isMotorway(3) && !isMotorway(2)).toBe(true);
    expect(profileOf(6).laneCentres).toEqual([0]);
  });

  it("a ramp between two streets saves and loads", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 6, [{ x: 20.5, z: 30.5 }, { x: 30.5, z: 30.5 }]).ok).toBe(true);
    const b = deserialize(serialize(s));
    expect(b.world.segments.find((g) => g.type === 6)).toBeTruthy();
  });

  it("ramps give no frontage: no lots zone along a lone ramp", () => {
    const s = blankShowcaseCity();
    placeRoad(s, 6, [{ x: 20.5, z: 30.5 }, { x: 34.5, z: 30.5 }]);
    const w = s.world;
    for (let x = 22; x < 33; x++) for (const z of [29, 31]) expect(w.lotAt[z * w.size + x] ?? 0).toBe(0);
  });
});
```

Use the real save function names from `src/sim/save.ts` (`serialize`/`deserialize` per the 1A tests) and the real
showcase helper; adapt the frontage assertion to the zoning API the existing highway-frontage test uses (search
`isServed` tests) if `lotAt` is not the right probe — keep the intent "a ramp gives no frontage".

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/ramp-type.test.ts`
Expected: FAIL — `ROAD.RAMP` undefined / `specOf(6)` undefined.

- [ ] **Step 3: Implement**

1. `world.ts`: the Interfaces block above; replace `[1,2,3,4,5]` literals in `save.ts:193` and `sim.ts:623` by
   `ROAD_TYPES.includes(...)`.
2. `roadprofile.ts`: add the 6 entry:
   ```ts
   6: { type: 6, nameKey: "Ramp", descKey: "Ramp, 1 lane with shoulders. Joins a highway at a shallow angle.",
     thumb: "/ui/thumbs/rd-ramp.jpg", tileWidth: 1, drawWidth: 0.85, oneWay: true, lanesPerDir: [1, 0],
     laneWidth: 0.45, medianHalf: 0, median: "none", shoulder: 0.2, kerb: 0, sidewalk: 0, speed: 5,
     capacityPerLane: 5, cornerRadius: 0.45, clearance: 0.25, rank: 5, cost: 60, upkeep: 9, junctionMarkings: true },
   ```
3. `corridor.ts` PROFILES: add `6: makeProfile(6)` (or build from `ROAD_TYPES`). `elevation.ts`: `6: 12`.
4. One-way checks at `lanes.ts:34`, `junction.ts:1756`, `render/roads.ts:74`: replace `a.type === 4 || a.type === 5`
   by `isOneWayType(a.type)`.
5. Frontage/zoning/stops/furniture (`world.ts:474`, `blocks.ts`, `orientedlots.ts` ×2, `zoneblocks.ts` ×2,
   `traffic.ts:1239`, `transit.ts:35`, `props.ts:89,140`): where the code tests `ROAD.HIGHWAY` or `baseRoadType(..) === 3`
   to mean "no frontage / no stop / no furniture", use `isMotorway(type)`. Leave the other `=== 3` uses (at-grade
   highway rule, A* heuristic) to Task 3.
6. Casts `as 1 | 2 | 3 | 4 | 5` (`traffic.ts:290`, `props.ts:122,129,130`) → `as RoadType`.
7. `inspect.ts:40`: `const ROAD_PT` → use `tr(ROAD_NAME[t])` for every type (fixes 4/5 too).
8. `hud.ts:112` `ROAD_GLYPH[6] = "↗"`; `hud.ts:575-578`: iterate `ROAD_TYPES` and take thumbnails from
   `specOf(t).thumb` (delete the hard-coded array); ramp is listed after the highway.
9. `i18n.ts` PT: `"Ramp": "Alça"`, the descKey → `"Alça, 1 faixa com acostamento. Liga à rodovia em ângulo raso."`.
10. Update test type lists (`TYPES` in roadprofile/corridor/consumers/road-facts tests) to include 6 and the pinned
    literal arrays (capacity `[4, 10, 30, 4, 10, 5]`, rank order `[1, 4, 2, 5, 6, 3] → [1, 2, 3, 4, 5, 6]`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/sim/ramp-type.test.ts src/sim/roadprofile.test.ts src/sim/corridor.test.ts src/sim/roadprofile-consumers.test.ts src/ui/road-facts.test.ts && npx tsc --noEmit && npm run ci`
Expected: PASS. (`road-profiles-json.test.ts` stays green because the exporter skips types without a stem until Task 2.)

- [ ] **Step 5: Commit**

```bash
git add -A src && git commit -m "feat(roads): ramp road type 6 (spec, plumbing, saves, no frontage)"
```

---

### Task 2: Ramp atlas texture and render class

**Files:**
- Modify: `scripts/export-road-profiles.ts:4-10` (STEM `6: "road_ramp"`)
- Modify: `blender/make_road_atlas.py:202-214` (add `road_ramp` to the loop and contact sheet)
- Create: `public/textures/road/road_ramp.png`; regenerate `profiles.json` (`npm run roads:profiles`)
- Modify: `src/render/roads.ts:53-71` (`ROAD_CLASS.RAMP = 11`, `roadClassFor`), `src/render/road-material.ts:124-164,211-219,256-314`
- Test: `src/render/road-material.test.ts`, `src/render/roads.test.ts:337-343`, `src/render/road-profiles-json.test.ts`

**Interfaces:**
- Consumes: `ROAD_SPECS[6]` (Task 1).
- Produces: `ROAD_CLASS.RAMP === 11`; `roadClassFor(6, dirSign) === ROAD_CLASS.RAMP`; shader uniform `uTexRamp`;
  `RoadAtlasMaps.ramp`.

- [ ] **Step 1: Write the failing tests**

```ts
// add to src/render/roads.test.ts (roadClassFor block)
it("ramps draw with their own atlas class", () => {
  expect(ROAD_CLASS.RAMP).toBe(11);
  expect(roadClassFor(6, 1)).toBe(ROAD_CLASS.RAMP);
  expect(roadClassFor(6, -1)).toBe(ROAD_CLASS.RAMP);
});
// add to src/render/road-material.test.ts
it("the shader samples the ramp texture for class 11 and keeps PLAIN for 10", () => {
  const src = roadShaderSourceForTests();               // existing helper used by the PLAIN/rain assertions
  expect(src).toMatch(/vRoadClass\s*>\s*10\.5[\s\S]*uTexRamp/);
  expect(src).toMatch(/uWet/);                           // ramps get wet darkening like ribbons
});
```

If the existing material test reads the shader through another accessor, use that accessor; keep both regexes.

- [ ] **Step 2: Run** `npx vitest run src/render/roads.test.ts src/render/road-material.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

1. STEM map `6: "road_ramp"`; run `npm run roads:profiles` (writes JSON through the freshness test).
2. `make_road_atlas.py`: add `"road_ramp"` to the generation tuple and the contact sheet list; `cross_section` already
   draws shoulders (white solid edge lines at `±(asphaltHalf − shoulder)`) and no kerb when `kerb+sidewalk == 0`; one
   lane → no lane dashes. Run `python3 blender/make_road_atlas.py`; every file `[OK ]` < 400 KB.
3. `road-material.ts`: add `["ramp", "/textures/road/road_ramp.png"]`, `RoadAtlasMaps.ramp`, uniform `uTexRamp`; in the
   fragment shader test `vRoadClass > 10.5` first (ramp texture), then `> 9.5` PLAIN; extend the wet/traffic gates so
   class 11 is treated like a ribbon (`isRibbon = step(vRoadClass, 6.5) + step(10.5, vRoadClass)`), PLAIN unchanged.
4. `roads.ts`: `ROAD_CLASS.RAMP: 11`; `roadClassFor`: `if (type === 6) return ROAD_CLASS.RAMP;` before the base switch.

- [ ] **Step 4: Run** `npx vitest run src/render && npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(roads): ramp atlas texture and render class"`

---

### Task 3: Crossing and planner rules for ramps

**Files:**
- Modify: `src/sim/crossings.ts:135-208` (interior and endpoint rules)
- Modify: `src/sim/sim.ts` planRoad (`:375-377` interchange refusal; new direction rule), `planRoadUpgrade:646-663`
- Modify: `src/sim/roads.ts:565,715,721` (angle rule exemption)
- Modify: `src/ui/road-snap.ts:171-175` (`connectable`)
- Modify: `src/i18n.ts` (two reasons)
- Test: `src/sim/ramp-rules.test.ts`

**Interfaces:**
- Consumes: `isMotorway`, `ROAD.RAMP` (Task 1).
- Produces:
  ```ts
  // crossings.ts
  export const RAMP_MIN_ANGLE_DEG = 10;
  export const RAMP_MAX_ANGLE_DEG = 30;
  export const RAMP_ANGLE_REASON = "Ramps join a highway at 10 to 30 degrees";
  export const RAMP_DIRECTION_REASON = "Ramp joins the highway against its direction";
  /** Angle in degrees between the ramp's end tangent and the highway at the contact, 0..90. */
  export function rampContactAngle(w: World, rampPts: Pt[], end: "a" | "b", hwSegId: number): number;
  ```
  Rules: an endpoint of a type-6 piece on a ground highway is a `"junction"` crossing when the angle is within
  [10°, 30°] and the ramp's travel direction is compatible (an exit leaves along the highway's travel direction on
  that side; an entry arrives along it); otherwise blocked with the reasons above. Types 1, 2, 4, 5 keep
  "Highways need an interchange". A ramp crossing a highway's interior keeps the overpass/underpass rule.
  Direction rule (right-hand traffic): the highway carriageway on the RIGHT of travel a→b is the +offset side. A ramp
  whose contact point is on the + side of the highway centreline must travel with a→b; on the − side with b→a; the
  ramp's own travel direction at that end is "leaving" (exit/diverge) when the contact is its start (end "a" with
  dir 1) and "arriving" (entry/merge) when it is its end.

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/ramp-rules.test.ts
import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad, planRoad } from "./sim";
import { INTERCHANGE_REASON, RAMP_ANGLE_REASON, RAMP_DIRECTION_REASON } from "./crossings";

const P = (x: number, z: number) => ({ x, z });
function hw() {
  const s = blankShowcaseCity();
  expect(placeRoad(s, 3, [P(10.5, 40.5), P(70.5, 40.5)]).ok).toBe(true); // eastbound carriageway on +z side
  return s;
}
// Exit on the eastbound side: starts on the highway, leaves at ~20° to the south-east.
const exitPts = [P(30.5, 40.5), P(36, 41.6), P(40.5, 44.5)];

describe("ramp rules", () => {
  it("a street still cannot end on a highway", () => {
    const s = hw();
    expect(planRoad(s, 1, [P(30.5, 48.5), P(30.5, 40.5)]).reason).toBe(INTERCHANGE_REASON);
  });
  it("a ramp leaving the eastbound side at ~20° is accepted as a junction", () => {
    const s = hw();
    const plan = planRoad(s, 6, exitPts);
    expect(plan.ok).toBe(true);
    expect(plan.crossings!.some((c) => c.kind === "junction" && c.atEnd)).toBe(true);
  });
  it("a ramp at 60° is refused with the angle reason", () => {
    const s = hw();
    expect(planRoad(s, 6, [P(30.5, 40.5), P(35.5, 49.1)]).reason).toBe(RAMP_ANGLE_REASON);
  });
  it("an exit drawn toward the highway on the eastbound side (arriving against traffic) is refused", () => {
    const s = hw();
    // Same geometry, stroke reversed: it would ENTER heading west into the eastbound carriageway.
    expect(planRoad(s, 6, exitPts.slice().reverse()).reason).toBe(RAMP_DIRECTION_REASON);
  });
  it("an entry on the eastbound side arriving heading east is accepted", () => {
    const s = hw();
    expect(planRoad(s, 6, [P(20.5, 44.5), P(25, 41.6), P(30.5, 40.5)]).ok).toBe(true);
  });
  it("a ramp may end on a street normally", () => {
    const s = hw();
    placeRoad(s, 1, [P(40.5, 44.5), P(40.5, 56.5)]);
    expect(planRoad(s, 6, exitPts).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/sim/ramp-rules.test.ts` — Expected: FAIL (ramp refused with INTERCHANGE_REASON).

- [ ] **Step 3: Implement**

1. `crossings.ts` endpoint branch (`:172-208`): when `onHighway && level === "ground"`:
   - if `type !== ROAD.RAMP` → blocked "interchange" (unchanged);
   - else compute `rampContactAngle`; outside [10, 30] → blocked with `blockedReason: "ramp-angle"`; direction check
     → blocked `"ramp-direction"`; else push a `"junction"` crossing with `atEnd: true`.
   `rampContactAngle`: tangent of the ramp at that end (`pts[1]-pts[0]` or `pts[n-1]-pts[n-2]`), highway tangent at the
   nearest point of segment `hwSegId` (`nearestOnLine` on its centreline), angle = `acos(|t1·t2|)` in degrees.
   Direction: `side = sign(cross(hwTangent_ab, contact→rampFarPoint))` (+1 = right of a→b); ramp travel at the
   contact is "leaving" for end "a" (one-way dir 1); require `side > 0 ⇔ (leaving ? ramp heads along a→b : ramp arrives along a→b)`,
   where "heads along a→b" = `dot(rampTangentOfTravel, hwTangent_ab) > 0`.
2. Interior highway crossings by a ramp: unchanged (overpass/underpass or blocked near the end).
3. `sim.ts` planRoad: map `blockedReason` `"ramp-angle"` → `RAMP_ANGLE_REASON`, `"ramp-direction"` → `RAMP_DIRECTION_REASON`.
4. `roads.ts` placementIssue: the `MIN_CROSSING_ANGLE_DEG = 20` "angle" issue does not apply between a type-6 arm and a
   type-3 arm (they meet at 10-30° by design); keep it for every other pair.
5. `road-snap.ts` `connectable`: `!hw || baseRoadType(type) === 3 || type === ROAD.RAMP`.
6. `planRoadUpgrade:646-663`: an endpoint node with a highway arm may also have ramp arms; still refuse city types.
7. `i18n.ts` PT: `"Ramps join a highway at 10 to 30 degrees": "Alças ligam à rodovia entre 10 e 30 graus"`,
   `"Ramp joins the highway against its direction": "A alça entra na rodovia na contramão"`.

- [ ] **Step 4: Run** `npx vitest run src/sim/ramp-rules.test.ts src/sim/crossings.test.ts src/sim/grade-separation.test.ts src/ui && npm run ci` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -am "feat(roads): ramps may join a highway at 10-30 degrees in its direction"`

---

### Task 4: Merge/diverge junction kind

**Files:**
- Modify: `src/sim/junction.ts` (`JunctionKind`, `classify` :734, new `buildGore`, `KNOWN_CODES` :1770)
- Modify: `src/sim/lanes.ts` (connector mapping for gores)
- Test: `src/sim/junction-gore.test.ts`

**Interfaces:**
- Consumes: Task 3 contacts (a ramp end on a highway node or T-split).
- Produces:
  ```ts
  export type JunctionKind = "end" | "middle" | "bend" | "transition" | "taper" | "merge" | "diverge" | "junction" | "roundabout" | "non-ground";
  // JunctionLayout gains:
  gore?: {
    rampArm: number;          // arm index of the ramp
    side: -1 | 1;             // highway side in the highway a→b frame (+1 = right of a→b)
    length: number;           // merge length along the highway, tiles
    noseStation: number;      // distance from the node along the highway where the ramp edge leaves the shoulder
    outerLane: number;        // highway lane index (left→right of travel) the ramp joins
  };
  ```
  Classification: exactly 3 ground arms, two of type 3 collinear within 10° (the highway), the third of type 6 at
  10-30° to one of them. `"diverge"` when the ramp is outbound from the node, `"merge"` when inbound.

Geometry recipe (`buildGore`):
1. Highway arms keep full ribbons (trims 0 on the side away from the ramp). On the ramp side, the highway asphalt pad is
   the rectangle from station 0 to `length` (along the arm the ramp follows) and lateral `[asphaltHalf_hw − shoulder_hw,
   asphaltHalf_hw + rampWidth]`, unioned with the ramp wedge until the ramp's own edge clears the highway edge
   (`noseStation = (asphaltHalf_hw + rampAsphaltHalf) / tan(angle)`, clamped ≥ 1); `length = clamp(6·rampAsphaltHalf/tan(angle), 2, 8)`.
2. The ramp ribbon is trimmed to `noseStation`; the highway ribbon on the ramp side is trimmed to `length` on its
   outer band only (shoulder line ends, dashed merge line drawn by Task 5).
3. Rings: asphalt (pad polygon), no kerb/sidewalk (both classes have none), boundary = asphalt + clearance.
4. Connectors: through lanes of both highway directions map straight (leftAligned, all lanes); ramp lane ↔ the
   rightmost highway lane in the ramp's direction (`outerLane`); no other movements; no U-turns. Every connector must
   stay inside the asphalt ring (existing containment rule).
5. No crosswalks, stop lines, signals, priority box: set `markingsSuppressed` on every arm; `hasSignal` false.
6. `KNOWN_CODES` += `"gore-clamped"` (emitted when `length` or `noseStation` hit a clamp).

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/junction-gore.test.ts
import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad } from "./sim";
import { junctionsOf, checkJunction } from "./junction";
import { pointInPolygon } from "./lanes";

const P = (x: number, z: number) => ({ x, z });
function build(entry: boolean) {
  const s = blankShowcaseCity();
  placeRoad(s, 3, [P(10.5, 40.5), P(70.5, 40.5)]);
  const pts = entry ? [P(20.5, 44.5), P(25, 41.6), P(30.5, 40.5)] : [P(30.5, 40.5), P(36, 41.6), P(40.5, 44.5)];
  expect(placeRoad(s, 6, pts).ok).toBe(true);
  const l = [...junctionsOf(s.world).byNode.values()].find((x) => x.kind === (entry ? "merge" : "diverge"))!;
  return { s, l };
}

describe("merge and diverge gores", () => {
  for (const entry of [false, true]) {
    it(`${entry ? "merge" : "diverge"}: kind, rings, connectors`, () => {
      const { s, l } = build(entry);
      expect(l).toBeTruthy();
      expect(checkJunction(s.world, l).filter((d) => d.severity === "error")).toEqual([]);
      expect(l.gore!.side).toBe(1);                        // eastbound carriageway is the +z side
      expect(l.gore!.length).toBeGreaterThanOrEqual(2);
      // Ramp lane connects only to the outer eastbound lane.
      const ramp = l.gore!.rampArm;
      const rampConns = l.connectors!.filter((c) => (entry ? c.inArm === ramp : c.outArm === ramp));
      expect(rampConns).toHaveLength(1);
      // Through lanes: 3 each way, straight.
      const through = l.connectors!.filter((c) => c.inArm !== ramp && c.outArm !== ramp);
      expect(through).toHaveLength(6);
      for (const c of l.connectors!) for (const p of c.points) expect(pointInPolygon(p, l.asphalt)).toBe(true);
      expect(l.arms.every((a) => a.markingsSuppressed)).toBe(true);
    });
  }
});
```

Use the diagnostic filter that `junction-taper.test.ts` uses if `severity` is not a field.

- [ ] **Step 2: Run** — Expected: FAIL (kind is "junction").
- [ ] **Step 3: Implement** the recipe above; route the 3-arm classification to `buildGore` before the general
  junction path; add `gore` to `hashLayout` inputs.
- [ ] **Step 4: Run** `npx vitest run src/sim/junction-gore.test.ts src/sim/junction*.test.ts src/sim/showcase-gate.test.ts src/sim/lanes*.test.ts && npm run ci` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(roads): merge and diverge gores where a ramp meets a highway"`

---

### Task 5: Highway barrier, gore paint, highway and ramp lights

**Files:**
- Modify: `src/render/roads.ts` (`ribbon` highway branch, new `jerseyBarrier`, `drawGoreMarks`, `medianNoses`)
- Modify: `src/render/scene.ts:1123-1150` (lamp loop)
- Test: `src/render/roads-highway.test.ts`

**Interfaces:**
- Consumes: `layout.gore` (Task 4), `ROAD_CLASS.PLAIN`, `box`/`vertFast`, `lampMesh`, `streetLightFx`.
- Produces: `export function highwayLampPositions(w: World): { x: number; z: number; yaw: number; twin: boolean }[]`
  (pure, in `src/render/roads.ts` or a new `src/render/highway-lights.ts`), used by the scene lamp loop.

Recipe:
1. Jersey barrier along every ground and bridge highway segment, centred at offset 0, profile (lateral, height):
   `(±0.06, 0) → (±0.045, 0.03) → (±0.025, 0.10)` plus a flat top; one quad strip per face per sample row (reuse the
   ribbon's stations so it follows curves and decks); PLAIN class, `CONCRETE`; stops `medianHalf` before junction and
   gore mouths and closes with an end cap; merged in the road geometry.
2. Gore paint (`drawGoreMarks`, MARK_LIFT, white): solid lines along both gore edges from the nose to the node, three
   chevrons inside the gore triangle, dashed line (0.3 on / 0.3 off) along the ramp-side outer lane boundary over
   `gore.length`.
3. Lights: `highwayLampPositions` walks each highway segment and emits a twin-arm lamp on the barrier every 3 tiles
   (`twin: true`), and each ramp segment a single lamp at `asphaltHalf + 0.15` on its outer side every 3 tiles; skip
   positions within 1.0 of a junction centre. The scene lamp loop places these after the street lamps, sharing the
   InstancedMesh capacity (stop when full) and `streetLightFx.add`. Twin lamps: two instances rotated 180°.

- [ ] **Step 1: Write the failing test**

```ts
// src/render/roads-highway.test.ts
import { describe, expect, it } from "vitest";
import { buildRoadNetworkGeometry, ROAD_CLASS } from "./roads";
import { highwayLampPositions } from "./roads";
import { blankShowcaseCity } from "../sim/showcase-cases";
import { placeRoad } from "../sim/sim";

const P = (x: number, z: number) => ({ x, z });
describe("highway structure", () => {
  it("a straight highway has a Jersey barrier 0.10 tall on the median, plain class, both tiers", () => {
    for (const atlas of [true, false]) {
      const s = blankShowcaseCity();
      placeRoad(s, 3, [P(10.5, 40.5), P(40.5, 40.5)]);
      const geo = buildRoadNetworkGeometry(s.world, () => 0, { atlas });
      const pos = geo.getAttribute("position"), cls = geo.getAttribute("roadClass");
      let top = 0, n = 0;
      for (let i = 0; i < pos.count; i++) {
        if (cls.getX(i) !== ROAD_CLASS.PLAIN) continue;
        if (Math.abs(pos.getZ(i) - 40.5) > 0.07) continue;
        n++; top = Math.max(top, pos.getY(i));
      }
      expect(n).toBeGreaterThan(20);
      expect(top).toBeGreaterThan(0.06 + 0.095);
      expect(top).toBeLessThan(0.06 + 0.105);
    }
  });
  it("lamps every 3 tiles on the barrier, none near junction centres", () => {
    const s = blankShowcaseCity();
    placeRoad(s, 3, [P(10.5, 40.5), P(40.5, 40.5)]);
    const lamps = highwayLampPositions(s.world);
    expect(lamps.length).toBeGreaterThanOrEqual(9);
    for (const l of lamps) expect(Math.abs(l.z - 40.5)).toBeLessThan(0.01);
    expect(lamps.every((l) => l.twin)).toBe(true);
  });
});
```

Use the vertex-attribute name the 1A tests use for the class (search `roadClass` in `roads-atlas.test.ts`).

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the recipe; add a gore test: on the Task 4 diverge, white MARK_LIFT vertices exist inside
  the gore triangle and no ramp-side shoulder line continues past `gore.length`.
- [ ] **Step 4: Run** `npx vitest run src/render && npm run ci`; record warm dense-grid rebuild ms (must stay < 10).
- [ ] **Step 5: Commit** `git commit -am "feat(roads): highway Jersey barrier, gore paint, highway and ramp lights"`

---

### Task 6: Diamond interchange through the planner

**Files:**
- Create: `src/sim/interchange.ts`
- Modify: `src/main.ts:498-540` (`stampInterchangeAt` → `planInterchange`/`placeInterchange` through `attempt()`, emit
  `roads:changed`), `src/ui/tool-state.ts:208` hint, `src/dev/scenario.ts` case E, `src/dev/scenario-roads.test.ts`
- Modify: `src/i18n.ts` (reasons)
- Test: `src/sim/interchange.test.ts`

**Interfaces:**
- Consumes: Tasks 3-4 (ramps legal at 10-30°, gores), `planRoad`, `placeRoad`, `diamondRamps` (kept for old tests).
- Produces:
  ```ts
  export interface InterchangeRamp { pts: Pt[]; role: "exit" | "entry"; side: -1 | 1 }
  export interface InterchangePlan { ok: boolean; reason?: string; ramps: InterchangeRamp[]; cost: number }
  /** (x, z): a point on the tile where a cross road passes over or under a ground highway. */
  export function planInterchange(s: CityState, x: number, z: number): InterchangePlan;
  export function placeInterchange(s: CityState, plan: InterchangePlan): ToolResult; // atomic: all ramps or none
  export const INTERCHANGE_TERMINAL_GAP = 2; // tiles past the cross road's bridge/tunnel ends
  ```

Layout recipe (highway direction `h` = unit a→b of the highway segment at the crossing, `n` = right normal of `h`;
cross road direction `c` chosen so `dot(c, n) > 0`):
1. Find the crossing: a tile with both a ground highway and a non-ground cross road (deck or tunnel), or the reverse
   (highway on a bridge over a ground road). Otherwise refuse "Tap where a road crosses a highway".
2. Terminal distance along the cross road: from the crossing to where its non-ground piece ends on each side, plus
   `INTERCHANGE_TERMINAL_GAP`; terminals `T+ = X + c·d+` (on the `n` side) and `T− = X − c·d−`.
3. Gore points on the highway centreline at `G = X ± h·g` with `g = max(d+, d−) / tan(20°)` clamped to [6, 14].
4. Ramps (quadratic, control point chosen so the ramp leaves the highway at 20°):
   - eastbound side (`n`, carriageway travelling `h`): exit `[X − h·g, ctrl, T+]` (role exit, leaves along `h`),
     entry `[T+, ctrl, X + h·g]` (role entry, arrives along `h`);
   - westbound side (`−n`, travelling `−h`): exit `[X + h·g, ctrl, T−]`, entry `[T−, ctrl, X − h·g]`.
   `ctrl = G + h_travel·(g/2) + side·n·(asphaltHalf_hw + 0.6)` so the start tangent is ~20°.
5. Each ramp is planned with `planRoad(s, 6, pts)`; the first refusal returns `{ ok: false, reason }`. Terminals that
   would sit within 4 tiles of another junction on the cross road → "No room for ramp terminals". Cost = sum of plan
   costs; money checked on the total.
6. `placeInterchange` snapshots `s` via the caller's undo (`attempt`), calls `placeRoad` for each ramp, and on any
   failure restores the four-ramp-before state (simplest: plan again before each place and abort before the first
   place if anything is not ok).

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/interchange.test.ts
import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad } from "./sim";
import { planInterchange, placeInterchange } from "./interchange";
import { junctionsOf } from "./junction";
import { findLayeredPath } from "./traffic";
import { serialize, deserialize } from "./save";

const P = (x: number, z: number) => ({ x, z });
function crossing() {
  const s = blankShowcaseCity();
  placeRoad(s, 3, [P(8.5, 48.5), P(88.5, 48.5)]);
  placeRoad(s, 2, [P(48.5, 20.5), P(48.5, 76.5)]);      // auto-elevated over the highway
  return s;
}

describe("diamond interchange", () => {
  it("plans two exits and two entries, one per side", () => {
    const s = crossing();
    const plan = planInterchange(s, 48.5, 48.5);
    expect(plan.ok).toBe(true);
    expect(plan.ramps.map((r) => `${r.role}${r.side}`).sort()).toEqual(["entry-1", "entry1", "exit-1", "exit1"]);
    expect(plan.cost).toBeGreaterThan(0);
  });

  it("builds 2 merges and 2 diverges and every movement is routable", () => {
    const s = crossing();
    const money = s.money;
    expect(placeInterchange(s, planInterchange(s, 48.5, 48.5)).ok).toBe(true);
    const kinds = [...junctionsOf(s.world).byNode.values()].map((l) => l.kind);
    expect(kinds.filter((k) => k === "merge")).toHaveLength(2);
    expect(kinds.filter((k) => k === "diverge")).toHaveLength(2);
    expect(s.money).toBeLessThan(money);
    // Highway west end → cross road north end, and cross road south → highway east end.
    const w = s.world, t = (x: number, z: number) => Math.floor(z) * w.size + Math.floor(x);
    expect(findLayeredPath(w, t(10.5, 48.5), t(48.5, 22.5))).toBeTruthy();
    expect(findLayeredPath(w, t(48.5, 74.5), t(86.5, 48.5))).toBeTruthy();
  });

  it("refuses away from a crossing and builds nothing", () => {
    const s = crossing();
    const before = serialize(s);
    const plan = planInterchange(s, 20.5, 48.5);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("Tap where a road crosses a highway");
    expect(serialize(s)).toBe(before);
  });

  it("refuses when a terminal would hit water or a building, nothing built", () => {
    const s = crossing();
    s.world.facility[60 * s.world.size + 48] = 1;           // something on the south terminal
    const before = serialize(s);
    const plan = planInterchange(s, 48.5, 48.5);
    expect(plan.ok).toBe(false);
    expect(serialize(s)).toBe(before);
  });

  it("bulldozing one ramp leaves valid junctions", () => {
    const s = crossing();
    placeInterchange(s, planInterchange(s, 48.5, 48.5));
    const ramp = s.world.segments.find((g) => g.type === 6)!;
    // use the real bulldoze API (search "bulldoze" in sim.ts tests) on a tile of this ramp
    // then:
    expect(() => junctionsOf(s.world)).not.toThrow();
  });

  it("an old save with the flat type-4 diamond still loads beside a new interchange", () => {
    const s = crossing();
    // reproduce the 1A-era diamond exactly as dev/scenario.ts case E did (addSegment type 4 from diamondRamps)
    const loaded = deserialize(serialize(s));
    expect(() => junctionsOf(loaded.world)).not.toThrow();
  });
});
```

Fill the two marked lines with the real bulldoze call and the case-E diamond reproduction (both exist in the repo:
`sim.ts` bulldoze tool used by `grade-separation.test.ts:186-209`, `diamondRamps` + `addSegment` in the 1A scenario).
Keep the assertions as written; adjust the facility index to a tile on the planned south terminal if 60 is not it.

- [ ] **Step 2: Run** — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `interchange.ts` per the recipe; in `main.ts` replace the body of `stampInterchangeAt`
  with: pick point → `const plan = planInterchange(state, x, z)` → if `!plan.ok` toast `tr(plan.reason)` → else
  `attempt(() => placeInterchange(state, plan))`, then `cityEvents.emit("roads:changed")`; keep
  `dispatch({ kind: "interchangeDone" })`. Hint `"Tap where a road crosses a highway to build an interchange"`.
  Scenario case E: replace the `addSegment` diamond with `placeInterchange(s, planInterchange(s, cx, cz))` (enlarge the
  cell if the ramps do not fit: use `g` from the plan); add a shot `"E-legacy"` that keeps the old flat diamond for
  the save-compatibility capture, and update `scenario-roads.test.ts` keys.
  PT strings: `"Tap where a road crosses a highway": "Toque onde uma via cruza a rodovia"`,
  `"No room for ramp terminals": "Sem espaço para as saídas das alças"`, the hint.
- [ ] **Step 4: Run** `npx vitest run src/sim/interchange.test.ts src/dev src/ui && npm run ci` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(roads): diamond interchange with two entries and two exits through the planner"`

---

### Task 7: Vehicles in lanes

**Files:**
- Modify: `src/sim/traffic.ts` (`Vehicle.lane`, `TransitVehicle.lane`, spawn sites, `routePath(w, tiles, lane?)`,
  `snapToCentrelines`, connector splice choice, `planLeg` for buses)
- Modify: `src/render/scene.ts:1631-1633, 1659-1660` (remove fixed lateral offsets)
- Test: `src/sim/traffic-lanes.test.ts`, `src/render/scene-vehicles.test.ts` (unchanged gate must stay green)

**Interfaces:**
- Produces:
  ```ts
  // traffic.ts
  export interface Vehicle { /* existing */ lane: number }          // 0 = leftmost lane of travel
  export function laneFor(id: number, kind: 0 | 1, lanesInDirection: number): number; // trucks → last lane
  export function routePath(w: World, tiles: number[], lane?: number): Float32Array;  // pts already in the lane
  ```
  `laneFor(id, 0, n) = id % n`; `laneFor(id, 1, n) = n - 1`. Buses use `n - 1`. The lane index is clamped per tile to
  that tile's road (`min(lane, lanesInDirection(road) - 1)`).

Recipe:
1. In `snapToCentrelines`, after snapping a sample to segment `pick`'s centreline, offset it by the lane centre of
   that segment's type for the travel direction: travel direction = sign of `dot(next − prev, segment a→b tangent)`;
   lane offsets = `laneOffsets({ end, type, oneWay, dir }, …)` semantics, i.e. for two-way a→b travel use the
   positive-side centres left→right, for b→a the negative-side centres in left→right-of-travel order; for one-way all
   centres. Use a precomputed per-type table (no allocation per sample beyond the output array).
2. Connector splice: when splicing a junction's connectors, prefer the connector whose `inLane` equals the vehicle's
   clamped lane; fall back to the current geometric choice. The connector's first point then coincides with the
   lane-offset sample (≤ 0.05 tile jump — Review Focus 5).
3. Render: delete the `lane` constant and the `- hz * lane` / `+ hx * lane` terms for cars and the `bus ? 0.14 : 0`
   term for transit; positions come straight from `pts`. Keep the functions allocation-free (switch to
   `pointAtRouteArcInto` with a preallocated out object while there).
4. Save: `lane` is derived on spawn, not saved (vehicles are not saved).

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/traffic-lanes.test.ts
import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad } from "./sim";
import { laneFor, routePath, findLayeredPath } from "./traffic";
import { junctionsOf } from "./junction";

const P = (x: number, z: number) => ({ x, z });
describe("vehicles in lanes", () => {
  it("laneFor spreads cars and keeps trucks right", () => {
    expect([0, 1, 2, 3].map((id) => laneFor(id, 0, 3))).toEqual([0, 1, 2, 0]);
    expect(laneFor(7, 1, 3)).toBe(2);
  });
  it("an eastbound route on a highway sits on the eastbound lane centres", () => {
    const s = blankShowcaseCity(), w = s.world;
    placeRoad(s, 3, [P(10.5, 40.5), P(60.5, 40.5)]);
    const t = (x: number, z: number) => Math.floor(z) * w.size + Math.floor(x);
    const tiles = findLayeredPath(w, t(12.5, 40.5), t(58.5, 40.5))!;
    for (const [lane, z] of [[0, 40.5 + 0.3], [1, 40.5 + 0.7], [2, 40.5 + 1.1]] as const) {
      const pts = routePath(w, tiles, lane);
      for (let i = 4; i < pts.length / 2 - 4; i++) expect(pts[i * 2 + 1]).toBeCloseTo(z, 2);
    }
  });
  it("no sideways jump where the route enters a junction connector", () => {
    const s = blankShowcaseCity(), w = s.world;
    placeRoad(s, 2, [P(10.5, 40.5), P(60.5, 40.5)]);
    placeRoad(s, 2, [P(35.5, 20.5), P(35.5, 60.5)]);
    const t = (x: number, z: number) => Math.floor(z) * w.size + Math.floor(x);
    const tiles = findLayeredPath(w, t(12.5, 40.5), t(58.5, 40.5))!;
    for (const lane of [0, 1]) {
      const pts = routePath(w, tiles, lane);
      for (let i = 1; i < pts.length / 2; i++) {
        const d = Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
        const lat = Math.abs(pts[i * 2 + 1] - pts[i * 2 - 1]);
        if (d > 1e-6) expect(lat).toBeLessThan(0.05 + 0.2 * d);  // straight E-W route: lateral drift only along curves
      }
    }
    expect(junctionsOf(w).byNode.size).toBeGreaterThan(0);
  });
});
```

Eastbound highway travel is +z side with `+offset = right of a→b` and centres `0.3, 0.7, 1.1` (from 1A
`profileOf(3).laneCentres`); left→right of eastbound travel is ascending.

- [ ] **Step 2: Run** — Expected: FAIL (`laneFor` missing).
- [ ] **Step 3: Implement** the recipe; spawn sites set `lane = laneFor(v.id, v.kind, lanesAtSpawn)` and pass it to
  `routePath`; buses pass the rightmost lane.
- [ ] **Step 4: Run** `npx vitest run src/sim/traffic*.test.ts src/render/scene-vehicles.test.ts && npm run ci`;
  the gridlock matrix tests must stay green.
- [ ] **Step 5: Commit** `git commit -am "feat(traffic): vehicles drive in real lanes; renderer adds no lateral offset"`

---

### Task 8: Scenario, captures, gate, docs (lead)

- [ ] **Step 1:** Add shots `"interchange"` (new diamond, close and game), `"E-legacy"`, `"gore"` (one diverge close),
  `"highway-night"` to `buildRoadsScenario`; update `scenario-roads.test.ts`.
- [ ] **Step 2:** Captures before (main `18a5b89`) and after (branch head) for every shot, day and night, same camera;
  side-by-side sheets in `docs/img/roads-1b/`.
- [ ] **Step 3:** Visual gate (AGENTS rule 11): barrier continuous and capped at mouths; gores clean (no square plate,
  chevrons inside); ramps with shoulder lines; lamps on barrier at night; cars in three lanes each way, trucks right;
  interchange movements watched live with `__city.traffic` for 2 game minutes (vehicles use the ramps, no jam at
  terminals).
- [ ] **Step 4:** Performance: warm dense-grid rebuild and a 96×96 saved city rebuild (first time measured), before and
  after; FPS on the Mac at game zoom with 260 vehicles; no iPad claim without a device run.
- [ ] **Step 5:** `docs/process/26-roads-cycle1.md` section 12 "1B result", CHANGELOG, PROGRESS; ask the owner before
  committing to `main`.
