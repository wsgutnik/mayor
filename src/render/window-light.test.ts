import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makeRng } from "../sim/rng";
import {
  BRIGHT_HI, BRIGHT_LO, COOL_HOME, COOL_OFFICE, EMISSIVE_GAIN, LIT_FRACTION,
  WINDOW_FAMILIES, WINDOW_LIGHT_FRAG, WINDOW_LIGHT_VERT, WARM_HI, WARM_LO,
  familyFor, patchWindowMaterial, setWindowNight, windowEmissive, windowLight,
} from "./window-light";

function hashes(seed: number, n: number): [number, number][] {
  const rng = makeRng(seed);
  return Array.from({ length: n }, () => [rng(), rng()] as [number, number]);
}

describe("windowLight CPU mirror (fable §3.2)", () => {
  it("lights 0 % of windows while night < 0.06", () => {
    for (const night of [0, 0.03, 0.059]) {
      for (const [h, h2] of hashes(7, 200)) {
        expect(windowLight(h, h2, night, 0.75).lit).toBe(0);
        expect(windowLight(h, h2, night, 0.75, true, 0.1).lit).toBe(0);
      }
    }
  });

  it("lights litBias·0.68 ± 0.02 at full night over 10 000 hashes", () => {
    for (const bias of [0.35, 0.6, 0.75]) {
      const pairs = hashes(1000 + Math.round(bias * 100), 10000);
      const lit = pairs.filter(([h, h2]) => windowLight(h, h2, 1, bias).lit > 0.5).length / pairs.length;
      expect(Math.abs(lit - bias * LIT_FRACTION)).toBeLessThan(0.02);
    }
  });

  it("is monotone in night for fixed windows", () => {
    const nights = Array.from({ length: 25 }, (_, i) => (i / 24) * 1.2);
    for (const [h, h2] of hashes(21, 60)) {
      let prev = -1;
      for (const night of nights) {
        const lit = windowLight(h, h2, night, 0.6).lit;
        expect(lit).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = lit;
      }
    }
  });

  it("shares ≥ 70 % of panes per office floor, unlike homes", () => {
    const coherence = (office: boolean) => {
      const rng = makeRng(office ? 5 : 6);
      let sum = 0;
      const floors = 300, panes = 12;
      for (let f = 0; f < floors; f++) {
        const floorLamp = rng();
        let lit = 0;
        for (let p = 0; p < panes; p++) {
          if (windowLight(rng(), rng(), 1, 0.55, office, floorLamp).lit > 0.5) lit++;
        }
        sum += Math.max(lit, panes - lit) / panes;
      }
      return sum / floors;
    };
    expect(coherence(true)).toBeGreaterThanOrEqual(0.75);
    expect(coherence(false)).toBeLessThan(0.7);
  });

  it("pins the colour table", () => {
    const at = (h2: number, office: boolean) => windowLight(0.1, h2, 1, 0.6, office).color;
    expect(at(0, false)).toEqual(WARM_LO);
    const mid = at(0.5, false);
    for (let i = 0; i < 3; i++) expect(mid[i]).toBeCloseTo((WARM_LO[i] + WARM_HI[i]) / 2, 12);
    expect(at(0.95, false)).toEqual(COOL_HOME);
    expect(at(0.5, true)).toEqual(COOL_OFFICE);
    expect(at(0.2, true)[0]).toBeCloseTo(WARM_LO[0] + (WARM_HI[0] - WARM_LO[0]) * 0.2);
  });

  it("keeps brightness in 0.22..0.85 and dims blinds to 42 %", () => {
    for (const [h, h2] of hashes(9, 200)) {
      const plain = windowLight(h, h2, 1, 0.6).bright;
      expect(plain).toBeGreaterThanOrEqual(BRIGHT_LO - 1e-12);
      expect(plain).toBeLessThanOrEqual(BRIGHT_HI + 1e-12);
      expect(windowLight(h, h2, 1, 0.6, false, h2, true).bright).toBeCloseTo(plain * 0.42, 12);
    }
  });

  it("scales emissive by colour·lit·bright·0.86", () => {
    const w = windowLight(0.3, 0.4, 1, 0.6);
    const e = windowEmissive(w);
    expect(e[0]).toBeCloseTo(w.color[0] * w.lit * w.bright * EMISSIVE_GAIN, 12);
    expect(windowEmissive(windowLight(0.3, 0.4, 0, 0.6))).toEqual([0, 0, 0]);
  });
});

describe("window-light families and GLSL", () => {
  it("maps material suffixes to litBias, defaulting bare glow_window to 0.6", () => {
    expect(familyFor("glow_window")).toEqual({ litBias: 0.6, office: false });
    expect(familyFor("glow_window_office")).toEqual({ litBias: 0.55, office: true });
    expect(familyFor("glow_window_shop")).toEqual(WINDOW_FAMILIES.glow_window_shop);
    expect(familyFor("glow_window_ind")).toEqual(WINDOW_FAMILIES.glow_window_ind);
    expect(familyFor("glow_window_future")).toEqual({ litBias: 0.6, office: false });
    expect(familyFor("glass_dark")).toBeNull();
    expect(familyFor("glow_sign")).toBeNull();
  });

  it("keeps the GLSL chunk on the same constants as the mirror", () => {
    expect(WINDOW_LIGHT_FRAG).toContain("smoothstep(0.06, 0.42, uNight)");
    expect(WINDOW_LIGHT_FRAG).toContain("uLitBias * 0.68 * nightOn");
    expect(WINDOW_LIGHT_FRAG).toContain("mix(hCell, floorLamp, 0.7)");
    expect(WINDOW_LIGHT_FRAG).toContain("step(0.92, hCell2)");
    expect(WINDOW_LIGHT_FRAG).toContain("uOffice * step(0.35, hCell2)");
    expect(WINDOW_LIGHT_FRAG).toContain("mix(0.22, 0.85, fract(hCell * 17.0))");
    expect(WINDOW_LIGHT_FRAG).toContain("totalEmissiveRadiance *= lc * lit * bright * 0.86;");
    expect(WINDOW_LIGHT_FRAG).toContain("vec3(1.0, 0.56, 0.24)");
    expect(WINDOW_LIGHT_VERT).toContain("floor(position / 0.02)");
    expect(WINDOW_LIGHT_VERT).toContain("instanceMatrix[3]");
  });

  it("patches a shared material and drives uNight per frame", () => {
    const mat = new THREE.MeshStandardMaterial({ name: "glow_window_office" });
    patchWindowMaterial(mat, { litBias: 0.55, office: true });
    expect(mat.emissive.getHexString()).toBe("ffffff");
    expect(mat.customProgramCacheKey()).toBe("window-light-v1:0.55:1");
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: "#include <common>\n#include <begin_vertex>",
      fragmentShader: "#include <common>\n#include <emissivemap_fragment>",
    };
    mat.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer,
    );
    expect(shader.vertexShader).toContain("vWinInstance");
    expect(shader.fragmentShader).toContain("uNight");
    expect(shader.uniforms.uLitBias.value).toBe(0.55);
    expect(shader.uniforms.uOffice.value).toBe(1);
    setWindowNight(mat, 0.5);
    expect(shader.uniforms.uNight.value).toBe(0.5);
    // unpatched materials are a no-op
    setWindowNight(new THREE.MeshStandardMaterial(), 0.5);
  });
});
