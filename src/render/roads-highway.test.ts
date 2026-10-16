import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  buildRoadNetworkGeometry, highwayLampPositions, ROAD_CLASS, ROAD_LIFT,
  MARK_LIFT_FOR_TESTS as MARK_LIFT,
} from "./roads";
import { junctionsOf, type JunctionLayout } from "../sim/junction";
import { pointInPolygon } from "../sim/lanes";
import { blankShowcaseCity } from "../sim/showcase-cases";
import { placeRoad } from "../sim/sim";
import { profileOf } from "../sim/corridor";
import { curvePoints, heightAt, makeDeckSampler, segElevation } from "../sim/world";
import { triangulateRing } from "./earclip";

const P = (x: number, z: number) => ({ x, z });

/** Report-only timing tests run only with MAYOR_PERF=1 and write under os.tmpdir(). */
const PERF = process.env.MAYOR_PERF === "1";

describe("highway structure", () => {
  it("a straight highway has a Jersey barrier 0.10 tall on the median, plain class, both tiers", () => {
    for (const atlas of [true, false]) {
      const s = blankShowcaseCity();
      placeRoad(s, 3, [P(10.5, 40.5), P(40.5, 40.5)]);
      const geo = buildRoadNetworkGeometry(s.world, () => 0, { atlas });
      const pos = geo.getAttribute("position"), cls = geo.getAttribute("aClass");
      let top = 0, n = 0;
      for (let i = 0; i < pos.count; i++) {
        if (cls.getX(i) !== ROAD_CLASS.PLAIN) continue;
        if (Math.abs(pos.getZ(i) - 40.5) > 0.07) continue;
        n++; top = Math.max(top, pos.getY(i));
      }
      expect(n).toBeGreaterThan(20);
      expect(top).toBeGreaterThan(0.06 + 0.095);
      expect(top).toBeLessThan(0.06 + 0.105);
    }
  });
  it("lamps every 3 tiles on the barrier, none near junction centres", () => {
    const s = blankShowcaseCity();
    placeRoad(s, 3, [P(10.5, 40.5), P(40.5, 40.5)]);
    const lamps = highwayLampPositions(s.world);
    expect(lamps.length).toBeGreaterThanOrEqual(9);
    for (const l of lamps) expect(Math.abs(l.z - 40.5)).toBeLessThan(0.01);
    expect(lamps.every((l) => l.twin)).toBe(true);
  });
});

/** Task 4 diverge, reused for every gore render assertion. */
function buildDiverge() {
  const s = blankShowcaseCity();
  expect(placeRoad(s, 3, [P(10.5, 40.5), P(70.5, 40.5)]).ok).toBe(true);
  expect(placeRoad(s, 6, [P(30.5, 40.5), P(36, 41.6), P(40.5, 44.5)]).ok).toBe(true);
  const l = [...junctionsOf(s.world).byNode.values()].find((x) => x.kind === "diverge")!;
  expect(l).toBeTruthy();
  return { s, l };
}

type P2 = { x: number; z: number };

/**
 * Gore paint triangle: node gore-side corner O, follows-arm mouth gore-side
 * point F1, ramp mouth far corner R1. Mirrors the renderer's vertex selection.
 */
function goreTriangle(l: JunctionLayout): [P2, P2, P2] {
  const g = l.gore!;
  const follows = l.arms.find((a) => a.type === 3 && (a.trimNeg.asphalt > 0 || a.trimPos.asphalt > 0))!;
  const mouth = follows.mouth!.asphalt!;
  const F1 = mouth.neg.s >= mouth.pos.s ? mouth.neg.p : mouth.pos.p;
  const goreLocal = follows.trimPos.asphalt > 0 ? 1 : -1;
  const px = -follows.dz, pz = follows.dx;
  const O = l.asphalt
    .filter((v) => ((v.x - l.centre.x) * px + (v.z - l.centre.z) * pz) * goreLocal > 0)
    .sort((a, b) => Math.hypot(a.x - l.centre.x, a.z - l.centre.z) - Math.hypot(b.x - l.centre.x, b.z - l.centre.z))[0];
  const ramp = l.arms[g.rampArm];
  const corners = [ramp.mouth!.asphalt!.neg.p, ramp.mouth!.asphalt!.pos.p];
  corners.sort((a, b) => Math.hypot(a.x - F1.x, a.z - F1.z) - Math.hypot(b.x - F1.x, b.z - F1.z));
  return [O, F1, corners[1]];
}

