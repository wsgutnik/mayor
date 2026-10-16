/**
 * Report-only performance measurement: dense 96x96 road/traffic city (Roads 1B).
 *
 * Builds the same deterministic city in both trees (baseline skips only the
 * interchange stamping, which needs src/sim/interchange.ts), grows it for 4
 * game-months, fills traffic to the vehicle cap, then measures warm
 * (3 warm-up iterations, median of 10):
 *   (a) buildRoadNetworkGeometry with {atlas:true} and {atlas:false},
 *   (b) junctionsOf after a one-segment edit (addSegment bumps graphRevision),
 *   (c) tickTraffic(0.1) at the vehicle cap,
 *   (d) junction layout counts by kind.
 *
 * Opt-in: runs only with MAYOR_PERF=1. Numbers go to $PERF_OUT or, by
 * default, a file under os.tmpdir(). This test asserts nothing about
 * milliseconds; it only asserts the harness itself is intact (placements
 * held, geometry non-empty, cap reached).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyTool, applyZoneBulk, newCity, placeRoad, step, type CityState } from "../sim/sim";
import { cidx, heightAt, ROAD, ZONE, type Pt, type RoadType } from "../sim/world";
import { addSegment, removeSegment } from "../sim/roads";
import { junctionsOf } from "../sim/junction";
import { newTraffic, tickTraffic } from "../sim/traffic";
import { buildRoadNetworkGeometry } from "../render/roads";

const OUT = process.env.PERF_OUT ?? join(tmpdir(), "mayor-perf-city.txt");
const PERF = process.env.MAYOR_PERF === "1";
const LABEL = process.env.PERF_LABEL ?? "unknown";
/** Private MAX_VEHICLES in src/sim/traffic.ts (same value on baseline). */
const VEHICLE_CAP = 260;
const WARM = 3, SAMPLES = 10;

/** 6 grid lines each way at 14-tile spacing. */
const LINES = [10.5, 24.5, 38.5, 52.5, 66.5, 80.5];
/** Full-span piece stops: joints sit exactly on the crossing lines. */
const STOPS = [2.5, 10.5, 24.5, 38.5, 52.5, 66.5, 80.5, 93.5];
/** Gapped lines leave x in [24.5, 66.5] open for interchange ramps/terminals. */
const GAP_STOPS = [2.5, 10.5, 24.5, 66.5, 80.5, 93.5];
const H1Z = 45.5; // east-west highway (crosses vertical avenues 10.5/38.5/66.5)
const H2X = 87.5; // north-south highway (crosses horizontal avenues 10.5/38.5/66.5), east of the gore field
/** The x=52.5 interchange cross runs [31.5, 59.5] unjointed so #1's ramps overpass it. */
const IX2_STOPS = [2.5, 10.5, 24.5, 31.5, 59.5, 66.5, 80.5, 93.5];
const VTYPE: RoadType[] = [ROAD.ONEWAY_AVENUE, ROAD.STREET, ROAD.AVENUE, ROAD.STREET, ROAD.AVENUE, ROAD.STREET];
const HTYPE: RoadType[] = [ROAD.AVENUE, ROAD.STREET, ROAD.AVENUE, ROAD.STREET, ROAD.ONEWAY_AVENUE, ROAD.STREET];
const GAPPED = new Set([38.5, 52.5]);
/** One-segment edit probe for (b): T-stub off a straight street stretch. */
const STUB_A: Pt = { x: 24.5, z: 60.5 };
const STUB_B: Pt = { x: 28.5, z: 60.5 };

const P = (x: number, z: number): Pt => ({ x, z });

function median(xs: number[]): number {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function stats(ts: number[]): { median: number; mean: number; min: number; max: number } {
  return {
    median: median(ts),
    mean: ts.reduce((x, y) => x + y, 0) / ts.length,
    min: Math.min(...ts),
    max: Math.max(...ts),
  };
}

function timed(fn: () => void): number[] {
  for (let i = 0; i < WARM; i++) fn();
  const ts: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now();
    fn();
    ts.push(performance.now() - t0);
  }
  return ts;
}

