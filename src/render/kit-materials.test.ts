import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { loadPatterns, textureName, upgradeMaterials } from "./kit-materials";

describe("kit material texture names", () => {
  it("selects HD names when present and falls back to SD when absent", () => {
    expect(textureName("brick", "hd", (name) => name === "brick_hd")).toBe("brick_hd");
    expect(textureName("brick", "hd", () => false)).toBe("brick");
    expect(textureName("brick", "sd", () => true)).toBe("brick");
  });
});

describe("kit glow materials (F3)", () => {
  it("keeps a non-black emissive on head / tail / sign lamps so the night pass lights them", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            glow_head: [null, null, "#fff1c0"],
            glow_tail: [null, null, "#a01818"],
            glow_sign: [null, null, "#f5c04a"],
          }),
      }),
    );
    await loadPatterns();
    vi.unstubAllGlobals();
    const mk = (name: string) => new THREE.MeshStandardMaterial({ name });
    const out = upgradeMaterials({
      geometry: new THREE.BufferGeometry(),
      materials: [mk("glow_head"), mk("glow_tail"), mk("glow_sign")],
      glow: [],
    });
    for (const m of out.materials) {
      const s = m as THREE.MeshStandardMaterial;
      expect(s.emissive.getHexString(), s.name).not.toBe("000000");
    }
    expect(out.glow.length).toBe(3);
  });
});

describe("kit glow collection (V1 window families)", () => {
  it("collects every glow_window* suffix into the night-driven set", () => {
    const std = (name: string) => new THREE.MeshStandardMaterial({ name });
    const model = upgradeMaterials({
      geometry: new THREE.BufferGeometry(),
      materials: [std("wall"), std("glow_window"), std("glow_window_office"), std("glow_sign")],
      glow: [],
    });
    expect(model.glow.map((g) => g.name).sort()).toEqual(["glow_sign", "glow_window", "glow_window_office"]);
  });
});
