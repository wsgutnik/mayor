import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
});
