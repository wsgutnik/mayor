import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad } from "./sim";
import { addSegment } from "./roads";
import { buildJunction, checkJunction } from "./junction";
import { derive } from "./roadprofile";
import type { RoadType } from "./world";

function straightPair(a: RoadType, b: RoadType, reverseB = false, reverseA = false) {
  const s = blankShowcaseCity(), w = s.world;
  const pa = [{ x: 20.5, z: 30.5 }, { x: 30.5, z: 30.5 }];
  placeRoad(s, a, reverseA ? pa.slice().reverse() : pa);
  const pb = [{ x: 30.5, z: 30.5 }, { x: 40.5, z: 30.5 }];
  placeRoad(s, b, reverseB ? pb.slice().reverse() : pb);
  const node = w.nodes.find((n) => Math.hypot(n.x - 30.5, n.z - 30.5) < 0.6)!;
  return { w, l: buildJunction(w, node.id)! };
}

function opposingOneWays(reverse = false) {
  const s = blankShowcaseCity(), w = s.world;
  const pa = [{ x: 20.5, z: 30.5 }, { x: 30.5, z: 30.5 }];
  const pb = [{ x: 30.5, z: 30.5 }, { x: 40.5, z: 30.5 }];
  addSegment(w, 5, reverse ? pa.slice().reverse() : pa);
  addSegment(w, 4, reverse ? pb : pb.slice().reverse());
  const node = w.nodes.find((n) => Math.hypot(n.x - 30.5, n.z - 30.5) < 0.6)!;
  return buildJunction(w, node.id)!;
}

