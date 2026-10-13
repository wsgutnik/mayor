import { Lang } from "../i18n";
import { MapListing } from "../sim/maps";

/** Sort order for map difficulty: beginner first, advanced last. */
const DIFFICULTY_RANK: Record<MapListing["difficulty"], number> = {
  beginner: 0,
  medium: 1,
  advanced: 2,
};

/** English key for the difficulty badge (translate with tr()). */
export function difficultyKey(d: MapListing["difficulty"]): string {
  return d === "beginner" ? "Beginner" : d === "medium" ? "Medium" : "Advanced";
}

/** New array sorted by difficulty (beginner first); unknown values sort last, stable. */
export function sortMapsByDifficulty(maps: MapListing[]): MapListing[] {
  return [...maps].sort((a, b) => (DIFFICULTY_RANK[a.difficulty] ?? 99) - (DIFFICULTY_RANK[b.difficulty] ?? 99));
}

/** Map name in the current language (English falls back to the pt-BR default). */
export function localizedName(m: MapListing, lang: Lang): string {
  return lang === "en" ? m.nameEn : m.name;
}

/** Map description in the current language. */
export function localizedDescription(m: MapListing, lang: Lang): string {
  return lang === "en" ? m.descriptionEn : m.description;
}
