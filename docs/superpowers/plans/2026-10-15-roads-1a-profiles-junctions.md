# Roads 1A — Road Profile Table and Honest Junctions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One road profile table drives simulation, lane graph, junctions, atlas textures and the road card; junctions
stop drawing square plates; width changes taper; one-way roads use their full width and keep their direction at
junctions.

**Architecture:** New `src/sim/roadprofile.ts` holds `ROAD_SPECS` (types 1-5) and derives every width; existing
records in `world.ts`, `corridor.ts`, `traffic.ts`, `junction.ts` become views of it. The junction builder gains a
`"taper"` kind and passes one-way direction to the lane builder. The atlas renderer reuses the low-tier per-side
trimmed band loop with UVs, and the atlas PNGs are regenerated from an exported `profiles.json`.

**Tech Stack:** TypeScript, Three.js, Vitest, Python 3 + PIL/numpy (`blender/make_road_atlas.py`, no Blender needed).

**Spec:** `docs/process/26-roads-cycle1.md` (sections 3, 4, 5, 8, 9 — rows 1A.0-1A.3). 1B (highway render, ramp
type 6, interchange, vehicle lanes) and 1C (road tool) get their own plans after this one is merged; they depend on
code this plan creates. Deferred on purpose: `atGradeWith`/`levels` spec fields and the ramp type (1B, where the
ramp is the first consumer); road card thumbnails and descriptions in `hud.ts` (1C). `descKey` is added now so 1C
only renders it.

## Global Constraints

- 1 tile = 8 m. Widths in tiles.
- Road type ids 1-5 never change; old saves must load (`save.ts` validation untouched in 1A).
- Footprints and drawn widths stay: 1→0.90, 2→1.80, 3→2.80, 4→0.90, 5→1.80; tile widths 1,2,3,1,2.
- Spec values (types 1-5): lanes fwd+back 1+1, 2+2, 3+3, 2+0, 4+0; lane width 0.38, 0.325, 0.40, 0.38, 0.405;
  median half 0, 0.16 (planted), 0.10 (barrier), 0, 0; shoulder 0, 0, 0.10, 0, 0; kerb 0.07, 0.09, 0, 0.07, 0.09;
  sidewalk 0.12, 0.16, 0, 0.12, 0.16; speed 3, 4.5, 7, 3, 4.5; capacity per lane 2, 2.5, 5, 2, 2.5;
  rank 1, 3, 6, 2, 4; cost/upkeep 20/3, 45/7, 90/14, 22/3, 48/7; junction markings yes, yes, no, yes, yes.
- Corner radius: street 0.45, avenue 0.60, highway 1.20, one-way street 0.25, one-way avenue 0.35 (doc 07 values).
- Clearance: 0.25 for highway, 0.10 otherwise.
- Taper length `L = clamp(6·|ΔasphaltHalf|, 0.6, 3)`, collinear tolerance 10°.
- Seam tolerance 1e-3; sliver min angle 2°.
- `npx tsc --noEmit` clean and `npx vitest run --exclude '.claude/**'` green after every task.
- iPad budget: no per-frame allocation; road rebuild < 10 ms at 96×96.
- UI strings through `src/i18n.ts`.
- Do not commit or push (AGENTS.md rule 1). "Checkpoint" steps below record a diff instead.

## Review Focus

1. One-way redrawn in the opposite direction (`dir = -1`) meeting a two-way at a T: expect connectors only in the
   travel direction and the left-turn lane on the geometric left. Test in Task 3.
2. Taper between a two-way avenue and a one-way street whose direction points INTO the avenue vs OUT of it: both
   valid, connectors only along travel. Test in Task 4.
3. Old save with a type-4 interchange ramp (flat one-way street touching a highway node): must load and build a
   junction without throwing. Test in Task 5.
4. Curved road (3-point segment) meeting a narrower road: no taper (not collinear), ordinary transition pad, no
   ribbon vertex inside the pad. Test in Task 7.
5. Sloped terrain with an atlas ribbon trimmed at a junction: ribbon end vertices sit on the trim line, not at the
   node. Test in Task 7 (heights not flat).

---

## Ownership and order

| Task | Owner | Exclusive files | After |
|---|---|---|---|
| 1 Spec table | Lead | `src/sim/roadprofile.ts`, `src/sim/roadprofile.test.ts` | – |
| 2 Consumers + rank | Lead | `world.ts`, `corridor.ts`, `traffic.ts` (constants only), `junction.ts` (radius/clearance only), `sim.ts:483`, `src/ui/road-facts.ts` | 1 |
| 3 One-way lanes + direction | Codex `gpt-5.6-terra` (agent `roads-sim`) | `lanes.ts`, `junction.ts` | 2 |
| 4 Taper kind | `roads-sim` | `junction.ts`, `junction-mixed.test.ts`, new `junction-taper.test.ts` | 3 |
| 5 Reasons + old-save | `roads-sim` | `lanes.ts`, `junction.ts`, `sim.ts` planRoad | 4 |
| 6 profiles.json + atlas | Codex `gpt-5.6-terra` (agent `roads-render`) | `scripts/export-road-profiles.ts`, `blender/make_road_atlas.py`, `public/textures/road/*`, `package.json` script | 2 (parallel with 3-5) |
| 7 Atlas ribbons honour trims, single surface | `roads-render` | `src/render/roads.ts`, `src/render/roads-atlas.test.ts` | 6 |
| 8 Taper surface + markings | `roads-render` | `src/render/roads.ts` | 4 and 7 |
| 9 Roads scenario + captures | Lead | `src/dev/scenario.ts`, `src/main.ts` (scenario hook only) | 2 (parallel) |
| 10 Integration and gate | Lead | docs | all |

Worktrees: `git worktree add /tmp/mayor-wt/<agent> -b agent/<agent>` from main after Task 2 is applied; symlink
`node_modules`. Prompts and logs in `/tmp/mayor-agents/`. Lead applies `git diff` patches with `git apply --3way`
and runs `npm run ci` between merges.

---

### Task 1: Road spec table

**Files:**
- Create: `src/sim/roadprofile.ts`
- Test: `src/sim/roadprofile.test.ts`

**Interfaces:**
- Consumes: `RoadType` from `src/sim/world.ts` (type-only import; no runtime cycle).
- Produces:
  ```ts
  export interface RoadSpec { type; nameKey; descKey; thumb; tileWidth; drawWidth; oneWay; lanesPerDir: [number, number];
    laneWidth; medianHalf; median: "none"|"paint"|"planted"|"barrier"; shoulder; kerb; sidewalk; speed;
    capacityPerLane; cornerRadius; clearance; rank; cost; upkeep; junctionMarkings: boolean }
  export interface DerivedProfile { asphaltHalf: number; drawHalf: number; sidewalkEdge: number; totalLanes: number;
    laneCentres: number[]; capacity: number }
  export const ROAD_SPECS: Record<RoadType, RoadSpec>;
  export function specOf(t: RoadType): RoadSpec;
  export function derive(t: RoadType): DerivedProfile;
  export function rankOf(t: number): number;   // 0 for 0/unknown
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/roadprofile.test.ts
import { describe, expect, it } from "vitest";
import { ROAD_SPECS, derive, rankOf, specOf } from "./roadprofile";
import type { RoadType } from "./world";

const TYPES: RoadType[] = [1, 2, 3, 4, 5];

describe("road spec table", () => {
  it("derived drawn width equals the declared drawn width", () => {
    for (const t of TYPES) expect(2 * derive(t).drawHalf).toBeCloseTo(specOf(t).drawWidth, 6);
  });
  it("lanes plus median plus shoulders fill the asphalt exactly", () => {
    for (const t of TYPES) {
      const s = specOf(t), d = derive(t);
      const lanes = s.lanesPerDir[0] + s.lanesPerDir[1];
      expect(lanes * s.laneWidth + 2 * s.medianHalf + 2 * s.shoulder).toBeCloseTo(2 * d.asphaltHalf, 6);
      expect(d.totalLanes).toBe(lanes);
      expect(d.laneCentres).toHaveLength(lanes);
    }
  });
  it("lane centres are ascending, inside the asphalt, and clear of the median", () => {
    for (const t of TYPES) {
      const s = specOf(t), d = derive(t);
      for (let i = 1; i < d.laneCentres.length; i++) expect(d.laneCentres[i]).toBeGreaterThan(d.laneCentres[i - 1]);
      for (const c of d.laneCentres) {
        expect(Math.abs(c) + s.laneWidth / 2).toBeLessThanOrEqual(d.asphaltHalf - s.shoulder + 1e-9);
        expect(Math.abs(c) - s.laneWidth / 2).toBeGreaterThanOrEqual(s.medianHalf - 1e-9);
      }
    }
  });
  it("one-way specs have no back lanes and no median", () => {
    for (const t of [4, 5] as RoadType[]) {
      expect(specOf(t).oneWay).toBe(true);
      expect(specOf(t).lanesPerDir[1]).toBe(0);
      expect(specOf(t).medianHalf).toBe(0);
    }
  });
  it("highway is 3+3 with a barrier and shoulders", () => {
    const h = specOf(3);
    expect(h.lanesPerDir).toEqual([3, 3]);
    expect(h.median).toBe("barrier");
    expect(h.shoulder).toBeCloseTo(0.1, 9);
    expect(h.junctionMarkings).toBe(false);
  });
  it("capacity is per-lane capacity times lanes", () => {
    expect(TYPES.map((t) => derive(t).capacity)).toEqual([4, 10, 30, 4, 10]);
  });
  it("rank orders street < one-way street < avenue < one-way avenue < highway, 0 for none", () => {
    expect([1, 4, 2, 5, 3].map(rankOf)).toEqual([1, 2, 3, 4, 6]);
    expect(rankOf(0)).toBe(0);
  });
  it("every spec carries i18n keys and a thumbnail", () => {
    for (const t of TYPES) {
      const s = ROAD_SPECS[t];
      expect(s.nameKey.length).toBeGreaterThan(0);
      expect(s.descKey.length).toBeGreaterThan(0);
      expect(s.thumb).toMatch(/^\/ui\/thumbs\/.+\.jpg$/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/roadprofile.test.ts`
