import { describe, expect, it } from "vitest";
import { newCity, placeRoad } from "./sim";
import { findPath, routePath } from "./traffic";
import { cidx, curvePoints, idx } from "./world";

/** Dry flat ground around the entry so any road shape is buildable. */
function flat(s: ReturnType<typeof newCity>) {
  for (let y = 0; y < s.world.size; y++) for (let x = 0; x < s.world.size; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e7;
}

/** Distance from (x, z) to the polyline. */
function distTo(line: { x: number; z: number }[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
  }
  return best;
}

describe("vehicle routes follow the road centreline", () => {
  for (const [name, pts] of [
    ["diagonal", [{ x: 8.5, z: 8.5 }, { x: 40.5, z: 30.5 }]],
    ["curve", [{ x: 8.5, z: 8.5 }, { x: 36.5, z: 10.5 }, { x: 40.5, z: 36.5 }]],
  ] as const) {
    it(`stays within a quarter tile of the ${name} road`, () => {
      const s = newCity(7, 64);
      flat(s);
      expect(placeRoad(s, 1, pts.map((p) => ({ ...p }))).ok).toBe(true);
      const w = s.world;
      const seg = w.segments[w.segments.length - 1];
      const centre = curvePoints(seg.pts, 0.25);
      const a = seg.tiles[0], b = seg.tiles[seg.tiles.length - 1];
      const tiles = findPath(w, new Uint16Array(w.size * w.size), a, b)!;
      expect(tiles.length).toBeGreaterThan(10);
      const route = routePath(w, tiles);
      expect(route.length).toBe(tiles.length * 2);
      let worst = 0;
      for (let i = 0; i < tiles.length; i++) worst = Math.max(worst, distTo(centre, route[i * 2], route[i * 2 + 1]));
      expect(worst).toBeLessThan(0.25);
      // no zero-length steps: every vehicle always has a heading
      for (let i = 0; i + 1 < tiles.length; i++) {
        expect(Math.hypot(route[i * 2 + 2] - route[i * 2], route[i * 2 + 3] - route[i * 2 + 1])).toBeGreaterThan(0.005);
      }
      void idx;
    });
  }
});
