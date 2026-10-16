/**
 * Zone pipeline benchmark (task zperf). Skipped unless ZPERF=1 (it builds three cities and takes ~a minute):
 *
 *   ZPERF=1 npx vitest run src/sim/zone-perf.bench.test.ts
 *
 * Fixtures (zone-perf.fixtures.ts): 96x96 grid (~170 segments), 96x96 organic curves (~300), 128x128 dense grid
 * (~1000+). Operations: place one road, bulk paint 2000 tiles, bulldoze one road tile, upgrade one segment, load a
 * save. Each operation runs REPS times on a fresh copy of the city (caches warmed the way the game warms them: the
 * zone blocks, junction layouts and road surface are built before the edit) and the median per phase is printed.
 * ZPERF_OUT=<file> also writes the table as markdown. ZPERF_ORACLE=1 runs the frozen pre-zperf pipeline instead (the
 * "before" column; ZPERF_ORACLE_SKIP=Infinity disables its old > 1000 segment shortcut).
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyTool, applyZoneBulk, getZoneBlocks, placeRoad, upgradeRoad, type CityState } from "./sim";
import { deserialize, serialize } from "./save";
import { junctionsOf } from "./junction";
import { roadSurface } from "./roadsurface";
import { zprof, zpReset } from "./zoneprof";
import { FIXTURES, newRoadFor, paintRect, roadTileFor, upgradeFor } from "./zone-perf.fixtures";
import { ROAD, type RoadType } from "./world";
import { zoneHooks, type ZoneHooks } from "./zonehooks";
import * as oz from "./zone-oracle/zoneblocks";
import * as ol from "./zone-oracle/orientedlots";
import * as om from "./zone-oracle/mirror";
import * as or from "./zone-oracle/roadsurface";

const REPS = Number(process.env.ZPERF_REPS ?? 7);
const PHASES = [
  "junctionsOf", "blocksForSegment", "valid.prepRoads", "valid.prepJunctions", "valid.cells", "resolveOverlaps",
  "resolve.neighbours", "resolve.sortFallback", "finalize", "migrate", "scrub", "roadSurface.sidewalk", "planLots", "mirror", "reconcile",
];

const median = (xs: number[]): number => {
  const a = [...xs].sort((p, q) => p - q);
  return a.length ? a[(a.length - 1) >> 1] : 0;
};

interface Row { fixture: string; op: string; total: number; phases: Map<string, number> }

function warm(s: CityState): void {
  getZoneBlocks(s.world);
  junctionsOf(s.world);
  roadSurface(s.world);
}

function measure(snap: string, op: (s: CityState) => void, fresh = true): { total: number; phases: Map<string, number> } {
  const totals: number[] = [];
  const per = new Map<string, number[]>();
  for (let r = 0; r < REPS + 1; r++) {
    const s = fresh ? deserialize(snap) : (null as unknown as CityState);
    if (s) warm(s);
    zpReset();
    zprof.on = true;
    const t0 = performance.now();
    op(s);
    const dt = performance.now() - t0;
    zprof.on = false;
    if (r === 0) continue; // JIT warm-up
    totals.push(dt);
    for (const ph of PHASES) {
      const arr = per.get(ph) ?? [];
      arr.push(zprof.ms.get(ph) ?? 0);
      per.set(ph, arr);
    }
  }
  const phases = new Map<string, number>();
  for (const [k, v] of per) phases.set(k, median(v));
  return { total: median(totals), phases };
}

/**
 * Always-on guard (loose: ~4x the iPad target, so a loaded parallel suite does not flake, but a return of the old
 * whole-city recompute, 46-188 ms per edit, fails): one road placement, one road bulldoze and one 2000-tile repaint
 * on the 96x96 grid fixture, best of several fresh copies, reconcile time from the phase timer.
 */