Expected: FAIL — `Failed to resolve import "./roadprofile"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/sim/roadprofile.ts
/**
 * The single source of road numbers (docs/process/26-roads-cycle1.md section 4). Every other table
 * (world.ts ROAD_*, corridor.ts profiles, traffic.ts speed/capacity, junction.ts radius/clearance,
 * road-facts.ts, the atlas generator via profiles.json) is a view of ROAD_SPECS. 1 tile = 8 m.
 */
import type { RoadType } from "./world";

export type MedianKind = "none" | "paint" | "planted" | "barrier";

export interface RoadSpec {
  type: RoadType;
  nameKey: string;
  descKey: string;
  thumb: string;
  tileWidth: number;
  drawWidth: number;
  oneWay: boolean;
  /** [forward (a→b or the one-way direction), back]. */
  lanesPerDir: [number, number];
  laneWidth: number;
  medianHalf: number;
  median: MedianKind;
  shoulder: number;
  kerb: number;
  sidewalk: number;
  speed: number;
  capacityPerLane: number;
  cornerRadius: number;
  clearance: number;
  rank: number;
  cost: number;
  upkeep: number;
  junctionMarkings: boolean;
}

export interface DerivedProfile {
  asphaltHalf: number;
  drawHalf: number;
  sidewalkEdge: number;
  totalLanes: number;
  /** Signed offsets, ascending; +offset is the right of a→b (world z points south). */
  laneCentres: number[];
  capacity: number;
}

export const ROAD_SPECS: Record<RoadType, RoadSpec> = {
  1: { type: 1, nameKey: "Street", descKey: "roadDesc.street", thumb: "/ui/thumbs/rd-two.jpg",
    tileWidth: 1, drawWidth: 0.9, oneWay: false, lanesPerDir: [1, 1], laneWidth: 0.38, medianHalf: 0, median: "paint",
    shoulder: 0, kerb: 0.07, sidewalk: 0.12, speed: 3, capacityPerLane: 2, cornerRadius: 0.45, clearance: 0.1,
    rank: 1, cost: 20, upkeep: 3, junctionMarkings: true },
  2: { type: 2, nameKey: "Avenue", descKey: "roadDesc.avenue", thumb: "/ui/thumbs/rd-four.jpg",
    tileWidth: 2, drawWidth: 1.8, oneWay: false, lanesPerDir: [2, 2], laneWidth: 0.325, medianHalf: 0.16, median: "planted",
    shoulder: 0, kerb: 0.09, sidewalk: 0.16, speed: 4.5, capacityPerLane: 2.5, cornerRadius: 0.6, clearance: 0.1,
    rank: 3, cost: 45, upkeep: 7, junctionMarkings: true },
  3: { type: 3, nameKey: "Highway", descKey: "roadDesc.highway", thumb: "/ui/thumbs/rd-highway.jpg",
    tileWidth: 3, drawWidth: 2.8, oneWay: false, lanesPerDir: [3, 3], laneWidth: 0.4, medianHalf: 0.1, median: "barrier",
    shoulder: 0.1, kerb: 0, sidewalk: 0, speed: 7, capacityPerLane: 5, cornerRadius: 1.2, clearance: 0.25,
    rank: 6, cost: 90, upkeep: 14, junctionMarkings: false },
  4: { type: 4, nameKey: "One-way street", descKey: "roadDesc.onewayStreet", thumb: "/ui/thumbs/rd-two.jpg",
    tileWidth: 1, drawWidth: 0.9, oneWay: true, lanesPerDir: [2, 0], laneWidth: 0.38, medianHalf: 0, median: "none",
    shoulder: 0, kerb: 0.07, sidewalk: 0.12, speed: 3, capacityPerLane: 2, cornerRadius: 0.25, clearance: 0.1,
    rank: 2, cost: 22, upkeep: 3, junctionMarkings: true },
  5: { type: 5, nameKey: "One-way avenue", descKey: "roadDesc.onewayAvenue", thumb: "/ui/thumbs/rd-four.jpg",
    tileWidth: 2, drawWidth: 1.8, oneWay: true, lanesPerDir: [4, 0], laneWidth: 0.405, medianHalf: 0, median: "none",
    shoulder: 0, kerb: 0.09, sidewalk: 0.16, speed: 4.5, capacityPerLane: 2.5, cornerRadius: 0.35, clearance: 0.1,
    rank: 4, cost: 48, upkeep: 7, junctionMarkings: true },
};

export const specOf = (t: RoadType): RoadSpec => ROAD_SPECS[t];

export function rankOf(t: number): number {
  return (ROAD_SPECS as Record<number, RoadSpec | undefined>)[t]?.rank ?? 0;
}

const derivedCache = new Map<RoadType, DerivedProfile>();

export function derive(t: RoadType): DerivedProfile {
  const hit = derivedCache.get(t);
  if (hit) return hit;
  const s = ROAD_SPECS[t];
  const [fwd, back] = s.lanesPerDir;
  const total = fwd + back;
  const asphaltHalf = s.oneWay
    ? (total * s.laneWidth) / 2 + s.shoulder
    : s.medianHalf + fwd * s.laneWidth + s.shoulder;
  const drawHalf = asphaltHalf + s.kerb;
  const centres: number[] = [];
  if (s.oneWay) {
    for (let i = 0; i < total; i++) centres.push((i - (total - 1) / 2) * s.laneWidth);
  } else {
    // Back lanes (b→a) on the negative side, forward lanes on the positive side.
    for (let i = back - 1; i >= 0; i--) centres.push(-(s.medianHalf + (i + 0.5) * s.laneWidth));
    for (let i = 0; i < fwd; i++) centres.push(s.medianHalf + (i + 0.5) * s.laneWidth);
  }
  const d: DerivedProfile = {
    asphaltHalf, drawHalf, sidewalkEdge: drawHalf + s.sidewalk, totalLanes: total,
    laneCentres: centres, capacity: s.capacityPerLane * total,
  };
  derivedCache.set(t, d);
  return d;
}
```

Check against the table: street 0+0.38 = 0.38 + 0.07 = 0.45 ✓; avenue 0.16+0.65 = 0.81 + 0.09 = 0.90 ✓;
highway 0.10+1.20+0.10 = 1.40 ✓; one-way street 0.38 + 0.07 ✓; one-way avenue 0.81 + 0.09 ✓.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/roadprofile.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Checkpoint**

Run: `npx tsc --noEmit && git diff --stat > /tmp/mayor-agents/roads-1a-task1.stat`

---

### Task 2: Consumers read the table; tile class by rank

**Files:**
- Modify: `src/sim/world.ts:124-128` (ROAD_* records), `:648-651` (raster class)
- Modify: `src/sim/sim.ts:483` (`layerExisting < type`)
- Modify: `src/sim/corridor.ts:50-114` (`makeProfile`, `kerbFor`, `sidewalkFor`, `medianHalfFor`, `laneCentresFor`)
- Modify: `src/sim/traffic.ts:13-14` (`ROAD_SPEED`, `ROAD_CAPACITY`), `:309-310` comment (8 m per tile)
- Modify: `src/sim/junction.ts:52-60` (`cornerRadiusFor`, `clearanceFor`)
- Modify: `src/ui/road-facts.ts:21-26`
- Modify: `src/i18n.ts` (five `roadDesc.*` keys, pt-BR and en)
- Test: `src/sim/roadprofile-consumers.test.ts`

