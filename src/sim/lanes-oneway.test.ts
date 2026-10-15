// src/sim/lanes-oneway.test.ts
import { describe, expect, it } from "vitest";
import { laneOffsets } from "./lanes";
import { buildJunction } from "./junction";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad } from "./sim";
import { derive } from "./roadprofile";

describe("one-way lanes", () => {
  it("a one-way street offers both lanes in its travel direction and none against it", () => {
    const all = derive(4).laneCentres;
    // a→b travel: enters the junction at end b, leaves at end a.
    expect(laneOffsets({ end: "b", type: 4, oneWay: true, dir: 1 }, true)).toEqual(all);
    expect(laneOffsets({ end: "a", type: 4, oneWay: true, dir: 1 }, false)).toEqual(all);
    expect(laneOffsets({ end: "a", type: 4, oneWay: true, dir: 1 }, true)).toEqual([]);
    // b→a travel flips both.
    expect(laneOffsets({ end: "a", type: 4, oneWay: true, dir: -1 }, true)).toEqual(all.slice().reverse()); // left→right of b→a travel
    expect(laneOffsets({ end: "b", type: 4, oneWay: true, dir: -1 }, true)).toEqual([]);
  });

  for (const flip of [false, true]) {
    it(`T junction avenue + one-way street (${flip ? "redrawn reversed" : "drawn inward"}): connectors follow travel`, () => {
      const s = blankShowcaseCity(), w = s.world;
      placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
      const stem = [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }];
      placeRoad(s, 4, stem);
      if (flip) placeRoad(s, 4, stem); // redraw flips direction (existing behaviour; 1C replaces it)
      const seg = w.segments.find((g) => g.type === 4)!;
      const node = w.nodes.find((n) => Math.hypot(n.x - 30.5, n.z - 30.5) < 0.6)!;
      const l = buildJunction(w, node.id)!;
      const stemArm = l.arms.findIndex((a) => a.segId === seg.id);
      const inbound = (seg.dir ?? 1) === 1 ? (seg.b === node.id) : (seg.a === node.id);
      const fromStem = l.connectors!.filter((c) => c.inArm === stemArm);
      const intoStem = l.connectors!.filter((c) => c.outArm === stemArm);
      if (inbound) { expect(fromStem.length).toBeGreaterThan(0); expect(intoStem).toHaveLength(0); }
      else { expect(intoStem.length).toBeGreaterThan(0); expect(fromStem).toHaveLength(0); }
      // Left turns leave from the geometric left lane of the inbound arm.
      for (const c of l.connectors!.filter((c) => c.turn === "left")) {
        const arm = l.arms[c.inArm], p = c.points[0];
        const travelX = -arm.dx, travelZ = -arm.dz;            // inbound travel heads to the node
        const side = travelX * (p.z - l.centre.z) - travelZ * (p.x - l.centre.x); // >0 = left in x-right/z-down frame
        expect(side).toBeLessThan(0.5);
        const lanesOnArm = l.connectors!.filter((k) => k.inArm === c.inArm).map((k) => k.inLane);
        expect(c.inLane).toBe(Math.min(...lanesOnArm));
      }
    });
  }
});

describe("lane order is left to right of travel", () => {
  it("two-way and one-way arms list inbound and outbound lanes left first", () => {
    // +offset is the right of a→b, so travel a→b lists ascending and travel b→a descending.
    expect(laneOffsets({ end: "b", type: 2 }, true)).toEqual([0.3225, 0.6475]);    // a→b into end b
    expect(laneOffsets({ end: "a", type: 2 }, false)).toEqual([0.3225, 0.6475]);   // a→b out of end a
    expect(laneOffsets({ end: "a", type: 2 }, true)).toEqual([-0.3225, -0.6475]);  // b→a into end a
    expect(laneOffsets({ end: "b", type: 2 }, false)).toEqual([-0.3225, -0.6475]); // b→a out of end b
    expect(laneOffsets({ end: "a", type: 4, oneWay: true, dir: -1 }, true)).toEqual([0.19, -0.19]);
    expect(laneOffsets({ end: "b", type: 4, oneWay: true, dir: -1 }, false)).toEqual([0.19, -0.19]);
  });

  for (const [label, stem, redraw] of [
    ["one-way b→a inbound at its end a", [{ x: 30.5, z: 30.5 }, { x: 30.5, z: 20.5 }], true],
    ["one-way a→b inbound at its end b", [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }], false],
  ] as const) {
    it(`left turns leave from the leftmost inbound lane, right turns from the rightmost (${label})`, () => {
      const s = blankShowcaseCity(), w = s.world;
      placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
      placeRoad(s, 4, stem.slice());
      if (redraw) placeRoad(s, 4, stem.slice()); // drawn away from the node, then flipped: travel b→a into end a
      const seg = w.segments.find((g) => g.type === 4)!;
      const nodeId = w.nodes.find((n) => Math.hypot(n.x - 30.5, n.z - 30.5) < 0.6)!.id;
      expect((seg.dir ?? 1) === 1 ? seg.b : seg.a).toBe(nodeId); // the stem flows into the node
      const node = w.nodes.find((n) => Math.hypot(n.x - 30.5, n.z - 30.5) < 0.6)!;
      const l = buildJunction(w, node.id)!;
      let checked = 0;
      for (let arm = 0; arm < l.arms.length; arm++) {
        const outs = l.connectors!.filter((c) => c.inArm === arm);
        if (!outs.length) continue;
        const a = l.arms[arm];
        // Lateral coordinate, positive = LEFT of inbound travel (travel = -outward; z points south).
        const left = (p: { x: number; z: number }) => (p.z - l.centre.z) * a.dx - (p.x - l.centre.x) * a.dz;
        const lat = new Map<number, number>();
        for (const c of outs) lat.set(c.inLane, left(c.points[0]));
        const lanes = [...lat.keys()].sort((x, y) => x - y);
        for (let i = 1; i < lanes.length; i++) expect(lat.get(lanes[i])!).toBeLessThan(lat.get(lanes[i - 1])!);
        for (const c of outs.filter((c) => c.turn === "left")) { expect(c.inLane).toBe(lanes[0]); checked++; }
        for (const c of outs.filter((c) => c.turn === "right")) { expect(c.inLane).toBe(lanes[lanes.length - 1]); checked++; }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});