function whiteMarkVerts(geo: THREE.BufferGeometry): P2[] {
  const pos = geo.getAttribute("position"), col = geo.getAttribute("color");
  const out: P2[] = [];
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getY(i) - MARK_LIFT) > 1e-4) continue;
    if (Math.abs(col.getX(i) - 1) > 1e-6 || Math.abs(col.getY(i) - 1) > 1e-6 || Math.abs(col.getZ(i) - 1) > 1e-6) continue;
    out.push({ x: pos.getX(i), z: pos.getZ(i) });
  }
  return out;
}

describe("gore paint", () => {
  it("white chevrons and edge lines inside the gore triangle, both tiers", () => {
    const { s, l } = buildDiverge();
    const tri = goreTriangle(l);
    for (const atlas of [true, false]) {
      const geo = buildRoadNetworkGeometry(s.world, () => 0, { atlas });
      const white = whiteMarkVerts(geo);
      const inside = white.filter((p) => pointInPolygon(p, tri));
      expect(inside.length, `${atlas ? "atlas" : "low"} white verts in gore triangle`).toBeGreaterThan(20);
      for (const p of inside) expect(pointInPolygon(p, l.asphalt)).toBe(true);
    }
  });

  it("no ramp-side shoulder line continues past gore.length (low tier)", () => {
    const { s, l } = buildDiverge();
    const geo = buildRoadNetworkGeometry(s.world, () => 0, { atlas: false });
    const pos = geo.getAttribute("position"), col = geo.getAttribute("color");
    const line = new THREE.Color("#d8d4b0");
    const stopX = l.centre.x + l.gore!.length - 0.1;
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - MARK_LIFT) > 1e-4) continue;
      if (Math.abs(col.getX(i) - line.r) > 1e-6 || Math.abs(col.getY(i) - line.g) > 1e-6 || Math.abs(col.getZ(i) - line.b) > 1e-6) continue;
      // Ramp-side shoulder line of the follows arm: z ≈ 41.8, east of the node.
      if (pos.getZ(i) < 41.6 || pos.getZ(i) > 42.0 || pos.getX(i) <= l.centre.x) continue;
      n++;
      expect(pos.getX(i), "shoulder vert x").toBeGreaterThanOrEqual(stopX);
    }
    expect(n).toBeGreaterThan(0);
  });
});

// Exact convex polygon clipping (same pattern as roads-atlas.test.ts).
type Tri2 = [P2, P2, P2];
const signedArea = (poly: P2[]): number => poly.reduce((sum, a, i) => {
  const b = poly[(i + 1) % poly.length];
  return sum + a.x * b.z - b.x * a.z;
}, 0) / 2;

