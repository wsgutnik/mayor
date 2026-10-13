import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Box3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CATALOG } from "../sim/catalog";

const dir = "public/models";
const expected = Array.from({ length: 40 }, (_, i) => String(i + 1).padStart(2, "0") + ".glb");

function parseGLB(file: string): Promise<void> {
  const buf = readFileSync(join(dir, file));
  const array = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(array, "", gltf => {
      expect(gltf.scene.children.length, file).toBeGreaterThan(0);
      resolve();
    }, reject);
  });
}

describe("Mayor building asset completeness", () => {
  it("keeps precisely 40 stable catalog identifiers", () => {
    expect(CATALOG.map(entry => entry.n).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it("has a GLB file for every one of the 40 catalog buildings", () => {
    const present = readdirSync(dir).filter(name => name.endsWith(".glb")).sort();
    expect(present).toEqual(expected);
  });

  it("parses all 40 building GLBs", async () => {
    for (const file of expected) await parseGLB(file);
  });

  it("ships a manifest that agrees with the 40 GLBs and the catalog", async () => {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
      triLimit: number;
      buildings: { n: number; name: string; footprint: number[]; tris: number; inside_tile: boolean; variant: string; version: number }[];
    };
    expect(manifest.buildings.map((b) => b.n)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    for (const b of manifest.buildings) {
      expect(b.inside_tile, `#${b.n}`).toBe(true);
      expect(b.tris, `#${b.n}`).toBeLessThanOrEqual(manifest.triLimit);
      expect(b.footprint, `#${b.n}`).toEqual([1, 1]);
      expect(b.variant, `#${b.n}`).toBeTruthy();
      expect(b.version, `#${b.n}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps every building inside the unit tile with its base on the ground", async () => {
    for (const file of expected) {
      const buf = readFileSync(join(dir, file));
      const array = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const scene = await new Promise<import("three").Object3D>((res, rej) => new GLTFLoader().parse(array, "", (g) => res(g.scene), rej));
      const box = new Box3().setFromObject(scene);
      expect(box.min.x, file).toBeGreaterThanOrEqual(-0.51);
      expect(box.max.x, file).toBeLessThanOrEqual(0.51);
      expect(box.min.z, file).toBeGreaterThanOrEqual(-0.51);
      expect(box.max.z, file).toBeLessThanOrEqual(0.51);
      expect(box.min.y, file).toBeGreaterThanOrEqual(-0.01);
      expect(box.min.y, file).toBeLessThanOrEqual(0.02);
    }
  });
});
