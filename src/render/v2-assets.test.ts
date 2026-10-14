import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeScene } from "./glb-models";
import { VISUAL_V2_REFERENCE_IDS } from "./visual-v2";

const path = (n: number, lod: number) => `public/models/v2/${String(n).padStart(2, "0")}_lod${lod}.glb`;

function load(file: string): Promise<THREE.Group> {
  const b = readFileSync(file);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Promise((res, rej) => new GLTFLoader().parse(ab, "", (g) => res(g.scene), rej));
}
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe("Visual V2 reference assets (opt-in variants)", () => {
  it("exports three LODs for every v2 building", () => {
    for (const n of VISUAL_V2_REFERENCE_IDS) for (const lod of [0, 1, 2]) expect(existsSync(path(n, lod)), path(n, lod)).toBe(true);
  });

  it("keeps every LOD inside the unit tile, on the ground, below 2.7, with triangles decreasing", async () => {
    for (const n of VISUAL_V2_REFERENCE_IDS) {
      const counts: number[] = [];
      for (const lod of [0, 1, 2]) {
        const f = path(n, lod);
        const m = mergeScene(await load(f));
        expect(m, f).not.toBeNull();
        const g = m!.geometry;
        g.computeBoundingBox();
        const b = g.boundingBox!;
        expect(b.min.x, f).toBeGreaterThanOrEqual(-0.51);
        expect(b.max.x, f).toBeLessThanOrEqual(0.51);
        expect(b.min.z, f).toBeGreaterThanOrEqual(-0.51);
        expect(b.max.z, f).toBeLessThanOrEqual(0.51);
        expect(b.min.y, f).toBeGreaterThanOrEqual(-0.01);
        expect(b.max.y, f).toBeLessThan(2.7);
        expect(m!.materials.length, f).toBeGreaterThan(0);
        counts.push(tris(g));
      }
      expect(counts[0], `#${n}`).toBeGreaterThan(counts[1]);
      expect(counts[1], `#${n}`).toBeGreaterThan(counts[2]);
      expect(counts[0], `#${n}`).toBeLessThanOrEqual(6000);
    }
  });
});
