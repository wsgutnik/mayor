import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildRoadNetworkGeometry, padBandTriangles, ROAD_CLASS, ROAD_LIFT } from "./roads";
import { checkJunction, junctionsOf, type JunctionLayout } from "../sim/junction";
import { pointInPolygon } from "../sim/lanes";
import { blankShowcaseCity } from "../sim/showcase-cases";
import { placeRoad } from "../sim/sim";
import type { RoadType } from "../sim/world";
import { PAD_MIN_ANGLE, triangulateRing } from "./earclip";

type Case = { name: string; roads: [RoadType, { x: number; z: number }[]][]; slope?: boolean };
const CASES: Case[] = [
  { name: "avenue T one-way", roads: [[2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]], [4, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }]]] },
  { name: "street x avenue", roads: [[2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]], [1, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 40.5 }]]] },
  { name: "diagonal", roads: [[2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]], [1, [{ x: 24.5, z: 24.5 }, { x: 36.5, z: 36.5 }]]] },
  { name: "curve into street", roads: [[2, [{ x: 20.5, z: 30.5 }, { x: 26, z: 26 }, { x: 30.5, z: 30.5 }]], [1, [{ x: 30.5, z: 30.5 }, { x: 30.5, z: 40.5 }]]] },
  { name: "sloped T", slope: true, roads: [[2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]], [1, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }]]] },
  { name: "avenue to street taper", roads: [[2, [{ x: 20.5, z: 30.5 }, { x: 30.5, z: 30.5 }]], [1, [{ x: 30.5, z: 30.5 }, { x: 40.5, z: 30.5 }]]] },
];

type P2 = { x: number; z: number };
type Tri2 = [P2, P2, P2];

const signedArea = (poly: P2[]): number => poly.reduce((sum, a, i) => {
  const b = poly[(i + 1) % poly.length];
  return sum + a.x * b.z - b.x * a.z;
}, 0) / 2;

/** Exact convex polygon clipping; both inputs here are triangles. */
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

function padTriangles(layout: JunctionLayout, band: boolean): Tri2[] {
  if (!band) return triangulateRing(layout.asphalt);
  const b = padBandTriangles(layout);
  return [...(b.kerb ?? []), ...(b.walk ?? [])];
}

/**
 * Pad triangles as emitted (Float32 positions): matched by vertex within 1e-3,
 * bucketed by centroid so the low tier (where pad and ribbon share class 0 and
 * colour) can drop them before the overlap sum.
 */
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

function ribbonTriangles(
  geo: ReturnType<typeof buildRoadNetworkGeometry>, atlas: boolean, lift: number,
  allPads: PadIndex, groundY: (x: number, z: number) => number,
): Tri2[] {
  const pos = geo.getAttribute("position"), col = geo.getAttribute("color");
  const cls = geo.getAttribute("aClass"), idx = geo.getIndex()!;
  const band = lift > ROAD_LIFT + 0.003;
  const allowed = (band ? ["#ccd0d6"] : ["#31353c", "#41464e"]).map((hex) => new THREE.Color(hex));
  const out: Tri2[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const vi = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    if (!vi.every((v) => Math.abs(pos.getY(v) - groundY(pos.getX(v), pos.getZ(v)) - lift) < 1e-4)) continue;
    if (atlas) {
      if (!vi.every((v) => cls.getX(v) >= 1 && cls.getX(v) <= 5)) continue;
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

function shrink(ring: { x: number; z: number }[], c: { x: number; z: number }, by: number) {
  return ring.map((p) => { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz) || 1; return { x: p.x - (dx / d) * by, z: p.z - (dz / d) * by }; });
}

function distToRing(p: { x: number; z: number }, ring: { x: number; z: number }[]) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)));
  }
  return best;
}