**Interfaces:**
- Consumes: `ROAD_SPECS`, `specOf`, `derive`, `rankOf` from Task 1.
- Produces: unchanged exported names (`ROAD_COST`, `ROAD_UPKEEP`, `ROAD_NAME`, `ROAD_TILE_WIDTH`, `ROAD_DRAW_WIDTH`,
  `ROAD_SPEED`, `ROAD_CAPACITY`, `profileOf`, `cornerRadiusFor`, `clearanceFor`, `roadFacts`) now derived;
  `RoadProfile` gains `shoulder: number` and `median: MedianKind`; `RoadFacts` gains `lanesPerDir: [number, number]`
  and `descKey: string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/roadprofile-consumers.test.ts
import { describe, expect, it } from "vitest";
import { ROAD_SPECS, derive, specOf } from "./roadprofile";
import { ROAD_COST, ROAD_DRAW_WIDTH, ROAD_NAME, ROAD_TILE_WIDTH, ROAD_UPKEEP, rebuildRoadRaster, type RoadType } from "./world";
import { profileOf } from "./corridor";
import { ROAD_CAPACITY, ROAD_SPEED } from "./traffic";
import { clearanceFor, cornerRadiusFor } from "./junction";
import { roadFacts } from "../ui/road-facts";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad } from "./sim";

const TYPES: RoadType[] = [1, 2, 3, 4, 5];

describe("every road table is a view of ROAD_SPECS", () => {
  it("world, corridor, traffic, junction and UI agree with the spec", () => {
    for (const t of TYPES) {
      const s = specOf(t), d = derive(t), p = profileOf(t);
      expect(ROAD_COST[t]).toBe(s.cost);
      expect(ROAD_UPKEEP[t]).toBe(s.upkeep);
      expect(ROAD_NAME[t]).toBe(s.nameKey);
      expect(ROAD_TILE_WIDTH[t]).toBe(s.tileWidth);
      expect(ROAD_DRAW_WIDTH[t]).toBe(s.drawWidth);
      expect(ROAD_SPEED[t]).toBe(s.speed);
      expect(ROAD_CAPACITY[t]).toBe(d.capacity);
      expect(cornerRadiusFor(t)).toBe(s.cornerRadius);
      expect(clearanceFor(t)).toBe(s.clearance);
      expect(p.asphaltHalf).toBeCloseTo(d.asphaltHalf, 9);
      expect(p.laneCentres).toEqual(d.laneCentres);
      expect(p.lanes).toBe(d.totalLanes);
      expect(p.medianHalf).toBe(s.medianHalf);
      expect(p.shoulder).toBe(s.shoulder);
      const f = roadFacts(t);
      expect(f.lanes).toBe(d.totalLanes);
      expect(f.lanesPerDir).toEqual(s.lanesPerDir);
      expect(f.descKey).toBe(s.descKey);
    }
    expect(Object.keys(ROAD_SPECS)).toHaveLength(5);
  });

  it("a one-way street joining an avenue leaves the shared tiles avenue class", () => {
    const s = blankShowcaseCity();
    const w = s.world;
    placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
    placeRoad(s, 4, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }]);
    rebuildRoadRaster(w);
    const shared = 30 * w.size + 30;
    expect(w.road[shared]).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/roadprofile-consumers.test.ts`
Expected: FAIL — highway `ROAD_CAPACITY[3]` is 20 not 30; `p.shoulder` undefined; `w.road[shared]` is 4.

- [ ] **Step 3: Rewrite the world records as views**

In `src/sim/world.ts`, replace lines 124-128 with (keep the doc comment above them):

```ts
import { ROAD_SPECS, rankOf } from "./roadprofile";
const fromSpec = <K extends keyof (typeof ROAD_SPECS)[1]>(k: K) =>
  Object.fromEntries(Object.values(ROAD_SPECS).map((s) => [s.type, s[k]])) as Record<RoadType, (typeof ROAD_SPECS)[1][K]>;
export const ROAD_TILE_WIDTH: Record<RoadType, number> = fromSpec("tileWidth");
export const ROAD_DRAW_WIDTH: Record<RoadType, number> = fromSpec("drawWidth");
export const ROAD_COST: Record<RoadType, number> = fromSpec("cost");
export const ROAD_UPKEEP: Record<RoadType, number> = fromSpec("upkeep");
export const ROAD_NAME: Record<RoadType, string> = fromSpec("nameKey");
```

Place the `import` with the other imports at the top of the file. `roadprofile.ts` imports `RoadType` as a type only,
so there is no runtime cycle.

Replace lines 648-651:

```ts
      if (rankOf(w.road[t]) < rankOf(seg.type)) w.road[t] = seg.type;
      if (elev === "ground" && rankOf(w.roadSurface[t]) < rankOf(seg.type)) w.roadSurface[t] = seg.type;
      else if (elev === "bridge" && rankOf(w.roadDeck[t]) < rankOf(seg.type)) w.roadDeck[t] = seg.type;
      else if (elev === "tunnel" && rankOf(w.roadTunnel[t]) < rankOf(seg.type)) w.roadTunnel[t] = seg.type;
```

In `src/sim/sim.ts:483` replace `if (layerExisting < type) {` with
`if (rankOf(layerExisting) < rankOf(type)) {` and add `rankOf` to the imports from `./roadprofile`.

- [ ] **Step 4: Derive corridor profiles**

In `src/sim/corridor.ts` add `shoulder: number; median: MedianKind;` to `RoadProfile`, delete `kerbFor`,
`sidewalkFor`, `medianHalfFor`, `laneCentresFor`, and replace `makeProfile` with:

```ts
import { derive, specOf, type MedianKind } from "./roadprofile";

function makeProfile(type: RoadType): RoadProfile {
  const s = specOf(type), d = derive(type);
  return {
    type,
    asphaltHalf: d.asphaltHalf,
    kerb: s.kerb,
    sidewalk: s.sidewalk,
    setback: Math.max(0, s.tileWidth / 2 - d.sidewalkEdge),
    drawHalf: d.drawHalf,
    lanes: d.totalLanes,
    laneCentres: d.laneCentres,
    medianHalf: s.medianHalf,
    median: s.median,
    shoulder: s.shoulder,
    laneWidth: s.laneWidth,
    propOffsets: {
      streetlight: d.sidewalkEdge + 0.2,
      hydrant: d.sidewalkEdge + 0.14,
      bench: d.sidewalkEdge + 0.2,
      planter: d.sidewalkEdge + 0.2,
      signal: d.sidewalkEdge + 0.08,
    },
  };
}
```

Remove the now-unused `ROAD_DRAW_WIDTH`, `ROAD_TILE_WIDTH`, `baseRoadType` imports if `tsc` reports them unused.

- [ ] **Step 5: Derive traffic, junction and UI**

`src/sim/traffic.ts:13-14`:

```ts
export const ROAD_SPEED: Record<number, number> = Object.fromEntries(Object.values(ROAD_SPECS).map((s) => [s.type, s.speed]));
export const ROAD_CAPACITY: Record<number, number> = Object.fromEntries(Object.values(ROAD_SPECS).map((s) => [s.type, derive(s.type).capacity]));
```

with `import { ROAD_SPECS, derive } from "./roadprofile";`. Change the comment at `traffic.ts:309-310` to say
1 tile = 8 m.

`src/sim/junction.ts:52-60`:

```ts
/** Kerb return radius at the asphalt edge, by road class (roadprofile.ts). */
export function cornerRadiusFor(type: RoadType): number { return specOf(type).cornerRadius; }
/** Boundary clearance outside the sidewalk, by road class (roadprofile.ts). */
export function clearanceFor(type: RoadType): number { return specOf(type).clearance; }
```

`src/ui/road-facts.ts`: add `lanesPerDir: [number, number]; descKey: string;` to `RoadFacts` and in `roadFacts`
add `lanesPerDir: specOf(type).lanesPerDir, descKey: specOf(type).descKey,` (import `specOf`).

`src/i18n.ts`: add to the pt-BR dictionary (and the same keys with English values to `en`):

```ts
"roadDesc.street": "Mão dupla, 1 faixa por sentido, calçadas.",
"roadDesc.avenue": "Mão dupla, 2 faixas por sentido, canteiro arborizado.",
"roadDesc.highway": "Rodovia, 3 faixas por sentido, barreira central e acostamento. Só conecta por trevo.",
"roadDesc.onewayStreet": "Mão única, 2 faixas no sentido do traçado.",
"roadDesc.onewayAvenue": "Mão única, 4 faixas no sentido do traçado.",
```