function triangleOverlapArea(subject: Tri2, clipTriangle: Tri2): number {
  const clip = signedArea(clipTriangle) < 0 ? [...clipTriangle].reverse() : clipTriangle;
  let poly: P2[] = [...subject];
  for (let i = 0; i < 3 && poly.length > 0; i++) {
    const a = clip[i], b = clip[(i + 1) % 3];
    const cross = (p: P2): number => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    const input = poly;
    poly = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const cp = cross(p), cq = cross(q);
      const pIn = cp >= -1e-10, qIn = cq >= -1e-10;
      if (pIn) poly.push(p);
      if (pIn === qIn) continue;
      const t = cp / (cp - cq);
      poly.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return poly.length < 3 ? 0 : Math.abs(signedArea(poly));
}

class PadIndex {
  private cells = new Map<string, Tri2[]>();
  constructor(tris: Tri2[]) {
    for (const t of tris) {
      const k = this.key(t);
      const list = this.cells.get(k);
      if (list) list.push(t); else this.cells.set(k, [t]);
    }
  }
  private key(t: Tri2, dx = 0, dz = 0): string {
    const cx = (t[0].x + t[1].x + t[2].x) / 3, cz = (t[0].z + t[1].z + t[2].z) / 3;
    return `${Math.round(cx * 50) + dx},${Math.round(cz * 50) + dz}`;
  }
  has(t: Tri2): boolean {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const p of this.cells.get(this.key(t, dx, dz)) ?? []) {
        if (t.every((a) => p.some((b) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-3))) return true;
      }
    }
    return false;
  }
}

function goreRibbonTriangles(
  geo: THREE.BufferGeometry, atlas: boolean, allPads: PadIndex,
): Tri2[] {
  const pos = geo.getAttribute("position"), col = geo.getAttribute("color");
  const cls = geo.getAttribute("aClass"), idx = geo.getIndex()!;
  const allowed = ["#31353c", "#41464e"].map((hex) => new THREE.Color(hex));
  const out: Tri2[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const vi = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    if (!vi.every((v) => Math.abs(pos.getY(v) - ROAD_LIFT) < 1e-4)) continue;
    if (atlas) {
      if (!vi.every((v) => cls.getX(v) === ROAD_CLASS.HIGHWAY || cls.getX(v) === ROAD_CLASS.RAMP)) continue;
    } else {
      if (!vi.every((v) => cls.getX(v) === 0)) continue;
      if (!vi.every((v) => allowed.some((c) =>
        Math.abs(col.getX(v) - c.r) < 1e-6 && Math.abs(col.getY(v) - c.g) < 1e-6 && Math.abs(col.getZ(v) - c.b) < 1e-6))) continue;
    }
    const tri = vi.map((v) => ({ x: pos.getX(v), z: pos.getZ(v) })) as Tri2;
    if (!atlas && allPads.has(tri)) continue;
    out.push(tri);
  }
  return out;
}

describe("gore overlap", () => {
  it("highway ribbon and ramp ribbon never overlap the gore pad at the same height", () => {
    const { s, l } = buildDiverge();
    const pads = triangulateRing(l.asphalt);
    const allPads = new PadIndex(pads);
    for (const atlas of [true, false]) {
      const geo = buildRoadNetworkGeometry(s.world, () => 0, { atlas });
      const ribbons = goreRibbonTriangles(geo, atlas, allPads);
      expect(ribbons.length).toBeGreaterThan(0);
      let overlap = 0;
      for (const ribbon of ribbons) {
        for (const pad of pads) overlap += triangleOverlapArea(ribbon, pad);
      }
      expect.soft(overlap, `${atlas ? "atlas" : "low"} tier`).toBeLessThanOrEqual(1e-4);
    }
  });

  it("the barrier stops before the gore pad", () => {
    const { s, l } = buildDiverge();
    for (const atlas of [true, false]) {
      const geo = buildRoadNetworkGeometry(s.world, () => 0, { atlas });
      const pos = geo.getAttribute("position"), cls = geo.getAttribute("aClass");
      for (let i = 0; i < pos.count; i++) {
        if (cls.getX(i) !== ROAD_CLASS.PLAIN || pos.getY(i) < 0.12) continue;
        // Tall PLAIN verts near the highway centreline are barrier, not caps.
        if (Math.abs(pos.getZ(i) - 40.5) > 0.5) continue;
        expect(pointInPolygon({ x: pos.getX(i), z: pos.getZ(i) }, l.asphalt),
          `barrier vert ${i} inside gore pad`).toBe(false);
      }
    }
  });
});

