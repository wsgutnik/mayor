import { describe, expect, it } from "vitest";
import { guideAngles, resolveGuide } from "./road-guides";
const a = { x: 0, z: 0 };
describe("road guides", () => {
  it("generates deterministic world and road-relative fans", () => {
    expect(guideAngles(a)).toHaveLength(8);
    expect(guideAngles(a, Math.PI / 8)).toHaveLength(16);
    expect(guideAngles(a, 0, { fifteen: true })).toHaveLength(24);
  });
  it("snaps only inside its angular tolerance and keeps odd angles free", () => {
    const g = guideAngles(a);
    expect(resolveGuide(a, { x: 10, z: .5 }, g).guide).not.toBeNull();
    expect(resolveGuide(a, { x: 10, z: 2 }, g).guide).toBeNull();
  });
  it("holds the previous guide through its hysteresis band", () => {
    const g = guideAngles(a);
    const first = resolveGuide(a, { x: 10, z: .5 }, g).guide!;
    expect(resolveGuide(a, { x: 10, z: .8 }, g, 0, 4, first).guide?.angle).toBe(first.angle);
  });
  it("is deterministic and uses pixel tolerance at close range", () => {
    const g = guideAngles(a);
    const p = { x: 1, z: .15 };
    expect(resolveGuide(a, p, g)).toEqual(resolveGuide(a, p, g));
    expect(resolveGuide(a, p, g, 16).guide).not.toBeNull();
  });
});