describe("atlas ribbons stop at the junction trims", () => {
  for (const k of CASES) {
    it(k.name, () => {
      const s = blankShowcaseCity(), w = s.world;
      if (k.slope) for (let i = 0; i < w.heights.length; i++) w.heights[i] = 0.35 + 0.02 * (i % (w.size + 1));
      for (const [t, pts] of k.roads) expect(placeRoad(s, t, pts).ok ?? true).toBeTruthy();
      const geo = buildRoadNetworkGeometry(w, () => 0, { atlas: true });
      const pos = geo.getAttribute("position");
      const cls = geo.getAttribute("aClass");
      const pads = [...junctionsOf(w).byNode.values()].filter((l) => l.asphalt.length >= 3 && l.kind !== "middle");
      expect(pads.length).toBeGreaterThan(0);
      let inside = 0, bandInside = 0;
      for (let i = 0; i < pos.count; i++) {
        // Ribbon vertices only (atlas classes 1–5): pads may carry interior
        // Steiner points (earclip refineRing) that are part of the pad itself.
        if (cls.getX(i) < 1 || cls.getX(i) > 5) continue;
        if (Math.abs(pos.getY(i) - ROAD_LIFT) > 1e-4) continue;
        const p = { x: pos.getX(i), z: pos.getZ(i) };
        for (const l of pads) if (pointInPolygon(p, shrink(l.asphalt, l.centre, 1e-3))) {
          if (!l.asphalt.some((r) => Math.hypot(r.x - p.x, r.z - p.z) < 1e-3)) inside++;
        }
      }
      for (let i = 0; i < pos.count; i++) {
        if (cls.getX(i) < 1 || cls.getX(i) > 5 || Math.abs(pos.getY(i) - (ROAD_LIFT + 0.006)) > 1e-4) continue;
        const p = { x: pos.getX(i), z: pos.getZ(i) };
        for (const l of pads) {
          if (l.sidewalkOuter.length < 3 || !pointInPolygon(p, shrink(l.sidewalkOuter, l.centre, 1e-3))) continue;
          const onLayerRing = [l.asphalt, l.kerbOuter, l.sidewalkOuter]
            .some((ring) => distToRing(p, ring) < 1e-3);
          if (!onLayerRing) bandInside++;
        }
      }
      expect(inside).toBe(0);
      expect(bandInside).toBe(0);
    });
  }

  // Overlap method: exact Sutherland–Hodgman clipping of every same-height
  // ribbon triangle against every pad triangle (convex ∩ convex), summed per
  // junction. Asphalt level 0.060 and band level 0.066; atlas and low tier.
  for (const k of CASES) {
    it(`${k.name}: ribbons do not overlap same-height pads in either tier`, () => {
      const s = blankShowcaseCity(), w = s.world;
      if (k.slope) for (let i = 0; i < w.heights.length; i++) w.heights[i] = 0.35 + 0.02 * (i % (w.size + 1));
      for (const [t, pts] of k.roads) expect(placeRoad(s, t, pts).ok ?? true).toBeTruthy();
      const groundY = () => 0;
      const pads = [...junctionsOf(w).byNode.values()].filter((l) => l.asphalt.length >= 3 && l.kind !== "middle");
      expect(pads.length).toBeGreaterThan(0);
      for (const atlas of [true, false]) {
        const geo = buildRoadNetworkGeometry(w, groundY, { atlas });
        for (const band of [false, true]) {
          const byPad = pads.map((l) => padTriangles(l, band));
          const allPads = new PadIndex(byPad.flat());
          const ribbons = ribbonTriangles(
            geo, atlas, ROAD_LIFT + (band ? 0.006 : 0), allPads, groundY,
          );
          for (let p = 0; p < pads.length; p++) {
            let overlap = 0;
            for (const ribbon of ribbons) {
              for (const pad of byPad[p]) overlap += triangleOverlapArea(ribbon, pad);
            }
            expect.soft(overlap, `${k.name} ${atlas ? "atlas" : "low"} ${band ? "bands" : "asphalt"} node ${pads[p].nodeId}`)
              .toBeLessThanOrEqual(1e-4);
          }
        }
      }
    });
  }

  for (const k of CASES) {
    it(`${k.name}: pad asphalt triangles keep a ${PAD_MIN_ANGLE}° minimum angle`, () => {
      const s = blankShowcaseCity(), w = s.world;
      if (k.slope) for (let i = 0; i < w.heights.length; i++) w.heights[i] = 0.35 + 0.02 * (i % (w.size + 1));
      for (const [t, pts] of k.roads) expect(placeRoad(s, t, pts).ok ?? true).toBeTruthy();
      const geo = buildRoadNetworkGeometry(w, () => 0, { atlas: true });
      const pos = geo.getAttribute("position"), cls = geo.getAttribute("aClass"), idx = geo.getIndex()!;
      let checked = 0, worst = 180;
      for (let i = 0; i < idx.count; i += 3) {
        const v = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
        if (!v.every((x) => cls.getX(x) === ROAD_CLASS.JUNCTION && Math.abs(pos.getY(x) - ROAD_LIFT) < 1e-4)) continue;
        const [a, b, c] = v.map((x) => ({ x: pos.getX(x), z: pos.getZ(x) }));
        const ang = (p: P2, q: P2, r: P2): number => {
          const ux = q.x - p.x, uz = q.z - p.z, vx = r.x - p.x, vz = r.z - p.z;
          return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz))))) * 180 / Math.PI;
        };
        worst = Math.min(worst, ang(a, b, c), ang(b, c, a), ang(c, a, b));
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
      expect(worst).toBeGreaterThanOrEqual(PAD_MIN_ANGLE);
    });
  }

  it("pad and ribbon asphalt share one height", () => {
    const s = blankShowcaseCity(), w = s.world;
    placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
    placeRoad(s, 1, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }]);
    const pos = buildRoadNetworkGeometry(w, () => 0, { atlas: true }).getAttribute("position");
    const ys = new Set<number>();
    for (let i = 0; i < pos.count; i++) ys.add(Math.round(pos.getY(i) * 1e4) / 1e4);
    expect(ys.has(Math.round((ROAD_LIFT + 0.02) * 1e4) / 1e4)).toBe(false);
  });

  it("low-tier highway markings use profile shoulder and lane offsets", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 3, [{ x: 10.5, z: 20.5 }, { x: 40.5, z: 20.5 }]).ok ?? true).toBeTruthy();
    const pos = buildRoadNetworkGeometry(s.world, () => 0, { atlas: false }).getAttribute("position");
    const markVerts: { x: number; z: number }[] = [];
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - (ROAD_LIFT + 0.004)) < 1e-4) {
        markVerts.push({ x: pos.getX(i), z: pos.getZ(i) });
      }
    }
    expect(markVerts.length % 4).toBe(0);
    const offsets: number[] = [];
    for (let i = 0; i < markVerts.length; i += 4) {
      offsets.push(markVerts.slice(i, i + 4).reduce((sum, p) => sum + p.z - 20.5, 0) / 4);
    }
    const has = (want: number): boolean => offsets.some((off) => Math.abs(off - want) < 1e-3);
    expect(has(1.40 - 0.10)).toBe(true);
    expect(has(-(1.40 - 0.10))).toBe(true);
    expect(has(0.7)).toBe(false);
    expect(has(-0.7)).toBe(false);
  });

  it("rebuild time on a dense grid (report only)", () => {
    const s = blankShowcaseCity();
    for (let k = 0; k < 8; k++) {
      placeRoad(s, k % 2 ? 1 : 2, [{ x: 8.5, z: 8.5 + k * 6 }, { x: 56.5, z: 8.5 + k * 6 }]);
      placeRoad(s, k % 2 ? 2 : 1, [{ x: 8.5 + k * 6, z: 8.5 }, { x: 8.5 + k * 6, z: 56.5 }]);
    }
    const once = (): number => {
      const t = performance.now();
      s.world.graphRevision = (s.world.graphRevision ?? 0) + 1;
      buildRoadNetworkGeometry(s.world, () => 0, { atlas: true });
      return performance.now() - t;
    };
    const cold: number[] = [];
    for (let i = 0; i < 5; i++) cold.push(once());
    // Warm: JIT settled, best of 15 (the iPad budget is a warm rebuild).
    let warm = Infinity;
    for (let i = 0; i < 15; i++) warm = Math.min(warm, once());
    console.log(`[roads-1a] atlas rebuild cold mean ${(cold.reduce((a, b) => a + b, 0) / cold.length).toFixed(2)} ms, warm best ${warm.toFixed(2)} ms`);
  });
});

