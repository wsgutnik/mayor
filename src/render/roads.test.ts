import { describe, expect, it } from "vitest";
import * as THREE from "three";
import * as fs from "node:fs";
import { newCity, placeRoad, CityState } from "../sim/sim";
import { cidx, heightAt, RoadType } from "../sim/world";
import { nodeArms } from "../sim/roads";
import { junctionsOf } from "../sim/junction";
import {
  buildRoadNetworkGeometry, buildStripGeometry, junctionDebugGeometry,
  JUNCTION_TILE, ROAD_CLASS, ROAD_TILE_LENGTH, roadClassFor,
} from "./roads";

const tris = (g: THREE.BufferGeometry): number =>
  (g.index ? g.index.count : g.attributes.position.count) / 3;

function flatTown(): CityState {
  const s = newCity(3);
  const ey = s.world.entry.y;
  for (let y = ey - 14; y <= ey + 16; y++)
    for (let x = 0; x <= 60; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e7;
  return s;
}

const road = (s: CityState, type: RoadType, pts: [number, number][]): void => {
  const r = placeRoad(s, type, pts.map(([x, y]) => ({ x, z: y })));
  expect(r.ok).toBe(true);
};

const finite = (g: THREE.BufferGeometry): void => {
  const pos = g.attributes.position.array as Float32Array;
  expect(pos.length).toBeGreaterThan(0);
  for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i])).toBe(true);
  const idxAttr = g.index;
  if (idxAttr) {
    const n = pos.length / 3;
    for (let i = 0; i < idxAttr.count; i++) expect(idxAttr.getX(i)).toBeLessThan(n);
  }
};

const pointInPoly = (poly: { x: number; z: number }[], p: { x: number; z: number }): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (((a.z > p.z) !== (b.z > p.z))
      && p.x < ((b.x - a.x) * (p.z - a.z)) / ((b.z - a.z) || 1e-12) + a.x) inside = !inside;
  }
  return inside;
};

const distToSeg = (p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number => {
  const vx = b.x - a.x, vz = b.z - a.z;
  const l2 = vx * vx + vz * vz;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / l2));
  return Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t));
};

const onBoundary = (poly: { x: number; z: number }[], p: { x: number; z: number }): boolean =>
  poly.some((a, i) => distToSeg(p, a, poly[(i + 1) % poly.length]) < 2e-3);

const minTriAngle = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number => {
  const ab = Math.hypot(ax - bx, az - bz), bc = Math.hypot(bx - cx, bz - cz), ca = Math.hypot(cx - ax, cz - az);
  if (ab < 1e-9 || bc < 1e-9 || ca < 1e-9) return 0;
  const angle = (x: number, y: number, z: number) =>
    Math.acos(Math.max(-1, Math.min(1, (x * x + y * y - z * z) / (2 * x * y)))) * 180 / Math.PI;
  return Math.min(angle(ab, ca, bc), angle(ab, bc, ca), angle(bc, ca, ab));
};

