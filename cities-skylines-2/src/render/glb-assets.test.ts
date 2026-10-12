import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeScene } from "./glb-models";

const MODELS = "public/models";

function load(path: string): Promise<THREE.Group> {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(ab, "", (g) => resolve(g.scene), reject));
}

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const files = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".glb")).map((f) => join(dir, f));

describe("Blender kit models", () => {
  const buildings = files(MODELS);
  const props = files(join(MODELS, "props"));

  it("has building models, and numbers are within 1-40", () => {
    expect(buildings.length).toBeGreaterThan(0);
    for (const f of buildings) {
      const n = Number(f.match(/(\d+)\.glb$/)![1]);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(40);
    }
  });

  it("every building parses, fits its tile and stays inside the triangle budget", async () => {
    for (const f of buildings) {
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
      expect(tris(g), f).toBeLessThanOrEqual(450);
      expect(m!.materials.length, f).toBeGreaterThan(0);
    }
  });

  it("has the trees, vehicles, boats and street furniture the renderer asks for", () => {
    const names = new Set(props.map((f) => f.split("/").pop()!.replace(".glb", "")));
    for (const n of ["tree_oak", "tree_pine", "tree_poplar", "tree_cherry", "tree_autumn", "tree_palm", "bush", "bush_flowers", "rock",
      "car_sedan", "car_hatch", "car_suv", "van", "truck", "bus", "train", "boat_motor", "boat_sail", "boat_ferry", "lamp"]) {
      expect(names.has(n), n).toBe(true);
    }
  });

  it("props are light enough for thousands of instances and light up at night where they should", async () => {
    for (const f of props) {
      const m = mergeScene(await load(f));
      expect(m, f).not.toBeNull();
      expect(tris(m!.geometry), f).toBeLessThanOrEqual(260);
    }
    const car = mergeScene(await load(join(MODELS, "props", "car_sedan.glb")))!;
    expect(car.glow.length).toBeGreaterThan(0); // head and tail lights
    const lamp = mergeScene(await load(join(MODELS, "props", "lamp.glb")))!;
    expect(lamp.glow.some((g) => g.name === "glow_lamp")).toBe(true);
  });
});
