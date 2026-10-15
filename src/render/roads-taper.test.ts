import { describe, expect, it } from "vitest";
import {
  buildRoadNetworkGeometry, MARK_LIFT_FOR_TESTS, ROAD_CLASS,
} from "./roads";
import { junctionsOf, type JunctionLayout } from "../sim/junction";
import { inboundArmOffset, pointInPolygon } from "../sim/lanes";
import { blankShowcaseCity } from "../sim/showcase-cases";
import { placeRoad } from "../sim/sim";
import { profileOf } from "../sim/corridor";

function markingVertices(
  geo: ReturnType<typeof buildRoadNetworkGeometry>, cls: number,
): { x: number; y: number; z: number }[] {
  const pos = geo.getAttribute("position");
  const classes = geo.getAttribute("aClass");
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < pos.count; i++) {
    if (classes.getX(i) !== cls) continue;
    out.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });
  }
  return out;
}

function stopBarOffsets(
  geo: ReturnType<typeof buildRoadNetworkGeometry>, layout: JunctionLayout, armIndex: number,
): number[] {
  const arm = layout.arms[armIndex];
  const station = Math.max(arm.trimNeg.asphalt, arm.trimPos.asphalt) + 0.38;
  return markingVertices(geo, ROAD_CLASS.STOP_BAR).flatMap((p) => {
    const rx = p.x - layout.centre.x, rz = p.z - layout.centre.z;
    const along = rx * arm.dx + rz * arm.dz;
    if (Math.abs(along - station) > 0.05) return [];
    return [-rx * arm.dz + rz * arm.dx];
  });
}

function highwayArrowVertices(
  geo: ReturnType<typeof buildRoadNetworkGeometry>, layout: JunctionLayout,
): number {
  const pos = geo.getAttribute("position");
  const classes = geo.getAttribute("aClass");
  let count = 0;
  for (const arrow of layout.laneArrows) {
    if (!arrow.turns.length) continue;
    const arm = layout.arms[arrow.arm];
    const off = inboundArmOffset(arm, arrow.lane);
    if (off === undefined) continue;
    const trim = Math.max(arm.trimNeg.asphalt, arm.trimPos.asphalt);
    const cx = layout.centre.x + arm.dx * (trim + 0.98) - arm.dz * off;
    const cz = layout.centre.z + arm.dz * (trim + 0.98) + arm.dx * off;
    for (let i = 0; i < pos.count; i++) {
      if (classes.getX(i) !== ROAD_CLASS.FLAT) continue;
      if (Math.abs(pos.getY(i) - (MARK_LIFT_FOR_TESTS + 0.002)) > 1e-4) continue;
      if (Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz) < 0.3) count++;
    }
  }
  return count;
}

describe("taper rendering", () => {
  it("avenue → one-way street draws a pad and merge markings inside it", () => {
    const s = blankShowcaseCity(), w = s.world;
    placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 30.5, z: 30.5 }]);
    placeRoad(s, 4, [{ x: 30.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
    const l = [...junctionsOf(w).byNode.values()].find((x) => x.kind === "taper")!;
    expect(l).toBeTruthy();
    const geo = buildRoadNetworkGeometry(w, () => 0, { atlas: true });
    const pos = geo.getAttribute("position");
    let marks = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - MARK_LIFT_FOR_TESTS) > 0.003) continue;
      if (pointInPolygon({ x: pos.getX(i), z: pos.getZ(i) }, l.asphalt)) marks++;
    }
    expect(marks).toBeGreaterThanOrEqual(4 * l.taper!.droppedLanes.length);
    const arrows = markingVertices(geo, ROAD_CLASS.ARROW).filter((p) =>
      Math.abs(p.y - MARK_LIFT_FOR_TESTS) < 1e-4 && pointInPolygon(p, l.asphalt));
    expect(arrows).toHaveLength(4 * l.taper!.droppedLanes.length);
    // Dropped-lane dashes (12 vertices each) plus the pad's lane lines, all inside the ring.
    const taperDashes = markingVertices(geo, ROAD_CLASS.FLAT).filter((p) =>
      Math.abs(p.y - MARK_LIFT_FOR_TESTS) < 1e-4 && pointInPolygon(p, l.asphalt));
    expect(taperDashes.length).toBeGreaterThanOrEqual(12 * l.taper!.droppedLanes.length);
  });

  it("one-way stop bars span inbound arms and are absent from outbound arms", () => {
    const inbound = blankShowcaseCity();
    placeRoad(inbound, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
    placeRoad(inbound, 4, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }]);
    const inLayout = [...junctionsOf(inbound.world).byNode.values()].find((x) => x.kind === "junction")!;
    const inArm = inLayout.arms.findIndex((a) => a.type === 4);
    const inGeo = buildRoadNetworkGeometry(inbound.world, () => 0, { atlas: true });
    const offsets = stopBarOffsets(inGeo, inLayout, inArm);
    expect(offsets).toHaveLength(4);
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeGreaterThan(0.7);

    const outbound = blankShowcaseCity();
    placeRoad(outbound, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
    placeRoad(outbound, 4, [{ x: 30.5, z: 30.5 }, { x: 30.5, z: 40.5 }]);
    const outLayout = [...junctionsOf(outbound.world).byNode.values()].find((x) => x.kind === "junction")!;
    const outArm = outLayout.arms.findIndex((a) => a.type === 4);
    const outGeo = buildRoadNetworkGeometry(outbound.world, () => 0, { atlas: true });
    expect(stopBarOffsets(outGeo, outLayout, outArm)).toHaveLength(0);
  });

  it("highway junctions get no crosswalks, stop bars, or lane arrows", () => {
    const s = blankShowcaseCity();
    placeRoad(s, 3, [{ x: 10.5, z: 30.5 }, { x: 50.5, z: 30.5 }]);
    placeRoad(s, 3, [{ x: 30.5, z: 10.5 }, { x: 30.5, z: 30.5 }]);
    const layout = [...junctionsOf(s.world).byNode.values()].find((x) => x.kind === "junction")!;
    expect(layout).toBeTruthy();
    const geo = buildRoadNetworkGeometry(s.world, () => 0, { atlas: true });
    expect(markingVertices(geo, ROAD_CLASS.CROSSWALK)).toHaveLength(0);
    expect(markingVertices(geo, ROAD_CLASS.STOP_BAR)).toHaveLength(0);
    expect(highwayArrowVertices(geo, layout)).toBe(0);
  });
});

