import { describe, expect, it } from "vitest";
import { QUALITY_PIXEL_CAP, QUALITY_PROFILE, qualityForPixelCap } from "./prefs";

describe("quality tiers", () => {
  it("maps pixel caps back to tiers", () => {
    expect(qualityForPixelCap(1)).toBe("low");
    expect(qualityForPixelCap(1.5)).toBe("medium");
    expect(qualityForPixelCap(2)).toBe("high");
  });

  it("keeps the profile pixel caps in sync with QUALITY_PIXEL_CAP", () => {
    for (const q of ["low", "medium", "high"] as const) {
      expect(QUALITY_PROFILE[q].pixelCap).toBe(QUALITY_PIXEL_CAP[q]);
    }
  });

  it("climbs in cost from low to high", () => {
    const tiers = ["low", "medium", "high"] as const;
    const shadow = tiers.map((q) => QUALITY_PROFILE[q].shadow);
    const veg = tiers.map((q) => QUALITY_PROFILE[q].veg);
    const lod = tiers.map((q) => QUALITY_PROFILE[q].lodDist);
    expect([...shadow].sort((a, b) => a - b)).toEqual(shadow);
    expect([...veg].sort((a, b) => a - b)).toEqual(veg);
    expect([...lod].sort((a, b) => a - b)).toEqual(lod);
    expect(QUALITY_PROFILE.low.splat).toBe("off");
    expect(QUALITY_PROFILE.high.splat).toBe("hd");
  });
});
