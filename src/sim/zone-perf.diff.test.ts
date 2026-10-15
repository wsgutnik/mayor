/**
 * Differential test for the incremental zone pipeline (task zperf): the frozen pre-zperf implementation
 * (src/sim/zone-oracle/, swapped in through zoneHooks) and the current one must produce BYTE-IDENTICAL zone blocks
 * (geometry, valid, zone, level, lot), tile index, oriented lots, tile mirror (zone, level, lotAt, lots, cell index)
 * after every operation of
 *  - the seeded random-operation scenarios of zone-invariant.test.ts (roads, curves, upgrades, road bulldozes,
 *    roundabouts, facilities, bulk paints/clears, brushes, undo/redo, save/load), both zoning modes;
 *  - the benchmark fixtures (zone-perf.fixtures.ts) and their operations (place road, bulk paint, bulldoze a road
 *    tile, upgrade a segment, load a save).
 * Default: seeds 11 and 23 plus the grid fixture. ZDIFF_ALL=1 runs every zone-invariant seed and all three fixtures
 * (the 1000+ segment city is compared against the oracle with the old shortcut disabled, i.e. always exact).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applyTool, applyZoneAt, applyZoneBulk, bulldozeAt, getZoneBlocks, newCity, placeRoad, placeRoundabout, upgradeRoad,
  type CityState,
} from "./sim";
import { deserialize, serialize } from "./save";
import { makeRng } from "./rng";
import { cidx, segElevation, type Pt, type RoadType } from "./world";
import type { ZoningMode } from "./zonecells";
import { zoneHooks, type ZoneHooks } from "./zonehooks";
import { mirrorIndex } from "./mirror";
import * as oz from "./zone-oracle/zoneblocks";
import * as ol from "./zone-oracle/orientedlots";
import * as om from "./zone-oracle/mirror";
import * as or from "./zone-oracle/roadsurface";
import type { ZoneBlockSet } from "./zoneblocks";
import { FIXTURES, newRoadFor, paintRect, roadTileFor, upgradeFor } from "./zone-perf.fixtures";
import { corridorsOf } from "./corridor";
import { junctionsOf } from "./junction";

const current: ZoneHooks = { ...zoneHooks };
const oracle = {
  buildZoneBlocks: oz.buildZoneBlocks, nearestCell: oz.nearestCell, planOrientedLots: ol.planOrientedLots,
  rasterizeMirror: om.rasterizeMirror, lotRectOnRoad: or.lotRectOnRoad, roadSurface: or.roadSurface,
} as unknown as ZoneHooks;
let oracleMode = false;

function use(h: ZoneHooks, isOracle: boolean): void {
  Object.assign(zoneHooks, h);
  oracleMode = isOracle;
}

const h = (...parts: (ArrayBufferView | string | number)[]): string => {
  const c = createHash("sha1");
  for (const p of parts) {
    if (typeof p === "string") c.update(p);
    else if (typeof p === "number") c.update(String(p));
    else c.update(new Uint8Array(p.buffer, p.byteOffset, p.byteLength));
    c.update("|");
  }
  return c.digest("hex").slice(0, 16);
};

/** Per-field digests of everything the zone pipeline owns. */
function digest(s: CityState): Record<string, string> {
  const w = s.world;
  const out: Record<string, string> = {
    zone: h(w.zone), level: h(w.level), lotAt: h(w.lotAt), lots: h(JSON.stringify(w.lots)),
    mirrorIndex: h((oracleMode ? om.mirrorIndex(w) : mirrorIndex(w)) ?? "none"),
  };
  if (w.zoning !== "oriented") return out;
  const set = getZoneBlocks(w) as ZoneBlockSet;
  const geo: (ArrayBufferView | string | number)[] = [], valid: ArrayBufferView[] = [], zone: ArrayBufferView[] = [];
  const level: ArrayBufferView[] = [], lot: ArrayBufferView[] = [];
  for (const [k, b] of set.blocks) {
    geo.push(k, b.key, b.seg, b.side, b.block, b.rows, b.s0, b.lat0, b.age, b.frame, b.edge ?? "noedge");
    valid.push(b.valid); zone.push(b.zone); level.push(b.level); lot.push(b.lot);
  }
  out.blockGeo = h(...geo);
  out.valid = h(...valid);
  out.cellZone = h(...zone);
  out.cellLevel = h(...level);
  out.cellLot = h(...lot);
  out.bySeg = h(JSON.stringify([...set.bySeg].map(([k, v]) => [k, v.map((b) => b.key)])));
  out.tileIndex = h(JSON.stringify([...set.tileIndex]));
  out.graphRevision = String(set.graphRevision);
  out.olots = h(JSON.stringify(w.olots ?? null));
  out.nextOLotId = String(w.nextOLotId);
  return out;
}

