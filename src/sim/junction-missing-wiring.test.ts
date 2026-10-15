/**
 * buildJunction must turn every movement buildLaneConnectors could not place into a
 * "connector-missing" diagnostic (docs/process/26-roads-cycle1.md 5.6). Real geometry rarely drops a
 * movement, so the lane builder is wrapped to report one.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./lanes", async (orig) => {
  const real = await orig<typeof import("./lanes")>();
  return {
    ...real,
    buildLaneConnectors: (...args: Parameters<typeof real.buildLaneConnectors>) => {
      const r = real.buildLaneConnectors(...args);
      return { ...r, missing: [...r.missing, { inArm: 0, outArm: 1, turn: "left" as const }] };
    },
  };
});

import { buildJunction } from "./junction";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad } from "./sim";

describe("connector-missing wiring", () => {
  for (const [label, b] of [["junction", [{ x: 30.5, z: 22.5 }, { x: 30.5, z: 30.5 }]], ["taper", [{ x: 30.5, z: 30.5 }, { x: 38.5, z: 30.5 }]]] as const) {
    it(`${label}: a missing movement becomes a diagnostic with its detail`, () => {
      const s = blankShowcaseCity(), w = s.world;
      placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: label === "taper" ? 30.5 : 40.5, z: 30.5 }]);
      placeRoad(s, label === "taper" ? 1 : 1, b.slice());
      const node = w.nodes.find((n) => Math.hypot(n.x - 30.5, n.z - 30.5) < 0.6)!;
      const l = buildJunction(w, node.id)!;
      expect(l.kind).toBe(label);
      expect(l.diagnostics).toContainEqual({ code: "connector-missing", detail: "0->1:left" });
    });
  }
});
