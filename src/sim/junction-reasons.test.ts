import { buildLaneConnectors } from "./lanes";
import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad, planRoad } from "./sim";
import { buildJunction, junctionsOf } from "./junction";
import { addSegment } from "./roads";
import { rebuildRoadRaster } from "./world";
import { serialize, deserialize } from "./save";

describe("junction refusal reasons", () => {
  it("planner refuses two one-way roads that meet head-on in a straight line", () => {
    const s = blankShowcaseCity();
    placeRoad(s, 4, [{ x: 20.5, z: 30.5 }, { x: 30.5, z: 30.5 }]);           // → east
    const plan = planRoad(s, 5, [{ x: 40.5, z: 30.5 }, { x: 30.5, z: 30.5 }]); // → west, into it
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("One-way direction conflicts with the road it joins");
  });

  it("missing legal movements are diagnosed, never silent", () => {
    const s = blankShowcaseCity(), w = s.world;
    // Very acute Y: the sharp turn cannot stay on asphalt.
    placeRoad(s, 1, [{ x: 20.5, z: 30.5 }, { x: 30.5, z: 30.5 }]);
    placeRoad(s, 1, [{ x: 30.5, z: 30.5 }, { x: 20.5, z: 31.6 }]);
    const node = w.nodes.find((n) => Math.hypot(n.x - 30.5, n.z - 30.5) < 0.6)!;
    const l = buildJunction(w, node.id)!;
    const legal = l.arms.length * (l.arms.length - 1);
    const made = new Set(l.connectors!.map((c) => `${c.inArm}->${c.outArm}`)).size;
    const missing = l.diagnostics.filter((d) => d.code === "connector-missing").length;
    expect(made + missing).toBeGreaterThanOrEqual(legal);
  });

  it("an old save with a flat type-4 interchange ramp touching a highway loads and builds junctions", () => {
    const s = blankShowcaseCity(), w = s.world;
    placeRoad(s, 3, [{ x: 10.5, z: 30.5 }, { x: 50.5, z: 30.5 }]);
    addSegment(w, 4, [{ x: 30.5, z: 30.5 }, { x: 34.5, z: 26.5 }]); // what main.ts:529 used to create
    rebuildRoadRaster(w);
    const again = deserialize(serialize(s));
    expect(() => junctionsOf(again.world)).not.toThrow();
  });
});

describe("connector-missing wiring", () => {
  it("buildLaneConnectors reports legal movements it cannot place", () => {
    // A T whose asphalt polygon is a tiny triangle at the node: no connector fits, every legal movement is missing.
    const arms = [
      { segId: 1, end: "b" as const, type: 1 as const, dx: -1, dz: 0, trim: 0.5 },
      { segId: 2, end: "a" as const, type: 1 as const, dx: 1, dz: 0, trim: 0.5 },
      { segId: 3, end: "b" as const, type: 1 as const, dx: 0, dz: -1, trim: 0.5 },
    ];
    const tiny = [{ x: 30.49, z: 30.49 }, { x: 30.51, z: 30.49 }, { x: 30.5, z: 30.51 }];
    const r = buildLaneConnectors({ x: 30.5, z: 30.5 }, arms, tiny);
    expect(r.connectors).toHaveLength(0);
    expect(r.missing.length).toBe(6);
    for (const m of r.missing) expect(["left", "right", "straight"]).toContain(m.turn);
  });

});