describe("gore barrier cap clearance", () => {
  for (const kind of ["merge", "diverge"] as const) {
    for (const angle of [12, 20, 29]) {
      it(`${kind} at ${angle}°: barrier cap keeps 0.1 clear of the gore pad, both tiers`, () => {
        const { s, l } = buildGoreAt(angle, kind);
        const ring = l.asphalt;
        const distToRing = (p: { x: number; z: number }): number => {
          let best = Infinity;
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
            const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
            best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z));
          }
          return best;
        };
        for (const atlas of [true, false]) {
          const geo = buildRoadNetworkGeometry(s.world, () => 0, { atlas });
          const pos = geo.getAttribute("position"), col = geo.getAttribute("color");
          const cls = geo.getAttribute("aClass");
          const concrete = new THREE.Color("#a8adb5");
          let min = Infinity;
          for (let i = 0; i < pos.count; i++) {
            if (cls.getX(i) !== ROAD_CLASS.PLAIN) continue;
            if (Math.abs(col.getX(i) - concrete.r) > 1e-6 ||
                Math.abs(col.getY(i) - concrete.g) > 1e-6 ||
                Math.abs(col.getZ(i) - concrete.b) > 1e-6) continue;
            if (Math.abs(pos.getZ(i) - 40.5) > 0.5) continue;
            min = Math.min(min, distToRing({ x: pos.getX(i), z: pos.getZ(i) }));
          }
          const tier = `${kind} ${angle}° ${atlas ? "atlas" : "low"}`;
          expect(min, `${tier} has a barrier cap near the pad`).toBeLessThan(0.5);
          expect(min, `${tier} cap clearance`).toBeGreaterThanOrEqual(0.09);
        }
      });
    }
  }
});

/** Straight-ramp merge/diverge at an exact angle (deg) off the east highway arm. */
function buildGoreAt(angleDeg: number, kind: "merge" | "diverge") {
  const s = blankShowcaseCity();
  expect(placeRoad(s, 3, [P(10.5, 40.5), P(70.5, 40.5)]).ok).toBe(true);
  const th = (angleDeg * Math.PI) / 180, L = 22;
  // Diverge leaves eastward; merge enters eastward from the west.
  const outer = kind === "diverge"
    ? P(30.5 + Math.cos(th) * L, 40.5 + Math.sin(th) * L)
    : P(30.5 - Math.cos(th) * L, 40.5 + Math.sin(th) * L);
  const pts = kind === "diverge" ? [P(30.5, 40.5), outer] : [outer, P(30.5, 40.5)];
  expect(placeRoad(s, 6, pts).ok).toBe(true);
  const l = [...junctionsOf(s.world).byNode.values()].find((x) => x.kind === kind)!;
  expect(l).toBeTruthy();
  return { s, l };
}