English: "Two-way, 1 lane each way, sidewalks." / "Two-way, 2 lanes each way, planted median." /
"Highway, 3 lanes each way, central barrier and shoulders. Joins only through an interchange." /
"One-way, 2 lanes in the drawn direction." / "One-way, 4 lanes in the drawn direction."

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/sim/roadprofile-consumers.test.ts src/sim/roadprofile.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit && npx vitest run --exclude '.claude/**'`
Expected: tsc clean. Known expected failures to triage, not to silence: lane tests that assert 4 highway lanes or
half-width one-way lanes (`lanes.test.ts`), traffic gridlock matrix capacity snapshots, corridor snapshot widths for
one-way. For each failure: if the assertion encodes an old table value, update it to the spec value and note it in
`/tmp/mayor-agents/roads-1a-task2.md`; if it is a behaviour check (gridlock flows), stop and report.
One-way lane tests are expected to fail until Task 3; mark them `it.todo` with a comment "Task 3" only if Task 3
starts immediately after.

- [ ] **Step 7: Checkpoint**

Run: `npm run ci` (must pass apart from the Task-3 todos) and write `git diff > /tmp/mayor-agents/roads-1a-task2.patch`.
This patch is the base for the `roads-sim` and `roads-render` worktrees.

---

### Task 3: One-way lanes use full width and keep direction at junctions

**Files:**
- Modify: `src/sim/lanes.ts:33-46` (`laneOffsets`)
- Modify: `src/sim/junction.ts` `buildJunction` lane call near `:1480`
- Test: `src/sim/lanes-oneway.test.ts`

**Interfaces:**
- Consumes: `LaneArm` (`oneWay?`, `dir?`), `RoadSegment.oneWay/dir`, `segById(w, id)` already used in `armsAt`.
- Produces: `laneOffsets(arm, incoming)` returns ALL lane centres (ascending) for a one-way arm in its travel
  direction, `[]` against it; `buildJunction` passes `oneWay` and `dir` of each arm's segment.

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/lanes-oneway.test.ts
import { describe, expect, it } from "vitest";
import { laneOffsets } from "./lanes";
import { buildJunction } from "./junction";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad } from "./sim";
import { derive } from "./roadprofile";

describe("one-way lanes", () => {
  it("a one-way street offers both lanes in its travel direction and none against it", () => {
    const all = derive(4).laneCentres;
    // a→b travel: enters the junction at end b, leaves at end a.
    expect(laneOffsets({ end: "b", type: 4, oneWay: true, dir: 1 }, true)).toEqual(all);
    expect(laneOffsets({ end: "a", type: 4, oneWay: true, dir: 1 }, false)).toEqual(all);
    expect(laneOffsets({ end: "a", type: 4, oneWay: true, dir: 1 }, true)).toEqual([]);
    // b→a travel flips both.
    expect(laneOffsets({ end: "a", type: 4, oneWay: true, dir: -1 }, true)).toEqual(all);
    expect(laneOffsets({ end: "b", type: 4, oneWay: true, dir: -1 }, true)).toEqual([]);
  });

  for (const flip of [false, true]) {
    it(`T junction avenue + one-way street (${flip ? "redrawn reversed" : "drawn inward"}): connectors follow travel`, () => {
      const s = blankShowcaseCity(), w = s.world;
      placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
      const stem = [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }];
      placeRoad(s, 4, stem);
      if (flip) placeRoad(s, 4, stem); // redraw flips direction (existing behaviour; 1C replaces it)
      const seg = w.segments.find((g) => g.type === 4)!;
      const node = w.nodes.find((n) => Math.hypot(n.x - 30.5, n.z - 30.5) < 0.6)!;
      const l = buildJunction(w, node.id)!;
      const stemArm = l.arms.findIndex((a) => a.segId === seg.id);
      const inbound = (seg.dir ?? 1) === 1 ? (seg.b === node.id) : (seg.a === node.id);
      const fromStem = l.connectors!.filter((c) => c.inArm === stemArm);
      const intoStem = l.connectors!.filter((c) => c.outArm === stemArm);
      if (inbound) { expect(fromStem.length).toBeGreaterThan(0); expect(intoStem).toHaveLength(0); }
      else { expect(intoStem.length).toBeGreaterThan(0); expect(fromStem).toHaveLength(0); }
      // Left turns leave from the geometric left lane of the inbound arm.
      for (const c of l.connectors!.filter((c) => c.turn === "left")) {
        const arm = l.arms[c.inArm], p = c.points[0];
        const travelX = -arm.dx, travelZ = -arm.dz;            // inbound travel heads to the node
        const side = travelX * (p.z - l.centre.z) - travelZ * (p.x - l.centre.x); // >0 = left in x-right/z-down frame
        expect(side).toBeLessThan(0.5);
        const lanesOnArm = l.connectors!.filter((k) => k.inArm === c.inArm).map((k) => k.inLane);
        expect(c.inLane).toBe(Math.min(...lanesOnArm));
      }
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/lanes-oneway.test.ts`
Expected: FAIL — `laneOffsets` returns one side only; the flipped T has connectors against travel.

- [ ] **Step 3: Implement**

In `src/sim/lanes.ts` `laneOffsets`, after the direction guard line, return the full list for one-way arms:

```ts
  if (oneWay && incoming !== ((a.end === "b") === (dir === 1))) return [];
  if (oneWay) return all.slice();
```

In `src/sim/junction.ts`, at the `buildLaneConnectors` call (near `:1480`), pass the segment direction:

```ts
  const laneGraph = buildLaneConnectors(layout.centre, layout.arms.map(a => {
    const seg = segById(w, a.segId);
    return {
      segId: a.segId, end: a.end, type: a.type, dx: a.dx, dz: a.dz,
      trim: Math.max(a.trimNeg.asphalt, a.trimPos.asphalt),
      oneWay: seg?.oneWay ?? (a.type === 4 || a.type === 5), dir: seg?.dir ?? 1,
    };
  }), layout.asphalt);
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/sim/lanes-oneway.test.ts src/sim/lanes.test.ts src/sim/junction.test.ts`
Expected: PASS. Then restore any `it.todo` added in Task 2 and run the full suite.

- [ ] **Step 5: Checkpoint**

Run: `npx tsc --noEmit && npx vitest run --exclude '.claude/**'`; save `git diff` to
`/tmp/mayor-agents/roads-sim-task3.patch`.

---

### Task 4: Taper junction kind

**Files:**
- Modify: `src/sim/junction.ts` (`JunctionKind` `:64-65`, `classify` `:707-730`, the straight-transition early return
  `:885-907`, `KNOWN_CODES` `:1492-1496`)
- Modify: `src/sim/junction-mixed.test.ts:136-145` ("wraps the wider arm's kerb around a straight width step" now
  expects kind `"taper"`)
- Test: `src/sim/junction-taper.test.ts`

**Interfaces:**
- Consumes: `derive`, `specOf` (Task 1); one-way direction on arms (Task 3).
- Produces: `JunctionKind` gains `"taper"`; a taper layout has `asphalt`, `kerbOuter`, `sidewalkOuter`, `boundary`
  rings (CCW, simple, nested), arm trims, `connectors`, and `taper: { wideArm: number; length: number;
  droppedLanes: { side: -1 | 1; offset: number }[] }` on `JunctionLayout` (optional field). Diagnostic
  `"taper-direction-conflict"` added to `KNOWN_CODES`.

Geometry recipe (write it as a function `buildTaper(cx, cz, wide: JArm, narrow: JArm, wSeg, nSeg)`):
1. `L = clamp(6 * |wide.h - narrow.h|, 0.6, 3)`. The narrow arm's ribbon ends at the node (`trim 0`); the wide arm's
   ribbon is trimmed by `L` on every layer.
2. Each ring is a quadrilateral per side: at the node, the narrow arm's offset for that layer (`h`, `h+kerb`,
   `h+kerb+sidewalk`, `+clearance`); at distance `L` along the wide arm, the wide arm's offset. Points ordered CCW.
3. Connectors: `buildLaneConnectors` with both arms, trims `[L, 0]`; when the wide arm has more inbound lanes than the
   narrow arm has outbound, the extra lanes map to the nearest narrow lane (proportional rank already does this for
   `"straight"`), and each dropped wide lane is listed in `taper.droppedLanes` with its side and offset.
4. Direction: if either arm is one-way and the other arm offers no lane in the matching direction, emit
   `"taper-direction-conflict"` and keep connectors empty.

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/junction-taper.test.ts
import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad } from "./sim";
import { buildJunction, checkJunction } from "./junction";
import { derive } from "./roadprofile";
import type { RoadType } from "./world";

function straightPair(a: RoadType, b: RoadType, reverseB = false) {
  const s = blankShowcaseCity(), w = s.world;
  placeRoad(s, a, [{ x: 20.5, z: 30.5 }, { x: 30.5, z: 30.5 }]);
  const pb = [{ x: 30.5, z: 30.5 }, { x: 40.5, z: 30.5 }];
  placeRoad(s, b, reverseB ? pb.slice().reverse() : pb);
  const node = w.nodes.find((n) => Math.hypot(n.x - 30.5, n.z - 30.5) < 0.6)!;
  return { w, l: buildJunction(w, node.id)! };
}

describe("taper between collinear roads of different width", () => {
  for (const [a, b] of [[2, 1], [2, 4], [5, 4], [3, 3]] as [RoadType, RoadType][]) {
    it(`${a} → ${b}`, () => {
      const { w, l } = straightPair(a, b);
      if (a === b) { expect(l.kind).toBe("middle"); return; }
      expect(l.kind).toBe("taper");
      expect(checkJunction(w, l).filter((d) => d.severity === "error")).toEqual([]);
      const L = Math.min(3, Math.max(0.6, 6 * Math.abs(derive(a).asphaltHalf - derive(b).asphaltHalf)));
      expect(l.taper!.length).toBeCloseTo(L, 6);
      // Asphalt width shrinks monotonically along the taper.
      const wide = l.arms[l.taper!.wideArm];
      let prev = Infinity;
      for (let k = 0; k <= 10; k++) {
        const s = (L * (10 - k)) / 10;
        const px = l.centre.x + wide.dx * s, pz = l.centre.z + wide.dz * s;
        const width = widthAcross(l.asphalt, px, pz, -wide.dz, wide.dx);
        expect(width).toBeLessThanOrEqual(prev + 1e-6);
        prev = width;
      }
      expect(l.connectors!.length).toBeGreaterThan(0);
    });
  }

  it("avenue → one-way street pointing away: connectors only avenue→street; dropped lanes listed", () => {
    const { l } = straightPair(2, 4);
    const street = l.arms.findIndex((a) => a.type === 4);
    expect(l.connectors!.every((c) => c.outArm === street)).toBe(true);
    expect(l.taper!.droppedLanes.length).toBeGreaterThan(0);
  });

  it("avenue → one-way street pointing toward the avenue: connectors only street→avenue", () => {
    const { l } = straightPair(2, 4, true);
    const street = l.arms.findIndex((a) => a.type === 4);
    expect(l.connectors!.every((c) => c.inArm === street)).toBe(true);
  });
});

