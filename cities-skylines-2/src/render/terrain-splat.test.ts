import { describe, expect, it } from "vitest";
import { averageOfPixels, DEFAULT_SPLAT, splatWeights } from "./terrain-splat";

describe("splatWeights", () => {
  it("is grass on flat lowland", () => {
    const [g, s, r, d] = splatWeights(1, 0.02, 0.2);
    expect(g).toBeGreaterThan(0.9);
    expect(s + r + d).toBeLessThan(0.1);
  });

  it("is sand below the waterline margin", () => {
    const [g, s] = splatWeights(0.1, 0.01, 0.2);
    expect(s).toBeGreaterThan(0.9);
    expect(g).toBeLessThan(0.1);
  });

  it("is rock on steep slopes whatever the height", () => {
    const [, , r] = splatWeights(1, 0.6, 0.2);
    expect(r).toBeGreaterThan(0.9);
  });

  it("is rock high up even when flat", () => {
    const [, , r] = splatWeights(DEFAULT_SPLAT.rockAt + 2, 0.01, 0.2);
    expect(r).toBeGreaterThan(0.9);
  });

  it("grows dirt patches with the noise field on grass", () => {
    const plain = splatWeights(1, 0.02, 0.3);
    const patch = splatWeights(1, 0.02, 0.9);
    expect(patch[3]).toBeGreaterThan(plain[3]);
    expect(patch[3]).toBeGreaterThan(0.5);
    expect(plain[3]).toBeLessThan(0.1);
  });

  it("never grows dirt on sand or rock", () => {
    expect(splatWeights(0.0, 0.01, 1)[3]).toBeLessThan(0.05);
    expect(splatWeights(1, 0.7, 1)[3]).toBeLessThan(0.05);
  });

  it("sums to one across a sweep of heights and slopes", () => {
    for (let h = -2; h <= 8; h += 0.5) {
      for (const slope of [0, 0.2, 0.4, 0.7]) {
        const w = splatWeights(h, slope, 0.6);
        expect(w[0] + w[1] + w[2] + w[3]).toBeCloseTo(1, 6);
      }
    }
  });
});

describe("averageOfPixels", () => {
  it("averages raw bytes to 0..1", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    expect(averageOfPixels(data)).toEqual([0.5, 0, 0.5]);
  });

  it("guards empty input", () => {
    expect(averageOfPixels(new Uint8ClampedArray(0))).toEqual([0, 0, 0]);
  });
});