/**
 * Task 8 fix round 1: merge marks on real lane drops (2->1, 5->4), both
 * digitisations (wide arm at end "a" and "b"). droppedLanes offsets are in the
 * wide arm's outward frame; the kept lanes are on +perp = (-dz, dx), the left
 * of travel (travel = toward the node, -arm direction).
 */
describe("taper merge marks on real drops", () => {
  type Case = { name: string; wide: 2 | 5; narrow: 1 | 4; wideEnd: "a" | "b" };
  const cases: Case[] = [];
  for (const [wide, narrow] of [[2, 1], [5, 4]] as const) {
    for (const wideEnd of ["a", "b"] as const) cases.push({ name: `${wide}->${narrow} wide end ${wideEnd}`, wide, narrow, wideEnd });
  }
  const build = (c: Case) => {
    const s = blankShowcaseCity(), w = s.world;
    const A = { x: 20.5, z: 30.5 }, B = { x: 30.5, z: 30.5 }, C = { x: 40.5, z: 30.5 };
    // Travel A -> C for the one-way pair so lanes are dropped (wide -> narrow).
    if (c.wideEnd === "b") { expect(placeRoad(s, c.wide, [A, B]).ok).toBe(true); expect(placeRoad(s, c.narrow, [B, C]).ok).toBe(true); }
    else {
      // Wide segment digitised from the node outward (node at its end "a").
      expect(placeRoad(s, c.wide, [B, A]).ok).toBe(true);
      expect(placeRoad(s, c.narrow, c.wide === 5 ? [C, B] : [B, C]).ok).toBe(true);
      if (c.wide === 5) {
        // Both one-ways now run C -> A; flip them so traffic runs A -> C (wide -> narrow: lanes drop).
        // Re-drawing a one-way with the same tool flips its direction (sim.ts placeRoad).
        expect(placeRoad(s, c.wide, [B, A]).ok).toBe(true);
        expect(placeRoad(s, c.narrow, [C, B]).ok).toBe(true);
      }
    }
    const l = [...junctionsOf(w).byNode.values()].find((x) => x.kind === "taper")!;
    return { w, l };
  };
  for (const c of cases) {
    it(c.name, () => {
      const { w, l } = build(c);
      expect(l).toBeTruthy();
      const arm = l.arms[l.taper!.wideArm];
      expect(arm.end).toBe(c.wideEnd);
      const dropped = l.taper!.droppedLanes;
      expect(dropped.length).toBeGreaterThan(0);
      const geo = buildRoadNetworkGeometry(w, () => 0, { atlas: true });
      const pos = geo.getAttribute("position"), cls = geo.getAttribute("aClass");
      const lat = (x: number, z: number): number => -(x - l.centre.x) * arm.dz + (z - l.centre.z) * arm.dx;
      const lw = profileOf(c.wide).laneWidth;
      // Arrows: 4 consecutive vertices per quad (corners -0.3 tail, +0.3 head).
      const arrows: { x: number; z: number }[][] = [];
      for (let i = 0; i < pos.count; i++) {
        if (cls.getX(i) !== ROAD_CLASS.ARROW || Math.abs(pos.getY(i) - MARK_LIFT_FOR_TESTS) > 1e-4) continue;
        const q = [0, 1, 2, 3].map((k) => ({ x: pos.getX(i + k), z: pos.getZ(i + k) }));
        arrows.push(q);
        i += 3;
      }
      expect(arrows).toHaveLength(dropped.length);
      const perp = { x: -arm.dz, z: arm.dx }, travel = { x: -arm.dx, z: -arm.dz };
      const centres = arrows.map((q) => lat((q[0].x + q[2].x) / 2, (q[0].z + q[2].z) / 2)).sort((a, b) => a - b);
      const offs = dropped.map((d) => d.offset).sort((a, b) => a - b);
      centres.forEach((cl, k) => {
        expect(cl).toBeLessThan(0); // dropped (rightmost) side
        expect(cl).toBeGreaterThanOrEqual(offs[k] - 1e-6); // slid only toward the kept lanes
        expect(cl - offs[k]).toBeLessThanOrEqual(lw * 0.5);
      });
      for (const q of arrows) {
        for (const p of q) expect(pointInPolygon(p, l.asphalt)).toBe(true);
        const ux = (q[2].x + q[3].x - q[0].x - q[1].x) / 2, uz = (q[2].z + q[3].z - q[0].z - q[1].z) / 2;
        expect(ux * travel.x + uz * travel.z).toBeGreaterThan(0); // points along travel
        expect(ux * perp.x + uz * perp.z).toBeGreaterThan(0); // bends left, toward the kept lane
      }
      // Dashes and lane lines (flat class at MARK_LIFT near the taper): all
      // inside the ring; each dropped lane has dashes on its kept-side edge.
      const flats: number[] = [];
      for (let i = 0; i < pos.count; i++) {
        if (cls.getX(i) !== ROAD_CLASS.FLAT || Math.abs(pos.getY(i) - MARK_LIFT_FOR_TESTS) > 1e-4) continue;
        const p = { x: pos.getX(i), z: pos.getZ(i) };
        if (Math.hypot(p.x - l.centre.x, p.z - l.centre.z) > l.taper!.length + 1) continue;
        expect(pointInPolygon(p, l.asphalt)).toBe(true);
        flats.push(lat(p.x, p.z));
      }
      for (const o of offs) {
        expect(flats.some((x) => x >= o + lw / 2 - 0.02 && x <= o + lw + 1e-6), `dashes for lane ${o}`).toBe(true);
      }
      // Every mark fitted (a skipped one would be listed here instead of drawn outside).
      expect(geo.userData.diagnostics).toEqual([]);
    });
  }

  it("flipping a one-way rebuilds the taper (dropped <-> added lanes)", () => {
    const s = blankShowcaseCity(), w = s.world;
    const A = { x: 20.5, z: 30.5 }, B = { x: 30.5, z: 30.5 }, C = { x: 40.5, z: 30.5 };
    placeRoad(s, 5, [A, B]); placeRoad(s, 4, [B, C]);
    const taper = () => [...junctionsOf(w).byNode.values()].find((x) => x.kind === "taper")!.taper!;
    expect(taper().droppedLanes).toHaveLength(2);
    placeRoad(s, 5, [A, B]); placeRoad(s, 4, [B, C]); // re-draw = flip both
    expect(taper().droppedLanes).toHaveLength(0);
    expect(taper().addedLanes).toHaveLength(2);
  });

  it("added lanes (5->4 reversed travel) draw no merge marks", () => {
    const s = blankShowcaseCity(), w = s.world;
    placeRoad(s, 4, [{ x: 40.5, z: 30.5 }, { x: 30.5, z: 30.5 }]);
    placeRoad(s, 5, [{ x: 30.5, z: 30.5 }, { x: 20.5, z: 30.5 }]);
    const l = [...junctionsOf(w).byNode.values()].find((x) => x.kind === "taper")!;
    expect(l.taper!.droppedLanes).toHaveLength(0);
    expect(l.taper!.addedLanes.length).toBeGreaterThan(0);
    const geo = buildRoadNetworkGeometry(w, () => 0, { atlas: true });
    expect(markingVertices(geo, ROAD_CLASS.ARROW).filter((p) => Math.abs(p.y - MARK_LIFT_FOR_TESTS) < 1e-4)).toHaveLength(0);
  });
});
