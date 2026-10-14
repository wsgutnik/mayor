import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeScene } from "./glb-models";

// 2x2 service-building variants, built by blender/buildings_x2.py into public/models/x2/.
const X2_IDS = [21, 27, 29, 32, 34, 40];
const path = (n: number) => `public/models/x2/${String(n).padStart(2, "0")}.glb`;
const present = X2_IDS.filter((n) => existsSync(path(n)));

function load(file: string): Promise<THREE.Group> {
  const b = readFileSync(file);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Promise((res, rej) => new GLTFLoader().parse(ab, "", (g) => res(g.scene), rej));
}
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe("2x2 service-building variants (x2)", () => {
  it.skipIf(present.length === 0)("every x2 model fits the 2x2 footprint and stays inside the triangle budget", async () => {
    for (const n of present) {
      const f = path(n);
      const m = mergeScene(await load(f));
      expect(m, f).not.toBeNull();
      const g = m!.geometry;
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.x, f).toBeGreaterThanOrEqual(-1.01);
      expect(b.max.x, f).toBeLessThanOrEqual(1.01);
      expect(b.min.z, f).toBeGreaterThanOrEqual(-1.01);
      expect(b.max.z, f).toBeLessThanOrEqual(1.01);
      expect(b.min.y, f).toBeGreaterThanOrEqual(-0.01);
      expect(b.max.y, f).toBeLessThan(4.2);
      expect(tris(g), f).toBeLessThanOrEqual(4000);
      expect(m!.materials.length, f).toBeGreaterThan(0);
    }
  });
});
