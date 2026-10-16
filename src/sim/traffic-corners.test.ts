import { describe, expect, it } from "vitest";
import { newCity, placeRoad } from "./sim";
import { findPath, pointAtRouteArc, routeArcIndex, routeArcLengths, routePath } from "./traffic";
import { corridorsOf, profileOf } from "./corridor";
import { junctionsOf } from "./junction";
import { pointInPolygon } from "./lanes";
import { cidx, idx } from "./world";

function flat(s: ReturnType<typeof newCity>) {
  for (let y = 0; y < s.world.size; y++) for (let x = 0; x < s.world.size; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e7;
}

/**
 * Fraction of points sampled along the route (every 0.1 tile) that lie off
 * the road. TRUE on-road test: a sample counts as on-road when its distance
 * to some corridor centreline is within that corridor's asphalt half-width
 * (profileOf(type).asphaltHalf), or it lies inside a junction asphalt
 * polygon. (The tile-or-8-neighbour proxy this replaces accepted points a
 * full tile off a 1-tile road.)
 */
function offRoadFraction(s: ReturnType<typeof newCity>, route: Float32Array): number {
  const w = s.world;
  const corridors = [...corridorsOf(w).bySeg.values()];
  const pads = [...junctionsOf(w).byNode.values()].map((l) => l.asphalt).filter((p) => p.length >= 3);
  const onRoad = (x: number, z: number): boolean => {
    for (const c of corridors) {
      const half = profileOf(c.type).asphaltHalf;
      const pts = c.centre;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const vx = b.x - a.x, vz = b.z - a.z;
        const l2 = vx * vx + vz * vz || 1;
        const u = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
        if (Math.hypot(a.x + vx * u - x, a.z + vz * u - z) <= half) return true;
      }
    }
    for (const pad of pads) if (pointInPolygon({ x, z }, pad)) return true;
    return false;
  };
  let total = 0, off = 0;
  for (let i = 0; i + 1 < route.length / 2; i++) {
    const ax = route[i * 2], az = route[i * 2 + 1], bx = route[i * 2 + 2], bz = route[i * 2 + 3];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1));
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
      total++;
      if (!onRoad(x, z)) off++;
    }
  }
  return off / total;
}

function streetGrid(): ReturnType<typeof newCity> {
  const s = newCity(5, 64);
  flat(s);
  const roads: [number, number][][] = [
    [[6.5, 6.5], [40.5, 6.5]], [[40.5, 6.5], [40.5, 36.5]], [[40.5, 36.5], [6.5, 36.5]], [[6.5, 36.5], [6.5, 6.5]],
    [[6.5, 6.5], [40.5, 36.5]],
  ];
  for (const r of roads) expect(placeRoad(s, 1, r.map(([x, z]) => ({ x, z }))).ok).toBe(true);
  return s;
}

describe("routes through junctions stay on the carriageway", () => {
  it("a street grid with 90-degree turns and a diagonal never leaves the road tiles", () => {
    const s = streetGrid();
    const w = s.world;
    const pick = (x: number, y: number) => idx(w, x, y);
    const pairs: [number, number][] = [[pick(6, 6), pick(40, 36)], [pick(40, 6), pick(6, 36)], [pick(6, 20), pick(40, 20)]];
    for (const [a, b] of pairs) {
      if (!w.road[a] || !w.road[b]) continue;
      const tiles = findPath(w, new Uint16Array(w.size * w.size), a, b);
      if (!tiles) continue;
      const route = routePath(w, tiles);
      expect(offRoadFraction(s, route)).toBeLessThan(0.02);
    }
  });
  it("the gate bites: a line far from any road scores fully off-road", () => {
    const s = streetGrid();
    expect(offRoadFraction(s, new Float32Array([45.5, 50.5, 55.5, 50.5]))).toBe(1);
  });
});

import { roundCorners } from "./traffic";

describe("roundCorners", () => {
  it("softens a right angle, keeps endpoints and the point count", () => {
    // L-shaped route: (0,0) -> (3,0) -> (3,3), one point per unit step
    const pts = new Float32Array([0, 0, 1, 0, 2, 0, 3, 0, 3, 1, 3, 2, 3, 3]);
    const out = roundCorners(pts, 7);
    expect(out.length).toBe(pts.length);
    expect([out[0], out[1]]).toEqual([0, 0]);
    expect([out[12], out[13]]).toEqual([3, 3]);
    // the corner point moved inward but by less than half a tile
    const moved = Math.hypot(out[6] - 3, out[7] - 0);
    expect(moved).toBeGreaterThan(0.05);
    expect(moved).toBeLessThan(0.6);
    // straight stretches are untouched
    expect([out[2], out[3]]).toEqual([1, 0]);
  });
});

describe("route arc lengths", () => {
  it("measure and locate unequal connector samples without tile-index drift", () => {
    const pts = new Float32Array([0, 0, 0.25, 0, 1.25, 0, 1.25, 2]);
    const arc = routeArcLengths(pts);
    expect([...arc]).toEqual([0, 0.25, 1.25, 3.25]);
    expect(routeArcIndex(arc, 0.9)).toBe(1);
    const p = pointAtRouteArc(pts, arc, 2.25);
    expect(p.index).toBe(2);
    expect(p.x).toBeCloseTo(1.25);
    expect(p.z).toBeCloseTo(1);
  });
});
