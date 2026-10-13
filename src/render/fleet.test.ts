import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeScene } from "./glb-models";
import { ALL_FLEET_PROPS, BUS_LOOKS, CAR_LOOKS, TRUCK_LOOKS, pickLook } from "./fleet";

function load(path: string): Promise<THREE.Group> {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(ab, "", (g) => resolve(g.scene), reject));
}
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

const BUDGET: Record<string, number> = { car: 900, van: 900, truck: 1200, semi: 1200, bus: 1200 };
const budgetOf = (n: string): number => BUDGET[n.split("_")[0]] ?? 260;

describe("fleet props", () => {
  it("every look is built, single-mesh, within its budget, longer than wide and drives toward +X", async () => {
    for (const name of ALL_FLEET_PROPS) {
      const path = `public/models/props/${name}.glb`;
      expect(existsSync(path), path).toBe(true);
      const m = mergeScene(await load(path));
      expect(m, path).not.toBeNull();
      const g = m!.geometry;
      expect(tris(g), path).toBeLessThanOrEqual(budgetOf(name));
      g.computeBoundingBox();
      const b = g.boundingBox!;
      const len = b.max.x - b.min.x, wid = b.max.z - b.min.z, h = b.max.y - b.min.y;
      // glTF is Y-up: x is the driving axis, y the height, z the width
      expect(len, path).toBeGreaterThan(wid * 1.5);
      expect(h, path).toBeLessThan(0.4);
      expect(len, path).toBeLessThan(1.3);
      expect(b.min.y, path).toBeGreaterThanOrEqual(-0.01);
    }
  });

  it("picks a stable look per vehicle id and covers the table", () => {
    expect(pickLook(CAR_LOOKS, 7)).toBe(pickLook(CAR_LOOKS, 7));
    const seen = new Set(Array.from({ length: 200 }, (_, i) => pickLook(TRUCK_LOOKS, i)));
    expect(seen.size).toBe(new Set(TRUCK_LOOKS).size);
    const buses = new Set(Array.from({ length: 200 }, (_, i) => pickLook(BUS_LOOKS, i)));
    expect(buses.size).toBeGreaterThan(4);
    for (const look of ["car_station_wagon", "car_convertible", "car_coupe", "van_delivery", "car_minibus", "car_suv_long"]) {
      expect(CAR_LOOKS).toContain(look);
      expect(ALL_FLEET_PROPS).toContain(look);
    }
  });
});
