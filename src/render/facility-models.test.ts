import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeScene } from "./glb-models";
import { FACILITY_FALLBACK_SCALE, facilityFallbackScale, facilityModelPlan } from "./facility-models";
import { FAC, FACILITY_INFO, FacilityKind, facilityFootprint } from "../sim/world";

const KINDS = Object.keys(FACILITY_INFO).map(Number) as FacilityKind[];
const file = (url: string) => `public${url}`;

function load(path: string): Promise<THREE.Group> {
  const b = readFileSync(path);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Promise((res, rej) => new GLTFLoader().parse(ab, "", (g) => res(g.scene), rej));
}
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe("facility model resolution", () => {
  it("resolves every facility kind to a shipped Blender model of its footprint (no placeholder left)", () => {
    // Pre-expansion kinds without a kit entry keep their procedural model (sewage outlet, park).
    const procedural = new Set<FacilityKind>([FAC.SEWAGE, FAC.PARK]);
    for (const kind of KINDS) {
      const plan = facilityModelPlan(kind);
      if (procedural.has(kind)) { expect(plan.url, `kind ${kind}`).toBeNull(); continue; }
      expect(plan.url, `kind ${kind}`).not.toBeNull();
      expect(existsSync(file(plan.url!)), `kind ${kind} -> ${plan.url}`).toBe(true);
      expect(plan.dir, `kind ${kind}`).toBe(facilityFootprint(kind) === 2 ? "x2" : plan.n! <= 40 ? "kit" : "x1");
    }
  });

  it("maps the new tiers to their expansion models", () => {
    expect(facilityModelPlan(FAC.TRAIN_STATION).url).toBe("/models/x2/61.glb");
    expect(facilityModelPlan(FAC.POWER_SOLAR).url).toBe("/models/x2/73.glb");
    expect(facilityModelPlan(FAC.POWER_LARGE).url).toBe("/models/x2/81.glb");
    expect(facilityModelPlan(FAC.WATER_LARGE).url).toBe("/models/x2/82.glb");
    expect(facilityModelPlan(FAC.FIRE_HQ).url).toBe("/models/x2/83.glb");
    expect(facilityModelPlan(FAC.WATER_TOWER).url).toBe("/models/x1/76.glb");
    expect(facilityModelPlan(FAC.FIRE_POST).url).toBe("/models/x1/84.glb");
  });

  it("enlarges only a 2x2 stand-in, never a 1x1 facility", () => {
    expect(facilityFallbackScale(FAC.POLICE, false)).toBe(1);
    expect(facilityFallbackScale(FAC.FIRE_POST, false)).toBe(1);
    expect(facilityFallbackScale(FAC.FIRE_HQ, false)).toBe(FACILITY_FALLBACK_SCALE);
    expect(facilityFallbackScale(FAC.FIRE_HQ, true)).toBe(1);
  });

  it("keeps the 1x1 expansion models inside their tile, on the ground and inside the 1400-triangle budget", async () => {
    for (const kind of KINDS) {
      const plan = facilityModelPlan(kind);
      if (plan.dir !== "x1") continue;
      const m = mergeScene(await load(file(plan.url!)));
      expect(m, plan.url!).not.toBeNull();
      const g = m!.geometry;
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.x).toBeGreaterThanOrEqual(-0.51);
      expect(b.max.x).toBeLessThanOrEqual(0.51);
      expect(b.min.z).toBeGreaterThanOrEqual(-0.51);
      expect(b.max.z).toBeLessThanOrEqual(0.51);
      expect(b.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(b.max.y).toBeLessThan(2.6);
      // A service building must read at least as large as a kit house: fill most of the tile.
      expect(Math.max(b.max.x - b.min.x, b.max.z - b.min.z), plan.url!).toBeGreaterThan(0.85);
      expect(tris(g), plan.url!).toBeLessThanOrEqual(1400);
    }
  });

  it("fills the 2x2 footprint with every new x2 service model", async () => {
    for (const kind of [FAC.TRAIN_STATION, FAC.POWER_SOLAR, FAC.POWER_LARGE, FAC.WATER_LARGE, FAC.FIRE_HQ] as FacilityKind[]) {
      const url = facilityModelPlan(kind).url!;
      const g = mergeScene(await load(file(url)))!.geometry;
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.max.x - b.min.x, url).toBeGreaterThan(1.8);
      expect(b.max.z - b.min.z, url).toBeGreaterThan(1.8);
    }
  });
});
