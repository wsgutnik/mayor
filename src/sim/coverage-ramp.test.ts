import { describe, expect, it } from "vitest";
import { COVER } from "./world";
import { COVERAGE_HEX, coverageRamp, trafficByte } from "./coverage-field";

describe("coverageRamp", () => {
  it("gives near-white services a green served colour", () => {
    expect(COVERAGE_HEX[COVER.HEALTH]).toBe("#f2f6fb");
    expect(coverageRamp(COVER.HEALTH).covered).toBe("#35d38a");
  });

  it("keeps the service colour with amber/crimson stops otherwise", () => {
    const ramp = coverageRamp(COVER.POLICE);
    expect(ramp.covered).toBe("#3d6ee8");
    expect(ramp.warn).toBe("#e8a33d");
    expect(ramp.bad).toBe("#d6392c");
    expect(ramp.ring).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("covers every service bit", () => {
    for (const bit of Object.values(COVER)) {
      expect(COVERAGE_HEX[bit]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("trafficByte", () => {
  it("encodes clamp(load/capacity)", () => {
    expect(trafficByte(0, 4)).toBe(0);
    expect(trafficByte(2, 4)).toBe(128);
    expect(trafficByte(4, 4)).toBe(255);
    expect(trafficByte(9, 4)).toBe(255);
    expect(trafficByte(3, 0)).toBe(0);
  });
});
