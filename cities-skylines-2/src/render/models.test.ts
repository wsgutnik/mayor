import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildModels, VARIANTS } from "./models";
import { FACILITY_INFO, ZONE } from "../sim/world";

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe("procedural models", () => {
  const set = buildModels();

  it("has every zone, level and variant", () => {
    for (const z of [ZONE.RES, ZONE.COM, ZONE.IND]) {
      for (const l of [1, 2, 3]) {
        for (let v = 0; v < VARIANTS; v++) expect(set.buildings.has(`${z}-${l}-${v}`)).toBe(true);
      }
    }
    expect(set.buildings.size).toBe(3 * 3 * VARIANTS);
  });

  it("has a model for every facility kind", () => {
    for (const k of Object.keys(FACILITY_INFO)) expect(set.facilities.has(Number(k) as never)).toBe(true);
  });

  it("stays inside its tile and under a sensible height", () => {
    for (const g of [...set.buildings.values(), ...set.facilities.values()]) {
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.x).toBeGreaterThanOrEqual(-0.5);
      expect(b.max.x).toBeLessThanOrEqual(0.5);
      expect(b.min.z).toBeGreaterThanOrEqual(-0.5);
      expect(b.max.z).toBeLessThanOrEqual(0.5);
      expect(b.min.y).toBeGreaterThanOrEqual(-0.001);
      expect(b.max.y).toBeLessThan(2.6);
    }
  });

  it("keeps triangle counts low enough for thousands of instances on an iPad", () => {
    let worst = 0;
    for (const g of set.buildings.values()) worst = Math.max(worst, tris(g));
    expect(worst).toBeLessThan(260);
    let total = 0;
    for (const g of set.buildings.values()) total += tris(g);
    expect(total / set.buildings.size).toBeLessThan(120);
  });

  it("taller levels are taller and every model has finite, normalised normals", () => {
    const height = (key: string) => { const g = set.buildings.get(key)!; g.computeBoundingBox(); return g.boundingBox!.max.y; };
    for (const z of [ZONE.RES, ZONE.COM]) expect(height(`${z}-3-0`)).toBeGreaterThan(height(`${z}-1-0`));
    for (const g of set.buildings.values()) {
      const n = g.attributes.normal.array as Float32Array;
      for (let i = 0; i < n.length; i += 3) {
        const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
        expect(l).toBeGreaterThan(0.99);
        expect(l).toBeLessThan(1.01);
      }
    }
  });

  it("splits windowed walls and plain surfaces into material groups", () => {
    const g = set.buildings.get(`${ZONE.COM}-3-0`)!;
    expect(g.groups.map((x) => x.materialIndex)).toEqual([0, 1]);
    expect(g.groups.reduce((n, x) => n + x.count, 0)).toBe(g.index!.count);
  });
});
