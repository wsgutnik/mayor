import { describe, expect, it } from "vitest";
import { facilityModelTransform } from "./scene";

describe("facility model transform", () => {
  it("uses the posed street-frame centre, yaw and x2 fallback scale", () => {
    expect(facilityModelTransform({ x: 4, y: 6, w: 2, h: 2, cx: 7.25, cz: 8.5, yaw: Math.PI / 6 }, 4, 6, 1.8))
      .toEqual({ x: 7.25, z: 8.5, yaw: Math.PI / 6, scale: 1.8 });
  });
  it("keeps axis-aligned legacy anchors exactly on their previous model transform", () => {
    expect(facilityModelTransform({ x: 4, y: 6, w: 2, h: 2 }, 4, 6, 1.8))
      .toEqual({ x: 5, z: 7, yaw: 0, scale: 1.8 });
  });
});
