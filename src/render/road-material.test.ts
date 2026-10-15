import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createRoadDetailMaterial, roadLayerForColor } from "./road-material";

function patched() {
  const fallback = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  const detail = createRoadDetailMaterial(fallback);
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  detail.material.onBeforeCompile!(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return { detail, shader };
}

describe("traffic tint", () => {
  it("samples the load texture at world xz on carriageways", () => {
    const { shader } = patched();
    expect(shader.vertexShader).toContain("vWorldXz");
    expect(shader.fragmentShader).toContain("uTrafficTex");
    expect(shader.fragmentShader).toContain("vWorldXz / uMapSize");
    expect(shader.fragmentShader).toContain("uTrafficOn > 0.5 && vRoadClass > 0.5");
  });

  it("toggles and rebinds without recompiling", () => {
    const { detail, shader } = patched();
    const tex = new THREE.DataTexture(new Uint8Array(16), 4, 4, THREE.RedFormat);
    detail.setTrafficMap(tex, 64);
    detail.setTrafficOn(true);
    expect(shader.uniforms.uTrafficTex.value).toBe(tex);
    expect(shader.uniforms.uMapSize.value).toBe(64);
    expect(shader.uniforms.uTrafficOn.value).toBe(1);
    detail.setTrafficOn(false);
    expect(shader.uniforms.uTrafficOn.value).toBe(0);
  });

  it("carries its own program cache key so stock materials never reuse it", () => {
    const { detail } = patched();
    expect(detail.material.customProgramCacheKey!()).toBe("road-atlas-v2");
  });
});

describe("roadLayerForColor", () => {
  it("sends carriageways to the asphalt detail", () => {
    expect(roadLayerForColor("#3b3f46")).toBe("asphalt");
    expect(roadLayerForColor("#4a4f57")).toBe("asphalt");
  });

  it("sends the kerb band to the kerb/sidewalk mix", () => {
    expect(roadLayerForColor("#c4c7cc")).toBe("kerb");
  });

  it("keeps markings, median and edges flat", () => {
    for (const c of ["#d8d4b0", "#e8e4c8", "#5f8a4a", "#f1f1ea", "#b8bec6"]) {
      expect(roadLayerForColor(c)).toBe("flat");
    }
  });

  it("is case-insensitive", () => {
    expect(roadLayerForColor("#C4C7CC")).toBe("kerb");
  });
});

describe("plain structure class", () => {
  it("keeps bridge/portal concrete off the atlas, the detail maps and the traffic tint", () => {
    const { shader } = patched();
    const f = shader.fragmentShader;
    const plain = f.indexOf("if (vRoadClass > 9.5)");
    expect(plain).toBeGreaterThan(-1);
    // The plain branch comes first, so neither the atlas nor the detail branch runs for it.
    expect(plain).toBeLessThan(f.indexOf("uAtlasOn > 0.5 && vRoadClass > 0.5"));
    expect(f).toContain("uTrafficOn > 0.5 && vRoadClass > 0.5 && vRoadClass < 9.5");
    // Rain darkens plain pad bands and noses like the ribbon bands (final review).
    const plainBranch = f.slice(plain, f.indexOf("uAtlasOn > 0.5 && vRoadClass > 0.5"));
    expect(plainBranch).toContain("1.0 - 0.18 * uWet");
    expect(f.slice(f.indexOf("uAtlasOn > 0.5 && vRoadClass > 0.5"))).toContain("1.0 - 0.18 * uWet");
  });
});
