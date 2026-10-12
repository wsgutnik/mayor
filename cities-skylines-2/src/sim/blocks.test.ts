import { describe, expect, it } from "vitest";
import { computeBlocks, findFrontage, lotsReadyToBuild, planLots } from "./blocks";
import { makeRng } from "./rng";
import { ROAD, World, ZONE, generateWorld, idx } from "./world";

function blank(size = 20): World {
  const w = generateWorld(size, 7);
  w.road.fill(0); w.roadSurface.fill(0); w.deckH.fill(NaN);
  w.zone.fill(0); w.level.fill(0); w.facility.fill(0); w.connected.fill(0);
  w.segments.length = 0; w.heights.fill(1);
  return w;
}

function roadLine(w: World, x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
  for (let x = x0, y = y0;; x += dx, y += dy) {
    w.road[idx(w, x, y)] = ROAD.STREET;
    w.roadSurface[idx(w, x, y)] = ROAD.STREET;
    if (x === x1 && y === y1) break;
  }
}

function zoneRect(w: World, x0: number, y0: number, x1: number, y1: number, z: number = ZONE.RES) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.zone[idx(w, x, y)] = z;
}

describe("zone blocks", () => {
  it("finds frontage on both sides of a straight street with kerb depth zero", () => {
    const w = blank(); roadLine(w, 3, 9, 16, 9);
    zoneRect(w, 4, 5, 15, 8); zoneRect(w, 4, 10, 15, 13);
    const b = computeBlocks(w);
    expect(b.blockCount).toBe(2);
    expect(b.tile(idx(w, 8, 8))).toMatchObject({ depth: 0, facing: { dx: 0, dy: 1 } });
    expect(b.tile(idx(w, 8, 10))).toMatchObject({ depth: 0, facing: { dx: 0, dy: -1 } });
    expect(b.tile(idx(w, 8, 5))?.depth).toBe(3);
  });

  it("marks deterministic corner ownership where two road faces tie", () => {
    const w = blank(); roadLine(w, 4, 4, 12, 4); roadLine(w, 4, 4, 4, 12);
    zoneRect(w, 5, 5, 8, 8);
    const f = findFrontage(w), i = idx(w, 5, 5);
    expect(f.corner[i]).toBe(1);
    expect(f.road[i]).toBe(idx(w, 5, 4)); // row-major road index wins the equal-class tie
    expect([f.dx[i], f.dy[i]]).toEqual([0, -1]);
  });

  it("does not silently join blocks across a one-tile break in the road", () => {
    const w = blank(); roadLine(w, 2, 8, 7, 8); roadLine(w, 9, 8, 14, 8);
    zoneRect(w, 3, 6, 13, 7);
    const b = computeBlocks(w);
    expect(b.blockId[idx(w, 6, 7)]).not.toBe(b.blockId[idx(w, 10, 7)]);
  });

  it("keeps facing blocks separate between parallel streets six tiles apart", () => {
    const w = blank(); roadLine(w, 2, 5, 17, 5); roadLine(w, 2, 11, 17, 11);
    zoneRect(w, 3, 6, 16, 10);
    const b = computeBlocks(w);
    expect(b.blockId[idx(w, 8, 7)]).not.toBe(b.blockId[idx(w, 8, 9)]);
    expect(b.dy[idx(w, 8, 7)]).toBe(-1);
    expect(b.dy[idx(w, 8, 9)]).toBe(1);
  });

  it("plans only valid 1x1, 2x1 and 2x2 non-overlapping lots", () => {
    const w = blank(); roadLine(w, 2, 9, 17, 9); zoneRect(w, 3, 5, 16, 8);
    w.facility[idx(w, 8, 8)] = 1;
    const b = computeBlocks(w), lots = planLots(w, b, makeRng(123));
    const occupied = new Set<number>();
    expect(lots.length).toBeGreaterThan(0);
    for (const lot of lots) {
      expect([[1, 1], [1, 2], [2, 1], [2, 2]]).toContainEqual([lot.w, lot.h]);
      for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) {
        const i = idx(w, x, y);
        expect(occupied.has(i)).toBe(false); occupied.add(i);
        expect(w.road[i] || w.facility[i]).toBe(0);
        expect(b.blockId[i]).toBe(b.blockId[idx(w, lot.x, lot.y)]);
      }
    }
    expect(occupied.has(idx(w, 8, 8))).toBe(false);
  });

  it("is exactly deterministic for equal world state and seed", () => {
    const w = blank(); roadLine(w, 2, 9, 17, 9); zoneRect(w, 3, 6, 16, 8);
    const b = computeBlocks(w);
    expect(planLots(w, b, makeRng(88))).toEqual(planLots(w, b, makeRng(88)));
    expect(planLots(w, b, makeRng(88))).not.toEqual(planLots(w, b, makeRng(89)));
  });

  it("reserves 3x3/4x4 footprints for level-2+ commercial or industrial tiles", () => {
    const commercial = blank(); roadLine(commercial, 2, 10, 17, 10);
    zoneRect(commercial, 4, 6, 15, 9, ZONE.COM);
    for (let y = 6; y <= 9; y++) for (let x = 4; x <= 15; x++) commercial.level[idx(commercial, x, y)] = 2;
    const large = planLots(commercial, computeBlocks(commercial), () => 0);
    expect(large.some((lot) => lot.w >= 3 && lot.h >= 3)).toBe(true);

    const residential = blank(); roadLine(residential, 2, 10, 17, 10);
    zoneRect(residential, 4, 6, 15, 9, ZONE.RES);
    for (let y = 6; y <= 9; y++) for (let x = 4; x <= 15; x++) residential.level[idx(residential, x, y)] = 2;
    expect(planLots(residential, computeBlocks(residential), () => 0).every((lot) => lot.w <= 2 && lot.h <= 2)).toBe(true);
  });

  it("reports only lots fronting the connected road network as ready", () => {
    const w = blank(); roadLine(w, 2, 9, 17, 9); zoneRect(w, 3, 7, 16, 8);
    const b = computeBlocks(w), lots = planLots(w, b, makeRng(3));
    expect(lotsReadyToBuild(w, b, lots)).toHaveLength(0);
    for (let x = 2; x <= 9; x++) w.connected[idx(w, x, 9)] = 1;
    const ready = lotsReadyToBuild(w, b, lots);
    expect(ready.length).toBeGreaterThan(0);
    expect(ready.length).toBeLessThan(lots.length);
  });

  it("handles a 96x96 map with 20% zoning within the 15 ms budget", () => {
    const w = blank(96);
    for (let y = 5; y < 96; y += 10) roadLine(w, 0, y, 95, y);
    for (let i = 0; i < w.zone.length; i++) if ((i * 2654435761 >>> 0) % 5 === 0) w.zone[i] = ZONE.RES;
    // Warm the JIT; the measured operation includes frontage and grouping.
    computeBlocks(w);
    // Median of several runs: a single sample is noisy when other processes load the machine.
    const runs: number[] = [];
    for (let k = 0; k < 7; k++) {
      const start = performance.now();
      computeBlocks(w);
      runs.push(performance.now() - start);
    }
    runs.sort((a, b) => a - b);
    expect(runs[3]).toBeLessThan(15);
  });
});
