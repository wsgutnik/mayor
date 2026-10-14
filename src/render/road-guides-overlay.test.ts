import { describe, expect, it } from "vitest";
import { GUIDE_RAY_LENGTH, guideArcPoints, guideRayEndpoint } from "./road-guides-overlay";

describe("road guide overlay geometry", () => {
  it("ends a ray exactly at its requested polar endpoint", () => {
    const north = guideRayEndpoint({ x: 2, z: -3 }, Math.PI / 2);
    expect(north.x).toBeCloseTo(2, 12); expect(north.z).toBeCloseTo(-3 + GUIDE_RAY_LENGTH, 12);
    const p = guideRayEndpoint({ x: 0, z: 0 }, Math.PI / 4, Math.SQRT2);
    expect(p.x).toBeCloseTo(1, 8); expect(p.z).toBeCloseTo(1, 8);
  });

  it("makes a contiguous shortest-turn arc with no endpoints drift", () => {
    const a = guideArcPoints({ x: 5, z: 7 }, 0, Math.PI / 2, 2, 8);
    expect(a).toHaveLength(9);
    expect(a[0]).toEqual({ x: 7, z: 7 });
    expect(a.at(-1)!.x).toBeCloseTo(5, 8); expect(a.at(-1)!.z).toBeCloseTo(9, 8);
    for (let i = 1; i < a.length; i++) expect(Math.hypot(a[i].x - a[i - 1].x, a[i].z - a[i - 1].z)).toBeGreaterThan(0.01);
  });
});