/** Width of a CCW ring along the line through (px,pz) with unit normal (nx,nz). */
function widthAcross(ring: { x: number; z: number }[], px: number, pz: number, nx: number, nz: number): number {
  const hits: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const ex = b.x - a.x, ez = b.z - a.z;
    const den = nx * ez - nz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - px) * ez - (a.z - pz) * ex) / den;
    const u = ((a.x - px) * nz - (a.z - pz) * nx) / den;
    if (u >= -1e-9 && u <= 1 + 1e-9) hits.push(t);
  }
  return hits.length >= 2 ? Math.max(...hits) - Math.min(...hits) : 0;
}
```

If `checkJunction` returns plain diagnostics without `severity`, filter by codes that are not in the informational
list instead (read `checkJunction` in `junction.ts` and use the same predicate `junction-mixed.test.ts` uses).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/junction-taper.test.ts`
Expected: FAIL — kind is `"transition"`, `l.taper` undefined.

- [ ] **Step 3: Implement**

1. `JunctionKind`: add `| "taper"`. `JunctionLayout`: add
   `taper?: { wideArm: number; length: number; droppedLanes: { side: -1 | 1; offset: number }[] };`
2. `classify`: when two arms are within 10° of straight and their (`h`, `kerb`, `sidewalk`) differ, return
   `{ kind: "taper", template: "straight" }` (replace the `"transition"` straight branch).
3. Replace the straight-transition early return so that `"middle"` keeps the old early return and `"taper"` calls
   `buildTaper` (recipe above), sets `arms[i].trimNeg/trimPos` (wide arm: every layer `L`; narrow arm: `0`), builds
   connectors with the Task 3 arm mapping, fills `taper`, then `hashLayout`.
4. Add `"taper-direction-conflict"` to `KNOWN_CODES`.
5. Update `junction-mixed.test.ts:136-145` to expect `kind === "taper"` and keep its kerb-continuity assertion.
6. Mixed-width corners (spec 5.3): at `junction.ts:445` and `:549` the corner radius is `Math.max(Ra, Rb)`; change both
   to `Math.min(Ra, Rb)` (the narrower arm's radius). Add to `junction-taper.test.ts`:

```ts
it("a street corner off an avenue uses the street radius", () => {
  const s = blankShowcaseCity(), w = s.world;
  placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
  placeRoad(s, 1, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }]);
  const node = w.nodes.find((n) => Math.hypot(n.x - 30.5, n.z - 30.5) < 0.6)!;
  const l = buildJunction(w, node.id)!;
  const corners = l.fillets.filter((f) => f.rNominal > 0);
  expect(corners.length).toBeGreaterThan(0);
  for (const f of corners) expect(f.rNominal).toBeCloseTo(0.45, 6);
});
```

   Run it before the change (expect 0.6, FAIL) and after (PASS). If existing `junction-mixed` ring assertions break
   because smaller radii now fit where chamfers were used, update the expected fallback diagnostics and record them.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/sim/junction-taper.test.ts src/sim/junction-mixed.test.ts src/sim/junction.test.ts src/sim/showcase-gate.test.ts`
Expected: PASS. The showcase gate's `avenue-street-transition` case now yields a taper; if the gate asserts the old
kind, update that assertion to `"taper"` and record it.

- [ ] **Step 5: Checkpoint**

Full suite and tsc; save `git diff` to `/tmp/mayor-agents/roads-sim-task4.patch`.

---

### Task 5: Reasons when a connection cannot be built; old-save safety

**Files:**
- Modify: `src/sim/lanes.ts` `buildLaneConnectors` (return dropped legal movements)
- Modify: `src/sim/junction.ts` (`KNOWN_CODES`, diagnostics push)
- Modify: `src/sim/sim.ts` `planRoad` (reason for taper direction conflict)
- Modify: `src/i18n.ts` (reason strings)
- Test: `src/sim/junction-reasons.test.ts`

**Interfaces:**
- Consumes: Task 4 taper and diagnostics.
- Produces: `buildLaneConnectors(...)` returns `{ connectors, arrows, missing: { inArm: number; outArm: number; turn: TurnKind }[] }`;
  junction diagnostic code `"connector-missing"` with `detail: "<inArm>-><outArm>:<turn>"`; `planRoad` returns
  `{ ok: false, reason: "One-way direction conflicts with the road it joins" }` when the planned piece would create a
  `taper-direction-conflict`.

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/junction-reasons.test.ts
import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad, planRoad } from "./sim";
import { buildJunction, junctionsOf } from "./junction";
import { addSegment } from "./roads";
import { rebuildRoadRaster } from "./world";
import { serialize, deserialize } from "./save";

describe("junction refusal reasons", () => {
  it("planner refuses two one-way roads that meet head-on in a straight line", () => {
    const s = blankShowcaseCity();
    placeRoad(s, 4, [{ x: 20.5, z: 30.5 }, { x: 30.5, z: 30.5 }]);           // → east
    const plan = planRoad(s, 5, [{ x: 40.5, z: 30.5 }, { x: 30.5, z: 30.5 }]); // → west, into it
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("One-way direction conflicts with the road it joins");
  });

  it("missing legal movements are diagnosed, never silent", () => {
    const s = blankShowcaseCity(), w = s.world;
    // Very acute Y: the sharp turn cannot stay on asphalt.
    placeRoad(s, 1, [{ x: 20.5, z: 30.5 }, { x: 30.5, z: 30.5 }]);
    placeRoad(s, 1, [{ x: 30.5, z: 30.5 }, { x: 20.5, z: 31.6 }]);
    const node = w.nodes.find((n) => Math.hypot(n.x - 30.5, n.z - 30.5) < 0.6)!;
    const l = buildJunction(w, node.id)!;
    const legal = l.arms.length * (l.arms.length - 1);
    const made = new Set(l.connectors!.map((c) => `${c.inArm}->${c.outArm}`)).size;
    const missing = l.diagnostics.filter((d) => d.code === "connector-missing").length;
    expect(made + missing).toBeGreaterThanOrEqual(legal);
  });

  it("an old save with a flat type-4 interchange ramp touching a highway loads and builds junctions", () => {
    const s = blankShowcaseCity(), w = s.world;
    placeRoad(s, 3, [{ x: 10.5, z: 30.5 }, { x: 50.5, z: 30.5 }]);
    addSegment(w, 4, [{ x: 30.5, z: 30.5 }, { x: 34.5, z: 26.5 }]); // what main.ts:529 used to create
    rebuildRoadRaster(w);
    const again = deserialize(serialize(s));
    expect(() => junctionsOf(again.world)).not.toThrow();
  });
});
```

Before writing Step 3, open `src/sim/save.ts` and use its actual exported save/load function names in place of
`serialize`/`deserialize` (search `export function` in that file); keep the test body otherwise identical.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/junction-reasons.test.ts`
Expected: FAIL — planner returns ok; no `connector-missing` diagnostics.

- [ ] **Step 3: Implement**

1. In `buildLaneConnectors`, keep a `missing` array: for each `(i, o, turn)` where `ins.length > 0`,
   `outs.length > 0`, `turn !== "uturn"`, and no connector was pushed for that pair, push `{ inArm: i, outArm: o, turn }`.
   Return it with connectors and arrows.
2. In `buildJunction` (both the general path and `buildTaper`), for each missing entry push
   `{ code: "connector-missing", detail: `${m.inArm}->${m.outArm}:${m.turn}` }` and add the code to `KNOWN_CODES`.
3. In `planRoad`, after the pieces are known and before cost is returned: for each endpoint of the new piece that
   lands on an existing node with exactly one existing ground arm collinear within 10°, if either is one-way and the
   travel directions oppose (both enter or both leave the node), `return bad("One-way direction conflicts with the road it joins")`.
4. `src/i18n.ts`: pt-BR `"One-way direction conflicts with the road it joins": "O sentido da mão única contraria a via em que ela se conecta"`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/sim/junction-reasons.test.ts src/sim/lanes.test.ts src/sim/junction.test.ts`
Expected: PASS. Then full suite.

- [ ] **Step 5: Checkpoint**

Save `git diff` to `/tmp/mayor-agents/roads-sim-task5.patch`; report to the lead with the list of tests changed and why.

---

### Task 6: profiles.json and an atlas generated from the table

**Files:**
- Create: `scripts/export-road-profiles.ts`
- Create: `public/textures/road/profiles.json` (generated)
- Modify: `package.json` (`"roads:profiles": "vite-node scripts/export-road-profiles.ts"`; use `npx tsx` if
  `vite-node` is not installed — check `node_modules/.bin`)
- Modify: `blender/make_road_atlas.py:114-171` (`cross_section`, `junction`)
- Regenerate: `public/textures/road/road_*.png`, `junction_asphalt.png`
- Test: `src/render/road-profiles-json.test.ts`

**Interfaces:**
- Consumes: `ROAD_SPECS`, `derive` (Task 1).
- Produces: `profiles.json` shape
  `{ [kind: string]: { type, sidewalkEdge, drawHalf, asphaltHalf, kerb, sidewalk, medianHalf, median, shoulder,
  laneCentres, laneWidth, oneWay } }` keyed by atlas file stem (`road_street`, `road_avenue`, `road_highway`,
  `road_oneway_street`, `road_oneway_avenue`). u across the texture = `0.5 + offset / (2 * sidewalkEdge)`,
  which matches the runtime strip that spans `±sidewalkEdge`.

- [ ] **Step 1: Write the failing test**

```ts
// src/render/road-profiles-json.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { roadProfilesJson } from "../../scripts/export-road-profiles";

describe("road atlas profiles", () => {
  it("public/textures/road/profiles.json is fresh", () => {
    const disk = JSON.parse(readFileSync("public/textures/road/profiles.json", "utf8"));
    expect(disk).toEqual(roadProfilesJson());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/render/road-profiles-json.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the exporter**

```ts
// scripts/export-road-profiles.ts
import { writeFileSync } from "node:fs";
import { ROAD_SPECS, derive } from "../src/sim/roadprofile";

const STEM: Record<number, string> = { 1: "road_street", 2: "road_avenue", 3: "road_highway", 4: "road_oneway_street", 5: "road_oneway_avenue" };

export function roadProfilesJson(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of Object.values(ROAD_SPECS)) {
    const d = derive(s.type);
    out[STEM[s.type]] = {
      type: s.type, sidewalkEdge: d.sidewalkEdge, drawHalf: d.drawHalf, asphaltHalf: d.asphaltHalf,
      kerb: s.kerb, sidewalk: s.sidewalk, medianHalf: s.medianHalf, median: s.median, shoulder: s.shoulder,
      laneCentres: d.laneCentres, laneWidth: s.laneWidth, oneWay: s.oneWay,
    };
  }
  return out;
}

