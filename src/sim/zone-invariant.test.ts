/**
 * Property test for "zoned building areas never invade the road" (docs/process/05-oriented-lots.md §1.8, task zinv).
 *
 * Seeded random sequences of 200 player operations (roads, curves, upgrades, road bulldozes, roundabouts, facilities,
 * bulk zone paints and clears, brush paints, undo/redo through snapshots, save/load) on small flat worlds, in both
 * zoning modes. After EVERY operation (no frame-loop sync in between) `checkZoneInvariant` must report zero
 * cell/lot/pad/kerb/mirror intersections with the physical road surface, zero zone state outside valid cells, zero
 * orphan mirror tiles and zero lot overlaps.
 *
 * ZINV_LOG=<file> writes the per-run totals (used for the task report).
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyTool, applyZoneAt, applyZoneBulk, bulldozeAt, getZoneBlocks, newCity, placeRoad, placeRoundabout, upgradeRoad,
  type CityState,
} from "./sim";
import { deserialize, serialize } from "./save";
import { makeRng } from "./rng";
import { cidx, segElevation, type Pt, type RoadType } from "./world";
import type { ZoningMode } from "./zonecells";
import { checkZoneInvariant, explainCellRoad, explainLotLot, explainLotRoad, explainLots, invariantClean, type ZoneInvariantReport } from "./zoneinvariant";

const SIZE = 40;
const OPS = 200;

function flatCity(seed: number, mode: ZoningMode): CityState {
  const s = newCity(seed, SIZE);
  const w = s.world;
  w.zoning = mode;
  s.money = 1e9;
  for (let y = 0; y <= w.size; y++) for (let x = 0; x <= w.size; x++) w.heights[cidx(w, x, y)] = 0.35;
  return s;
}

function restore(snap: string, mode: ZoningMode): CityState {
  const s = deserialize(snap);
  // main.ts swapCity: undo/redo/load keep the player's zoning preference.
  if (s.world.zoning !== mode) throw new Error(`snapshot restored as ${s.world.zoning}, expected ${mode}`);
  return s;
}

interface RunResult { ops: number; okOps: number; worst: ZoneInvariantReport; violations: string[]; zonedMax: number; crashes: number }

function run(seed: number, mode: ZoningMode): RunResult {
  const rnd = makeRng(seed);
  const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  let s = flatCity(seed, mode);
  const past: string[] = [], future: string[] = [];
  const worst: ZoneInvariantReport = { cellRoad: 0, validRoad: 0, zonedInvalid: 0, mirrorRoad: 0, mirrorOrphan: 0, lotRoad: 0, lotStale: 0, padRoad: 0, kerbOff: 0, lotLot: 0, tileRoad: 0, tileOrphan: 0 };
  const violations: string[] = [];
  let okOps = 0, zonedMax = 0, crashes = 0;
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
  for (let op = 0; op < OPS; op++) {
    const kind = ri(0, 15);
    let name = "", res: { ok: boolean } = { ok: true };
    const mutate = (n: string, f: () => { ok: boolean }) => {
      name = n;
      past.push(serialize(s));
      res = f();
      if (!res.ok) past.pop(); else future.length = 0;
    };
    try {
    if (kind <= 2) {
      const a = pt(), b = near(a, 18);
      const type = pick([1, 1, 2] as RoadType[]);
      mutate(`road${type} ${a.x},${a.z}->${b.x},${b.z}`, () => placeRoad(s, type, [a, b]));
    } else if (kind === 3) {
      const a = pt(), c = near(a, 10), b = near(c, 10);
      mutate(`curve ${a.x},${a.z}`, () => placeRoad(s, 1, [a, c, b]));
    } else if (kind === 4) {
      const segs = s.world.segments.filter((g) => !g.fixed && segElevation(g) === "ground");
      if (!segs.length) continue;
      const g = pick(segs);
      mutate(`upgrade ${g.id}`, () => upgradeRoad(s, g.id, g.type === 1 ? 2 : 1));
    } else if (kind === 5) {
      const t = roadTile();
      if (!t) continue;
      mutate(`bulldoze road ${t.x},${t.y}`, () => applyTool(s, "bulldoze", t.x, t.y));
    } else if (kind === 6) {
      const n = s.world.nodes.filter((nd) => nd.segs.length >= 3);
      if (!n.length) continue;
      const nd = pick(n);
      mutate(`roundabout ${nd.id}`, () => placeRoundabout(s, Math.floor(nd.x), Math.floor(nd.z)));
    } else if (kind === 7) {
      const p = pt();
      mutate(`park ${p.x},${p.z}`, () => applyTool(s, "park", Math.floor(p.x), Math.floor(p.z)));
    } else if (kind <= 10) {
      const tool = pick(["res", "com", "ind"] as const);
      mutate(`bulk ${tool}`, () => applyZoneBulk(s, tool, rect()));
    } else if (kind === 11) {
      mutate("bulk clear", () => applyZoneBulk(s, "bulldoze", rect()));
    } else if (kind === 12) {
      const p = pt(), zone = pick([1, 2, 3] as const);
      if (mode === "oriented") mutate("brush", () => applyZoneAt(s, zone, p.x + rnd() - 0.5, p.z + rnd() - 0.5, { radius: pick([0, 1, 2] as const) }));
      else mutate("brush", () => applyTool(s, pick(["res", "com", "ind"] as const), Math.floor(p.x), Math.floor(p.z)));
    } else if (kind === 13) {
      const p = pt();
      if (mode === "oriented") mutate("bulldozeAt", () => bulldozeAt(s, p.x, p.z));
      else mutate("bulldoze tile", () => applyTool(s, "bulldoze", Math.floor(p.x), Math.floor(p.z)));
    } else if (kind === 14) {
      if (rnd() < 0.5 && past.length) { name = "undo"; future.push(serialize(s)); s = restore(past.pop()!, mode); }
      else if (future.length) { name = "redo"; past.push(serialize(s)); s = restore(future.pop()!, mode); }
      else continue;
    } else {
      name = "save/load";
      s = restore(serialize(s), mode);
    }
    } catch (e) {
      // A snapshot that cannot be restored (undo, save/load) is a violation too: report it and keep going.
      if (violations.length < 5) violations.push(`op ${op} ${name || kind}: CRASH ${(e as Error).message}`);
      crashes++;
      continue;
    }
    if (res.ok) okOps++;
    const r = checkZoneInvariant(s.world, getZoneBlocks(s.world));
    let zoned = 0;
    if (mode === "oriented") {
      for (const b of getZoneBlocks(s.world).blocks.values()) for (let i = 0; i < b.zone.length; i++) if (b.valid[i] && b.zone[i]) zoned++;
    } else for (const z of s.world.zone) if (z) zoned++;
    zonedMax = Math.max(zonedMax, zoned);
    for (const k of Object.keys(worst) as (keyof ZoneInvariantReport)[]) worst[k] = Math.max(worst[k], r[k]);
    if (r.validRoad && process.env.ZINV_EXPLAIN && violations.length < 5) violations.push(`op ${op} ${name} validRoad`, ...explainCellRoad(s.world, getZoneBlocks(s.world), 3, true));
    if (!invariantClean(r) && violations.length < 5) {
      violations.push(`op ${op} ${name}: ${JSON.stringify(r)}`);
      if (r.cellRoad && process.env.ZINV_EXPLAIN) violations.push(...explainCellRoad(s.world, getZoneBlocks(s.world)));
      if (process.env.ZINV_DUMP && violations.length === 1) writeFileSync(`${process.env.ZINV_DUMP}-${mode}-${seed}.json`, serialize(s));
      if (r.lotLot && process.env.ZINV_EXPLAIN) violations.push(...explainLotLot(s.world, getZoneBlocks(s.world)));
      if (r.lotRoad && process.env.ZINV_EXPLAIN) violations.push(...explainLotRoad(s.world, getZoneBlocks(s.world)));
      if ((r.padRoad || r.kerbOff) && process.env.ZINV_EXPLAIN) violations.push(...explainLots(s.world, getZoneBlocks(s.world)));
    }
  }
  return { ops: OPS, okOps, worst, violations, zonedMax, crashes };
}

describe("zone/road invariant under random operations", () => {
  const log: string[] = [];
  for (const mode of ["oriented", "tiles"] as const) {
    // ZINV_SEEDS=1,2,3 runs other seeds (soak runs for the report); the default four keep CI fast.
    const seeds = process.env.ZINV_SEEDS ? process.env.ZINV_SEEDS.split(",").map(Number) : [11, 23, 37, 41];
    for (const seed of seeds) {
      it(`${mode} seed ${seed}: 200 ops keep zones off the road`, () => {
        const r = run(seed, mode);
        log.push(`${mode} seed=${seed} ok=${r.okOps}/${r.ops} crashes=${r.crashes} zonedMax=${r.zonedMax} worst=${JSON.stringify(r.worst)}${r.violations.length ? "\n  " + r.violations.join("\n  ") : ""}`);
        if (process.env.ZINV_LOG) writeFileSync(process.env.ZINV_LOG, log.join("\n") + "\n");
        expect(r.zonedMax).toBeGreaterThan(0);
        expect(r.violations).toEqual([]);
      }, 120_000);
    }
  }
});

// ------------------------------------------------------------------ root causes found by the soak (zinv report)

const zonedOf = (s: CityState, segIds: Set<number>): number => {
  let n = 0;
  for (const b of getZoneBlocks(s.world).blocks.values()) {
    if (!segIds.has(b.seg)) continue;
    for (let i = 0; i < b.zone.length; i++) if (b.valid[i] && b.zone[i]) n++;
  }
  return n;
};
const rectTiles = (x0: number, y0: number, x1: number, y1: number) => {
  const t: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) t.push({ x, y });
  return t;
};
const clean = (s: CityState) => checkZoneInvariant(s.world, getZoneBlocks(s.world));

describe("zinv root causes", () => {
  it("a road drawn across zoned cells gets no zone copied onto its own cells (CS1: covered cells just vanish)", () => {
    const s = flatCity(5, "oriented");
    expect(placeRoad(s, 1, [{ x: 4.5, z: 20.5 }, { x: 35.5, z: 20.5 }]).ok).toBe(true);
    expect(applyZoneBulk(s, "res", rectTiles(2, 14, 37, 26)).ok).toBe(true);
    const before = new Set(s.world.segments.map((g) => g.id));
    expect(placeRoad(s, 1, [{ x: 10.5, z: 12.5 }, { x: 26.5, z: 28.5 }]).ok).toBe(true);
    const fresh = new Set(s.world.segments.filter((g) => !before.has(g.id) && Math.abs(g.pts[0].z - g.pts[g.pts.length - 1].z) > 1).map((g) => g.id));
    expect(fresh.size).toBeGreaterThan(0);
    expect(zonedOf(s, fresh)).toBe(0);
    expect(invariantClean(clean(s))).toBe(true);
  });

  it("splitting a zoned street keeps the zone of its unchanged cells", () => {
    const s = flatCity(5, "oriented");
    expect(placeRoad(s, 1, [{ x: 4.5, z: 20.5 }, { x: 35.5, z: 20.5 }]).ok).toBe(true);
    expect(applyZoneBulk(s, "res", rectTiles(2, 14, 37, 19)).ok).toBe(true);
    const zoned = () => [...getZoneBlocks(s.world).blocks.values()].reduce((n, b) => n + b.zone.reduce((m, z, i) => m + (z && b.valid[i] ? 1 : 0), 0), 0);
    const before = zoned();
    // A side street on the other side splits the zoned street in the middle.
    expect(placeRoad(s, 1, [{ x: 20.5, z: 20.5 }, { x: 20.5, z: 30.5 }]).ok).toBe(true);
    expect(zoned()).toBeGreaterThan(before - 8);
    expect(invariantClean(clean(s))).toBe(true);
  });

  it("a roundabout revalidates zones and lots at once (lots were left on the new ring)", () => {
    const s = flatCity(5, "oriented");
    placeRoad(s, 1, [{ x: 6.5, z: 20.5 }, { x: 34.5, z: 20.5 }]);
    placeRoad(s, 1, [{ x: 20.5, z: 6.5 }, { x: 20.5, z: 34.5 }]);
    expect(applyZoneBulk(s, "res", rectTiles(2, 2, 37, 37)).ok).toBe(true);
    expect(placeRoundabout(s, 20, 20).ok).toBe(true);
    const r = clean(s);
    expect(r).toEqual({ ...r, lotRoad: 0, padRoad: 0, lotStale: 0, lotLot: 0, mirrorOrphan: 0, cellRoad: 0 });
  });

  it("bulldozing a road leaves lots, mirror and the save consistent immediately (a stale save would not load)", () => {
    const s = flatCity(5, "oriented");
    placeRoad(s, 1, [{ x: 4.5, z: 20.5 }, { x: 35.5, z: 20.5 }]);
    placeRoad(s, 1, [{ x: 20.5, z: 20.5 }, { x: 20.5, z: 34.5 }]);
    expect(applyZoneBulk(s, "res", rectTiles(2, 14, 37, 36)).ok).toBe(true);
    const side = s.world.segments.find((g) => g.pts[0].x === 20.5 && g.pts[1].x === 20.5)!;
    const t = side.tiles[side.tiles.length - 1];
    expect(applyTool(s, "bulldoze", t % s.world.size, (t / s.world.size) | 0).ok).toBe(true);
    expect(invariantClean(clean(s))).toBe(true);
    expect(() => deserialize(serialize(s))).not.toThrow();
  });

  it("re-zoning after lots were dropped never points cells at another lot (id remap collision)", () => {
    const s = flatCity(5, "oriented");
    placeRoad(s, 1, [{ x: 4.5, z: 20.5 }, { x: 35.5, z: 20.5 }]);
    // Low ids kept, a run of higher ids dropped, then more new lots than the id gap: the old in-place renaming
    // (5 -> 9, then 9 -> 13, ...) re-pointed already renamed cells at a later lot.
    expect(applyZoneBulk(s, "res", rectTiles(4, 14, 7, 19)).ok).toBe(true);
    expect(applyZoneBulk(s, "ind", rectTiles(9, 14, 20, 19)).ok).toBe(true);
    expect(applyZoneBulk(s, "bulldoze", rectTiles(9, 14, 20, 19)).ok).toBe(true);
    // 28 new lots planned as 4..31 while ids up to 7 were already issued: renamed 4 -> 8, then 8 -> 12, ...
    expect(applyZoneBulk(s, "res", rectTiles(2, 21, 37, 26)).ok).toBe(true);
    const r = clean(s);
    expect(r.lotStale).toBe(0);
    expect(r.lotLot).toBe(0);
    const ids = (s.world.olots ?? []).map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a replan keeps landmarks and construction schedules of kept lots", () => {
    const s = flatCity(5, "oriented");
    placeRoad(s, 1, [{ x: 4.5, z: 20.5 }, { x: 35.5, z: 20.5 }]);
    expect(applyZoneBulk(s, "res", rectTiles(2, 14, 37, 19)).ok).toBe(true);
    const lot = s.world.olots![0];
    lot.landmark = "opera";
    lot.construction = { state: "structure", progress: 0.4, duration: 20 };
    expect(placeRoad(s, 1, [{ x: 30.5, z: 30.5 }, { x: 36.5, z: 36.5 }]).ok).toBe(true);
    const kept = s.world.olots!.find((l) => l.id === lot.id)!;
    expect(kept.landmark).toBe("opera");
    expect(kept.construction).toEqual({ state: "structure", progress: 0.4, duration: 20 });
  });

  it("tiles: the drawn asphalt of an avenue (centreline on tile centres) is never zoned", () => {
    const s = flatCity(5, "tiles");
    expect(placeRoad(s, 2, [{ x: 6.5, z: 20.5 }, { x: 30.5, z: 20.5 }]).ok).toBe(true);
    // Raster rows 20..21; the asphalt (half width 0.9 about z = 20.5) covers 0.4 of row 19.
    expect(applyTool(s, "res", 15, 19)).toEqual({ ok: false, reason: "Tile is a road" });
    expect(applyTool(s, "res", 15, 22).ok).toBe(true);
    expect(applyTool(s, "res", 15, 18).ok).toBe(true);
  });

  it("tiles: removing a road clears the zones it stranded and the zones under a new diagonal", () => {
    const s = flatCity(5, "tiles");
    expect(placeRoad(s, 1, [{ x: 6.5, z: 10.5 }, { x: 30.5, z: 10.5 }]).ok).toBe(true);
    expect(applyZoneBulk(s, "res", rectTiles(6, 6, 30, 14)).ok).toBe(true);
    expect(placeRoad(s, 1, [{ x: 8.5, z: 6.5 }, { x: 16.5, z: 14.5 }]).ok).toBe(true);
    expect(clean(s).tileRoad).toBe(0);
    const g = s.world.segments.find((x) => !x.fixed && x.pts.every((p) => p.z === 10.5) && x.pts.some((p) => p.x === 30.5))!;
    const t = g.tiles[Math.floor(g.tiles.length / 2)];
    expect(applyTool(s, "bulldoze", t % s.world.size, (t / s.world.size) | 0).ok).toBe(true);
    const r = clean(s);
    expect(r.tileOrphan).toBe(0);
    expect(r.tileRoad).toBe(0);
  });

  it("switching tiles -> oriented moves zones to cells instead of dropping them", async () => {
    const { setZoningMode } = await import("./sim");
    const s = flatCity(5, "tiles");
    placeRoad(s, 1, [{ x: 4.5, z: 20.5 }, { x: 35.5, z: 20.5 }]);
    expect(applyZoneBulk(s, "res", rectTiles(6, 16, 30, 19)).ok).toBe(true);
    const tiles = s.world.zone.reduce((n, z) => n + (z ? 1 : 0), 0);
    setZoningMode(s, "oriented");
    const cells = [...getZoneBlocks(s.world).blocks.values()].reduce((n, b) => n + b.zone.reduce((m, z, i) => m + (z && b.valid[i] ? 1 : 0), 0), 0);
    expect(cells).toBeGreaterThan(tiles * 0.8);
    expect(invariantClean(clean(s))).toBe(true);
  });
});
