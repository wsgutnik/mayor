import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad } from "./sim";
import { findLayeredPath, routePath } from "./traffic";
import { curvePoints } from "./world";

describe("routePath on curved and diagonal avenues", () => {
  for (const [name, pts] of [
    ["curved 3-point", [{ x: 10.5, z: 10.5 }, { x: 38.5, z: 12.5 }, { x: 42.5, z: 38.5 }]],
    ["45 degree diagonal", [{ x: 10.5, z: 10.5 }, { x: 40.5, z: 40.5 }]],
  ] as const) {
    for (const type of [2, 5] as const) {
      it(`${name} type ${type}: no throw, finite points on the road`, () => {
        const s = blankShowcaseCity();
        expect(placeRoad(s, type, pts.map((p) => ({ ...p }))).ok).toBe(true);
        const w = s.world;
        const seg = w.segments[w.segments.length - 1];
        const a = seg.tiles[0], b = seg.tiles[seg.tiles.length - 1];
        const lp = findLayeredPath(w, new Uint16Array(w.size * w.size), a, b);
        expect(lp).not.toBeNull();
        const route = routePath(w, lp!.tiles);
        expect(route.length).toBeGreaterThanOrEqual(4);
        const line = curvePoints(seg.pts, 0.25);
        for (let i = 0; i < route.length; i += 2) {
          expect(Number.isFinite(route[i]) && Number.isFinite(route[i + 1])).toBe(true);
          let d = Infinity;
          for (let k = 0; k + 1 < line.length; k++) {
            const p = line[k], q = line[k + 1];
            const dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((route[i] - p.x) * dx + (route[i + 1] - p.z) * dz) / l2));
            d = Math.min(d, Math.hypot(p.x + dx * t - route[i], p.z + dz * t - route[i + 1]));
          }
          expect(d).toBeLessThan(2);
        }
      });
    }
  }
});
