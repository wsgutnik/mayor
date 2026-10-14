import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeScene } from "./glb-models";

const ASSETS = [
  ["landmark_opera", 2], ["landmark_cathedral", 2], ["landmark_artdeco", 2],
  ["landmark_hotel", 4], ["landmark_conservatory", 2], ["landmark_clocktower", 2],
  ["landmark_observatory", 2], ["landmark_palace", 4],
] as const;
const file = (name: string) => `public/models/landmarks/${name}.glb`;
const triCount = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const load = (f: string) => { const b = readFileSync(f), ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); return new Promise<THREE.Group>((resolve, reject) => new GLTFLoader().parse(ab, "", g => resolve(g.scene), reject)); };

describe("landmark GLBs", () => {
  it.skipIf(!ASSETS.some(([name]) => existsSync(file(name))))("fit declared sites, touch ground, and retain a per-site budget", async () => {
    for (const [name, span] of ASSETS) {
      const f = file(name); expect(existsSync(f), f).toBe(true);
      const model = mergeScene(await load(f)); expect(model, f).not.toBeNull();
      const g = model!.geometry; g.computeBoundingBox(); const b = g.boundingBox!, lim = span / 2 + .01;
      expect(b.min.x, f).toBeGreaterThanOrEqual(-lim); expect(b.max.x, f).toBeLessThanOrEqual(lim);
      expect(b.min.z, f).toBeGreaterThanOrEqual(-lim); expect(b.max.z, f).toBeLessThanOrEqual(lim);
      expect(b.min.y, f).toBeGreaterThanOrEqual(-.01); expect(b.max.y, f).toBeLessThan(span === 2 ? 4.2 : 6.2);
      expect(triCount(g), f).toBeLessThanOrEqual(span === 2 ? 1400 : 2800);
      expect(model!.materials.length, f).toBeGreaterThan(0);
    }
  });
});
