import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPLAT, FLORA_LAYERS, GREY_LOOK, NO_ACCENT, SPLAT_SAMPLERS, SPLAT_SLOTS, accentBand, averageOfPixels,
  createTerrainSplatMaterial, floraFade, layerUrl, luma, slotColor, splatWeights, splatWeightsEx, terrainLayerSet,
} from "./terrain-splat";
import { BIOMES } from "../sim/world";

describe("splatWeights", () => {
  it("is grass on flat lowland", () => {
    const [g, s, r, d] = splatWeights(1, 0.02, 0.2);
    expect(g).toBeGreaterThan(0.9);
    expect(s + r + d).toBeLessThan(0.1);
  });

  it("is sand below the waterline margin", () => {
    const [g, s] = splatWeights(0.1, 0.01, 0.2);
    expect(s).toBeGreaterThan(0.9);
    expect(g).toBeLessThan(0.1);
  });

  it("is rock on steep slopes whatever the height", () => {
    const [, , r] = splatWeights(1, 0.6, 0.2);
    expect(r).toBeGreaterThan(0.9);
  });

  it("is rock high up even when flat", () => {
    const [, , r] = splatWeights(DEFAULT_SPLAT.rockAt + 2, 0.01, 0.2);
    expect(r).toBeGreaterThan(0.9);
  });

  it("grows dirt patches with the noise field on grass", () => {
    const plain = splatWeights(1, 0.02, 0.3);
    const patch = splatWeights(1, 0.02, 0.9);
    expect(patch[3]).toBeGreaterThan(plain[3]);
    expect(patch[3]).toBeGreaterThan(0.5);
    expect(plain[3]).toBeLessThan(0.1);
  });

  it("never grows dirt on sand or rock", () => {
    expect(splatWeights(0.0, 0.01, 1)[3]).toBeLessThan(0.05);
    expect(splatWeights(1, 0.7, 1)[3]).toBeLessThan(0.05);
  });

  it("sums to one across a sweep of heights and slopes", () => {
    for (let h = -2; h <= 8; h += 0.5) {
      for (const slope of [0, 0.2, 0.4, 0.7]) {
        const w = splatWeights(h, slope, 0.6);
        expect(w[0] + w[1] + w[2] + w[3]).toBeCloseTo(1, 6);
      }
    }
  });
});