function buildCity(): { s: CityState; placementFailures: string[] } {
  const s = newCity(7, 96, "plains");
  const w = s.world;
  w.zoning = "oriented";
  s.money = 1e9;
  for (let y = 0; y <= w.size; y++) for (let x = 0; x <= w.size; x++) w.heights[cidx(w, x, y)] = 0.35;
  const placementFailures: string[] = [];
  const road = (type: RoadType, pts: Pt[], note: string): void => {
    const r = placeRoad(s, type, pts);
    if (!r.ok) placementFailures.push(`${note}: ${r.reason}`);
  };
  const pieces = (stops: number[]): [number, number][] =>
    stops.slice(1).map((e, i) => [stops[i], e] as [number, number]);

  // Highways first so later crossings bridge over them at ground level.
  road(ROAD.HIGHWAY, [P(2.5, H1Z), P(45.5, H1Z)], "H1a");
  road(ROAD.HIGHWAY, [P(45.5, H1Z), P(93.5, H1Z)], "H1b");
  road(ROAD.HIGHWAY, [P(H2X, 2.5), P(H2X, 38.5)], "H2a");
  road(ROAD.HIGHWAY, [P(H2X, 38.5), P(H2X, 52.5)], "H2b-over-H1");
  road(ROAD.HIGHWAY, [P(H2X, 52.5), P(H2X, 93.5)], "H2c");
  // West entry connector (entry node at 2.5,48.5) so the grid is connected.
  road(ROAD.STREET, [P(2.5, 48.5), P(10.5, 48.5)], "entry-link");

  // Horizontal grid lines (one-way pieces all drawn eastward).
  LINES.forEach((z, k) => {
    const stops = GAPPED.has(z) ? GAP_STOPS : STOPS;
    // The gap is the [24.5, 66.5] span; every other span is road.
    for (const [a, b] of pieces(stops)) {
      if (GAPPED.has(z) && a === 24.5 && b === 66.5) continue;
      road(HTYPE[k], [P(a, z), P(b, z)], `H${z}[${a}-${b}]`);
    }
  });
  // Vertical grid lines (one-way pieces all drawn southward).
  LINES.forEach((x, k) => {
    const stops = x === 52.5 ? IX2_STOPS : STOPS;
    for (const [a, b] of pieces(stops)) road(VTYPE[k], [P(x, a), P(x, b)], `V${x}[${a}-${b}]`);
  });
  return { s, placementFailures };
}

function placeFacilities(s: CityState): { power: string; watertower: string } {
  const trySpots = (tool: "power" | "watertower", spots: [number, number][]): string => {
    const reasons: string[] = [];
    for (const [x, y] of spots) {
      const r = applyTool(s, tool, x, y);
      if (r.ok) return `${x},${y}`;
      reasons.push(`(${x},${y}): ${r.reason}`);
    }
    return `FAILED[${reasons.join("; ")}]`;
  };
  return {
    power: trySpots("power", [[84, 84], [84, 10], [10, 84]]),
    watertower: trySpots("watertower", [[5, 85], [90, 5], [5, 5]]),
  };
}

/** Stamp the two diamond interchanges; baseline has no interchange module. */
async function stampInterchanges(s: CityState): Promise<string> {
  let ix: typeof import("../sim/interchange");
  try {
    ix = await import("../sim/interchange");
  } catch {
    return "skipped: no interchange module (baseline)";
  }
  const taps: [number, number][] = [[38.5, H1Z], [52.5, H1Z]];
  const stamped: string[] = [];
  for (const [x, z] of taps) {
    const plan = ix.planInterchange(s, x, z);
    if (!plan.ok) return `FAILED at (${x},${z}): ${plan.reason} [stamped: ${stamped.join("; ")}]`;
    const placed = ix.placeInterchange(s, plan);
    if (!placed.ok) return `FAILED to place at (${x},${z}): ${placed.reason} [stamped: ${stamped.join("; ")}]`;
    stamped.push(`(${x},${z})`);
  }
  return `stamped: ${stamped.join(" ")}`;
}

function zoneAll(s: CityState): void {
  const w = s.world;
  const bands = [["res", 0, 31], ["com", 32, 63], ["ind", 64, 95]] as const;
  for (const [tool, y0, y1] of bands) {
    const tiles: { x: number; y: number }[] = [];
    for (let y = y0; y <= y1; y++) for (let x = 0; x < w.size; x++) tiles.push({ x, y });
    applyZoneBulk(s, tool, tiles);
  }
}

