import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeScene } from "./glb-models";

const MODELS = "public/models";
const TEXTURES = "public/textures";
const HD_TEXTURE_LIMIT = 1_500_000;

function load(path: string): Promise<THREE.Group> {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(ab, "", (g) => resolve(g.scene), reject));
}

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const files = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".glb")).map((f) => join(dir, f));
const pngSize = (path: string) => {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

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
      expect(tris(g), f).toBeLessThanOrEqual(1400);
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
      // Detailed fleet vehicles (rims, mirrors, seams, lights) get a vehicle-specific budget.
      const name = f.split("/").pop()!.replace(".glb", "");
      const vehicle = /^(car_|van|truck|bus|semi_)/.test(name);
      const heavy = /^(truck|bus|semi_)/.test(name);
      expect(tris(m!.geometry), f).toBeLessThanOrEqual(vehicle ? heavy ? 1500 : 1100 : 260);
    }
    const car = mergeScene(await load(join(MODELS, "props", "car_sedan.glb")))!;
    expect(car.glow.length).toBeGreaterThan(0); // head and tail lights
    const lamp = mergeScene(await load(join(MODELS, "props", "lamp.glb")))!;
    expect(lamp.glow.some((g) => g.name === "glow_lamp")).toBe(true);
  });

  it("street-furniture pack assets keep their authored bounds and 130-triangle budget", async () => {
    const expected: Record<string, [number, number, number]> = {
      shelter_small: [0.24, 0.36, 0.22], shelter_glass: [0.20, 0.40, 0.18],
      bench_road: [0.06, 0.20, 0.18], planter_street: [0.10, 0.18, 0.17],
      streetlight_b: [0.03, 0.11, 0.32], kiosk_route: [0.03, 0.08, 0.22],
      ticket_machine: [0.06, 0.07, 0.18], stop_sign_bus: [0.05, 0.07, 0.28],
    };
    for (const [name, bounds] of Object.entries(expected)) {
      const model = mergeScene(await load(join(MODELS, "props", `${name}.glb`)))!;
      model.geometry.computeBoundingBox();
      const box = model.geometry.boundingBox!, size = new THREE.Vector3();
      box.getSize(size);
      expect(tris(model.geometry), name).toBeLessThanOrEqual(130);
      // Export converts Blender Z-up to Three Y-up: footprint is X/Z and height is Y.
      expect(size.x, name).toBeLessThanOrEqual(bounds[0] + 0.01);
      expect(size.z, name).toBeLessThanOrEqual(bounds[1] + 0.01);
      expect(size.y, name).toBeLessThanOrEqual(bounds[2] + 0.01);
      expect(box.min.y, name).toBeGreaterThanOrEqual(-0.01);
    }
  });

  it("has compact HD texture siblings and the plot/window sheets required by the renderer", () => {
    const names = readdirSync(TEXTURES).filter((f) => f.endsWith(".png"));
    const set = new Set(names);
    const sd = names.filter((f) => !f.endsWith("_hd.png") && !f.endsWith("_md.png") && !f.includes("/"));
    for (const name of sd) {
      if (name === "window.png" || name === "window_glow.png") continue;
      const hd = name.replace(/\.png$/, "_hd.png");
      expect(set.has(hd), `${name} should have ${hd}`).toBe(true);
    }
    for (const name of names.filter((f) => f.endsWith("_hd.png"))) {
      expect(statSync(join(TEXTURES, name)).size, name).toBeLessThanOrEqual(HD_TEXTURE_LIMIT);
    }
    expect(set.has("plot.png")).toBe(true);
    expect(set.has("plot_hd.png")).toBe(true);
    expect(pngSize(join(TEXTURES, "plot.png"))).toEqual({ w: 512, h: 512 });
    expect(pngSize(join(TEXTURES, "plot_hd.png"))).toEqual({ w: 1024, h: 1024 });
    expect(pngSize(join(TEXTURES, "window.png"))).toEqual({ w: 256, h: 256 });
    expect(pngSize(join(TEXTURES, "window_glow.png"))).toEqual({ w: 256, h: 256 });
  });
});
