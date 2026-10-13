import type { ZoningMode } from "./sim/zonecells";
import { Lang, detectLang } from "./i18n";

export type Quality = "low" | "medium" | "high";
export type TextureTier = "sd" | "hd";

export interface Prefs {
  lang: Lang;
  quality: Quality;
  tips: boolean;
  autosave: boolean;
  dayNight: boolean;
  /** Zoning model: the classic tile grid, or street-aligned lots (docs/process/05-oriented-lots.md). */
  zoning: ZoningMode;
}

const KEY = "mayor:prefs";

export const defaultPrefs = (): Prefs => ({
  lang: detectLang(), quality: "high", tips: true, autosave: true, dayNight: true, zoning: "tiles",
});

/** Highest device-pixel-ratio the renderer may use at each quality level. */
export const QUALITY_PIXEL_CAP: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };

/** What each quality tier buys: shadow map, terrain splat set, vegetation, LOD range. */
export interface QualityProfile {
  pixelCap: number;
  aniso: 2 | 4 | 8 | 16;
  tex: TextureTier;
  shadow: 0 | 1024 | 2048 | 4096;
  padTex: boolean;
  /** Terrain splat: flat vertex colours, 512 px layers, or full 1024 px layers. */
  splat: "off" | "md" | "hd";
  /** Tree/prop scatter multiplier. */
  veg: number;
  /** Full-detail radius in tiles around the camera target. */
  lodDist: number;
}

export const QUALITY_PROFILE: Record<Quality, QualityProfile> = {
  low: { pixelCap: 1, aniso: 2, tex: "sd", shadow: 0, padTex: false, splat: "off", veg: 0.45, lodDist: 30 },
  medium: { pixelCap: 1.5, aniso: 4, tex: "sd", shadow: 1024, padTex: true, splat: "md", veg: 0.75, lodDist: 45 },
  high: { pixelCap: 2, aniso: 8, tex: "hd", shadow: 2048, padTex: true, splat: "hd", veg: 1, lodDist: 70 },
};

/** Tier back from a pixel cap (mirrors QUALITY_PIXEL_CAP; the scene only gets the cap). */
export function qualityForPixelCap(cap: number): Quality {
  return cap <= 1 ? "low" : cap < 2 ? "medium" : "high";
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultPrefs();
    const p = JSON.parse(raw) as Partial<Prefs>;
    const d = defaultPrefs();
    return {
      lang: p.lang === "en" || p.lang === "pt" ? p.lang : d.lang,
      quality: p.quality === "low" || p.quality === "medium" || p.quality === "high" ? p.quality : d.quality,
      tips: typeof p.tips === "boolean" ? p.tips : d.tips,
      autosave: typeof p.autosave === "boolean" ? p.autosave : d.autosave,
      dayNight: typeof p.dayNight === "boolean" ? p.dayNight : d.dayNight,
      zoning: p.zoning === "oriented" || p.zoning === "tiles" ? p.zoning : d.zoning,
    };
  } catch {
    return defaultPrefs();
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked: preferences last for this session only */
  }
}