const SIZE = 40;

function flatCity(seed: number, mode: ZoningMode, natural = false): CityState {
  const s = newCity(seed, SIZE);
  s.world.zoning = mode;
  s.money = 1e9;
  // Natural terrain keeps hills and water: slope/water validity and the levelling under roads and zones matter.
  if (!natural) for (let y = 0; y <= s.world.size; y++) for (let x = 0; x <= s.world.size; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  return s;
}

/** Corridors (reused per segment since zperf) and junction layouts of the live world vs a freshly loaded copy. */
function graphDigest(s: CityState): Record<string, string> {
  const fresh = deserialize(serialize(s)).world;
  const cor = (w: CityState["world"]) => h(JSON.stringify([...corridorsOf(w).bySeg]));
  const jun = (w: CityState["world"]) => h(JSON.stringify([...junctionsOf(w).byNode].map(([k, l]) => [k, l.hash] as const).sort((a, b) => a[0] - b[0])));
  return { corridors: cor(s.world), corridorsFresh: cor(fresh), junctions: jun(s.world), junctionsFresh: jun(fresh) };
}

/** zone-invariant.test.ts `run`, recording a digest after every operation. */
function scenario(seed: number, mode: ZoningMode, ops = 200, graph = false, natural = false): Record<string, string>[] {
  const rnd = makeRng(seed);
  const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  let s = flatCity(seed, mode, natural);
  const past: string[] = [], future: string[] = [];
  const trace: Record<string, string>[] = [];
  const pt = (): Pt => ({ x: ri(3, SIZE - 4) + 0.5, z: ri(3, SIZE - 4) + 0.5 });
  const near = (p: Pt, d: number): Pt => ({ x: Math.max(2.5, Math.min(SIZE - 2.5, p.x + ri(-d, d))), z: Math.max(2.5, Math.min(SIZE - 2.5, p.z + ri(-d, d))) });
  const rect = () => {
    const x0 = ri(0, SIZE - 2), y0 = ri(0, SIZE - 2), x1 = Math.min(SIZE - 1, x0 + ri(1, 14)), y1 = Math.min(SIZE - 1, y0 + ri(1, 14));
    const t: { x: number; y: number }[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) t.push({ x, y });
    return t;
  };
  const roadTile = (): { x: number; y: number } | null => {
    const segs = s.world.segments.filter((g) => !g.fixed && g.tiles.length);
    if (!segs.length) return null;
    const t = pick(pick(segs).tiles);
    return { x: t % s.world.size, y: (t / s.world.size) | 0 };
  };
  for (let op = 0; op < ops; op++) {
    const kind = ri(0, 15);
    let res: { ok: boolean } = { ok: true };
    const mutate = (f: () => { ok: boolean }) => {
      past.push(serialize(s));
      res = f();
      if (!res.ok) past.pop(); else future.length = 0;
    };
    try {
      if (kind <= 2) {
        const a = pt(), b = near(a, 18);
        const type = pick([1, 1, 2] as RoadType[]);
        mutate(() => placeRoad(s, type, [a, b]));
      } else if (kind === 3) {
        const a = pt(), c = near(a, 10), b = near(c, 10);
        mutate(() => placeRoad(s, 1, [a, c, b]));
      } else if (kind === 4) {
        const segs = s.world.segments.filter((g) => !g.fixed && segElevation(g) === "ground");
        if (!segs.length) continue;
        const g = pick(segs);
        mutate(() => upgradeRoad(s, g.id, g.type === 1 ? 2 : 1));
      } else if (kind === 5) {
        const t = roadTile();
        if (!t) continue;
        mutate(() => applyTool(s, "bulldoze", t.x, t.y));
      } else if (kind === 6) {
        const n = s.world.nodes.filter((nd) => nd.segs.length >= 3);
        if (!n.length) continue;
        const nd = pick(n);
        mutate(() => placeRoundabout(s, Math.floor(nd.x), Math.floor(nd.z)));
      } else if (kind === 7) {
        const p = pt();
        mutate(() => applyTool(s, "park", Math.floor(p.x), Math.floor(p.z)));
      } else if (kind <= 10) {
        const tool = pick(["res", "com", "ind"] as const);
        mutate(() => applyZoneBulk(s, tool, rect()));
      } else if (kind === 11) {
        mutate(() => applyZoneBulk(s, "bulldoze", rect()));
      } else if (kind === 12) {
        const p = pt(), zone = pick([1, 2, 3] as const);
        if (mode === "oriented") mutate(() => applyZoneAt(s, zone, p.x + rnd() - 0.5, p.z + rnd() - 0.5, { radius: pick([0, 1, 2] as const) }));
        else mutate(() => applyTool(s, pick(["res", "com", "ind"] as const), Math.floor(p.x), Math.floor(p.z)));
      } else if (kind === 13) {
        const p = pt();
        if (mode === "oriented") mutate(() => bulldozeAt(s, p.x, p.z));
        else mutate(() => applyTool(s, "bulldoze", Math.floor(p.x), Math.floor(p.z)));
      } else if (kind === 14) {
        if (rnd() < 0.5 && past.length) { future.push(serialize(s)); s = deserialize(past.pop()!); }
        else if (future.length) { past.push(serialize(s)); s = deserialize(future.pop()!); }
        else continue;
      } else {
        s = deserialize(serialize(s));
      }
    } catch (e) {
      trace.push({ op: String(op), crash: (e as Error).message });
      continue;
    }
    trace.push(graph ? { op: String(op), ...graphDigest(s) } : { op: String(op), ok: String(res.ok), money: String(s.money), ...digest(s) });
  }
  return trace;
}

function firstDiff(a: Record<string, string>[], b: Record<string, string>[]): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? {}, y = b[i] ?? {};
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    const bad = [...keys].filter((k) => x[k] !== y[k]);
    if (bad.length) return `step ${i} (op ${x.op ?? y.op}): ${bad.join(", ")}`;
  }
  return null;
}

