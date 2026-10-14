import { describe, expect, it } from "vitest";
import type { Pt } from "../sim/world";
import { triangulateBand, triangulateRing, triangulateStrip } from "./earclip";

const area = (ring: Pt[]): number => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], r = ring[(i + 1) % ring.length];
    a += p.x * r.z - r.x * p.z;
  }
  return Math.abs(a / 2);
};

const triArea = (t: [Pt, Pt, Pt]): number =>
  Math.abs((t[1].x - t[0].x) * (t[2].z - t[0].z) - (t[2].x - t[0].x) * (t[1].z - t[0].z)) / 2;

const minAngle = (t: [Pt, Pt, Pt]): number => {
  const side = (p: Pt, q: Pt): number => Math.hypot(p.x - q.x, p.z - q.z);
  const ab = side(t[0], t[1]), bc = side(t[1], t[2]), ca = side(t[2], t[0]);
  const angle = (x: number, y: number, z: number): number =>
    Math.acos(Math.max(-1, Math.min(1, (x * x + y * y - z * z) / (2 * x * y)))) * 180 / Math.PI;
  return Math.min(angle(ab, ca, bc), angle(ab, bc, ca), angle(bc, ca, ab));
};

describe("ear clipping", () => {
  it("triangulates a convex quad into 2 covering triangles", () => {
    const tris = triangulateRing([
      { x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 1 }, { x: 0, z: 1 },
    ]);
    expect(tris).toHaveLength(2);
    expect(tris.reduce((s, t) => s + triArea(t), 0)).toBeCloseTo(2, 9);
  });

  it("triangulates a concave arrowhead with full coverage", () => {
    const ring = [
      { x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 },
      { x: 1.5, z: 1.5 }, { x: 0, z: 3 },
    ];
    const tris = triangulateRing(ring);
    expect(tris).toHaveLength(3);
    expect(tris.reduce((s, t) => s + triArea(t), 0)).toBeCloseTo(area(ring), 9);
    for (const t of tris) {
      expect(triArea(t)).toBeGreaterThan(1e-9);
      expect(minAngle(t)).toBeGreaterThanOrEqual(5);
    }
  });

  it("absorbs collinear edge vertices without slivers", () => {
    const ring = [
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 },
      { x: 2, z: 1 }, { x: 1, z: 1 }, { x: 0, z: 1 },
    ];
    const tris = triangulateRing(ring);
    expect(tris.reduce((s, t) => s + triArea(t), 0)).toBeCloseTo(2, 9);
    for (const t of tris) expect(triArea(t)).toBeGreaterThan(1e-5);
  });

  it("handles either winding", () => {
    const ccw = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 1, z: 2 }];
    const cw = [...ccw].reverse();
    expect(triangulateRing(cw)).toHaveLength(1);
    expect(triangulateRing(ccw)).toHaveLength(1);
  });

  it("clips a rectangular band with full coverage", () => {
    const inner = [{ x: 1, z: 1 }, { x: 3, z: 1 }, { x: 3, z: 2 }, { x: 1, z: 2 }];
    const outer = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }];
    const strip = triangulateStrip(inner, outer);
    expect(strip).not.toBeNull();
    // Resampling chords wide-band corners; the guard contract is max(0.02, 5%).
    const got = strip!.reduce((s, t) => s + triArea(t), 0);
    const want = area(outer) - area(inner);
    expect(Math.abs(got - want)).toBeLessThan(Math.max(0.02, want * 0.05));
    const tris = triangulateBand(inner, outer);
    expect(tris).not.toBeNull();
    for (const t of tris!) {
      expect(triArea(t)).toBeGreaterThan(1e-9);
      expect(minAngle(t)).toBeGreaterThanOrEqual(5);
    }
  });

  it("clips a thin uniform band without slivers", () => {
    // Kerb-like proportions: a 2 x 0.5 inner plate inside a 2.14 x 0.64 outer
    // plate (0.07 band), with dense arc-like vertices along the long edges.
    const inner: Pt[] = [], outer: Pt[] = [];
    for (let k = 0; k <= 20; k++) {
      inner.push({ x: k * 0.1, z: 0 });
      outer.push({ x: -0.07 + k * 0.107, z: -0.07 });
    }
    for (let k = 20; k >= 0; k--) {
      inner.push({ x: k * 0.1, z: 0.5 });
      outer.push({ x: -0.07 + k * 0.107, z: 0.57 });
    }
    const band = triangulateBand(inner, outer);
    expect(band).not.toBeNull();
    expect(band!.reduce((s, t) => s + triArea(t), 0)).toBeCloseTo(area(outer) - area(inner), 1);
    for (const t of band!) {
      expect(triArea(t)).toBeGreaterThan(1e-5);
      expect(minAngle(t)).toBeGreaterThanOrEqual(5);
    }
  });

  it("returns null when the inner ring is not inside the outer", () => {
    const a = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }];
    const b = [{ x: 5, z: 5 }, { x: 6, z: 5 }, { x: 6, z: 6 }, { x: 5, z: 6 }];
    expect(triangulateBand(a, b)).toBeNull();
    expect(triangulateBand(b, a)).toBeNull();
  });

  it("reuses band output for unchanged rings (content cache)", () => {
    const inner = [{ x: 1, z: 1 }, { x: 3, z: 1 }, { x: 3, z: 2 }, { x: 1, z: 2 }];
    const outer = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }];
    const first = triangulateBand(inner, outer);
    const second = triangulateBand(inner, outer);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
  });

  it("recomputes bands and rings after in-place mutation (no stale cache)", () => {
    const inner: Pt[] = [{ x: 1, z: 1 }, { x: 3, z: 1 }, { x: 3, z: 2 }, { x: 1, z: 2 }];
    const outer: Pt[] = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }];
    const before = triangulateBand(inner, outer);
    expect(before).not.toBeNull();
    const areaBefore = before!.reduce((s, t) => s + triArea(t), 0);
    // Widen the band in place: same array identities, new contents.
    for (const p of outer) { p.x *= 1.5; p.z *= 1.5; }
    const after = triangulateBand(inner, outer);
    expect(after).not.toBeNull();
    const areaAfter = after!.reduce((s, t) => s + triArea(t), 0);
    expect(areaAfter).toBeGreaterThan(areaBefore * 1.5);
    const ring: Pt[] = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }, { x: 0, z: 2 }];
    expect(triangulateRing(ring).reduce((s, t) => s + triArea(t), 0)).toBeCloseTo(4, 9);
    for (const p of ring) { p.x *= 2; p.z *= 2; }
    expect(triangulateRing(ring).reduce((s, t) => s + triArea(t), 0)).toBeCloseTo(16, 9);
  });
});
