// src/dev/scenario-roads.test.ts
import { describe, expect, it } from "vitest";
import { buildRoadsScenario } from "./scenario";

describe("roads scenario", () => {
  it("places every case and has a camera for each", () => {
    const { state, shots } = buildRoadsScenario();
    expect(Object.keys(shots).sort()).toEqual(["A", "B", "C", "D", "E", "bridge", "four-way", "grade", "lane-reduction", "parallel", "tunnel", "upgrade"].sort());
    expect(state.world.segments.length).toBeGreaterThanOrEqual(20);
    for (const s of Object.values(shots)) {
      expect(s.x).toBeGreaterThan(4); expect(s.z).toBeGreaterThan(4);
      expect(s.x).toBeLessThan(state.world.size - 4); expect(s.z).toBeLessThan(state.world.size - 4);
    }
  });
});