if (process.argv[1]?.endsWith("export-road-profiles.ts")) {
  writeFileSync("public/textures/road/profiles.json", JSON.stringify(roadProfilesJson(), null, 2) + "\n");
  console.log("wrote public/textures/road/profiles.json");
}
```

Run: `npm run roads:profiles`, then the Step 1 test passes.

- [ ] **Step 4: Rewrite `cross_section` from the JSON**

Replace `cross_section(kind)` in `blender/make_road_atlas.py` so every band position comes from `profiles.json`:

```python
import json
PROFILES = json.load(open(os.path.join(HERE, "..", "public", "textures", "road", "profiles.json")))

def u_of(p, off):
    """Texture u for a signed offset (tiles) across the strip spanning ±sidewalkEdge."""
    return 0.5 + off / (2 * p["sidewalkEdge"])

def px(u):
    return int(round(u * (W - 1)))

def cross_section(kind):
    p = PROFILES[kind]
    tone = 0.34 if p["median"] == "barrier" else 0.30
    img = asphalt_base(tone=tone)
    img = wear_bands(img, [u_of(p, c) for c in p["laneCentres"]], 0.13)
    rgb = to_rgb(img)
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB").convert("RGBA")
    d = ImageDraw.Draw(im)
    ah, dh, se = p["asphaltHalf"], p["drawHalf"], p["sidewalkEdge"]
    for side in (-1, 1):
        if p["kerb"] > 0 or p["sidewalk"] > 0:
            a, b = sorted((px(u_of(p, side * ah)), px(u_of(p, side * se))))
            d.rectangle([a, 0, b, H], fill=(168, 172, 178, 255))           # kerb + sidewalk
            k = px(u_of(p, side * ah))
            d.rectangle([k - 2, 0, k + 2, H], fill=(226, 229, 233, 255))   # kerb highlight
            for y in range(0, H, 128):
                d.rectangle([a, y, b, y + 2], fill=(128, 132, 138, 255))
        if p["shoulder"] > 0:                                              # solid edge line at the shoulder
            e = px(u_of(p, side * (ah - p["shoulder"])))
            d.rectangle([e - 3, 0, e + 3, H], fill=WHITE)
    mh = p["medianHalf"]
    if p["median"] == "planted":
        a, b = px(u_of(p, -mh)), px(u_of(p, mh))
        d.rectangle([a, 0, b, H], fill=(86, 122, 66, 255))
        for k in (a, b):
            d.rectangle([k - 2, 0, k + 2, H], fill=(226, 229, 233, 255))
    elif p["median"] == "barrier":                                         # concrete strip; 3D barrier comes in 1B
        a, b = px(u_of(p, -mh)), px(u_of(p, mh))
        d.rectangle([a, 0, b, H], fill=(150, 150, 146, 255))
        for k in (a, b):
            d.rectangle([k - 3, 0, k + 3, H], fill=(236, 200, 70, 255))   # yellow inner edge lines
    elif p["median"] == "paint":
        v_dash(d, px(0.5), 5, CREAM)
    # Lane lines between adjacent lanes travelling the same way.
    c = p["laneCentres"]
    for i in range(len(c) - 1):
        mid = (c[i] + c[i + 1]) / 2
        same_dir = p["oneWay"] or (c[i] > 0) == (c[i + 1] > 0)
        if same_dir:
            v_dash(d, px(u_of(p, mid)), 5, WHITE)
    return np.asarray(im.convert("RGB")).astype(float) / 255
```

Keep `junction()` but make its tone and wear match the street asphalt: `asphalt_base(tone=0.30)` and
`wear_bands(img, [0.3, 0.7], 0.08)` (tone was 0.31). The one-way amber centre dash is removed (one-way has no
centre line).

- [ ] **Step 5: Regenerate and check sizes**

Run: `python3 blender/make_road_atlas.py`
Expected: every file reported `[OK ]` (under 400 KB) and copied to `public/textures/road/`.
Open `public/textures/road/road_avenue.png` and `road_highway.png` and check visually: avenue kerb band ≈ 0.25/2.12
of the width on each side, green median centred; highway 3 dashed lines per side? No — 2 dashed lines per side
(between 3 lanes), yellow lines at the barrier, white edge lines at the shoulders.

- [ ] **Step 6: Checkpoint**

Run: `npx vitest run src/render/road-profiles-json.test.ts && npx tsc --noEmit`; save `git diff --binary` to
`/tmp/mayor-agents/roads-render-task6.patch`.

---

### Task 7: Atlas ribbons honour junction trims; pad and ribbon are one surface

**Files:**
- Modify: `src/render/roads.ts:257-305` (atlas branch of `ribbon`), `:305-360` (`half` helper), `:779-799`
  (`drawJunctionPatch` lifts), `:18-23` (lift constants)
- Test: `src/render/roads-atlas.test.ts`

**Interfaces:**
- Consumes: `RibbonOpts` trims (unchanged), `profileOf` (now with `shoulder`), `junctionsOf`.
- Produces: atlas ribbons built from per-side, per-layer half strips with `uv = [0.5 ± offset/(2·sidewalkEdge), v]`;
  junction patch asphalt at `ROAD_LIFT`, its kerb and sidewalk bands at `KERB_LIFT`, its markings at `MARK_LIFT`.

- [ ] **Step 1: Write the failing test**

```ts
// src/render/roads-atlas.test.ts
import { describe, expect, it } from "vitest";
import { buildRoadNetworkGeometry, ROAD_LIFT } from "./roads";
import { junctionsOf } from "../sim/junction";
import { pointInPolygon } from "../sim/lanes";
import { blankShowcaseCity } from "../sim/showcase-cases";
import { placeRoad } from "../sim/sim";
import type { RoadType } from "../sim/world";

type Case = { name: string; roads: [RoadType, { x: number; z: number }[]][]; slope?: boolean };
const CASES: Case[] = [
  { name: "avenue T one-way", roads: [[2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]], [4, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }]]] },
  { name: "street x avenue", roads: [[2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]], [1, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 40.5 }]]] },
  { name: "diagonal", roads: [[2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]], [1, [{ x: 24.5, z: 24.5 }, { x: 36.5, z: 36.5 }]]] },
  { name: "curve into street", roads: [[2, [{ x: 20.5, z: 30.5 }, { x: 26, z: 26 }, { x: 30.5, z: 30.5 }]], [1, [{ x: 30.5, z: 30.5 }, { x: 30.5, z: 40.5 }]]] },
  { name: "sloped T", slope: true, roads: [[2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]], [1, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }]]] },
];

function shrink(ring: { x: number; z: number }[], c: { x: number; z: number }, by: number) {
  return ring.map((p) => { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz) || 1; return { x: p.x - (dx / d) * by, z: p.z - (dz / d) * by }; });
}

describe("atlas ribbons stop at the junction trims", () => {
  for (const k of CASES) {
    it(k.name, () => {
      const s = blankShowcaseCity(), w = s.world;
      if (k.slope) for (let i = 0; i < w.heights.length; i++) w.heights[i] = 0.35 + 0.02 * (i % (w.size + 1));
      for (const [t, pts] of k.roads) expect(placeRoad(s, t, pts).ok ?? true).toBeTruthy();
      const gy = (x: number, z: number) => 0; // flat sampling for the y test; xz test is independent of height
      const geo = buildRoadNetworkGeometry(w, gy, { atlas: true });
      const pos = geo.getAttribute("position");
      const pads = [...junctionsOf(w).byNode.values()].filter((l) => l.asphalt.length >= 3 && l.kind !== "middle");
      expect(pads.length).toBeGreaterThan(0);
      let inside = 0;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (Math.abs(y - ROAD_LIFT) > 1e-4) continue;          // only ribbon / pad asphalt level
        const p = { x: pos.getX(i), z: pos.getZ(i) };
        for (const l of pads) if (pointInPolygon(p, shrink(l.asphalt, l.centre, 1e-3))) {
          // A vertex inside the pad at asphalt level must belong to the pad triangulation: pads only emit ring vertices.
          const onRing = l.asphalt.some((r) => Math.hypot(r.x - p.x, r.z - p.z) < 1e-3);
          if (!onRing) inside++;
        }
      }
      expect(inside).toBe(0);
    });
  }

  it("pad and ribbon asphalt share one height", () => {
    const s = blankShowcaseCity(), w = s.world;
    placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
    placeRoad(s, 1, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }]);
    const geo = buildRoadNetworkGeometry(w, () => 0, { atlas: true });
    const pos = geo.getAttribute("position");
    const ys = new Set<number>();
    for (let i = 0; i < pos.count; i++) ys.add(Math.round(pos.getY(i) * 1e4) / 1e4);
    expect(ys.has(Math.round((ROAD_LIFT + 0.02) * 1e4) / 1e4)).toBe(false); // old NODE_ASPHALT_LIFT level is gone
  });
});
```

If a ribbon vertex legitimately lies exactly on a pad ring vertex (seam), the `onRing` check accepts it; any other
vertex inside the pad is a defect.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/render/roads-atlas.test.ts`
Expected: FAIL — `inside` > 0 for every case (atlas ribbon runs to the node centre), and the 0.08 lift exists.