describe("gore angle sweep", () => {
  for (const kind of ["merge", "diverge"] as const) {
    for (const angle of [12, 15, 20, 25, 29]) {
      it(`${kind} at ${angle}°: barrier, ribbons and paint follow the gore ring`, () => {
        const { s, l } = buildGoreAt(angle, kind);
        const pads = triangulateRing(l.asphalt);
        const allPads = new PadIndex(pads);
        const tri = goreTriangle(l);
        for (const atlas of [true, false]) {
          const geo = buildRoadNetworkGeometry(s.world, () => 0, { atlas });
          const tier = `${kind} ${angle}° ${atlas ? "atlas" : "low"}`;
          const pos = geo.getAttribute("position"), cls = geo.getAttribute("aClass");
          for (let i = 0; i < pos.count; i++) {
            if (cls.getX(i) !== ROAD_CLASS.PLAIN) continue;
            // PLAIN verts near the highway centreline are barrier (any height:
            // the base sits at pad height); dead-end caps are far from the pad.
            if (Math.abs(pos.getZ(i) - 40.5) > 0.5) continue;
            expect(pointInPolygon({ x: pos.getX(i), z: pos.getZ(i) }, l.asphalt),
              `${tier} barrier vert ${i} inside gore pad`).toBe(false);
          }
          let overlap = 0;
          for (const ribbon of goreRibbonTriangles(geo, atlas, allPads)) {
            for (const pad of pads) overlap += triangleOverlapArea(ribbon, pad);
          }
          expect(overlap, `${tier} ribbon/pad overlap`).toBeLessThanOrEqual(1e-4);
          const white = whiteMarkVerts(geo);
          const inside = white.filter((p) => pointInPolygon(p, tri));
          expect(inside.length, `${tier} white verts in gore triangle`).toBeGreaterThan(20);
          for (const p of inside) expect(pointInPolygon(p, l.asphalt), `${tier} paint vert`).toBe(true);
          // Three full chevron Vs between the node corner O and the nose: white
          // on both sides of the axis near each station (a clipped half-V leaves
          // one side bare; edge lines run on the axis and dashes sit 0.5 off it).
          const [O, F1, R1] = tri;
          const ramp = l.arms[l.gore!.rampArm];
          const corners = [ramp.mouth!.asphalt!.neg.p, ramp.mouth!.asphalt!.pos.p];
          corners.sort((a, b) => Math.hypot(a.x - F1.x, a.z - F1.z) - Math.hypot(b.x - F1.x, b.z - F1.z));
          const nose = corners[0];
          const axisLen = Math.hypot(nose.x - O.x, nose.z - O.z);
          const ux = (nose.x - O.x) / axisLen, uz = (nose.z - O.z) / axisLen;
          let px = -uz, pz = ux;
          if ((R1.x - O.x) * px + (R1.z - O.z) * pz < 0) { px = -px; pz = -pz; }
          for (const t of [0.25, 0.5, 0.75]) {
            const c = { x: O.x + ux * axisLen * t, z: O.z + uz * axisLen * t };
            const near = white.filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < 0.35);
            expect(near.some((p) => (p.x - c.x) * px + (p.z - c.z) * pz > 0.05),
              `${tier} chevron t=${t} +side`).toBe(true);
            expect(near.some((p) => (p.x - c.x) * px + (p.z - c.z) * pz < -0.05),
              `${tier} chevron t=${t} -side`).toBe(true);
          }
        }
      });
    }
  }
});

/** Barrier triangles: PLAIN class, concrete, hugging the centreline. */
function barrierTriangles(geo: THREE.BufferGeometry, centreZ: number): number {
  const pos = geo.getAttribute("position"), col = geo.getAttribute("color");
  const cls = geo.getAttribute("aClass"), idx = geo.getIndex()!;
  const concrete = new THREE.Color("#a8adb5");
  const isBarrierVert = (v: number): boolean =>
    cls.getX(v) === ROAD_CLASS.PLAIN &&
    Math.abs(col.getX(v) - concrete.r) < 1e-6 &&
    Math.abs(col.getY(v) - concrete.g) < 1e-6 &&
    Math.abs(col.getZ(v) - concrete.b) < 1e-6 &&
    Math.abs(pos.getZ(v) - centreZ) <= 0.07;
  let n = 0;
  for (let i = 0; i < idx.count; i += 3) {
    if (isBarrierVert(idx.getX(i)) && isBarrierVert(idx.getX(i + 1)) && isBarrierVert(idx.getX(i + 2))) n++;
  }
  return n;
}