describe("zone pipeline guard", () => {
  it("keeps a road edit and a bulk repaint on the 96x96 grid well under the old cost", () => {
    const city = FIXTURES[0].city();
    const snap = serialize(city);
    const roadPts = newRoadFor(city)!, tile = roadTileFor(city)!, rect = paintRect(city);
    const best = (op: (s: CityState) => void): number => {
      let b = Infinity;
      for (let r = 0; r < 5; r++) {
        const s = deserialize(snap);
        warm(s);
        zpReset();
        zprof.on = true;
        op(s);
        zprof.on = false;
        if (r > 0) b = Math.min(b, zprof.ms.get("reconcile") ?? Infinity);
      }
      return b;
    };
    const road = best((s) => { placeRoad(s, ROAD.STREET as RoadType, roadPts); });
    const dozer = best((s) => { applyTool(s, "bulldoze", tile.x, tile.y); });
    const paint = best((s) => { applyZoneBulk(s, "ind", rect); });
    expect(road).toBeLessThan(40);
    expect(dozer).toBeLessThan(40);
    expect(paint).toBeLessThan(40);
  }, 120_000);
});

describe.skipIf(!process.env.ZPERF)("zone pipeline benchmark (ZPERF=1)", () => {
  it("prints ms per phase per fixture", () => {
    const saved: ZoneHooks = { ...zoneHooks };
    if (process.env.ZPERF_ORACLE) {
      Object.assign(zoneHooks, {
        buildZoneBlocks: oz.buildZoneBlocks, nearestCell: oz.nearestCell, planOrientedLots: ol.planOrientedLots,
        rasterizeMirror: om.rasterizeMirror, lotRectOnRoad: or.lotRectOnRoad, roadSurface: or.roadSurface,
      } as unknown as ZoneHooks);
      oz.oracleOpts.skipAbove = Number(process.env.ZPERF_ORACLE_SKIP ?? 1000);
    }
    try {
    const rows: Row[] = [];
    const meta: string[] = [];
    for (const fx of FIXTURES) {
      const tb = performance.now();
      const city = fx.city();
      const build = performance.now() - tb;
      const w = city.world;
      let zoned = 0, cells = 0;
      for (const b of getZoneBlocks(w).blocks.values()) for (let i = 0; i < b.zone.length; i++) { cells++; if (b.zone[i] && b.valid[i]) zoned++; }
      const ground = w.segments.filter((g) => (g.elevation ?? "ground") === "ground").length;
      meta.push(`${fx.name}: size=${w.size} segments=${w.segments.length} ground=${ground} blocks=${getZoneBlocks(w).blocks.size} cells=${cells} zoned=${zoned} lots=${w.olots?.length ?? 0} (fixture build ${build.toFixed(0)} ms)`);
      const snap = serialize(city);
      const roadPts = newRoadFor(city);
      const tile = roadTileFor(city);
      const up = upgradeFor(city);
      const rect = paintRect(city);
      expect(roadPts && tile && up).toBeTruthy();
      const ops: [string, (s: CityState) => void][] = [
        ["place road", (s) => { expect(placeRoad(s, ROAD.STREET as RoadType, roadPts!).ok).toBe(true); }],
        ["bulk paint 2000", (s) => { expect(applyZoneBulk(s, "ind", rect).ok).toBe(true); }],
        ["bulldoze road tile", (s) => { expect(applyTool(s, "bulldoze", tile!.x, tile!.y).ok).toBe(true); }],
        ["upgrade segment", (s) => { expect(upgradeRoad(s, up!.id, up!.type).ok).toBe(true); }],
      ];
      for (const [name, op] of ops) {
        const m = measure(snap, op);
        rows.push({ fixture: fx.name, op: name, ...m });
      }
      const load = measure(snap, () => { deserialize(snap); }, false);
      rows.push({ fixture: fx.name, op: "load save", ...load });
    }
    const head = ["fixture", "op", "total", ...PHASES];
    const lines = [
      `| ${head.join(" | ")} |`,
      `|${head.map(() => "---").join("|")}|`,
      ...rows.map((r) => `| ${r.fixture} | ${r.op} | ${r.total.toFixed(2)} | ${PHASES.map((p) => (r.phases.get(p) ?? 0).toFixed(2)).join(" | ")} |`),
    ];
    const out = [...meta, "", ...lines].join("\n");
    console.info(`ZPERF (median of ${REPS}, ms)\n${out}`);
    if (process.env.ZPERF_OUT) writeFileSync(process.env.ZPERF_OUT, out + "\n");
    } finally {
      Object.assign(zoneHooks, saved);
      oz.oracleOpts.skipAbove = 1000;
    }
  }, 1_200_000);
});