- [ ] **Step 3: Implement**

1. Give `half(side, s0, s1, inner, outer, y, color)` an optional `uv?: (off: number) => number` and an optional
   `cls`. When `uv` is given, emit vertices with `g.vert(x, y, z, "#ffffff", [uv(side*inner|outer), v], cls)`
   instead of `g.vertFast`, with `v = (dirSign < 0 ? total - s : s) / ROAD_TILE_LENGTH`.
2. Replace the atlas branch body (`roads.ts:265-302`) with: compute `fw = sidewalkEdge(type)`,
   `uv = (off) => 0.5 + off / (2 * fw)`, `cls = roadClassFor(type, dirSign)`, then run the same per-side loop as the
   low tier (asphalt `0..hw` with `aNeg/aPos` trims, kerb `hw..hw+kw` with `kNeg/kPos`, sidewalk
   `hw+kw..hw+kw+sw` with `sNeg/sPos`), all at `ROAD_LIFT` (kerb and sidewalk at `KERB_LIFT`) with `uv` and `cls`.
   Keep the one-way arrow quads, starting at `max(0.9, aMin + 0.4)` and ending at `total - eMin - 0.3`.
3. Move the `half` helper above the atlas branch so both branches use it (it currently closes over `walk`,
   `samples`, `total`, `pts`; hoist `walk = makeWalker(samples)` before the branch).
4. Low-tier markings (`roads.ts:407-430`) read offsets from `profileOf(type)`: lane lines at the midpoints between
   adjacent same-direction `laneCentres`, the avenue median band at `±medianHalf`, the highway barrier strip at
   `±medianHalf` and solid edge lines at `±(asphaltHalf - shoulder)`; one-way roads draw no centre line. Add to
   `roads-atlas.test.ts` a low-tier case (`{ atlas: false }`) on a lone highway that finds marking vertices at
   `±(1.40 - 0.10)` within 1e-3 and none at the old `±0.7`.
5. In `drawJunctionPatch`: asphalt at `ROAD_LIFT`, bands at `KERB_LIFT`, fallback stack at `ROAD_LIFT - 0.004`;
   change `NODE_MARK_LIFT` to `MARK_LIFT`. Delete `NODE_ASPHALT_LIFT` if unused.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/render/roads-atlas.test.ts src/render/roads.test.ts src/sim/showcase-gate.test.ts`
Expected: PASS. Then `npx tsc --noEmit` and the full suite.

- [ ] **Step 5: Rebuild timing**

Add to the test file (not a gate, a measurement printed to the log):

```ts
it("rebuild time on a dense grid (report only)", () => {
  const s = blankShowcaseCity();
  for (let k = 0; k < 8; k++) {
    placeRoad(s, k % 2 ? 1 : 2, [{ x: 8.5, z: 8.5 + k * 6 }, { x: 56.5, z: 8.5 + k * 6 }]);
    placeRoad(s, k % 2 ? 2 : 1, [{ x: 8.5 + k * 6, z: 8.5 }, { x: 8.5 + k * 6, z: 56.5 }]);
  }
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) { s.world.graphRevision = (s.world.graphRevision ?? 0) + 1; buildRoadNetworkGeometry(s.world, () => 0, { atlas: true }); }
  console.log(`[roads-1a] atlas rebuild ${((performance.now() - t0) / 5).toFixed(2)} ms`);
});
```

Record the number before (on main, Task 2 patch only) and after in `/tmp/mayor-agents/roads-render-task7.md`.

- [ ] **Step 6: Checkpoint**

Save `git diff` to `/tmp/mayor-agents/roads-render-task7.patch`.

---

### Task 8: Taper surface and lane-drop markings

**Files:**
- Modify: `src/render/roads.ts` (`buildRoadNetworkGeometry` junction loop, marking emitters)
- Test: `src/render/roads-taper.test.ts`

**Interfaces:**
- Consumes: `JunctionLayout.kind === "taper"`, `layout.taper.droppedLanes`, `layout.taper.wideArm`,
  `layout.taper.length` (Task 4); `drawJunctionPatch` (Task 7).
- Produces: taper pads drawn by `drawJunctionPatch` (atlas: asphalt with world UV, bands in kerb material);
  for each dropped lane, a merge arrow texture quad (`ROAD_CLASS.ARROW`, rotated toward the kept lane) at
  `taper.length * 0.6` from the node and a dashed edge line along the dropped lane boundary (three 0.15-long quads).

- [ ] **Step 1: Write the failing test**

```ts
// src/render/roads-taper.test.ts
import { describe, expect, it } from "vitest";
import { buildRoadNetworkGeometry, MARK_LIFT_FOR_TESTS } from "./roads";
import { junctionsOf } from "../sim/junction";
import { pointInPolygon } from "../sim/lanes";
import { blankShowcaseCity } from "../sim/showcase-cases";
import { placeRoad } from "../sim/sim";

describe("taper rendering", () => {
  it("avenue → one-way street draws a pad and merge markings inside it", () => {
    const s = blankShowcaseCity(), w = s.world;
    placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 30.5, z: 30.5 }]);
    placeRoad(s, 4, [{ x: 30.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
    const l = [...junctionsOf(w).byNode.values()].find((x) => x.kind === "taper")!;
    expect(l).toBeTruthy();
    const geo = buildRoadNetworkGeometry(w, () => 0, { atlas: true });
    const pos = geo.getAttribute("position");
    let marks = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - MARK_LIFT_FOR_TESTS) > 0.003) continue;
      if (pointInPolygon({ x: pos.getX(i), z: pos.getZ(i) }, l.asphalt)) marks++;
    }
    expect(marks).toBeGreaterThanOrEqual(4 * l.taper!.droppedLanes.length); // one arrow quad per dropped lane at least
  });
});
```

Export `export const MARK_LIFT_FOR_TESTS = MARK_LIFT;` from `roads.ts` for this test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/render/roads-taper.test.ts`
Expected: FAIL — no marks inside the taper.

- [ ] **Step 3: Implement**

In the junction loop of `buildRoadNetworkGeometry`, after `drawJunctionPatch(g, l, groundY, atlas)`, add
`if (l.kind === "taper" && l.taper) drawTaperMarks(g, l, groundY);` with:

```ts
function drawTaperMarks(g: Geo, l: JunctionLayout, groundY: GroundY): void {
  const arm = l.arms[l.taper!.wideArm];
  const tx = -arm.dx, tz = -arm.dz;                       // travel toward the node along the wide arm
  for (const d of l.taper!.droppedLanes) {
    const off = armOffsetSign(arm) * d.offset;
    const s = l.taper!.length * 0.6;
    const cx = l.centre.x + arm.dx * s - arm.dz * off, cz = l.centre.z + arm.dz * s + arm.dx * off;
    // Merge arrow: points along travel, bent toward the kept lane (−side).
    const ax = tx - arm.dz * -d.side * 0.35, az = tz + arm.dx * -d.side * 0.35;
    const al = Math.hypot(ax, az), ux = ax / al, uz = az / al, nx = -uz, nz = ux;
    const q = (a: number, b: number) => ({ x: cx + ux * a + nx * b, z: cz + uz * a + nz * b });
    g.texQuad([q(-0.3, -0.12), q(-0.3, 0.12), q(0.3, 0.12), q(0.3, -0.12)], MARK_LIFT, groundY, ROAD_CLASS.ARROW);
    // Dashed boundary along the dropped lane's inner edge.
    for (let k = 0; k < 3; k++) {
      const s0 = l.taper!.length * (0.1 + k * 0.3), s1 = s0 + 0.15, e = off - d.side * 0.5 * profileOf(arm.type).laneWidth;
      const p = (s: number, w: number) => ({ x: l.centre.x + arm.dx * s - arm.dz * (e + w), z: l.centre.z + arm.dz * s + arm.dx * (e + w) });
      g.flatQuad([p(s0, -0.012), p(s0, 0.012), p(s1, 0.012), p(s1, -0.012)], MARK_LIFT, groundY, "#d8d6c4");
    }
  }
}
```

`armOffsetSign(arm)` is `arm.end === "a" ? 1 : -1` (same rule as `lanes.ts` `armOffset`); if `Geo` has no
`flatQuad`, use the existing helper that draws coloured marking quads in this file (search `MARK_LIFT` usages) and
keep the signature above.

Then the junction markings rules (spec 5.5 and the `junctionMarkings` field):
- `roads.ts:883-893`: skip crosswalks, stop bars and lane arrows on any arm whose `specOf(type).junctionMarkings`
  is false (highway).
- `roads.ts:643-669`: an inbound one-way arm gets a stop bar across its full asphalt width
  (`-asphaltHalf..+asphaltHalf`); an outbound one-way arm gets none; two-way arms keep the right half.

