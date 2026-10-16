import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createRoadDetailMaterial } from "./road-material";

/**
 * Sampler budget for the road fragment shader.
 *
 * WebGL guarantees only 16 texture image units per shader stage
 * (MAX_TEXTURE_IMAGE_UNITS), and Three's MeshStandardMaterial adds its own
 * samplers on top of ours (`map`, plus one shadow-map sampler per shadow
 * light). The road shader must therefore stay well under 16 custom
 * sampler2D uniforms: 11 leaves room for `map` and up to 4 shadow maps.
 * Adding a 13th sampler (uTexRamp on top of 12) broke rendering in the
 * browser with "texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS".
 */
export function roadSamplerNames(fragmentShader: string): string[] {
  const names = new Set<string>();
  for (const m of fragmentShader.matchAll(/uniform\s+sampler2D\s+([^;]+);/g)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().replace(/\[.*\]$/, "");
      // Only the road-injected custom uniforms (u-prefixed camelCase);
      // Three's own chunks (`map`, shadow maps, ...) are the headroom below.
      if (/^u[A-Z]/.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

function patchedFragment(): string {
  const fallback = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  createRoadDetailMaterial(fallback).material.onBeforeCompile!(
    shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer,
  );
  return shader.fragmentShader;
}

describe("road shader sampler budget", () => {
  it("uses at most 11 custom sampler2D uniforms (16 units minus map + shadow maps)", () => {
    const names = roadSamplerNames(patchedFragment());
    expect(names).toContain("uTexMarkings");
    expect(names).not.toContain("uTexCrosswalk");
    expect(names).not.toContain("uTexStopBar");
    expect(names).not.toContain("uTexArrow");
    expect(names).toHaveLength(11);
  });
});