const dumpSvg = (name: string, s: CityState): void => {
  fs.mkdirSync("/tmp/junc2", { recursive: true });
  const chunks: string[] = [];
  const polys: { x: number; z: number }[][] = [];
  const lines: { x: number; z: number }[][] = [];
  const layouts = junctionsOf(s.world);
  for (const node of s.world.nodes) {
    const l = layouts.byNode.get(node.id);
    if (!l || l.asphalt.length < 3) continue;
    const d = junctionDebugGeometry(l);
    polys.push(d.asphalt);
    lines.push(...d.kerbs);
  }
  const all = [...polys.flat(), ...lines.flat()];
  const minX = Math.min(...all.map((p) => p.x)) - 1, maxX = Math.max(...all.map((p) => p.x)) + 1;
  const minZ = Math.min(...all.map((p) => p.z)) - 1, maxZ = Math.max(...all.map((p) => p.z)) + 1;
  const sx = 900 / Math.max(1, maxX - minX), sz = 700 / Math.max(1, maxZ - minZ);
  const pt = (p: { x: number; z: number }) => `${((p.x - minX) * sx).toFixed(1)},${((p.z - minZ) * sz).toFixed(1)}`;
  chunks.push(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700">`);
  chunks.push(`<rect width="900" height="700" fill="#f8f8f4"/>`);
  for (const p of polys) chunks.push(`<polygon points="${p.map(pt).join(" ")}" fill="#3b3f46" stroke="#111" stroke-width="2"/>`);
  for (const l of lines) chunks.push(`<polyline points="${l.map(pt).join(" ")}" fill="none" stroke="#f5f5f0" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
  chunks.push(`</svg>`);
  fs.writeFileSync(`/tmp/junc2/${name}.svg`, chunks.join("\n"));
};

describe("road network geometry", () => {
  const junction = (): CityState => {
    const s = flatTown();
    const ey = s.world.entry.y;
    road(s, 1, [[4.5, ey + 0.5], [20.5, ey + 0.5]]);
    road(s, 1, [[12.5, ey - 5], [12.5, ey + 5]]);
    road(s, 1, [[24.5, ey + 0.5], [30.5, ey + 0.5]]);
    return s;
  };

  it("builds finite junction geometry deterministically", () => {
    const s = junction();
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const a = buildRoadNetworkGeometry(s.world, gy);
    finite(a);
    expect(tris(a)).toBeGreaterThan(50);
    const b = buildRoadNetworkGeometry(s.world, gy);
    expect([...(a.attributes.position.array as Float32Array)])
      .toEqual([...(b.attributes.position.array as Float32Array)]);
    expect([...(a.index!.array as Uint16Array | Uint32Array)])
      .toEqual([...(b.index!.array as Uint16Array | Uint32Array)]);
  });

  it("covers every junction centre with asphalt", () => {
    const s = junction();
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const g = buildRoadNetworkGeometry(s.world, gy);
    const pos = g.attributes.position.array as Float32Array;
    const idxAttr = g.index!;
    const sign = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number =>
      (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
    const covered = (px: number, pz: number): boolean => {
      for (let t = 0; t < idxAttr.count; t += 3) {
        const vi = [idxAttr.getX(t), idxAttr.getX(t + 1), idxAttr.getX(t + 2)];
        const ax = pos[vi[0] * 3], az = pos[vi[0] * 3 + 2];
        const bx = pos[vi[1] * 3], bz = pos[vi[1] * 3 + 2];
        const cx = pos[vi[2] * 3], cz = pos[vi[2] * 3 + 2];
        const y = (pos[vi[0] * 3 + 1] + pos[vi[1] * 3 + 1] + pos[vi[2] * 3 + 1]) / 3;
        const lift = y - gy((ax + bx + cx) / 3, (az + bz + cz) / 3);
        if (Math.abs(lift - 0.06) > 5e-4 && Math.abs(lift - 0.08) > 5e-4) continue;
        const d1 = sign(px, pz, ax, az, bx, bz);
        const d2 = sign(px, pz, bx, bz, cx, cz);
        const d3 = sign(px, pz, cx, cz, ax, az);
        if (!((d1 < -1e-7 || d2 < -1e-7 || d3 < -1e-7) && (d1 > 1e-7 || d2 > 1e-7 || d3 > 1e-7))) return true;
      }
      return false;
    };
    // Ear clipping owns no centre vertex; the centre must lie inside an
    // asphalt triangle instead (ribbon or patch).
    for (const node of s.world.nodes) {
      if (node.segs.length < 2) continue;
      expect(covered(node.x, node.z)).toBe(true);
    }
  });

  it("paints zebras only at junctions with 3+ arms", () => {
    const s = junction();
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    // Vertex colours are stored linearised, so #f1f1ea reads ~0.85, well
    // above the kerb grey (~0.55) and the dash cream (~0.68).
    const white = (g: THREE.BufferGeometry): number => {
      const col = g.attributes.color.array as Float32Array;
      let n = 0;
      for (let i = 0; i < col.length; i += 3) {
        if (col[i] > 0.8 && col[i + 1] > 0.8 && col[i + 2] > 0.75) n++;
      }
      return n;
    };
    // Cross (4 arms) plus T (3 arms) both get zebras; the dead end gets none.
    expect(white(buildRoadNetworkGeometry(s.world, gy))).toBeGreaterThan(0);

    const lone = flatTown();
    const ey = lone.world.entry.y;
    road(lone, 1, [[30.5, ey + 10], [36.5, ey + 10]]);
    expect(white(buildRoadNetworkGeometry(lone.world, gy))).toBe(0);
  });

  it("exports inbound lane arrows on the junction-mark lift", () => {
    const s = flatTown();
    const ey = s.world.entry.y;
    road(s, 2, [[4.5, ey + 0.5], [28.5, ey + 0.5]]);
    road(s, 1, [[16.5, ey - 8], [16.5, ey + 8]]);
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const g = buildRoadNetworkGeometry(s.world, gy, { atlas: true });
    const cls = g.getAttribute("aClass").array as Float32Array;
    const pos = g.getAttribute("position").array as Float32Array;
    const arrows: number[] = [];
    for (let i = 0; i < cls.length; i++) if (cls[i] === ROAD_CLASS.ARROW) arrows.push(i);
    expect(arrows.length).toBeGreaterThan(0);
    expect(arrows.length % 4).toBe(0);
    for (const i of arrows) {
      expect(pos[i * 3 + 1] - gy(pos[i * 3], pos[i * 3 + 2])).toBeCloseTo(0.084, 3);
    }
  });

  it("keeps every vertex on a small fixed set of lifts (no per-segment offsets)", () => {
    const s = junction();
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const g = buildRoadNetworkGeometry(s.world, gy);
    const pos = g.attributes.position.array as Float32Array;
    const lifts = new Set<string>();
    for (let i = 0; i < pos.length / 3; i++) lifts.add((pos[i * 3 + 1] - gy(pos[i * 3], pos[i * 3 + 2])).toFixed(3));
    // ribbons 0.060 / kerb 0.066 / marks 0.064, node patch asphalt 0.080, bands and node markings above it 0.084 / 0.086
    const allowed = new Set(["0.060", "0.064", "0.066", "0.078", "0.080", "0.074", "0.084", "0.086"]);
    for (const y of lifts) expect(allowed.has(y)).toBe(true);
    expect(lifts.has("0.060")).toBe(true);
    expect(lifts.has("0.066")).toBe(true);
  });

  it("covers every arm mouth where streets meet an avenue at acute angles", () => {
    const s = flatTown();
    const ey = s.world.entry.y;
    road(s, 2, [[3.5, ey + 0.5], [28.5, ey + 0.5]]);
    road(s, 1, [[20.5, ey - 8], [15.5, ey + 0.5]]);
    road(s, 1, [[10.5, ey - 8], [15.5, ey + 0.5]]);
    const w = s.world;
    const node = w.nodes.find((n) => n.segs.length === 4)!;
    expect(node).toBeDefined();
    const gy = (x: number, z: number): number => heightAt(w, x, z);
    const g = buildRoadNetworkGeometry(w, gy);
    const pos = g.attributes.position.array as Float32Array;
    const idxAttr = g.index!;
    const tris: number[][] = [];
    for (let t = 0; t < idxAttr.count; t += 3) {
      const vi = [idxAttr.getX(t), idxAttr.getX(t + 1), idxAttr.getX(t + 2)];
      const ax = pos[vi[0] * 3], az = pos[vi[0] * 3 + 2];
      const bx = pos[vi[1] * 3], bz = pos[vi[1] * 3 + 2];
      const cx = pos[vi[2] * 3], cz = pos[vi[2] * 3 + 2];
      const y = (pos[vi[0] * 3 + 1] + pos[vi[1] * 3 + 1] + pos[vi[2] * 3 + 1]) / 3;
      const lift = y - gy((ax + bx + cx) / 3, (az + bz + cz) / 3);
      if (Math.abs(lift - 0.06) > 5e-4 && Math.abs(lift - 0.08) > 5e-4) continue;
      // No zero-area slivers in the asphalt layer.
      expect(Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2).toBeGreaterThan(1e-9);
      tris.push([ax, az, bx, bz, cx, cz]);
    }
    const sign = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number =>
      (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
    const covered = (px: number, pz: number): boolean => tris.some((t) => {
      const d1 = sign(px, pz, t[0], t[1], t[2], t[3]);
      const d2 = sign(px, pz, t[2], t[3], t[4], t[5]);
      const d3 = sign(px, pz, t[4], t[5], t[0], t[1]);
      return !((d1 < -1e-7 || d2 < -1e-7 || d3 < -1e-7) && (d1 > 1e-7 || d2 > 1e-7 || d3 > 1e-7));
    });
    // Every arm mouth is asphalt from the node centre out past the trims; the
    // samples sit slightly off the centreline so ribbon halves cannot hide them.
    for (const arm of nodeArms(w, node.id)) {
      for (const d of [0.4, 0.9, 1.4]) {
        const px = node.x + arm.dx * d - arm.dz * 0.05;
        const pz = node.z + arm.dz * d + arm.dx * 0.05;
        expect(covered(px, pz)).toBe(true);
      }
    }
  });

  it("keeps junction kerbs on the asphalt boundary or outside it", () => {
    const scenarios: CityState[] = [];
    {
      const s = flatTown(), ey = s.world.entry.y;
      road(s, 2, [[3.5, ey + 0.5], [28.5, ey + 0.5]]);
      road(s, 1, [[20.5, ey - 8], [15.5, ey + 0.5]]);
      road(s, 1, [[10.5, ey - 8], [15.5, ey + 0.5]]);
      scenarios.push(s);
      dumpSvg("acute-avenue", s);
    }
    {
      const s = flatTown(), ey = s.world.entry.y;
      road(s, 1, [[30.5, ey + 10], [36.5, ey + 10]]);
      scenarios.push(s);
      dumpSvg("dead-end", s);
    }
    {
      const s = flatTown(), ey = s.world.entry.y;
      road(s, 1, [[4.5, ey + 0.5], [12.5, ey + 0.5]]);
      road(s, 1, [[12.5, ey + 0.5], [20.5, ey + 2.5]]);
      scenarios.push(s);
      dumpSvg("bend", s);
    }
    {
      const s = flatTown(), ey = s.world.entry.y;
      road(s, 1, [[4.5, ey + 0.5], [20.5, ey + 0.5]]);
      road(s, 1, [[12.5, ey - 5], [12.5, ey + 5]]);
      road(s, 5, [[24.5, ey - 4], [24.5, ey + 0.5]]);
      road(s, 2, [[18.5, ey + 0.5], [30.5, ey + 0.5]]);
      scenarios.push(s);
      dumpSvg("cross-and-oneway-t", s);
    }
    for (const s of scenarios) {
      const layouts = junctionsOf(s.world);
      for (const node of s.world.nodes) {
        const l = layouts.byNode.get(node.id);
        if (!l || l.asphalt.length < 3) continue;
        const d = junctionDebugGeometry(l);
        for (const line of d.kerbs) {
          for (const p of line) {
            expect(pointInPoly(d.asphalt, p) && !onBoundary(d.asphalt, p)).toBe(false);
          }
        }
      }
    }
  });

  it("does not emit skinny junction triangles", () => {
    const s = flatTown();
    const ey = s.world.entry.y;
    road(s, 2, [[3.5, ey + 0.5], [28.5, ey + 0.5]]);
    road(s, 1, [[20.5, ey - 8], [15.5, ey + 0.5]]);
    road(s, 1, [[10.5, ey - 8], [15.5, ey + 0.5]]);
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const g = buildRoadNetworkGeometry(s.world, gy);
    const pos = g.attributes.position.array as Float32Array;
    const idxAttr = g.index!;
    for (let t = 0; t < idxAttr.count; t += 3) {
      const vi = [idxAttr.getX(t), idxAttr.getX(t + 1), idxAttr.getX(t + 2)];
      const ax = pos[vi[0] * 3], ay = pos[vi[0] * 3 + 1], az = pos[vi[0] * 3 + 2];
      const bx = pos[vi[1] * 3], by = pos[vi[1] * 3 + 1], bz = pos[vi[1] * 3 + 2];
      const cx = pos[vi[2] * 3], cy = pos[vi[2] * 3 + 1], cz = pos[vi[2] * 3 + 2];
      const lift = ((ay - gy(ax, az)) + (by - gy(bx, bz)) + (cy - gy(cx, cz))) / 3;
      if (Math.abs(lift - 0.078) > 0.001) continue;
      const area = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
      expect(area).toBeGreaterThan(1e-5);
      expect(minTriAngle(ax, az, bx, bz, cx, cz)).toBeGreaterThanOrEqual(5);
    }
  });

  it("maps road types to atlas classes", () => {
    expect(roadClassFor(1, 0)).toBe(ROAD_CLASS.STREET);
    expect(roadClassFor(2, 0)).toBe(ROAD_CLASS.AVENUE);
    expect(roadClassFor(3, 0)).toBe(ROAD_CLASS.HIGHWAY);
    expect(roadClassFor(4, 0)).toBe(ROAD_CLASS.ONEWAY_STREET);
    expect(roadClassFor(5, 0)).toBe(ROAD_CLASS.ONEWAY_AVENUE);
    expect(roadClassFor(1, 1)).toBe(ROAD_CLASS.ONEWAY_STREET);
    expect(roadClassFor(2, -1)).toBe(ROAD_CLASS.ONEWAY_AVENUE);
  });

  it("atlas avenue: one strip, UVs across 0..1 and along in tiles, 3x fewer vertices", () => {
    const s = flatTown();
    const ey = s.world.entry.y;
    road(s, 2, [[4.5, ey + 0.5], [24.5, ey + 0.5]]);
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const flat = buildRoadNetworkGeometry(s.world, gy);
    const atlas = buildRoadNetworkGeometry(s.world, gy, { atlas: true });
    finite(atlas);
    // Ribbon verts only (junction patches triangulate identically in both
    // paths, so they are excluded from the efficiency comparison): flat
    // ribbon lifts vs the atlas textured-strip classes.
    const liftOf = (g: THREE.BufferGeometry, i: number): number => {
      const p = g.attributes.position.array as Float32Array;
      return p[i * 3 + 1] - gy(p[i * 3], p[i * 3 + 2]);
    };
    let fv = 0;
    for (let i = 0; i < flat.attributes.position.count; i++) {
      const l = liftOf(flat, i);
      if (Math.abs(l - 0.06) < 5e-4 || Math.abs(l - 0.066) < 5e-4) fv++;
    }
    const acls = atlas.attributes.aClass.array as Float32Array;
    let av = 0;
    for (let i = 0; i < acls.length; i++) {
      if (acls[i] >= ROAD_CLASS.STREET && acls[i] <= ROAD_CLASS.ONEWAY_AVENUE) av++;
    }
    expect(fv).toBeGreaterThan(0);
    expect(av).toBeGreaterThan(0);
    expect(av * 3).toBeLessThanOrEqual(fv);
    // Cross-section UVs: u spans exactly 0..1, v spans the length in tiles.
    const uv = atlas.attributes.uv.array as Float32Array;
    const cls = atlas.attributes.aClass.array as Float32Array;
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity, n = 0;
    for (let i = 0; i < cls.length; i++) {
      if (cls[i] !== ROAD_CLASS.AVENUE) continue;
      n++;
      uMin = Math.min(uMin, uv[i * 2]); uMax = Math.max(uMax, uv[i * 2]);
      vMin = Math.min(vMin, uv[i * 2 + 1]); vMax = Math.max(vMax, uv[i * 2 + 1]);
    }
    expect(n).toBeGreaterThan(0);
    expect(uMin).toBe(0);
    expect(uMax).toBe(1);
    expect(vMin).toBe(0);
    expect(vMax).toBeCloseTo(20 / ROAD_TILE_LENGTH, 5);
  });

  it("atlas junction: patch uses world-space UV, zebras are single textured quads", () => {
    const s = junction();
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const g = buildRoadNetworkGeometry(s.world, gy, { atlas: true });
    finite(g);
    const pos = g.attributes.position.array as Float32Array;
    const uv = g.attributes.uv.array as Float32Array;
    const cls = g.attributes.aClass.array as Float32Array;
    const count = (c: number): number => cls.filter((v) => v === c).length;
    // One quad (4 verts) per zebra arm, crosswalks paired with stop bars.
    expect(count(ROAD_CLASS.CROSSWALK)).toBe(count(ROAD_CLASS.STOP_BAR));
    expect(count(ROAD_CLASS.CROSSWALK)).toBeGreaterThanOrEqual(16);
    expect(count(ROAD_CLASS.CROSSWALK) % 4).toBe(0);
    expect(count(ROAD_CLASS.JUNCTION)).toBeGreaterThan(0);
    for (let i = 0; i < cls.length; i++) {
      if (cls[i] !== ROAD_CLASS.JUNCTION) continue;
      expect(uv[i * 2]).toBeCloseTo(pos[i * 3] / JUNCTION_TILE, 4);
      expect(uv[i * 2 + 1]).toBeCloseTo(pos[i * 3 + 2] / JUNCTION_TILE, 4);
    }
    // Crosswalk UVs stay inside the texture.
    for (let i = 0; i < cls.length; i++) {
      if (cls[i] !== ROAD_CLASS.CROSSWALK && cls[i] !== ROAD_CLASS.STOP_BAR) continue;
      expect(uv[i * 2]).toBeGreaterThanOrEqual(0);
      expect(uv[i * 2]).toBeLessThanOrEqual(1);
      expect(uv[i * 2 + 1]).toBeGreaterThanOrEqual(0);
      expect(uv[i * 2 + 1]).toBeLessThanOrEqual(1);
    }
  });

  it("builds preview strips without junctions", () => {
    const s = flatTown();
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const g = buildStripGeometry(
      [{ type: 1, pts: [{ x: 4.5, z: 10.5 }, { x: 14.5, z: 10.5 }] }],
      gy, new THREE.Color("#7fe08a"),
    );
    finite(g);
    expect(tris(g)).toBeGreaterThan(0);
  });
});
