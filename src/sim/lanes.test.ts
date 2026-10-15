import { describe, expect, it } from "vitest";
import { generateWorld, ROAD } from "./world";
import { addSegment } from "./roads";
import { buildJunction } from "./junction";
import { armOffset, buildLaneConnectors, inboundArmOffset, pointInPolygon } from "./lanes";
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

  it("keeps all four arms of a street cross connected and marked", () => {
    const w = generateWorld(48, 1); w.heights.fill(.35);
    addSegment(w, ROAD.STREET, [{x:5,z:24},{x:43,z:24}]);
    addSegment(w, ROAD.STREET, [{x:24,z:5},{x:24,z:43}]);
    const l=buildJunction(w,w.nodes.find(n=>n.segs.length===4)!.id)!;
    expect(l.connectors).toHaveLength(12);
    expect(new Set(l.connectors.map(c => c.inArm)).size).toBe(4);
    expect(l.laneArrows.filter(a => a.turns.length > 0).map(a => a.arm).sort()).toEqual([0,1,2,3]);
  });

  it("mirrors segment offsets into the outward end-b frame and rejects exit-only one-way arms", () => {
    expect(armOffset({end:"a"}, -.19)).toBeCloseTo(-.19);
    expect(armOffset({end:"b"}, -.19)).toBeCloseTo(.19);
    const inA = inboundArmOffset({end:"a",type:ROAD.STREET,oneWay:true,dir:1}, 0);
    const inB = inboundArmOffset({end:"b",type:ROAD.STREET,oneWay:true,dir:1}, 0);
    expect(inA).toBeUndefined();
    expect(inB).toBeDefined();
    const arms = [
      {segId:1,end:"a" as const,type:ROAD.ONEWAY_STREET,dx:1,dz:0,trim:1,oneWay:true,dir:1 as const},
      {segId:2,end:"a" as const,type:ROAD.STREET,dx:-1,dz:0,trim:1},
    ];
    const g = buildLaneConnectors({x:0,z:0}, arms, [{x:-2,z:-2},{x:2,z:-2},{x:2,z:2},{x:-2,z:2}]);
    expect(g.arrows.filter(a => a.arm === 0)).toHaveLength(0);
  });

  it("reports legal arm pairs whose connectors cannot stay on asphalt", () => {
    const arms = [
      {segId:1,end:"a" as const,type:ROAD.STREET,dx:1,dz:0,trim:1},
      {segId:2,end:"a" as const,type:ROAD.STREET,dx:-1,dz:0,trim:1},
    ];
    const g = buildLaneConnectors(
      {x:0,z:0}, arms,
      [{x:-.1,z:-.1},{x:.1,z:-.1},{x:.1,z:.1},{x:-.1,z:.1}],
    );
    expect(g.connectors).toEqual([]);
    expect(g.missing).toEqual([
      {inArm:0,outArm:1,turn:"straight"},
      {inArm:1,outArm:0,turn:"straight"},
    ]);
  });
});