describe("barrier stations", () => {
  it("straight flat highway: barrier reuses the ribbon's end stations (no 0.25 sampling)", () => {
    const s = blankShowcaseCity();
    placeRoad(s, 3, [P(10.5, 40.5), P(50.5, 40.5)]);
    for (const atlas of [true, false]) {
      const geo = buildRoadNetworkGeometry(s.world, () => 0, { atlas });
      const total = geo.getIndex()!.count / 3;
      const barrier = barrierTriangles(geo, 40.5);
      // Two end rows + caps ≈ 18 tris; the 0.25 sampler emits ~1700.
      // (Low-tier total stays higher: dashes are real geometry there.)
      expect(barrier, `${atlas ? "atlas" : "low"} barrier tris`).toBeLessThanOrEqual(60);
      expect(total, `${atlas ? "atlas" : "low"} total tris`).toBeLessThanOrEqual(1000);
    }
  });

  it("curved highway: barrier still follows sampled stations", () => {
    const s = blankShowcaseCity();
    placeRoad(s, 3, [P(10.5, 40.5), P(30.5, 50.5), P(50.5, 40.5)]);
    for (const atlas of [true, false]) {
      const geo = buildRoadNetworkGeometry(s.world, () => 0, { atlas });
      // Count without the z filter: the arc leaves the straight centreline.
      const col = geo.getAttribute("color");
      const cls = geo.getAttribute("aClass"), idx = geo.getIndex()!;
      const concrete = new THREE.Color("#a8adb5");
      let n = 0;
      for (let i = 0; i < idx.count; i += 3) {
        const vs = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
        if (vs.every((v) =>
          cls.getX(v) === ROAD_CLASS.PLAIN &&
          Math.abs(col.getX(v) - concrete.r) < 1e-6 &&
          Math.abs(col.getY(v) - concrete.g) < 1e-6 &&
          Math.abs(col.getZ(v) - concrete.b) < 1e-6)) n++;
      }
      expect(n, `${atlas ? "atlas" : "low"} curved barrier tris`).toBeGreaterThan(100);
    }
  });

  it.skipIf(!PERF)("highway rebuild time on a 96x96 map (report only, MAYOR_PERF=1)", () => {
    // Parallel highways, no crossings: the barrier (not bridge decks) dominates.
    const s = blankShowcaseCity();
    for (let k = 0; k < 12; k++) {
      const z = 4.5 + k * 8;
      expect(placeRoad(s, 3, [{ x: 4.5, z }, { x: 36.5, z }]).ok).toBe(true);
      expect(placeRoad(s, 3, [{ x: 36.5, z }, { x: 68.5, z }]).ok).toBe(true);
      expect(placeRoad(s, 3, [{ x: 68.5, z }, { x: 92.5, z }]).ok).toBe(true);
    }
    const hwSegs = s.world.segments.filter((sg) => sg.type === 3).length;
    expect(hwSegs).toBeGreaterThanOrEqual(30);
    const lines = [`highway segments: ${hwSegs}`];
    for (const atlas of [true, false]) {
      const once = (): number => {
        const t = performance.now();
        s.world.graphRevision = (s.world.graphRevision ?? 0) + 1;
        buildRoadNetworkGeometry(s.world, () => 0, { atlas });
        return performance.now() - t;
      };
      for (let i = 0; i < 5; i++) once();
      let warm = Infinity;
      for (let i = 0; i < 15; i++) warm = Math.min(warm, once());
      const tris = buildRoadNetworkGeometry(s.world, () => 0, { atlas }).getIndex()!.count / 3;
      lines.push(`${atlas ? "atlas" : "low"} warm rebuild: ${warm.toFixed(2)} ms, ${tris} tris (target < 10 ms)`);
    }
    writeFileSync(join(tmpdir(), "mayor-highway-rebuild-timing.txt"), `${lines.join("\n")}\n`);
  });
});

