import { describe, expect, it } from "vitest";
import { lineTiles, strokePoints } from "./input";

const adjacent4 = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

describe("lineTiles", () => {
  it("includes both endpoints", () => {
    const t = lineTiles({ x: 2, y: 3 }, { x: 9, y: 7 });
    expect(t[0]).toEqual({ x: 2, y: 3 });
    expect(t[t.length - 1]).toEqual({ x: 9, y: 7 });
  });

  it("is 4-connected for every slope", () => {
    for (const [bx, by] of [[10, 0], [0, 10], [10, 10], [-7, 4], [3, -9], [-5, -5], [13, 4]]) {
      const t = lineTiles({ x: 0, y: 0 }, { x: bx, y: by });
      for (let i = 1; i < t.length; i++) expect(adjacent4(t[i - 1], t[i])).toBe(true);
    }
  });

  it("handles a single tile", () => {
    expect(lineTiles({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual([{ x: 4, y: 4 }]);
  });
});

describe("strokePoints", () => {
  it("resamples ground strokes at no more than half-tile spacing", () => {
    const pts = strokePoints({ x: 0.25, z: 0.25 }, { x: 5.25, z: 5.25 });
    expect(pts[0]).toEqual({ x: 0.25, z: 0.25 });
    expect(pts[pts.length - 1]).toEqual({ x: 5.25, z: 5.25 });
    for (let i = 1; i < pts.length; i++) {
      expect(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});
