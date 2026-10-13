import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Builder, buildModels } from "./models";
import { KIT_FACILITY_MAKERS, KIT_MAKERS } from "./kit-models";
import { zoneEntries } from "../sim/catalog";
import { FACILITY_INFO, ZONE } from "../sim/world";

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe("procedural models", () => {
  const set = buildModels();

  it("has one model per kit entry of every zone and level", () => {
    let total = 0;
    for (const z of [ZONE.RES, ZONE.COM, ZONE.IND]) {
      for (const l of [1, 2, 3]) {
        const n = zoneEntries(z, l).length;
        expect(n).toBeGreaterThan(0);
        for (let v = 0; v < n; v++) expect(set.buildings.has(`${z}-${l}-${v}`)).toBe(true);
        total += n;
      }
    }
    expect(set.buildings.size).toBe(total);
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
    expect(worst).toBeLessThanOrEqual(220);
    let total = 0;
    for (const g of set.buildings.values()) total += tris(g);
    expect(total / set.buildings.size).toBeLessThanOrEqual(150);
    let facilityWorst = 0;
    for (const g of set.facilities.values()) facilityWorst = Math.max(facilityWorst, tris(g));
    expect(facilityWorst).toBeLessThanOrEqual(260);
  });

  it("validates every dedicated kit model and keeps same-tier zoned entries distinct", () => {
    const validate = (make: (b: Builder) => void, budget: number) => {
      const b = new Builder(); make(b); const g = b.build();
      expect(g.attributes.position.count).toBeGreaterThan(0);
      expect(tris(g)).toBeLessThanOrEqual(budget);
      g.computeBoundingBox(); const box = g.boundingBox!;
      expect(box.min.x).toBeGreaterThanOrEqual(-.5); expect(box.max.x).toBeLessThanOrEqual(.5);
      expect(box.min.z).toBeGreaterThanOrEqual(-.5); expect(box.max.z).toBeLessThanOrEqual(.5);
      expect(box.min.y).toBeGreaterThanOrEqual(-.001); expect(box.max.y).toBeLessThan(2.6);
      return Array.from(g.attributes.position.array as ArrayLike<number>).join(",");
    };
    for (const make of Object.values(KIT_MAKERS)) validate(make!, 220);
    for (const make of Object.values(KIT_FACILITY_MAKERS)) validate(make!, 260);
    for (const z of [ZONE.RES, ZONE.COM, ZONE.IND]) for (const l of [1, 2, 3]) {
      const data = zoneEntries(z, l).map((e) => validate(KIT_MAKERS[e.n]!, 220));
      expect(new Set(data).size).toBe(data.length);
    }
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
