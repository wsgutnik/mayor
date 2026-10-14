import { describe, expect, it } from "vitest";
import { shadowBias } from "./shadow-tuning";

describe("shadow tuning", () => {
  it("grows the bias with the frustum span and caps the normal bias", () => {
    const near = shadowBias(8, 2048, 1, 220);
    const far = shadowBias(60, 2048, 1, 220);
    expect(far.normalBias).toBeGreaterThan(near.normalBias);
    expect(far.bias).toBeLessThan(near.bias);
    expect(shadowBias(1000, 2048, 1, 220).normalBias).toBe(0.11);
    expect(shadowBias(0.5, 2048, 1, 220).normalBias).toBeLessThan(0.11);
  });

  it("clamps the penumbra radius to [1.15, 4.2]", () => {
    expect(shadowBias(8, 2048, 1, 220).radius).toBe(4.2);
    expect(shadowBias(60, 2048, 1, 220).radius).toBeLessThan(4.2);
    expect(shadowBias(60, 2048, 1, 220).radius).toBeGreaterThanOrEqual(1.15);
    expect(shadowBias(1000, 128, 1, 220).radius).toBe(1.15);
  });

  it("matches the texel formula at the default zoom", () => {
    const t = shadowBias(8, 2048, 1, 220);
    const texel = 16 / 2048;
    expect(t.normalBias).toBeCloseTo(texel * 1.9, 9);
    expect(t.bias).toBeCloseTo(-(0.005 + texel * 0.55) / 219, 12);
  });
});
