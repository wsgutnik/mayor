// src/sim/traffic-lanes.test.ts
import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad, CityState } from "./sim";
import { laneFor, lanesInDirection, routePath, findPath, newTraffic } from "./traffic";
import { junctionsOf } from "./junction";
import { addSegment } from "./roads";
import { ROAD, idx, rebuildRoadRaster, updateConnectivity } from "./world";

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
    const tiles = findPath(w, new Uint16Array(w.size * w.size), t(12.5, 40.5), t(58.5, 40.5))!;
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
    const tiles = findPath(w, new Uint16Array(w.size * w.size), t(12.5, 40.5), t(58.5, 40.5))!;
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
  it("routes stay monotone along travel: no backward segment on any lane, both directions (Task 7 fix round 5)", () => {
    // A lane-offset approach/exit sample past a connector mouth leaves a
    // ~0.4-tile backward hook; a car sitting on it has heading dot -1 against
    // its followers, so the same-lane filter drops it and the queue stacks.
    // Lanes 0..2 on street (clamped to its single lane), avenue and highway
    // crossing a street, plus avenue x avenue. Highways never meet a street
    // at grade via placeRoad (auto-overpass), so that crossing is forced with
    // addSegment, exactly as crossings.test.ts builds its highway fixtures.
    const cases = [
      { name: "street x street", ew: ROAD.STREET as number, ns: ROAD.STREET as number, forced: false },
      { name: "avenue x street", ew: ROAD.AVENUE as number, ns: ROAD.STREET as number, forced: false },
      { name: "highway x street", ew: ROAD.HIGHWAY as number, ns: ROAD.STREET as number, forced: true },
      { name: "avenue x avenue", ew: ROAD.AVENUE as number, ns: ROAD.AVENUE as number, forced: false },
    ] as const;
    for (const c of cases) {
      const s: CityState = blankShowcaseCity(), w = s.world;
      const H = [{ x: 10.5, z: 40.5 }, { x: 60.5, z: 40.5 }];
      const V = [{ x: 35.5, z: 20.5 }, { x: 35.5, z: 60.5 }];
      if (c.forced) {
        addSegment(w, c.ew as 3, H);
        addSegment(w, c.ns as 1, V);
        rebuildRoadRaster(w);
        updateConnectivity(w);
      } else {
        expect(placeRoad(s, c.ew as 1 | 2, H).ok, `${c.name} E-W`).toBe(true);
        expect(placeRoad(s, c.ns as 1 | 2, V).ok, `${c.name} N-S`).toBe(true);
      }
      const layouts = junctionsOf(w).byNode;
      const ours = [...layouts.values()].find((l) => Math.hypot(l.centre.x - 35.5, l.centre.z - 40.5) < 1.5);
      expect(ours, `${c.name} junction at 35.5,40.5`).toBeDefined();
      const t = newTraffic(w.size);
      const routeEW = (x0: number, x1: number): number[] => {
        for (let y = 38; y <= 42; y++) {
          const a = idx(w, x0, y), b = idx(w, x1, y);
          if (w.road[a] && w.road[b]) {
            const tiles = findPath(w, t.load, a, b);
            if (tiles) return tiles;
          }
        }
        throw new Error(`${c.name} no route ${x0}->${x1}`);
      };
      const routeNS = (z0: number, z1: number): number[] => {
        for (let x = 33; x <= 37; x++) {
          const a = idx(w, x, z0), b = idx(w, x, z1);
          if (w.road[a] && w.road[b]) {
            const tiles = findPath(w, t.load, a, b);
            if (tiles) return tiles;
          }
        }
        throw new Error(`${c.name} no route ${z0}->${z1}`);
      };
      const dirs = [
        { tiles: routeEW(12, 58), dir: "E" },
        { tiles: routeEW(58, 12), dir: "W" },
        { tiles: routeNS(22, 58), dir: "S" },
        { tiles: routeNS(58, 22), dir: "N" },
      ];
      for (const { tiles, dir } of dirs) {
        for (let lane = 0; lane <= 2; lane++) {
          const label = `${c.name} ${dir} lane=${lane}`;
          const pts = routePath(w, tiles, lane);
          const n = pts.length / 2;
          expect(n, `${label} points`).toBeGreaterThan(10);
          let near = Infinity;
          for (let i = 0; i < n; i++)
            near = Math.min(near, Math.hypot(pts[i * 2] - 35.5, pts[i * 2 + 1] - 40.5));
          expect(near, `${label} must cross the junction`).toBeLessThan(1.5);
          const tx = pts[(n - 1) * 2] - pts[0], tz = pts[(n - 1) * 2 + 1] - pts[1];
          const tl = Math.hypot(tx, tz) || 1;
          let minDot = Infinity, minLen = Infinity;
          for (let i = 0; i + 1 < n; i++) {
            const dx = pts[(i + 1) * 2] - pts[i * 2], dz = pts[(i + 1) * 2 + 1] - pts[i * 2 + 1];
            const len = Math.hypot(dx, dz);
            minLen = Math.min(minLen, len);
            if (len > 1e-9) minDot = Math.min(minDot, (dx * tx + dz * tz) / (len * tl));
          }
          expect(minLen, `${label} duplicate points (min seg len)`).toBeGreaterThan(1e-9);
          expect(minDot, `${label} backward segment (min dot with travel)`).toBeGreaterThanOrEqual(-1e-6);
        }
      }
    }
  });
  it("no sideways spike past a junction exit on avenue x street and a tee, every lane both directions", () => {
    for (const tee of [false, true]) {
      const s = blankShowcaseCity(), w = s.world;
      placeRoad(s, 2, [P(10.5, 40.5), P(60.5, 40.5)]);
      placeRoad(s, 1, tee ? [P(35.5, 40.5), P(35.5, 60.5)] : [P(35.5, 20.5), P(35.5, 60.5)]);
      const layouts = junctionsOf(w).byNode;
      expect(layouts.size, tee ? "tee junctions" : "cross junctions").toBeGreaterThan(0);
      const t = (x: number, z: number) => Math.floor(z) * w.size + Math.floor(x);
      const dirs = [
        [t(12.5, 40.5), t(58.5, 40.5)],
        [t(58.5, 40.5), t(12.5, 40.5)],
      ] as const;
      for (const [from, to] of dirs) {
        const tiles = findPath(w, new Uint16Array(w.size * w.size), from, to)!;
        for (let lane = 0; lane < lanesInDirection(2); lane++) {
          const pts = routePath(w, tiles, lane);
          // Guard: the route must actually pass our junction at (35.5, 40.5), or the bound below is vacuous.
          const ours = [...layouts.values()].find((l) => Math.hypot(l.centre.x - 35.5, l.centre.z - 40.5) < 1.5);
          expect(ours, `tee=${tee} junction at 35.5,40.5`).toBeDefined();
          let near = Infinity;
          for (let i = 0; i < pts.length / 2; i++)
            near = Math.min(near, Math.hypot(pts[i * 2] - 35.5, pts[i * 2 + 1] - 40.5));
          expect(near, `tee=${tee} lane=${lane} dir=${from < to ? "E" : "W"}`).toBeLessThan(1.5);
          for (let i = 1; i < pts.length / 2; i++) {
            const d = Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
            const lat = Math.abs(pts[i * 2 + 1] - pts[i * 2 - 1]);
            if (d > 1e-6) expect(lat, `tee=${tee} lane=${lane} dir=${from < to ? "E" : "W"} i=${i}`).toBeLessThan(0.05 + 0.2 * d);
          }
        }
      }
    }
  });
});
