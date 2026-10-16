// src/dev/scenario-roads.test.ts
import { describe, expect, it } from "vitest";
import { buildInterchangeScenario, buildRoadsScenario } from "./scenario";
import { junctionsOf } from "../sim/junction";

describe("roads scenario", () => {
  it("places every case and has a camera for each", () => {
    const { state, shots } = buildRoadsScenario();
    expect(Object.keys(shots).sort()).toEqual(["A", "B", "C", "D", "E-legacy", "bridge", "four-way", "grade", "lane-reduction", "parallel", "tunnel", "upgrade"].sort());
    expect(state.world.segments.length).toBeGreaterThanOrEqual(20);
    for (const s of Object.values(shots)) {
      expect(s.x).toBeGreaterThan(4); expect(s.z).toBeGreaterThan(4);
      expect(s.x).toBeLessThan(state.world.size - 4); expect(s.z).toBeLessThan(state.world.size - 4);
    }
  });
});

describe("interchange scenario", () => {
  it("builds the diamond through the planner with two merges and two diverges", () => {
    const { state, built } = buildInterchangeScenario();
    expect(built).toBe(true);
    expect(state.world.segments.filter((s) => s.type === 6).length).toBeGreaterThanOrEqual(4);
    const kinds = [...junctionsOf(state.world).byNode.values()].map((l) => l.kind);
    expect(kinds.filter((k) => k === "merge")).toHaveLength(2);
    expect(kinds.filter((k) => k === "diverge")).toHaveLength(2);
  });
});