Add to `roads-taper.test.ts`:

```ts
it("one-way stop bars span the whole arm; highways get no junction marks", () => {
  const s = blankShowcaseCity(), w = s.world;
  placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
  placeRoad(s, 4, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }]);           // inbound one-way stem
  const l = [...junctionsOf(w).byNode.values()].find((x) => x.kind === "junction")!;
  const stem = l.arms.findIndex((a) => a.type === 4);
  const bar = l.stopLines.find((q) => q.arm === stem)!;
  const xs = bar.points.map((p) => p.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.7);           // ≈ 2·0.38, not 0.38
  const s2 = blankShowcaseCity();
  placeRoad(s2, 3, [{ x: 10.5, z: 30.5 }, { x: 50.5, z: 30.5 }]);
  placeRoad(s2, 3, [{ x: 30.5, z: 10.5 }, { x: 30.5, z: 30.5 }]);
  const h = [...junctionsOf(s2.world).byNode.values()].find((x) => x.kind === "junction")!;
  expect(h.crosswalks).toHaveLength(0);
  expect(h.stopLines).toHaveLength(0);
});
```

If `MarkingQuad` has no `arm`/`points` fields or the marks are built in `roads.ts` rather than in the layout, adapt
the accessors to where the quads actually live (search `stopLines` and `crosswalks`) and keep the two assertions:
inbound one-way bar width ≈ full asphalt, zero highway marks.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/render/roads-taper.test.ts src/render/roads-atlas.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Save `git diff` to `/tmp/mayor-agents/roads-render-task8.patch`.

---

### Task 9: Roads scenario with fixed cameras

**Files:**
- Modify: `src/dev/scenario.ts` (add `buildRoadsScenario` and `ROAD_SHOTS`)
- Modify: `src/main.ts:1013-1021` (route `?scenario=roads`, expose `window.__scenario`)
- Test: `src/dev/scenario-roads.test.ts`

**Interfaces:**
- Consumes: `blankShowcaseCity`, `placeRoad`, `diamondRamps`, `addSegment` (old ramp behaviour for case E).
- Produces: `buildRoadsScenario(): { state: CityState; shots: Record<RoadShot, CameraShot> }`,
  `type RoadShot = "A" | "B" | "C" | "D" | "E" | "lane-reduction" | "four-way" | "parallel" | "bridge" | "tunnel" | "grade" | "upgrade"`,
  `interface CameraShot { x: number; z: number; game: { dist: number; pitch: number; yaw: number }; close: { dist: number; pitch: number; yaw: number } }`;
  in the browser `window.__scenario.shot(name, "game" | "close")` sets `renderer.rig` and calls `apply()`.

- [ ] **Step 1: Write the failing test**

```ts
// src/dev/scenario-roads.test.ts
import { describe, expect, it } from "vitest";
import { buildRoadsScenario } from "./scenario";

describe("roads scenario", () => {
  it("places every case and has a camera for each", () => {
    const { state, shots } = buildRoadsScenario();
    expect(Object.keys(shots).sort()).toEqual(["A", "B", "C", "D", "E", "bridge", "four-way", "grade", "lane-reduction", "parallel", "tunnel", "upgrade"].sort());
    expect(state.world.segments.length).toBeGreaterThanOrEqual(20);
    for (const s of Object.values(shots)) {
      expect(s.x).toBeGreaterThan(4); expect(s.z).toBeGreaterThan(4);
      expect(s.x).toBeLessThan(state.world.size - 4); expect(s.z).toBeLessThan(state.world.size - 4);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/dev/scenario-roads.test.ts`
Expected: FAIL — `buildRoadsScenario` not exported.

- [ ] **Step 3: Implement**

Use `blankShowcaseCity()` (flat, size from `SHOWCASE_SIZE`; if smaller than 72, call `newCity(SHOWCASE_SEED, 96, "plains")`
and flatten heights the same way) and lay the cases on a 3×4 grid of 22-tile cells, cell centre `(13 + 22·col, 13 + 22·row)`:

| Shot | Calls (cx, cz = cell centre + 0.5) |
|---|---|
| A | `placeRoad(s,2,[P(cx-8,cz),P(cx,cz)]); placeRoad(s,4,[P(cx,cz),P(cx+8,cz)])` |
| B | `placeRoad(s,2,[P(cx-8,cz),P(cx+8,cz)]); placeRoad(s,4,[P(cx,cz-8),P(cx,cz)])` |
| C | `placeRoad(s,3,[P(cx-10,cz),P(cx+10,cz)])` |
| D | `placeRoad(s,2,[P(cx-8,cz),P(cx+8,cz)]); placeRoad(s,1,[P(cx-6,cz-6),P(cx+6,cz+6)])` |
| E | `placeRoad(s,3,[P(cx-10,cz),P(cx+10,cz)]); placeRoad(s,2,[P(cx,cz-8),P(cx,cz+8)]); for (const r of diamondRamps(cx,cz,{dx:1,dz:0},{dx:0,dz:1})) addSegment(w,4,r); rebuildRoadRaster(w)` (today's interchange, replaced in 1B) |
| lane-reduction | `placeRoad(s,5,[P(cx-8,cz),P(cx,cz)]); placeRoad(s,4,[P(cx,cz),P(cx+8,cz)])` |
| four-way | `placeRoad(s,2,[P(cx-8,cz),P(cx+8,cz)]); placeRoad(s,2,[P(cx,cz-8),P(cx,cz+8)])` |
| parallel | `placeRoad(s,4,[P(cx-8,cz-0.9),P(cx+8,cz-0.9)]); placeRoad(s,4,[P(cx+8,cz+0.9),P(cx-8,cz+0.9)])` |
| bridge | `placeRoad(s,1,[P(cx-8,cz),P(cx+8,cz)]); placeRoad(s,2,[P(cx,cz-9),P(cx,cz+9)],"elevated")` |
| tunnel | `placeRoad(s,1,[P(cx-8,cz),P(cx+8,cz)]); placeRoad(s,2,[P(cx,cz-9),P(cx,cz+9)],"tunnel")` |
| grade | `placeRoad(s,3,[P(cx-10,cz),P(cx+10,cz)]); placeRoad(s,1,[P(cx,cz-8),P(cx,cz+8)])` (auto grade separation) |
| upgrade | `placeRoad(s,1,[P(cx-8,cz),P(cx+8,cz)]); placeRoad(s,1,[P(cx,cz-8),P(cx,cz)]); upgradeRoad(s, findUpgradeTarget(w,cx-4,cz,2)!.id, 2)` |

Cameras: `game: { dist: 22, pitch: 0.95, yaw: 0.5 }`, `close: { dist: 9, pitch: 1.0, yaw: 0.5 }`, centred on the cell.
Set `s.money = 1e9` before placing and pause the simulation in `main.ts` as `initScenario` does for `upgrade`.
In `main.ts`, mirror the existing `?scenario=upgrade` branch: `host.useCity(state)`, then
`(window as any).__scenario = { shot(name, kind) { const c = shots[name]; const r = renderer.rig; r.target.x = c.x; r.target.z = c.z; Object.assign(r, c[kind]); r.apply(); } }`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/dev/scenario-roads.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Before captures (lead, browser)**

On the Task-2 baseline (before Tasks 3-8 are applied), start `preview_start {name: "mayor-dev-5180"}`, open
`http://localhost:5180/?scenario=roads`, hide HUD panels, and for each shot × {game, close} × {day `setTod(0.5)`,
night `setTod(0.0)`} take a screenshot. Save to `/tmp/mayor-agents/roads-1a-shots/before/<shot>-<zoom>-<tod>.jpg`.

---

### Task 10: Integration and gate (lead)

**Files:**
- Modify: `docs/process/26-roads-cycle1.md` (status section: what was observed), `docs/CHANGELOG.md`, `PROGRESS.md`

- [ ] **Step 1: Apply patches in order**

From `/Volumes/T7/07-Projects/clones`: Task 2 base is already applied; then
`git apply --3way /tmp/mayor-agents/roads-sim-task3.patch` … `task5.patch`, `npm run ci` after each;
then `roads-render-task6.patch` … `task8.patch`, `npm run ci` after each.
Expected: each `npm run ci` exits 0.

- [ ] **Step 2: After captures**

Same scenario, same 12 shots × 2 zooms × day/night into `/tmp/mayor-agents/roads-1a-shots/after/`.
Build a side-by-side sheet (`python3 -c` with PIL, before left, after right) per shot.

- [ ] **Step 3: Visual gate**

Check each after shot for: no square plate, no notch at pad/ribbon seams, no z-fighting (zoom close at a seam),
taper visible on A and lane-reduction, one-way with arrows and no centre line on B and parallel, highway lanes
3+3 with barrier strip on C/E/grade, night readable. Any defect: send it back to the owning agent with the shot.

- [ ] **Step 4: Old save and performance**

Load an existing save from before this cycle (iPad screenshots city or any `.mayor` save in `~/Library` or the
IndexedDB export) in the dev server; confirm it opens and roads render. Record the Task 7 rebuild numbers before and
after. Do not claim iPad FPS.

- [ ] **Step 5: Documentation aligned to observation**

Add to `docs/process/26-roads-cycle1.md` a "1A result" section: what changed, test list, the before/after sheet
paths, rebuild numbers, open defects. Add a CHANGELOG entry and a PROGRESS line. Ask the owner whether to commit.
