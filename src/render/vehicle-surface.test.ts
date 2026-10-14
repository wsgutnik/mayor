import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeScene } from "./glb-models";
import { ALL_FLEET_PROPS } from "./fleet";
import { CLS, LIGHT, bakeVehicleSurface, classOf, knownMaterialNames, lampAnchors, pitchFor, shadowProxy } from "./vehicle-surface";

function load(path: string): Promise<THREE.Group> {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(ab, "", (g) => resolve(g.scene), reject));
}

const LOOKS = [...new Set([...ALL_FLEET_PROPS, "train"])];
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe("vehicle surface classes", () => {
  it("maps every material name in every fleet GLB (no silent generic)", async () => {
    const known = knownMaterialNames();
    for (const name of LOOKS) {
      const m = mergeScene(await load(`public/models/props/${name}.glb`));
      for (const mat of m!.materials) expect(known.has(mat.name), `${name}: ${mat.name}`).toBe(true);
    }
  });

  it("bakes to 0 groups with full-length aClass / aLight / aSurf", async () => {
    const m = mergeScene(await load("public/models/props/car_sedan.glb"));
    expect(m!.geometry.groups.length).toBeGreaterThan(1);
    const baked = bakeVehicleSurface(m!, 8);
    const n = baked.geometry.attributes.position.count;
    expect(baked.geometry.groups.length).toBe(0);
    expect(baked.geometry.attributes.aClass.count).toBe(n);
    expect(baked.geometry.attributes.aLight.count).toBe(n);
    expect(baked.geometry.attributes.aSurf.count).toBe(n);
    expect(baked.aPaint.count).toBe(8);
    expect(baked.aState.count).toBe(8);
  });

  it("glass reads class 2 with a colour of its own, never the body paint", async () => {
    const m = mergeScene(await load("public/models/props/car_sedan.glb"));
    const baked = bakeVehicleSurface(m!, 4);
    const g = baked.geometry;
    const cls = g.attributes.aClass as THREE.BufferAttribute;
    const col = g.attributes.color as THREE.BufferAttribute;
    let glass = 0, paint = 0;
    const glassCol = new THREE.Color(), bodyCol = new THREE.Color();
    for (let i = 0; i < cls.count; i++) {
      if (cls.getX(i) === CLS.GLASS) {
        glass++;
        if (glass === 1) glassCol.setRGB(col.getX(i), col.getY(i), col.getZ(i));
      }
      if (cls.getX(i) === CLS.PAINT) {
        paint++;
        if (paint === 1) bodyCol.setRGB(col.getX(i), col.getY(i), col.getZ(i));
      }
    }
    expect(glass).toBeGreaterThan(0);
    expect(paint).toBeGreaterThan(0);
    expect(glassCol.equals(bodyCol)).toBe(false);
    // paint mask only on the body: glass, tyres and lamps ignore the instance paint
    const surf = g.attributes.aSurf as THREE.BufferAttribute;
    const light = g.attributes.aLight as THREE.BufferAttribute;
    for (let i = 0; i < cls.count; i++) {
      const c = cls.getX(i);
      if (c === CLS.PAINT) expect(surf.getX(i)).toBe(1);
      else expect(surf.getX(i)).toBe(0);
      if (c === CLS.LAMP) expect(light.getX(i)).toBeGreaterThan(0);
    }
  });

  it("maps lamps to lens class with head / tail light kinds", () => {
    expect(classOf("glow_head")).toMatchObject({ cls: CLS.LAMP, light: LIGHT.HEAD });
    expect(classOf("glow_tail")).toMatchObject({ cls: CLS.LAMP, light: LIGHT.TAIL });
    expect(classOf("tire").cls).toBe(CLS.RUBBER);
    expect(classOf("rim").cls).toBe(CLS.METAL);
  });

  it("builds a 24-tri proxy whose bbox contains the source", async () => {
    const m = mergeScene(await load("public/models/props/bus_city.glb"));
    const proxy = shadowProxy(m!.geometry);
    expect(tris(proxy)).toBe(24);
    m!.geometry.computeBoundingBox();
    proxy.computeBoundingBox();
    const s = m!.geometry.boundingBox!, p = proxy.boundingBox!;
    expect(p.min.x).toBeLessThanOrEqual(s.min.x + 1e-6);
    expect(p.max.x).toBeGreaterThanOrEqual(s.max.x - 1e-6);
    expect(p.min.z).toBeLessThanOrEqual(s.min.z + 1e-6);
    expect(p.max.z).toBeGreaterThanOrEqual(s.max.z - 1e-6);
    expect(p.max.y).toBeGreaterThanOrEqual(s.max.y - 1e-6);
  });

  it("derives lamp anchors inside the front / rear faces", async () => {
    const m = mergeScene(await load("public/models/props/car_sedan.glb"));
    const baked = bakeVehicleSurface(m!, 4);
    const { head, tail } = lampAnchors(baked.geometry);
    baked.geometry.computeBoundingBox();
    const bb = baked.geometry.boundingBox!;
    // forward is +X: headlamps on the +X face, tail lamps on the -X face
    expect(head[0]).toBeGreaterThan((bb.min.x + bb.max.x) / 2);
    expect(tail[0]).toBeLessThan((bb.min.x + bb.max.x) / 2);
    for (const a of [head, tail]) {
      expect(a[0]).toBeGreaterThanOrEqual(bb.min.x - 1e-6);
      expect(a[0]).toBeLessThanOrEqual(bb.max.x + 1e-6);
      expect(a[1]).toBeGreaterThanOrEqual(bb.min.y - 1e-6);
      expect(a[1]).toBeLessThanOrEqual(bb.max.y + 1e-6);
    }
  });

  it("pitches nose-up on a rising ramp and stays level on flat ground", () => {
    expect(pitchFor(1.2, 1.2, 0.32)).toBe(0);
    expect(pitchFor(1.3, 1.2, 0.32)).toBeGreaterThan(0);
    expect(pitchFor(1.2, 1.3, 0.32)).toBeLessThan(0);
    expect(pitchFor(9, 0, 0.32)).toBeLessThanOrEqual(0.5);
  });
});
