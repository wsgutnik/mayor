import { describe, expect, it } from "vitest";
import { generateWorld, ZONE } from "./world";
import { applyLandmarkLandValue, landmarkCap, landmarkRoll, LANDMARK_COOLDOWN } from "./landmarks";
import type { OrientedLot } from "./zonecells";

const lot = (id = 7): OrientedLot => ({ id, seg: 1, side: 1, block: 0, row: 0, col: 0, w: 4, d: 4, zone: ZONE.COM, level: 3, build: 1, landmark: "opera", cx: 8.5, cz: 8.5, yaw: 0, tiles: [] });
describe("landmarks", () => {
  it("uses only seed, day and candidate identity for its deterministic roll", () => {
    expect(landmarkRoll(123, 45, lot())).toBe(landmarkRoll(123, 45, lot()));
    expect(landmarkRoll(123, 45, lot())).not.toBe(landmarkRoll(123, 46, lot()));
    expect(landmarkCap(749)).toBe(0); expect(landmarkCap(1500)).toBe(2);
  });
  it("applies bounded radial effects without changing distant tiles", () => {
    const w = generateWorld(20, 3); w.landValue.fill(95);
    applyLandmarkLandValue(w, [lot()]);
    expect(w.landValue[8 * w.size + 8]).toBe(100);
    expect(w.landValue[0]).toBe(95);
  });
  it("documents a nonzero cooldown", () => expect(LANDMARK_COOLDOWN).toBeGreaterThan(1));
});
