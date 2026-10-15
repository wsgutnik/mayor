import { describe, expect, it } from "vitest";
import { QUALITY_PROFILE } from "../prefs";
import { BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD } from "./postfx";

describe("cinematic post-processing", () => {
  it("keeps bloom restrained so only bright sources glow", () => {
    expect(BLOOM_THRESHOLD).toBeGreaterThanOrEqual(0.8);
    expect(BLOOM_STRENGTH).toBeLessThanOrEqual(0.5);
    expect(BLOOM_RADIUS).toBeGreaterThan(0);
    expect(BLOOM_RADIUS).toBeLessThanOrEqual(1);
  });

  it("enables bloom only on the high quality tier", () => {
    expect(QUALITY_PROFILE.low.bloom).toBe(false);
    expect(QUALITY_PROFILE.medium.bloom).toBe(false);
    expect(QUALITY_PROFILE.high.bloom).toBe(true);
  });
});
