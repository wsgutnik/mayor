import { Lang, detectLang } from "./i18n";

export type Quality = "low" | "medium" | "high";

export interface Prefs {
  lang: Lang;
  quality: Quality;
  tips: boolean;
  autosave: boolean;
  dayNight: boolean;
}

const KEY = "mayor:prefs";

export const defaultPrefs = (): Prefs => ({
  lang: detectLang(), quality: "high", tips: true, autosave: true, dayNight: true,
});

/** Highest device-pixel-ratio the renderer may use at each quality level. */
export const QUALITY_PIXEL_CAP: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };

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
