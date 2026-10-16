import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newCity, placeRoad } from "./sim";
import { newTraffic, tickTraffic } from "./traffic";
import { cidx, idx } from "./world";

/** Same avenue-spine gridlock fixture as traffic-jam.test.ts. */
function fixture() {
  const s = newCity(21);
  const w = s.world, ey = w.entry.y;
  for (let y = ey - 30; y <= ey + 30; y++) for (let x = 0; x <= 70; x++) w.heights[cidx(w, x, y)] = 0.35;
  s.money = 1e7;
  const seg = (type: 1 | 2, x0: number, y0: number, x1: number, y1: number) =>
    placeRoad(s, type, [{ x: x0 + 0.5, z: y0 + 0.5 }, { x: x1 + 0.5, z: y1 + 0.5 }]).ok;
  const cols = [10, 20, 30, 40, 50], rows = [ey - 14, ey - 7, ey, ey + 7, ey + 14];
  const ok = [seg(1, 2, ey, 6, ey)];
  for (const y of rows) ok.push(seg(y === ey ? 2 : 1, 6, y, 54, y));
  for (const x of cols) ok.push(seg(x === 30 ? 2 : 1, x, rows[0], x, rows[4]));
  expect(ok.every(Boolean)).toBe(true);
  const t = newTraffic(w.size, 5);
  tickTraffic(s, t, 0);
  t.homes = []; t.jobs = [];
  for (let x = 12; x <= 52; x += 2) { t.homes.push(idx(w, x, rows[2] - 1)); t.jobs.push(idx(w, x, rows[3] + 1)); }
  for (const y of rows) { t.homes.push(idx(w, 8, y)); t.jobs.push(idx(w, 52, y)); }
  s.population = 9000;
  s.capacity.ind = 0;
  return { s, t };
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i];
}

/** Report-only timing test: runs only with MAYOR_PERF=1, writes under os.tmpdir(). */
const PERF = process.env.MAYOR_PERF === "1";

describe("traffic tick timing (report-only)", () => {
  it.skipIf(!PERF)("reports median ms/tick on the avenue-spine gridlock fixture", () => {
    const { s, t } = fixture();
    for (let i = 0; i < 1500; i++) tickTraffic(s, t, 0.1);
    const warmVehicles = t.vehicles.length;
    const times: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const t0 = performance.now();
      tickTraffic(s, t, 0.1);
      times.push(performance.now() - t0);
    }
    const sorted = [...times].sort((a, b) => a - b);
    const out = {
      label: process.env.TRAFFIC_PERF_LABEL ?? "unknown",
      warmVehicles,
      endVehicles: t.vehicles.length,
      completed: t.completed,
      ticks: times.length,
      medianMs: quantile(sorted, 0.5),
      p95Ms: quantile(sorted, 0.95),
      meanMs: times.reduce((a, b) => a + b, 0) / times.length,
    };
    writeFileSync(process.env.TRAFFIC_PERF_OUT ?? join(tmpdir(), "mayor-traffic-perf.json"), JSON.stringify(out, null, 2));
    // Report-only: CI must not fail on absolute speed, only on harness breakage.
    expect(times).toHaveLength(1500);
    expect(Number.isFinite(out.medianMs)).toBe(true);
  }, 180000);
});
