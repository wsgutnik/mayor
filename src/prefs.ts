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
  /** HUD scale multiplier, 0.8–1.4 in steps of 0.1. The 3D canvas is never scaled. */
  uiScale: number;
  /** HUD panel background opacity, 0.6–1 in steps of 0.05. Text stays fully opaque. */
  uiOpacity: number;
}

const KEY = "mayor:prefs";
/** 2 = street-aligned lots became the default; an explicit choice saved at this version is kept. */
const ZONING_PREF_VERSION = 3; // 3: every player returns to the street-aligned model once (tile zoning ignores street angles)

/** Slider range for the interface-scale setting. */
export const UI_SCALE = { min: 0.8, max: 1.4, step: 0.1, def: 1 } as const;
/** Slider range for the panel-opacity setting. */
export const UI_OPACITY = { min: 0.6, max: 1, step: 0.05, def: 1 } as const;

export const defaultPrefs = (): Prefs => ({
  lang: detectLang(), quality: "high", tips: true, autosave: true, dayNight: true, zoning: "oriented",
  uiScale: UI_SCALE.def, uiOpacity: UI_OPACITY.def,
});

/** Clamp a stored value to the uiScale range and quantize it to the slider step. */
export function clampUiScale(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : UI_SCALE.def;
  return Math.round(Math.min(UI_SCALE.max, Math.max(UI_SCALE.min, n)) * 10) / 10;
}

/** Clamp a stored value to the uiOpacity range and quantize it to the slider step. */
export function clampUiOpacity(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : UI_OPACITY.def;
  return Math.round(Math.min(UI_OPACITY.max, Math.max(UI_OPACITY.min, n)) * 20) / 20;
}

/** Minimal style host so tests can pass a fake instead of the document. */
export interface UiPrefsRoot {
  style: { setProperty(key: string, value: string): void };
}

/** Publish the prefs as CSS custom properties consumed by src/ui/style.css and touch.css. */
export function applyUiPrefs(p: Prefs, root?: UiPrefsRoot | null): void {
  const el: UiPrefsRoot | undefined =
    root ?? (typeof document !== "undefined" ? document.documentElement : undefined);
  if (!el) return;
  el.style.setProperty("--ui-scale", String(clampUiScale(p.uiScale)));
  el.style.setProperty("--ui-panel-alpha", String(clampUiOpacity(p.uiOpacity)));
}

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
  /** Cinematic bloom post-processing (high tier only; costly on iPad GPUs). */
  bloom: boolean;
}

export const QUALITY_PROFILE: Record<Quality, QualityProfile> = {
  low: { pixelCap: 1, aniso: 2, tex: "sd", shadow: 0, padTex: false, splat: "off", veg: 0.45, lodDist: 30, bloom: false },
  medium: { pixelCap: 1.5, aniso: 4, tex: "sd", shadow: 1024, padTex: true, splat: "md", veg: 0.75, lodDist: 45, bloom: false },
  high: { pixelCap: 2, aniso: 8, tex: "hd", shadow: 2048, padTex: true, splat: "hd", veg: 1, lodDist: 70, bloom: true },
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
      // Street-aligned zoning is the only supported model: tile zoning ignores street angles, so a stored
      // "tiles" is never honoured (the owner's iPad kept it after the cutover).
      zoning: "oriented",
      uiScale: p.uiScale === undefined ? d.uiScale : clampUiScale(p.uiScale),
      uiOpacity: p.uiOpacity === undefined ? d.uiOpacity : clampUiOpacity(p.uiOpacity),
    };
  } catch {
    return defaultPrefs();
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...p, zoningV: ZONING_PREF_VERSION }));
  } catch {
    /* storage blocked: preferences last for this session only */
  }
}