function both<T>(f: () => T): { old: T; neu: T } {
  use(oracle, true);
  try {
    const old = f();
    use(current, false);
    const neu = f();
    return { old, neu };
  } finally {
    use(current, false);
  }
}

describe("zone pipeline: incremental == frozen oracle (byte-identical)", () => {
  const all = !!process.env.ZDIFF_ALL;
  const seeds = all ? [11, 23, 37, 41] : [11, 23];
  for (const mode of ["oriented", "tiles"] as const) for (const seed of seeds) {
    it(`${mode} seed ${seed}: 200 random ops`, () => {
      const { old, neu } = both(() => scenario(seed, mode));
      expect(old.length).toBeGreaterThan(100);
      expect(firstDiff(old, neu)).toBeNull();
    }, 300_000);
  }

  for (const seed of all ? [5, 11, 23, 37] : [5]) {
    it(`oriented seed ${seed} on natural terrain (hills, water, levelling): 200 random ops`, () => {
      const { old, neu } = both(() => scenario(seed, "oriented", 200, false, true));
      expect(old.length).toBeGreaterThan(100);
      expect(firstDiff(old, neu)).toBeNull();
    }, 300_000);
  }

  it("heights changed behind the pipeline's back (terraform, water) are picked up by the next rebuild", () => {
    const { old, neu } = both(() => {
      const trace: Record<string, string>[] = [];
      const s = flatCity(9, "oriented");
      const w = s.world;
      placeRoad(s, 1, [{ x: 4.5, z: 12.5 }, { x: 35.5, z: 12.5 }]);
      placeRoad(s, 2, [{ x: 4.5, z: 24.5 }, { x: 35.5, z: 26.5 }]);
      const all: { x: number; y: number }[] = [];
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) all.push({ x, y });
      applyZoneBulk(s, "res", all);
      trace.push({ op: "zoned", ...digest(s) });
      // A pond, a cliff and a gentle hill, each followed by an unrelated road elsewhere (a rebuild).
      const edits: [string, (x: number, y: number) => number][] = [
        ["pond", (x, y) => (Math.hypot(x - 10, y - 15) < 2.2 ? 0.01 : NaN)],
        ["cliff", (x, y) => (x >= 22 && x <= 26 && y >= 13 && y <= 18 ? 1.8 : NaN)],
        ["hill", (x, y) => (Math.hypot(x - 18, y - 21) < 4 ? 0.35 + (4 - Math.hypot(x - 18, y - 21)) * 0.3 : NaN)],
      ];
      let k = 0;
      for (const [name, f] of edits) {
        for (let y = 0; y <= SIZE; y++) for (let x = 0; x <= SIZE; x++) {
          const v = f(x, y);
          if (!Number.isNaN(v)) w.heights[cidx(w, x, y)] = v;
        }
        placeRoad(s, 1, [{ x: 6.5 + 8 * k, z: 34.5 }, { x: 10.5 + 8 * k, z: 37.5 }]);
        k++;
        trace.push({ op: name, ...digest(s) });
      }
      return trace;
    });
    expect(firstDiff(old, neu)).toBeNull();
  }, 300_000);

  it("lot rectangle answers carried across road edits equal a fresh query", () => {
    use(current, false);
    const s = flatCity(13, "oriented");
    const w = s.world;
    placeRoad(s, 1, [{ x: 5.5, z: 8.5 }, { x: 20.5, z: 22.5 }, { x: 34.5, z: 9.5 }]);
    placeRoad(s, 2, [{ x: 4.5, z: 30.5 }, { x: 35.5, z: 31.5 }]);
    const poses: [number, number, number, number, number][] = [];
    for (let z = 2; z < SIZE - 2; z += 1.25) for (let x = 2; x < SIZE - 2; x += 1.25) {
      poses.push([x, z, 1 + ((x * 3 + z) % 3), 1 + ((x + z * 5) % 4), (x * 0.37 + z * 0.11) % Math.PI]);
    }
    const ask = (sf: ReturnType<typeof zoneHooks.roadSurface>, f: typeof zoneHooks.lotRectOnRoad) =>
      poses.map(([x, z, lw, ld, yaw]) => f(sf, x, z, lw, ld, yaw, 0.005)).join("");
    ask(zoneHooks.roadSurface(w), zoneHooks.lotRectOnRoad); // fill the memo
    const edits: (() => unknown)[] = [
      () => placeRoad(s, 1, [{ x: 12.5, z: 4.5 }, { x: 14.5, z: 36.5 }]),
      () => upgradeRoad(s, w.segments.find((g) => !g.fixed && g.pts.length === 3)!.id, 2),
      () => placeRoad(s, 1, [{ x: 20.5, z: 22.5 }, { x: 28.5, z: 30.5 }]),
      () => { const g = w.segments.find((x) => !x.fixed && x.tiles.length > 6)!; const t = g.tiles[3]; return applyTool(s, "bulldoze", t % w.size, (t / w.size) | 0); },
    ];
    for (const edit of edits) {
      edit();
      const carried = ask(zoneHooks.roadSurface(w), zoneHooks.lotRectOnRoad);
      const fresh = ask(or.roadSurface(w) as never, or.lotRectOnRoad as never);
      expect(carried).toBe(fresh);
      expect(carried.includes("true") && carried.includes("false")).toBe(true);
    }
  }, 300_000);

  it("facilities appearing and vanishing between rival blocks (validity changes without road changes)", () => {
    const { old, neu } = both(() => {
      const trace: Record<string, string>[] = [];
      const s = flatCity(7, "oriented");
      const all: { x: number; y: number }[] = [];
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) all.push({ x, y });
      const parks = [[12, 23], [13, 24], [20, 23], [21, 24], [27, 23], [16, 11], [22, 17]] as const;
      // Parks first (next to the first road), so the rival blocks of the later roads are built while the cells under
      // the parks are dead; clearing the parks then revives cells between rival blocks without any road change.
      // The first road continues the highway entry (row 20), so the parks are within reach of a connected road.
      const entry = s.world.segments.find((g) => g.fixed)!.pts[1];
      placeRoad(s, 1, [{ x: entry.x, z: entry.z }, { x: 35.5, z: entry.z }]);
      const placed = parks.filter(([x, y]) => applyTool(s, "park", x, y).ok).length;
      trace.push({ op: "parks", placed: String(placed), ...digest(s) });
      placeRoad(s, 1, [{ x: 4.5, z: 27.5 }, { x: 35.5, z: 27.5 }]);
      placeRoad(s, 2, [{ x: 10.5, z: 8.5 }, { x: 30.5, z: 13.5 }]);
      applyZoneBulk(s, "res", all);
      trace.push({ op: "zoned", ...digest(s) });
      for (const [x, y] of parks) {
        applyTool(s, "bulldoze", x, y);
        trace.push({ op: `clear ${x},${y}`, ...digest(s) });
        applyZoneBulk(s, "com", all.filter((t) => Math.abs(t.x - x) <= 3 && Math.abs(t.y - y) <= 3));
        trace.push({ op: `rezone ${x},${y}`, ...digest(s) });
      }
      return trace;
    });
    expect(Number(old[0].placed)).toBeGreaterThan(4);
    expect(firstDiff(old, neu)).toBeNull();
  }, 300_000);

  it("corridors and junction layouts after incremental edits equal a fresh build", () => {
    const t = scenario(23, "oriented", 120, true);
    for (const r of t) {
      if (r.crash) continue;
      expect(r.corridors, `op ${r.op}`).toBe(r.corridorsFresh);
      expect(r.junctions, `op ${r.op}`).toBe(r.junctionsFresh);
    }
  }, 300_000);

  const fixtures = all ? FIXTURES : FIXTURES.filter((f) => f.name === "grid96");
  for (const fx of fixtures) {
    it(`fixture ${fx.name}: build, place road, bulk paint, bulldoze, upgrade, load`, () => {
      const skip = oz.oracleOpts.skipAbove;
      // The 1000+ segment city: the oracle runs its exact path (the shortcut is gone from the incremental pipeline).
      oz.oracleOpts.skipAbove = Infinity;
      try {
        const { old, neu } = both(() => {
          const trace: Record<string, string>[] = [];
          const s0 = fx.city();
          trace.push({ op: "build", ...digest(s0) });
          const snap = serialize(s0);
          const roadPts = newRoadFor(s0)!, tile = roadTileFor(s0)!, up = upgradeFor(s0)!, rect = paintRect(s0);
          const run = (name: string, f: (s: CityState) => { ok: boolean }) => {
            const s = deserialize(snap);
            trace.push({ op: `load:${name}`, ...digest(s) });
            const r = f(s);
            trace.push({ op: name, ok: String(r.ok), ...digest(s) });
            const re = deserialize(serialize(s));
            trace.push({ op: `${name}+reload`, ...digest(re) });
          };
          run("place road", (s) => placeRoad(s, 1, roadPts));
          run("bulk paint", (s) => applyZoneBulk(s, "ind", rect));
          run("bulldoze", (s) => applyTool(s, "bulldoze", tile.x, tile.y));
          run("upgrade", (s) => upgradeRoad(s, up.id, up.type));
          return trace;
        });
        expect(firstDiff(old, neu)).toBeNull();
      } finally {
        oz.oracleOpts.skipAbove = skip;
      }
    }, 600_000);
  }
});
