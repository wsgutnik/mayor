import { describe, expect, it } from "vitest";
import { QUALITY_PIXEL_CAP, QUALITY_PROFILE, defaultPrefs, loadPrefs, qualityForPixelCap, savePrefs } from "./prefs";
import { generateWorld } from "./sim/world";

describe("quality tiers", () => {
  it("maps pixel caps back to tiers", () => {
    expect(qualityForPixelCap(1)).toBe("low");
    expect(qualityForPixelCap(1.5)).toBe("medium");
    expect(qualityForPixelCap(2)).toBe("high");
  });

  it("keeps the profile pixel caps in sync with QUALITY_PIXEL_CAP", () => {
    for (const q of ["low", "medium", "high"] as const) {
      expect(QUALITY_PROFILE[q].pixelCap).toBe(QUALITY_PIXEL_CAP[q]);
    }
  });

  it("climbs in cost from low to high", () => {
    const tiers = ["low", "medium", "high"] as const;
    const aniso = tiers.map((q) => QUALITY_PROFILE[q].aniso);
    const shadow = tiers.map((q) => QUALITY_PROFILE[q].shadow);
    const tex = tiers.map((q) => QUALITY_PROFILE[q].tex === "hd" ? 1 : 0);
    const veg = tiers.map((q) => QUALITY_PROFILE[q].veg);
    const lod = tiers.map((q) => QUALITY_PROFILE[q].lodDist);
    expect([...aniso].sort((a, b) => a - b)).toEqual(aniso);
    expect([...shadow].sort((a, b) => a - b)).toEqual(shadow);
    expect([...tex].sort((a, b) => a - b)).toEqual(tex);
    expect([...veg].sort((a, b) => a - b)).toEqual(veg);
    expect([...lod].sort((a, b) => a - b)).toEqual(lod);
    expect(QUALITY_PROFILE.low.padTex).toBe(false);
    expect(QUALITY_PROFILE.high.padTex).toBe(true);
    expect(QUALITY_PROFILE.low.splat).toBe("off");
    expect(QUALITY_PROFILE.high.splat).toBe("hd");
  });
});

describe("zoning preference", () => {
  it("defaults to the classic tile grid and round-trips the oriented mode", () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
    expect(defaultPrefs().zoning).toBe("tiles");
    expect(loadPrefs().zoning).toBe("tiles");
    savePrefs({ ...defaultPrefs(), zoning: "oriented" });
    expect(loadPrefs().zoning).toBe("oriented");
    store.set("mayor:prefs", JSON.stringify({ zoning: "diagonal" }));
    expect(loadPrefs().zoning).toBe("tiles");
  });

  it("new worlds start in the classic mode with empty oriented state", () => {
    const w = generateWorld(32, 3);
    expect(w.zoning).toBe("tiles");
    expect(w.nextOLotId).toBe(1);
    expect(w.obstacleRevision).toBe(1);
    expect(w.olots).toBeUndefined();
  });
});
