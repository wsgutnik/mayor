import { describe, expect, it } from "vitest";
import { generateWorld, ROAD } from "./world";
import { addSegment } from "./roads";
import { buildJunction } from "./junction";
import { pointInPolygon } from "./lanes";
import { profileOf } from "./corridor";

describe("junction lane graph", () => {
  it("keeps every sampled connector in its exact asphalt pad and below its curvature bound", () => {
    const w = generateWorld(48, 1); w.heights.fill(.35);
    addSegment(w, ROAD.STREET, [{x:5,z:24},{x:43,z:24}]);
    addSegment(w, ROAD.STREET, [{x:24,z:5},{x:24,z:43}]);
    const node=w.nodes.find(n=>n.segs.length===4)!;
    const l=buildJunction(w,node.id)!;
    expect(l.connectors.length).toBeGreaterThan(0);
    for(const c of l.connectors) {
      expect(c.points.length).toBeGreaterThanOrEqual(4); // ceil(d/.2), clamped 3..14 steps
      expect(c.points.length).toBeLessThanOrEqual(15);
      expect(c.points.every(p=>pointInPolygon(p,l.asphalt))).toBe(true);
      const limit=2/Math.min(profileOf(l.arms[c.inArm].type).laneWidth,profileOf(l.arms[c.outArm].type).laneWidth);
      expect(c.curvature).toBeLessThanOrEqual(limit+.001);
    }
  });

  it("exports proportional lane arrows without U-turns at a normal junction", () => {
    const w = generateWorld(48, 1); w.heights.fill(.35);
    addSegment(w, ROAD.AVENUE, [{x:5,z:24},{x:43,z:24}]);
    addSegment(w, ROAD.STREET, [{x:24,z:5},{x:24,z:43}]);
    const l=buildJunction(w,w.nodes.find(n=>n.segs.length===4)!.id)!;
    expect(l.laneArrows.some(a=>a.turns.includes("left"))).toBe(true);
    expect(l.laneArrows.every(a=>!a.turns.includes("uturn"))).toBe(true);
  });
});
