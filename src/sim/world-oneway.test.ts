import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { applyTool, placeRoad } from "./sim";
import { findLayeredPath } from "./traffic";
import { idx } from "./world";

const P = (x: number, z: number) => ({ x, z });

describe("one-way road raster at two-way roads", () => {
  it("keeps every legal avenue movement routable when a one-way street ends on it", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 2, [P(20.5, 48.5), P(76.5, 48.5)]).ok).toBe(true);
    expect(placeRoad(s, 4, [P(48.5, 20.5), P(48.5, 48.5)]).ok).toBe(true);
    const w = s.world, load = new Uint16Array(w.size * w.size);
    const path = (ax: number, az: number, bx: number, bz: number) =>
      findLayeredPath(w, load, idx(w, ax, az), idx(w, bx, bz));

    expect(path(22, 48, 74, 48)).toBeTruthy();
    expect(path(74, 48, 22, 48)).toBeTruthy();
    expect(path(48, 22, 22, 48)).toBeTruthy();
    expect(path(48, 22, 74, 48)).toBeTruthy();
    for (const x of [47, 48, 49]) {
      const tile = idx(w, x, 48);
      expect([w.dirX[tile], w.dirZ[tile]]).toEqual([0, 0]);
    }
  });
});

describe("roundabout ring direction", () => {
  it("keeps the ring directional on two-way arm tiles", () => {
    for (const [ty, dirTiles, moves] of [[1, 10, 40], [2, 10, 96]] as const) {
      const s = blankShowcaseCity();
      placeRoad(s, ty, [P(20.5, 48.5), P(76.5, 48.5)]);
      placeRoad(s, ty, [P(48.5, 20.5), P(48.5, 76.5)]);
      applyTool(s, "roundabout", 48, 48);
      const w = s.world;
      let dir = 0, allowed = 0;
      for (let y = 44; y <= 53; y++) for (let x = 44; x <= 53; x++) {
        const t = idx(w, x, y);
        if (w.dirX[t] || w.dirZ[t]) dir++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = idx(w, x + dx, y + dy);
          if (!w.road[t] || !w.road[j]) continue;
          if ((w.dirX[t] || w.dirZ[t]) && w.dirX[t] * dx + w.dirZ[t] * dy < -0.35) continue;
          if ((w.dirX[j] || w.dirZ[j]) && w.dirX[j] * dx + w.dirZ[j] * dy < -0.35) continue;
          allowed++;
        }
      }
      if (ty === 2) expect(dir).toBe(dirTiles);
      expect(allowed).toBe(moves);
    }
  });
});