function findStubSeg(s: CityState): number | undefined {
  const node = s.world.nodes.find((n) => Math.abs(n.x - STUB_B.x) < 1e-6 && Math.abs(n.z - STUB_B.z) < 1e-6);
  return node && node.segs.length === 1 ? node.segs[0] : undefined;
}

describe("roads 1B city perf (report-only)", () => {
  it.skipIf(!PERF)("measures dense 96x96 road/traffic rebuild + tick", async () => {
    const { s, placementFailures } = buildCity();
    const w = s.world;
    const facilities = placeFacilities(s);
    const interchange = await stampInterchanges(s);
    const interchangeOk = interchange.startsWith("stamped");
    zoneAll(s);
    for (let d = 0; d < 4 * 30; d++) step(s);

    // Fill traffic to the cap. Utility coverage is rationed per tile of supply,
    // so a fully zoned 96x96 city cannot serve every lot from a few plants;
    // demand is seeded from the zoned tiles like traffic-perf.test.ts does.
    const organicPop = Math.round(s.population);
    const t = newTraffic(w.size, 7);
    tickTraffic(s, t, 0);
    t.homes = []; t.jobs = [];
    for (let i = 0; i < w.zone.length; i++) {
      const z = w.zone[i];
      if (z === ZONE.RES) t.homes.push(i);
      else if (z === ZONE.COM || z === ZONE.IND) t.jobs.push(i);
    }
    const seededHomes = t.homes.length, seededJobs = t.jobs.length;
    s.population = 9000;
    let ticksToCap = 0;
    while (t.vehicles.length < VEHICLE_CAP && ticksToCap < 3000) {
      tickTraffic(s, t, 0.1);
      ticksToCap++;
    }
    const vehiclesAtCap = t.vehicles.length;

    // (a) Road network geometry rebuild, both atlas tiers.
    const groundY = (x: number, z: number): number => heightAt(w, x, z);
    let atlasTris = 0, atlasVerts = 0;
    const atlasTs = timed(() => {
      const g = buildRoadNetworkGeometry(w, groundY, { atlas: true });
      atlasTris = g.getIndex()!.count / 3;
      atlasVerts = g.getAttribute("position").count;
      g.dispose();
    });
    let lowTris = 0, lowVerts = 0;
    const lowTs = timed(() => {
      const g = buildRoadNetworkGeometry(w, groundY, { atlas: false });
      lowTris = g.getIndex()!.count / 3;
      lowVerts = g.getAttribute("position").count;
      g.dispose();
    });

    // (d) Junction layout counts by kind (pristine city, before edit probes).
    const kinds = new Map<string, number>();
    for (const l of junctionsOf(w).byNode.values()) kinds.set(l.kind, (kinds.get(l.kind) ?? 0) + 1);

    // (c) Traffic tick at the cap.
    const tickVehiclesBefore = t.vehicles.length;
    const completedBefore = t.completed;
    const tickTs = timed(() => tickTraffic(s, t, 0.1));
    const tickVehiclesAfter = t.vehicles.length;
    const tickCompletedDelta = t.completed - completedBefore;

    // (b) Junction rebuild after a one-segment edit (add bumps graphRevision).
    const segsBefore = w.segments.length, nodesBefore = w.nodes.length;
    let probeFailures = 0;
    const editTs: number[] = [];
    for (let i = 0; i < WARM + SAMPLES; i++) {
      addSegment(w, ROAD.STREET, [{ ...STUB_A }, { ...STUB_B }]);
      const t0 = performance.now();
      junctionsOf(w);
      const dt = performance.now() - t0;
      if (i >= WARM) editTs.push(dt);
      const id = findStubSeg(s);
      if (id === undefined || !removeSegment(w, id)) probeFailures++;
    }
    const segsAfter = w.segments.length, nodesAfter = w.nodes.length;

    // City census for the report.
    let leveled = 0;
    for (let i = 0; i < w.level.length; i++) if (w.level[i] > 0) leveled++;
    const atlas = stats(atlasTs), low = stats(lowTs), tick = stats(tickTs), edit = stats(editTs);
    const f3 = (n: number): string => n.toFixed(3);
    const overBudget: string[] = [];
    if (atlas.median > 10) overBudget.push("geo.atlas");
    if (low.median > 10) overBudget.push("geo.low");
    if (edit.median > 10) overBudget.push("junction.edit");
    const lines = [
      `# mayor roads 1B perf: dense 96x96 city (report-only; warm ${WARM}, median of ${SAMPLES})`,
      `label=${LABEL}`,
      `node=${process.version} platform=${process.platform}`,
      `city.seed=7 city.size=96 city.biome=plains city.zoning=${w.zoning}`,
      `build.placements.failed=${placementFailures.length}`,
      ...placementFailures.map((m) => `build.placements.failure=${m}`),
      `build.facility.power=${facilities.power}`,
      `build.facility.watertower=${facilities.watertower}`,
      `build.interchange=${interchange}`,
      `build.months=4 build.days=120`,
      `city.segments=${w.segments.length} city.nodes=${w.nodes.length}`,
      `city.olots=${w.olots?.length ?? 0} city.lots=${w.lots.length} city.leveled_tiles=${leveled}`,
      `city.population=${Math.round(s.population)} city.capacity.res=${Math.round(s.capacity.res)} city.capacity.com=${Math.round(s.capacity.com)} city.capacity.ind=${Math.round(s.capacity.ind)}`,
      `traffic.cap=${VEHICLE_CAP} traffic.ticks_to_cap=${ticksToCap} traffic.vehicles_at_cap=${vehiclesAtCap} traffic.seeded_homes=${seededHomes} traffic.seeded_jobs=${seededJobs} traffic.organic_pop=${organicPop}`,
      `geo.atlas.median_ms=${f3(atlas.median)} geo.atlas.mean_ms=${f3(atlas.mean)} geo.atlas.min_ms=${f3(atlas.min)} geo.atlas.max_ms=${f3(atlas.max)}`,
      `geo.atlas.tris=${atlasTris} geo.atlas.verts=${atlasVerts}`,
      `geo.low.median_ms=${f3(low.median)} geo.low.mean_ms=${f3(low.mean)} geo.low.min_ms=${f3(low.min)} geo.low.max_ms=${f3(low.max)}`,
      `geo.low.tris=${lowTris} geo.low.verts=${lowVerts}`,
      `junction.edit.median_ms=${f3(edit.median)} junction.edit.mean_ms=${f3(edit.mean)} junction.edit.min_ms=${f3(edit.min)} junction.edit.max_ms=${f3(edit.max)}`,
      `junction.edit.probe_failures=${probeFailures} junction.edit.segs_before=${segsBefore} junction.edit.segs_after=${segsAfter} junction.edit.nodes_before=${nodesBefore} junction.edit.nodes_after=${nodesAfter}`,
      `tick.median_ms=${f3(tick.median)} tick.mean_ms=${f3(tick.mean)} tick.min_ms=${f3(tick.min)} tick.max_ms=${f3(tick.max)}`,
      `tick.vehicles_before=${tickVehiclesBefore} tick.vehicles_after=${tickVehiclesAfter} tick.completed_delta=${tickCompletedDelta}`,
      `kinds.total=${[...kinds.values()].reduce((a, b) => a + b, 0)}`,
      ...[...kinds.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => `kinds.${k}=${n}`),
      `flag.rebuild_over_10ms=${overBudget.length ? overBudget.join(",") : "none"}`,
    ];
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${lines.join("\n")}\n`);

    // Harness integrity only: nothing here asserts about milliseconds.
    expect(placementFailures).toEqual([]);
    expect(facilities.power.startsWith("FAILED")).toBe(false);
    expect(facilities.watertower.startsWith("FAILED")).toBe(false);
    if (interchangeOk || LABEL === "1B") expect(interchange).toMatch(/^stamped/);
    expect(atlasTris).toBeGreaterThan(0);
    expect(lowTris).toBeGreaterThan(0);
    expect(atlasVerts).toBeGreaterThan(0);
    expect(kinds.size).toBeGreaterThan(0);
    expect(probeFailures).toBe(0);
    expect(vehiclesAtCap).toBe(VEHICLE_CAP);
  }, 300000);
});
