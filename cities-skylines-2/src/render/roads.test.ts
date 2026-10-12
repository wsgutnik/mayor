import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { newCity, placeRoad, CityState } from "../sim/sim";
import { cidx, heightAt } from "../sim/world";
import { nodeArms } from "../sim/roads";
import { buildRoadNetworkGeometry, buildStripGeometry } from "./roads";

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

const road = (s: CityState, type: 1 | 2 | 3, pts: [number, number][]): void => {
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
    for (const node of s.world.nodes) {
      if (node.segs.length < 2) continue;
      let best = Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        const d = Math.hypot(pos[i] - node.x, pos[i + 2] - node.z);
        if (d < best) best = d;
      }
      // The node fan owns a vertex at (or nearly at) the centre.
      expect(best).toBeLessThan(0.05);
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

  it("keeps every vertex on a small fixed set of lifts (no per-segment offsets)", () => {
    const s = junction();
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const g = buildRoadNetworkGeometry(s.world, gy);
    const pos = g.attributes.position.array as Float32Array;
    const lifts = new Set<string>();
    for (let i = 0; i < pos.length / 3; i++) lifts.add((pos[i * 3 + 1] - gy(pos[i * 3], pos[i * 3 + 2])).toFixed(3));
    // ribbons 0.060 / kerb 0.066 / marks 0.064, then the node patch on top: kerb 0.078, asphalt 0.080
    const allowed = new Set(["0.060", "0.064", "0.066", "0.078", "0.080", "0.074"]);
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
      if (Math.abs(y - gy((ax + bx + cx) / 3, (az + bz + cz) / 3) - 0.06) > 5e-4) continue;
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
