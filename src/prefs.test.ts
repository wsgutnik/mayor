import { describe, expect, it } from "vitest";
import { QUALITY_PIXEL_CAP, QUALITY_PROFILE, applyUiPrefs, clampUiOpacity, clampUiScale, defaultPrefs, loadPrefs, qualityForPixelCap, savePrefs } from "./prefs";
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
  it("defaults to street-aligned lots, keeps an explicit choice and migrates old prefs", () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
    expect(defaultPrefs().zoning).toBe("oriented");
    expect(loadPrefs().zoning).toBe("oriented");
    // An explicit choice is kept across reloads.
    savePrefs({ ...defaultPrefs(), zoning: "tiles" });
    expect(loadPrefs().zoning).toBe("tiles");
    savePrefs({ ...defaultPrefs(), zoning: "oriented" });
    expect(loadPrefs().zoning).toBe("oriented");
    // Old prefs (no version) that only stored "tiles" because it used to be the default move to the new default.
    store.set("mayor:prefs", JSON.stringify({ zoning: "tiles" }));
    expect(loadPrefs().zoning).toBe("oriented");
    store.set("mayor:prefs", JSON.stringify({ zoning: "diagonal", zoningV: 2 }));
    expect(loadPrefs().zoning).toBe("oriented");
    // v3 return: prefs written under the previous cutover version that kept tile zoning go back once.
    store.set("mayor:prefs", JSON.stringify({ zoning: "tiles", zoningV: 2 }));
    expect(loadPrefs().zoning).toBe("oriented");
    // Under the current version a deliberate choice of tiles is respected.
    savePrefs({ ...defaultPrefs(), zoning: "tiles" });
    expect(loadPrefs().zoning).toBe("tiles");
  });

  it("a bare generated world is classic with empty oriented state (the game applies the preference)", () => {
    const w = generateWorld(32, 3);
    expect(w.zoning).toBe("tiles");
    expect(w.nextOLotId).toBe(1);
    expect(w.obstacleRevision).toBe(1);
    expect(w.olots).toBeUndefined();
  });
});

describe("interface scale and panel opacity", () => {
  const useStore = () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
    return store;
  };

  it("defaults to full scale and full opacity", () => {
    expect(defaultPrefs().uiScale).toBe(1);
    expect(defaultPrefs().uiOpacity).toBe(1);
  });

  it("gives old prefs without the fields the defaults", () => {
    const store = useStore();
    store.set("mayor:prefs", JSON.stringify({ lang: "en", quality: "low" }));
    const p = loadPrefs();
    expect(p.uiScale).toBe(1);
    expect(p.uiOpacity).toBe(1);
    expect(p.lang).toBe("en");
  });

  it("clamps out-of-range values and falls back for garbage", () => {
    expect(clampUiScale(2)).toBe(1.4);
    expect(clampUiScale(0.5)).toBe(0.8);
    expect(clampUiScale("big")).toBe(1);
    expect(clampUiScale(NaN)).toBe(1);
    expect(clampUiScale(undefined)).toBe(1);
    expect(clampUiOpacity(2)).toBe(1);
    expect(clampUiOpacity(0)).toBe(0.6);
    expect(clampUiOpacity("clear")).toBe(1);
    expect(clampUiOpacity(null)).toBe(1);
  });

  it("quantizes to the slider steps", () => {
    expect(clampUiScale(1.12)).toBe(1.1);
    expect(clampUiScale(1.18)).toBe(1.2);
    expect(clampUiOpacity(0.87)).toBe(0.85);
    expect(clampUiOpacity(0.93)).toBe(0.95);
  });

  it("round-trips through storage and clamps stored garbage", () => {
    const store = useStore();
    savePrefs({ ...defaultPrefs(), uiScale: 1.2, uiOpacity: 0.8 });
    expect(loadPrefs().uiScale).toBe(1.2);
    expect(loadPrefs().uiOpacity).toBe(0.8);
    store.set("mayor:prefs", JSON.stringify({ uiScale: 9, uiOpacity: -1 }));
    expect(loadPrefs().uiScale).toBe(1.4);
    expect(loadPrefs().uiOpacity).toBe(0.6);
  });

  it("publishes the values as CSS custom properties", () => {
    const seen = new Map<string, string>();
    const root = { style: { setProperty: (k: string, v: string) => { seen.set(k, v); } } };
    applyUiPrefs({ ...defaultPrefs(), uiScale: 1.2, uiOpacity: 0.8 }, root);
    expect(seen.get("--ui-scale")).toBe("1.2");
    expect(seen.get("--ui-panel-alpha")).toBe("0.8");
    applyUiPrefs({ ...defaultPrefs(), uiScale: 9, uiOpacity: "x" as unknown as number }, root);
    expect(seen.get("--ui-scale")).toBe("1.4");
    expect(seen.get("--ui-panel-alpha")).toBe("1");
  });
});
