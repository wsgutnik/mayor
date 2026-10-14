import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROAD_PARALLEL,
  loadRoadParallel,
  normalizeRoadParallel,
  offsetPolyline,
  saveRoadParallel,
} from "./road-parallel";

const close = (p: { x: number; z: number }, x: number, z: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.z).toBeCloseTo(z, 6);
};

describe("offsetPolyline", () => {
  it("offsets a straight road sideways by the gap", () => {
    const pts = [{ x: 0, z: 0 }, { x: 10, z: 0 }];
    const left = offsetPolyline(pts, 2, "left");
    close(left[0], 0, 2);
    close(left[1], 10, 2);
    const right = offsetPolyline(pts, 2, "right");
    close(right[0], 0, -2);
    close(right[1], 10, -2);
  });

  it("supports gaps of 1, 2 and 3 tiles on any heading", () => {
    const diag = [{ x: 0, z: 0 }, { x: 5, z: 5 }];
    for (const gap of [1, 2, 3] as const) {
      const [a, b] = offsetPolyline(diag, gap, "left");
      // (-dz, dx) normal of (1,1)/√2, scaled by the gap.
      const n = gap / Math.SQRT2;
      close(a, -n, n);
      close(b, 5 - n, 5 + n);
    }
  });

  it("miters the bend of a curve control polygon", () => {
    // Right-angle bend: the control point moves along the bisector,
    // gap/cos(45°) ≈ 1.414·gap out.
    const [a, b, c] = offsetPolyline(
      [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }],
      2, "left",
    );
    close(a, 0, 2);
    close(b, 10 - 2, 2); // (8, 2): hugging the inside of the bend
    close(c, 8, 10);
  });

  it("clamps the miter on sharp bends instead of spiking", () => {
    // Near-hairpin: the miter would shoot far past the bend.
    const pts = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0.5, z: 0.5 }];
    const [, b] = offsetPolyline(pts, 2, "left");
    expect(Math.hypot(b.x - 10, b.z - 0)).toBeLessThanOrEqual(2 * 2 + 1e-6);
  });

  it("falls back to the exit leg on a hairpin", () => {
    const [, b] = offsetPolyline(
      [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 0 }],
      2, "left",
    );
    // Exit leg runs -x; its left normal is (0,-1)·… i.e. z steps down by the gap.
    close(b, 10, -2);
  });

  it("leaves degenerate drafts alone and never mutates the input", () => {
    const pts = [{ x: 3, z: 7 }];
    expect(offsetPolyline(pts, 2, "left")).toEqual(pts);
    const dup = [{ x: 4, z: 4 }, { x: 4, z: 4 }];
    expect(offsetPolyline(dup, 2, "right")).toEqual(dup);
    expect(offsetPolyline([{ x: 0, z: 0 }, { x: 5, z: 0 }], 0, "left"))
      .toEqual([{ x: 0, z: 0 }, { x: 5, z: 0 }]);
    const src = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
    const copy = src.map((p) => ({ ...p }));
    offsetPolyline(src, 3, "right");
    expect(src).toEqual(copy);
  });
});

describe("parallel options", () => {
  it("defaults to off, gap 2, left", () => {
    expect(DEFAULT_ROAD_PARALLEL).toEqual({ enabled: false, gap: 2, side: "left" });
  });

  it("repairs stored garbage field by field", () => {
    expect(normalizeRoadParallel(null)).toEqual(DEFAULT_ROAD_PARALLEL);
    expect(normalizeRoadParallel("left")).toEqual(DEFAULT_ROAD_PARALLEL);
    expect(normalizeRoadParallel({ enabled: "yes", gap: 5, side: "up" })).toEqual(DEFAULT_ROAD_PARALLEL);
    expect(normalizeRoadParallel({ enabled: true, gap: 3, side: "right" }))
      .toEqual({ enabled: true, gap: 3, side: "right" });
  });

  it("round-trips through storage and survives blocked storage", () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
    expect(loadRoadParallel()).toEqual(DEFAULT_ROAD_PARALLEL);
    saveRoadParallel({ enabled: true, gap: 1, side: "right" });
    expect(loadRoadParallel()).toEqual({ enabled: true, gap: 1, side: "right" });
    store.set("mayor:road-parallel", "{oops");
    expect(loadRoadParallel()).toEqual(DEFAULT_ROAD_PARALLEL);
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(loadRoadParallel()).toEqual(DEFAULT_ROAD_PARALLEL);
    expect(() => saveRoadParallel({ enabled: true, gap: 3, side: "left" })).not.toThrow();
  });
});

describe("parallelOffset (road profile)", () => {
  it("keeps both frontages plus `gap` lot cells per side, from the profile", async () => {
    const { parallelOffset, frontageHalf } = await import("./road-parallel");
    const { profileOf } = await import("../sim/corridor");
    const p = profileOf(1);
    expect(frontageHalf(1)).toBeCloseTo(p.drawHalf + p.sidewalk + p.setback, 12);
    expect(parallelOffset(1, 2)).toBeCloseTo(2 * frontageHalf(1) + 4, 12);
    expect(parallelOffset(2, 2) - parallelOffset(1, 2)).toBeCloseTo(2 * (frontageHalf(2) - frontageHalf(1)), 12);
  });

  it("accepts a 4-cell gap and still repairs garbage", () => {
    expect(normalizeRoadParallel({ enabled: true, gap: 4, side: "right" })).toEqual({ enabled: true, gap: 4, side: "right" });
    expect(normalizeRoadParallel({ gap: 5 }).gap).toBe(DEFAULT_ROAD_PARALLEL.gap);
  });
});
