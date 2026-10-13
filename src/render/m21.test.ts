import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyTool, newCity, placeRoad, CityState } from "../sim/sim";
import { cidx, heightAt } from "../sim/world";
import { buildRoadNetworkGeometry, buildStripGeometry } from "./roads";
import { propGeometry } from "./props";
import { PROP_KINDS } from "../sim/props";

function flatTown(): CityState {
  const s = newCity(3);
  const ey = s.world.entry.y;
  for (let y = ey - 14; y <= ey + 16; y++)
    for (let x = 0; x <= 60; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e7;
  return s;
}

const colourCount = (g: THREE.BufferGeometry, hex: string): number => {
  const want = new THREE.Color(hex);
  const col = g.attributes.color.array as Float32Array;
  let n = 0;
  for (let i = 0; i < col.length; i += 3) {
    if (Math.abs(col[i] - want.r) < 0.02 && Math.abs(col[i + 1] - want.g) < 0.02 && Math.abs(col[i + 2] - want.b) < 0.02) n++;
  }
  return n;
};

describe("one-way and roundabout rendering", () => {
  it("draws amber chevrons pointing along the one-way direction", () => {
    const s = flatTown();
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const pts = [{ x: 5.5, z: 20.5 }, { x: 20.5, z: 20.5 }];
    const twoWay = buildStripGeometry([{ type: 4, pts }], gy);
    const oneWay = buildStripGeometry([{ type: 4, pts, dirSign: 1 }], gy);
    expect(colourCount(twoWay, "#f5c542")).toBe(0);
    expect(colourCount(oneWay, "#f5c542")).toBeGreaterThan(6);
  });

  it("stamps the island disc and keeps ring geometry finite", () => {
    const s = flatTown();
    const ey = s.world.entry.y;
    const road = (pts: [number, number][]) => expect(placeRoad(s, 1, pts.map(([x, y]) => ({ x, z: y }))).ok).toBe(true);
    road([[4.5, ey + 0.5], [24.5, ey + 0.5]]);
    road([[14.5, ey - 6], [14.5, ey + 6]]);
    expect(applyTool(s, "roundabout", 14, ey).ok).toBe(true);
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const g = buildRoadNetworkGeometry(s.world, gy);
    const pos = g.attributes.position.array as Float32Array;
    for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i])).toBe(true);
    expect(colourCount(g, "#6f9b4e")).toBeGreaterThan(10); // island grass
    expect(colourCount(g, "#f5c542")).toBeGreaterThan(6); // ring chevrons
  });

  it("builds finite procedural geometry for every prop kind", () => {
    for (const kind of [...PROP_KINDS, "traffic_light" as const]) {
      const g = propGeometry(kind);
      const pos = g.attributes.position.array as Float32Array;
      expect(pos.length).toBeGreaterThan(0);
      for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i])).toBe(true);
      expect(g.index!.count).toBeGreaterThan(0);
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      expect(bb.max.y - bb.min.y).toBeGreaterThan(0.15);
      expect(bb.max.y - bb.min.y).toBeLessThan(1.4);
      expect(bb.min.y).toBeGreaterThanOrEqual(-0.01);
    }
  });
});