describe("highway and ramp lamps", () => {
  it("ramps get single lamps on the outer side every 3 tiles", () => {
    // Long curved ramp: the near-gore singles are skipped as in-pad, so the
    // shared short diverge fixture keeps only one; spacing needs length.
    const s = blankShowcaseCity();
    expect(placeRoad(s, 3, [P(10.5, 40.5), P(70.5, 40.5)]).ok).toBe(true);
    expect(placeRoad(s, 6, [P(30.5, 40.5), P(41, 42.7), P(52.5, 46.5)]).ok).toBe(true);
    const lamps = highwayLampPositions(s.world);
    const singles = lamps.filter((l) => !l.twin);
    expect(singles.length).toBeGreaterThanOrEqual(2);
    const hw = profileOf(6).asphaltHalf + 0.15;
    const ramp = s.world.segments.find((sg) => sg.type === 6)!;
    // Distance to the dense centreline: the curve bows off the control chords.
    const dense = curvePoints(ramp.pts, 0.1);
    for (const lamp of singles) {
      let best = Infinity;
      for (let k = 0; k + 1 < dense.length; k++) {
        const a = dense[k], b = dense[k + 1];
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((lamp.x - a.x) * dx + (lamp.z - a.z) * dz) / l2));
        best = Math.min(best, Math.hypot(lamp.x - (a.x + dx * t), lamp.z - (a.z + dz * t)));
      }
      expect(Math.abs(best - hw)).toBeLessThan(0.05);
    }
  });

  it("ramp singles stand on the outer side (right of travel), merge and diverge", () => {
    for (const kind of ["merge", "diverge"] as const) {
      const { s } = buildGoreAt(20, kind);
      const ramp = s.world.segments.find((sg) => sg.type === 6)!;
      const singles = highwayLampPositions(s.world).filter((l) => !l.twin);
      expect(singles.length, `${kind} singles`).toBeGreaterThanOrEqual(2);
      const hw = profileOf(6).asphaltHalf + 0.15;
      const dense = curvePoints(ramp.pts, 0.1);
      for (const lamp of singles) {
        let best = { d: Infinity, off: 0 };
        for (let k = 0; k + 1 < dense.length; k++) {
          const a = dense[k], b = dense[k + 1];
          const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
          const t = Math.max(0, Math.min(1, ((lamp.x - a.x) * dx + (lamp.z - a.z) * dz) / l2));
          const px = a.x + dx * t, pz = a.z + dz * t;
          const d = Math.hypot(lamp.x - px, lamp.z - pz);
          if (d >= best.d) continue;
          const len = Math.hypot(dx, dz) || 1;
          // Segment-frame offset: pos = p + (-dz, dx) * off; + is right of a→b.
          const off = ((lamp.x - px) * (-dz / len) + (lamp.z - pz) * (dx / len));
          best = { d, off };
        }
        expect(Math.abs(best.d - hw), `${kind} lamp distance`).toBeLessThan(0.05);
        // Right of travel: a→b frame when dir is 1, flipped when dir is -1.
        const rightOfTravel = (ramp.dir ?? 1) === 1 ? best.off : -best.off;
        expect(rightOfTravel, `${kind} lamp at (${lamp.x.toFixed(2)}, ${lamp.z.toFixed(2)}) right of travel`).toBeGreaterThan(0);
      }
    }
  });

  it("ramp singles flip side with dir (right of travel either way)", () => {
    const { s } = buildGoreAt(20, "diverge");
    const ramp = s.world.segments.find((sg) => sg.type === 6)!;
    const before = highwayLampPositions(s.world).filter((l) => !l.twin);
    expect(before.length).toBeGreaterThanOrEqual(2);
    ramp.dir = -1;
    s.world.graphRevision = (s.world.graphRevision ?? 0) + 1;
    const after = highwayLampPositions(s.world).filter((l) => !l.twin);
    expect(after.length).toBe(before.length);
    const dense = curvePoints(ramp.pts, 0.1);
    const segOff = (lamp: { x: number; z: number }): number => {
      let best = { d: Infinity, off: 0 };
      for (let k = 0; k + 1 < dense.length; k++) {
        const a = dense[k], b = dense[k + 1];
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((lamp.x - a.x) * dx + (lamp.z - a.z) * dz) / l2));
        const px = a.x + dx * t, pz = a.z + dz * t;
        const d = Math.hypot(lamp.x - px, lamp.z - pz);
        if (d >= best.d) continue;
        const len = Math.hypot(dx, dz) || 1;
        best = { d, off: (lamp.x - px) * (-dz / len) + (lamp.z - pz) * (dx / len) };
      }
      return best.off;
    };
    for (let i = 0; i < before.length; i++) {
      expect(Math.sign(segOff(after[i])), `lamp ${i} flips side`).toBe(-Math.sign(segOff(before[i])));
      expect(-segOff(after[i]), `lamp ${i} right of b→a travel`).toBeGreaterThan(0);
    }
  });

  for (const kind of ["merge", "diverge"] as const) {
    for (const angle of [12, 20, 29]) {
      it(`no lamp inside any junction pad (+0.5 margin): ${kind} at ${angle}°`, () => {
        const { s } = buildGoreAt(angle, kind);
        const pads = [...junctionsOf(s.world).byNode.values()]
          .map((l) => l.asphalt).filter((ring) => ring.length >= 3);
        expect(pads.length).toBeGreaterThan(0);
        const lamps = highwayLampPositions(s.world);
        expect(lamps.length).toBeGreaterThan(0);
        const distToRing = (p: { x: number; z: number }, ring: { x: number; z: number }[]): number => {
          let best = Infinity;
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
            const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
            best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z));
          }
          return best;
        };
        for (const lamp of lamps) {
          for (const ring of pads) {
            expect(pointInPolygon(lamp, ring),
              `${lamp.twin ? "twin" : "single"} at (${lamp.x.toFixed(2)}, ${lamp.z.toFixed(2)}) inside pad`).toBe(false);
            expect(distToRing(lamp, ring),
              `${lamp.twin ? "twin" : "single"} at (${lamp.x.toFixed(2)}, ${lamp.z.toFixed(2)}) pad margin`).toBeGreaterThanOrEqual(0.5);
          }
        }
      });
    }
  }

  it("no lamp within 1.0 of a junction centre", () => {
    const s = blankShowcaseCity();
    placeRoad(s, 3, [P(10.5, 40.5), P(40.5, 40.5)]);
    const lamps = highwayLampPositions(s.world);
    for (const lamp of lamps) {
      for (const node of s.world.nodes) {
        expect(Math.hypot(lamp.x - node.x, lamp.z - node.z)).toBeGreaterThanOrEqual(1.0);
      }
    }
  });

  it("highway lamps on a bridge deck sit at deck height + barrier top, not at ground", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 1, [P(10.5, 20.5), P(60.5, 20.5)]).ok).toBe(true);
    expect(placeRoad(s, 3, [P(30.5, 5.5), P(30.5, 40.5)]).ok).toBe(true);
    const w = s.world;
    const bridge = w.segments.find((sg) => sg.type === 3 && segElevation(sg) === "bridge")!;
    expect(bridge).toBeTruthy();
    const deck = makeDeckSampler(w, bridge.pts);
    const twins = highwayLampPositions(w).filter((l) => l.twin);
    // sAt snaps to the 0.25 deck samples, so compare with its tolerance.
    const deckY = (x: number, z: number): number => deck.yAt(deck.sAt(x, z));
    const elevated = twins.filter((l) => deckY(l.x, l.z) - heightAt(w, l.x, l.z) > 0.3);
    expect(elevated.length).toBeGreaterThanOrEqual(1);
    for (const l of elevated) {
      expect(Math.abs(l.y - (deckY(l.x, l.z) + ROAD_LIFT + 0.10))).toBeLessThan(0.06);
      expect(l.y - heightAt(w, l.x, l.z)).toBeGreaterThan(0.3);
    }
    for (const l of twins.filter((l) => !elevated.includes(l))) {
      expect(Math.abs(l.y - (heightAt(w, l.x, l.z) + ROAD_LIFT + 0.10))).toBeLessThan(1e-9);
    }
  });
});
