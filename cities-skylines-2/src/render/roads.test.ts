import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { newCity, placeRoad, CityState } from "../sim/sim";
import { cidx, heightAt } from "../sim/world";
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

  it("keeps one lift per layer across the whole network", () => {
    const s = junction();
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const g = buildRoadNetworkGeometry(s.world, gy);
    const pos = g.attributes.position.array as Float32Array;
    const lifts = new Set<string>();
    for (let i = 0; i < pos.length / 3; i++) {
      const y = pos[i * 3 + 1] - gy(pos[i * 3], pos[i * 3 + 2]);
      // Bands are 0.002 apart, far above float32 noise: exact layer match.
      const layer =
        Math.abs(y - 0.06) < 5e-4 ? "asphalt" : Math.abs(y - 0.066) < 5e-4 ? "kerb" : "mark";
      lifts.add(`${layer}:${y.toFixed(3)}`);
    }
    // Asphalt, kerb and markings each sit on exactly one lift (no per-segment offsets).
    const byLayer = new Map<string, Set<string>>();
    for (const key of lifts) {
      const [layer, y] = key.split(":");
      if (!byLayer.has(layer)) byLayer.set(layer, new Set());
      byLayer.get(layer)!.add(y);
    }
    for (const [layer, ys] of byLayer) {
      expect(ys.size).toBe(1); // flat ground: exactly one lift per layer
      void layer;
    }
    expect(byLayer.has("asphalt")).toBe(true);
    expect(byLayer.has("kerb")).toBe(true);
    expect(lifts.size).toBe(3); // 0.06 asphalt, 0.066 kerb, 0.064 markings
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
