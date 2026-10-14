import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CoverageOverlay, ringWeight } from "./coverage-overlay";
import { MAX_RINGS } from "../sim/coverage-field";

describe("ringWeight", () => {
  it("keeps normal rings fully visible near the target", () => {
    expect(ringWeight(12, 38, 0)).toBeCloseTo(1, 5);
  });

  it("fades rings far larger than the view", () => {
    expect(ringWeight(60, 15, 0)).toBe(0);
  });

  it("fades rings far from the camera target", () => {
    expect(ringWeight(12, 38, 500)).toBe(0);
  });
});

describe("CoverageOverlay", () => {
  const setup = (size = 8) => {
    const scene = new THREE.Scene();
    const overlay = new CoverageOverlay(scene, size);
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial());
    overlay.attach(terrain, size);
    return { scene, overlay, terrain };
  };

  it("shares the terrain geometry with a transparent, non-shadow overlay material", () => {
    const { scene, overlay, terrain } = setup();
    const mesh = scene.children.find((o) => o.name === "coverage-infoview") as THREE.Mesh;
    expect(mesh).toBeDefined();
    expect(mesh.geometry).toBe(terrain.geometry);
    expect(overlay.material.transparent).toBe(true);
    expect(overlay.material.depthWrite).toBe(false);
    expect(overlay.material.polygonOffset).toBe(true);
    expect(overlay.material.polygonOffsetFactor).toBe(-2);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.renderOrder).toBe(5);
    expect(overlay.material.uniforms.uRings.value).toHaveLength(MAX_RINGS);
  });

  it("uploads field bytes without reallocating the texture", () => {
    const { overlay } = setup(4);
    const before = overlay.texture.image.data as Uint8Array;
    const data = new Uint8Array(4 * 4 * 4).fill(7);
    overlay.setField({ size: 4, data, rings: [{ x: 1, z: 1, r: 12 }], facilities: 1, developed: 1, servedFrac: 1 });
    expect(overlay.texture.image.data).toBe(before);
    expect(before[0]).toBe(7);
    expect(overlay.texture.version).toBeGreaterThan(0);
    expect(overlay.material.uniforms.uRingCount.value).toBe(1);
  });

  it("writes ring uniforms from the camera and skips repeat work", () => {
    const { overlay } = setup(8);
    overlay.setField({ size: 8, data: new Uint8Array(8 * 8 * 4), rings: [{ x: 4, z: 4, r: 12 }], facilities: 1, developed: 1, servedFrac: 1 });
    overlay.updateRings(4, 4, 38, true);
    const ru = overlay.material.uniforms.uRings.value as THREE.Vector4[];
    expect(ru[0].x).toBe(4);
    expect(ru[0].z).toBe(12);
    expect(ru[0].w).toBeCloseTo(1, 5);
    ru[0].w = -99;
    overlay.updateRings(4, 4, 38); // same rounded key: untouched
    expect(ru[0].w).toBe(-99);
  });

  it("ports the Fable shader with tile-unit conversions", () => {
    const { overlay } = setup();
    const fs = overlay.material.fragmentShader;
    expect(fs).toContain("fract((vWorld.x + vWorld.z) * 0.44)"); // hatch: 0.055/m x 8
    expect(fs).toContain("fwidth(d) * 1.8 + 0.2"); // ring width: 1.6 m -> tiles
    expect(fs).toContain("exp(-d * 0.36)"); // glow: 0.045/m x 8
    expect(fs).toContain("#include <tonemapping_fragment>");
    expect(fs).toContain("#include <colorspace_fragment>");
  });
});