/**
 * Final review I1: a taper never exceeds its wide segment. Short wide
 * segments (street–avenue(L)–street, and an avenue running 2–3 tiles from a
 * cross into a street) must keep every pad apart from its neighbours and from
 * the ribbons at the same height (exact clipping, asphalt and band levels),
 * and a clamped taper reports `trim-clamped`.
 */
describe("taper clamped to its wide segment", () => {
  type Build = { name: string; roads: [RoadType, { x: number; z: number }[]][] };
  const builds: Build[] = [];
  for (const L of [1, 1.5, 2, 3, 5]) {
    builds.push({ name: `street–avenue(${L})–street`, roads: [
      [1, [{ x: 10.5, z: 30.5 }, { x: 20.5, z: 30.5 }]],
      [2, [{ x: 20.5, z: 30.5 }, { x: 20.5 + L, z: 30.5 }]],
      [1, [{ x: 20.5 + L, z: 30.5 }, { x: 30.5 + L, z: 30.5 }]],
    ] });
  }
  for (const L of [2, 3]) {
    builds.push({ name: `cross then ${L} tiles of avenue into a street`, roads: [
      [2, [{ x: 20.5, z: 30.5 }, { x: 30.5 + L, z: 30.5 }]],
      [1, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 40.5 }]],
      [1, [{ x: 30.5 + L, z: 30.5 }, { x: 40.5 + L, z: 30.5 }]],
    ] });
  }
  for (const b of builds) {
    it(b.name, () => {
      const s = blankShowcaseCity(), w = s.world;
      for (const [t, pts] of b.roads) expect(placeRoad(s, t, pts).ok).toBe(true);
      const layouts = [...junctionsOf(w).byNode.values()];
      const tapers = layouts.filter((l) => l.kind === "taper");
      expect(tapers.length).toBeGreaterThan(0);
      for (const t of tapers) {
        expect(t.diagnostics.some((d) => d.code === "trim-clamped"), `node ${t.nodeId}`).toBe(true);
        expect(checkJunction(t).ok).toBe(true);
      }
      const pads = layouts.filter((l) => l.asphalt.length >= 3);
      const groundY = () => 0;
      const geo = buildRoadNetworkGeometry(w, groundY, { atlas: true });
      for (const band of [false, true]) {
        const byPad = pads.map((l) => padTriangles(l, band));
        // Pad against pad.
        for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) {
          let overlap = 0;
          for (const a of byPad[i]) for (const c of byPad[j]) overlap += triangleOverlapArea(a, c);
          expect(overlap, `${band ? "bands" : "asphalt"} nodes ${pads[i].nodeId}/${pads[j].nodeId}`).toBeLessThanOrEqual(1e-4);
        }
        // Ribbons against pads.
        const ribbons = ribbonTriangles(geo, true, ROAD_LIFT + (band ? 0.006 : 0), new PadIndex(byPad.flat()), groundY);
        for (let p = 0; p < pads.length; p++) {
          let overlap = 0;
          for (const r of ribbons) for (const c of byPad[p]) overlap += triangleOverlapArea(r, c);
          expect(overlap, `${band ? "bands" : "asphalt"} ribbon/node ${pads[p].nodeId}`).toBeLessThanOrEqual(1e-4);
        }
      }
    });
  }
});