describe("taper between collinear roads of different width", () => {
  for (const [a, b] of [[2, 1], [2, 4], [5, 4], [3, 3]] as [RoadType, RoadType][]) {
    it(`${a} → ${b}`, () => {
      const { l } = straightPair(a, b);
      if (a === b) { expect(l.kind).toBe("middle"); return; }
      expect(l.kind).toBe("taper");
      expect(checkJunction(l).errors).toEqual([]);
      const L = Math.min(3, Math.max(0.6, 6 * Math.abs(derive(a).asphaltHalf - derive(b).asphaltHalf)));
      expect(l.taper!.length).toBeCloseTo(L, 6);
      // Asphalt width shrinks monotonically along the taper.
      const wide = l.arms[l.taper!.wideArm];
      let prev = Infinity;
      for (let k = 0; k <= 10; k++) {
        const s = (L * (10 - k)) / 10;
        const px = l.centre.x + wide.dx * s, pz = l.centre.z + wide.dz * s;
        const width = widthAcross(l.asphalt, px, pz, -wide.dz, wide.dx);
        expect(width).toBeLessThanOrEqual(prev + 1e-6);
        prev = width;
      }
      expect(l.connectors!.length).toBeGreaterThan(0);
    });
  }

  it("reports the same avenue→street drop and street→avenue gain in the arm frame for either digitisation", () => {
    const layouts = [
      straightPair(2, 1).l,
      straightPair(2, 1, false, true).l,
      straightPair(2, 1, true).l,
      straightPair(2, 1, true, true).l,
    ];
    for (const l of layouts) {
      expect(l.taper!.droppedLanes).toEqual([{ side: 1, offset: -0.6475 }]);
      expect(l.taper!.addedLanes).toEqual([{ side: 1, offset: 0.6475 }]);
    }
  });

  it("avenue → one-way street pointing away has two matching lanes and no drop or gain", () => {
    const { l } = straightPair(2, 4);
    const street = l.arms.findIndex((a) => a.type === 4);
    expect(l.connectors!.every((c) => c.outArm === street)).toBe(true);
    expect(l.connectors).toHaveLength(2);
    expect(l.taper!.droppedLanes).toEqual([]);
    expect(l.taper!.addedLanes).toEqual([]);
  });

  it("one-way street pointing toward the avenue has two matching lanes and no drop or gain", () => {
    const { l } = straightPair(2, 4, true);
    const street = l.arms.findIndex((a) => a.type === 4);
    expect(l.connectors!.every((c) => c.inArm === street)).toBe(true);
    expect(l.connectors).toHaveLength(2);
    expect(l.taper!.droppedLanes).toEqual([]);
    expect(l.taper!.addedLanes).toEqual([]);
  });

  it("left-aligns a one-way avenue → street taper: the two rightmost avenue lanes drop into lane 1", () => {
    const l = straightPair(5, 4).l;
    const wide = l.taper!.wideArm, narrow = 1 - wide;
    expect(l.taper!.droppedLanes).toEqual([
      { side: 1, offset: -0.2025 },
      { side: 1, offset: -0.6075 },
    ]);
    expect(l.taper!.addedLanes).toEqual([]);
    const map = l.connectors.map((c) => [c.inArm, c.inLane, c.outArm, c.outLane]);
    expect(map).toEqual([[wide, 0, narrow, 0], [wide, 1, narrow, 1], [wide, 2, narrow, 1], [wide, 3, narrow, 1]]);
    expectConnectorsInside(l);
  });

  it("left-aligns a one-way street → avenue taper: lanes 2 and 3 are gained, fed from street lane 1", () => {
    const l = straightPair(5, 4, true, true).l;
    const wide = l.taper!.wideArm, narrow = 1 - wide;
    expect(l.taper!.droppedLanes).toEqual([]);
    expect(l.taper!.addedLanes).toEqual([
      { side: 1, offset: 0.2025 },
      { side: 1, offset: 0.6075 },
    ]);
    const map = l.connectors.map((c) => [c.inArm, c.inLane, c.outArm, c.outLane]);
    expect(map).toEqual([[narrow, 0, wide, 0], [narrow, 1, wide, 1], [narrow, 1, wide, 2], [narrow, 1, wide, 3]]);
    expectConnectorsInside(l);
  });

  it("avenue ↔ street taper drops the right lane into lane 0 and gains the right lane from lane 0, either draw direction", () => {
    for (const [rb, ra] of [[false, false], [true, true], [false, true], [true, false]]) {
      const l = straightPair(2, 1, rb, ra).l;
      const wide = l.taper!.wideArm, narrow = 1 - wide;
      const map = l.connectors.map((c) => [c.inArm, c.inLane, c.outArm, c.outLane]).sort();
      expect(map).toEqual([[wide, 0, narrow, 0], [wide, 1, narrow, 0], [narrow, 0, wide, 0], [narrow, 0, wide, 1]].sort());
      expectConnectorsInside(l);
    }
  });

  it("opposing one-way tapers diagnose a direction conflict and build no movement metadata", () => {
    for (const l of [opposingOneWays(), opposingOneWays(true)]) {
      expect(l.diagnostics.some((d) => d.code === "taper-direction-conflict")).toBe(true);
      expect(l.connectors).toEqual([]);
      expect(l.taper!.droppedLanes).toEqual([]);
      expect(l.taper!.addedLanes).toEqual([]);
      expect(checkJunction(l).errors).toEqual([]);
    }
  });

  it("puts every taper ring's narrow edge exactly at the node station", () => {
    const { l } = straightPair(2, 1);
    const narrow = l.arms[1 - l.taper!.wideArm];
    for (const ring of [l.asphalt, l.kerbOuter, l.sidewalkOuter, l.boundary]) {
      const atNode = ring.filter((p) =>
        Math.abs((p.x - l.centre.x) * narrow.dx + (p.z - l.centre.z) * narrow.dz) < 1e-9);
      expect(atNode).toHaveLength(2);
    }
  });

  it("a street corner off an avenue uses the street radius", () => {
    const s = blankShowcaseCity(), w = s.world;
    placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
    placeRoad(s, 1, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }]);
    const node = w.nodes.find((n) => Math.hypot(n.x - 30.5, n.z - 30.5) < 0.6)!;
    const l = buildJunction(w, node.id)!;
    const corners = l.fillets.filter((f) => f.rNominal > 0);
    expect(corners.length).toBeGreaterThan(0);
    for (const f of corners) expect(f.rNominal).toBeCloseTo(0.45, 6);
  });
});

function expectConnectorsInside(l: ReturnType<typeof buildJunction> & object) {
  expect(l.connectors.length).toBeGreaterThan(0);
  for (const c of l.connectors) {
    for (const p of c.points) expect(insideRing(l.asphalt, p.x, p.z), `connector ${c.inArm}.${c.inLane}->${c.outArm}.${c.outLane}`).toBe(true);
  }
}

function insideRing(ring: { x: number; z: number }[], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

/** Width of a CCW ring along the line through (px,pz) with unit normal (nx,nz). */
function widthAcross(ring: { x: number; z: number }[], px: number, pz: number, nx: number, nz: number): number {
  const hits: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const ex = b.x - a.x, ez = b.z - a.z;
    const den = nx * ez - nz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - px) * ez - (a.z - pz) * ex) / den;
    const u = ((a.x - px) * nz - (a.z - pz) * nx) / den;
    if (u >= -1e-9 && u <= 1 + 1e-9) hits.push(t);
  }
  return hits.length >= 2 ? Math.max(...hits) - Math.min(...hits) : 0;
}