describe("splatWeightsEx (accent slot)", () => {
  it("reduces exactly to splatWeights without an accent", () => {
    for (let h = -1; h <= 6; h += 0.25) {
      for (const slope of [0, 0.3, 0.6]) {
        for (const n of [0.1, 0.6, 0.95]) {
          const ex = splatWeightsEx(h, slope, n, 0.9, DEFAULT_SPLAT, NO_ACCENT);
          expect(ex.slice(0, 4)).toEqual(splatWeights(h, slope, n));
          expect(ex[4]).toBe(0);
        }
      }
    }
  });

  it("sums to one and only takes weight from the grass", () => {
    const acc = { mode: "patch" as const, amount: 0.8 };
    for (let h = -1; h <= 6; h += 0.25) {
      for (const slope of [0, 0.3, 0.6]) {
        for (const an of [0, 0.4, 0.6, 1]) {
          const base = splatWeights(h, slope, 0.6);
          const ex = splatWeightsEx(h, slope, 0.6, an, DEFAULT_SPLAT, acc);
          expect(ex.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
          expect(ex[1]).toBe(base[1]);
          expect(ex[2]).toBe(base[2]);
          expect(ex[3]).toBe(base[3]);
          expect(ex[0] + ex[4]).toBeCloseTo(base[0], 9);
          expect(ex[4]).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("grows patch accents with their own noise field, up to the amount", () => {
    const acc = { mode: "patch" as const, amount: 0.75 };
    expect(splatWeightsEx(1, 0.02, 0.2, 0.2, DEFAULT_SPLAT, acc)[4]).toBe(0);
    const full = splatWeightsEx(1, 0.02, 0.2, 0.95, DEFAULT_SPLAT, acc);
    expect(full[4]).toBeGreaterThan(0.7);
    expect(full[4]).toBeLessThanOrEqual(0.75 + 1e-9);
  });

  it("keeps shore accents on the band just above the sand", () => {
    const acc = { mode: "shore" as const, amount: 0.85 };
    expect(accentBand(DEFAULT_SPLAT.sandAt + 0.1, "shore")).toBe(1);
    expect(accentBand(DEFAULT_SPLAT.sandAt + 0.9, "shore")).toBe(0);
    expect(accentBand(5, "patch")).toBe(1);
    const nearShore = splatWeightsEx(0.6, 0.02, 0.2, 0.8, DEFAULT_SPLAT, acc);
    const inland = splatWeightsEx(2, 0.02, 0.2, 0.8, DEFAULT_SPLAT, acc);
    expect(nearShore[4]).toBeGreaterThan(0.2);
    expect(inland[4]).toBe(0);
  });
});

describe("floraFade", () => {
  it("removes the accent just under the rock line, where the vertex colours turn to rock", () => {
    const acc = { mode: "patch" as const, amount: 0.8 };
    expect(floraFade(DEFAULT_SPLAT.rockAt - 0.5)).toBe(1);
    expect(floraFade(DEFAULT_SPLAT.rockAt)).toBe(0);
    expect(splatWeightsEx(DEFAULT_SPLAT.rockAt - 0.01, 0.02, 0.2, 0.95, DEFAULT_SPLAT, acc)[4]).toBeLessThan(0.01);
    expect(splatWeightsEx(1, 0.02, 0.2, 0.95, DEFAULT_SPLAT, acc)[4]).toBeGreaterThan(0.7);
  });
});

describe("slotColor", () => {
  const base: [number, number, number] = [0.16, 0.33, 0.08];
  it("is the old grain (biome colour x texel / average) for the grey M20 layers", () => {
    const avg: [number, number, number] = [0.4, 0.5, 0.3];
    const t: [number, number, number] = [0.5, 0.45, 0.33];
    const c = slotColor(t, avg, GREY_LOOK, base);
    expect(c[0]).toBeCloseTo(base[0] * 0.5 / 0.4, 9);
    expect(c[1]).toBeCloseTo(base[1] * 0.45 / 0.5, 9);
    expect(c[2]).toBeCloseTo(base[2] * 0.33 / 0.3, 9);
  });

  it("keeps the biome luminance on average for any hue/contrast, so layer borders never step in brightness", () => {
    // A synthetic reddish photo: per-texel colours whose mean is `avg`.
    const texels: [number, number, number][] = [];
    for (let i = 0; i < 64; i++) texels.push([0.3 + 0.2 * Math.sin(i), 0.15 + 0.08 * Math.cos(i * 1.7), 0.08 + 0.05 * Math.sin(i * 2.3)]);
    const avg = [0, 1, 2].map((c) => texels.reduce((a, t) => a + t[c], 0) / texels.length) as [number, number, number];
    for (const look of [{ hue: 0, contrast: 1 }, { hue: 0.45, contrast: 0.6 }, { hue: 1, contrast: 0.3 }]) {
      const mean = [0, 1, 2].map((c) => texels.reduce((a, t) => a + slotColor(t, avg, look, base)[c], 0) / texels.length) as [number, number, number];
      expect(luma(mean), JSON.stringify(look)).toBeCloseTo(luma(base), 6);
    }
  });

  it("shows the texture's own hue at full hue keep", () => {
    const avg: [number, number, number] = [0.26, 0.12, 0.055];
    const c = slotColor(avg, avg, { hue: 1, contrast: 1 }, base);
    expect(c[0] / c[1]).toBeCloseTo(avg[0] / avg[1], 6);
  });

  it("softens contrast around the texture mean", () => {
    const avg: [number, number, number] = [0.3, 0.3, 0.3];
    const g: [number, number, number] = [0.3, 0.3, 0.3];
    const c = slotColor([0.6, 0.6, 0.6], avg, { hue: 0, contrast: 0.5 }, g);
    expect(c[0]).toBeCloseTo(0.45, 9);
  });
});

describe("terrain layer sets", () => {
  it("binds a fixed number of samplers whatever the biome (iPad texture-unit budget)", () => {
    expect(SPLAT_SAMPLERS).toBe(5);
    expect(SPLAT_SLOTS).toHaveLength(SPLAT_SAMPLERS);
    const m = createTerrainSplatMaterial();
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: "#include <common>\n#include <begin_vertex>",
      fragmentShader: "#include <common>\n#include <map_fragment>",
    };
    (m.material.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
    const samplers = /uniform sampler2D ([^;]+);/.exec(shader.fragmentShader)![1].split(",").map((x) => x.trim());
    expect(samplers).toEqual(["uGrass", "uSand", "uRock", "uDirt", "uAccent"]);
    // CPU/GPU parity: the shader uses the same thresholds as splatWeightsEx and accentBand.
    expect(shader.fragmentShader).toContain("smoothstep(0.5, 0.72, an)");
    expect(shader.fragmentShader).toContain("smoothstep(0.3, 0.6, an)");
    expect(shader.fragmentShader).toContain("smoothstep(uSandAt + 0.1, uSandAt + 0.8, vSplatPos.y)");
    expect(shader.fragmentShader).toContain("smoothstep(uRockAt - 0.35, uRockAt, vSplatPos.y)");
    expect(shader.fragmentShader).toContain("smoothstep(0.55, 0.8, m20noise(wuv * 3.0))");
  });

  it("fills all five slots for every biome with textures that ship in both tiers", () => {
    for (const biome of BIOMES) {
      for (const seed of [0, 1, 2, 3, 1337, 99991]) {
        const set = terrainLayerSet(biome, seed);
        for (const slot of SPLAT_SLOTS) {
          const def = set.slots[slot];
          expect(def, `${biome} ${slot}`).toBeDefined();
          for (const tier of ["md", "hd"] as const) {
            expect(existsSync(`public${layerUrl(def.file, tier)}`), `${biome} ${slot} ${tier}`).toBe(true);
          }
          expect(def.look.contrast).toBeGreaterThan(0);
          expect(def.look.contrast).toBeLessThanOrEqual(1);
          expect(def.look.hue).toBeGreaterThanOrEqual(0);
          expect(def.look.hue).toBeLessThanOrEqual(1);
        }
        expect(set.accent.amount).toBeGreaterThan(0);
        expect(set.accent.amount).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is deterministic per biome and seed, and the seed varies the accent field", () => {
    expect(terrainLayerSet("plains", 42)).toEqual(terrainLayerSet("plains", 42));
    const offsets = new Set([1, 2, 3, 4, 5, 6].map((s) => terrainLayerSet("plains", s).accentOffset.join(",")));
    expect(offsets.size).toBeGreaterThan(3);
    // Both plains variants are reachable from seeds.
    const ids = new Set(Array.from({ length: 16 }, (_, s) => terrainLayerSet("plains", s).id));
    expect(ids.size).toBe(2);
  });

  it("uses every new flora texture, each where the brief puts it", () => {
    const used = new Set<string>();
    for (const biome of BIOMES) for (let s = 0; s < 16; s++) for (const slot of SPLAT_SLOTS) used.add(terrainLayerSet(biome, s).slots[slot].file);
    for (const f of FLORA_LAYERS) expect(used.has(f), f).toBe(true);
    const plains = Array.from({ length: 16 }, (_, s) => terrainLayerSet("plains", s));
    expect(plains.every((p) => p.slots.dirt.file === "flora/soil_grey")).toBe(true);
    expect(plains.some((p) => p.slots.accent.file === "flora/grass_fur")).toBe(true);
    for (const b of ["river", "coast"] as const) {
      const set = terrainLayerSet(b, 7);
      expect(set.slots.accent.file).toBe("flora/limestone");
      expect(set.accent.mode).toBe("shore");
    }
    expect(terrainLayerSet("mountain", 3).slots.dirt.file).toBe("flora/earth_red");
    expect(terrainLayerSet("desert", 3).slots.dirt.file).toBe("flora/earth_red");
    expect(terrainLayerSet("desert", 3).slots.rock.file).toBe("flora/earth_red");
    expect(terrainLayerSet("forest", 3).slots.accent.file).toBe("flora/hedge");
    // The base grey layers are untouched: grass, sand and (outside the desert) rock keep the M20 look.
    for (const biome of BIOMES) {
      const set = terrainLayerSet(biome, 5);
      expect(set.slots.grass.file).toBe("grass");
      expect(set.slots.grass.look).toEqual(GREY_LOOK);
      expect(set.slots.sand.file).toBe("sand");
    }
  });
});

describe("averageOfPixels", () => {
  it("averages raw bytes to 0..1", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    expect(averageOfPixels(data)).toEqual([0.5, 0, 0.5]);
  });

  it("guards empty input", () => {
    expect(averageOfPixels(new Uint8ClampedArray(0))).toEqual([0, 0, 0]);
  });
});
