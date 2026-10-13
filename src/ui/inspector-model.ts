import type { TileInfo } from "../sim/inspect";
import type { Lang } from "../i18n";

export type ServiceKey = keyof TileInfo["services"];

export interface ServiceChipDef {
  key: ServiceKey;
  /** i18n key for the label (all exist in src/i18n.ts). */
  labelKey: string;
  color: string;
}

export interface ServiceChip extends ServiceChipDef {
  present: boolean;
}

/** Chip order on the card: utilities first, then coverage. */
export const SERVICE_CHIP_DEFS: ServiceChipDef[] = [
  { key: "power", labelKey: "Power", color: "#f2c230" },
  { key: "water", labelKey: "Water", color: "#39b6e8" },
  { key: "sewage", labelKey: "Sewage", color: "#a07848" },
  { key: "garbage", labelKey: "Garbage", color: "#9aa3ad" },
  { key: "police", labelKey: "Police", color: "#3d6ee8" },
  { key: "fire", labelKey: "Fire", color: "#ee5a4c" },
  { key: "health", labelKey: "Health", color: "#e8eef5" },
  { key: "education", labelKey: "Education", color: "#f59a4a" },
  { key: "culture", labelKey: "Culture", color: "#e8b35a" },
  { key: "transit", labelKey: "Transit", color: "#9b7bff" },
];

/** One chip per service, in card order, flagged present/missing. */
export function serviceChips(services: TileInfo["services"]): ServiceChip[] {
  return SERVICE_CHIP_DEFS.map((d) => ({ ...d, present: !!services[d.key] }));
}

/** Three dots, filled up to `level` (clamped to 0..3). */
export function levelDots(level: number): boolean[] {
  const lvl = Math.max(0, Math.min(3, Math.floor(level)));
  return [1, 2, 3].map((i) => i <= lvl);
}

export function localizedName(info: Pick<TileInfo, "name" | "nameEn">, lang: Lang): string {
  return lang === "pt" ? info.name : info.nameEn;
}

export function localizedUse(info: Pick<TileInfo, "use" | "useEn">, lang: Lang): string {
  return lang === "pt" ? info.use : info.useEn;
}

/** i18n key for the people row, or null when the tile houses nobody. */
export function peopleLabelKey(info: Pick<TileInfo, "peopleKind">): "Residents" | "Jobs" | null {
  if (info.peopleKind === "residents") return "Residents";
  if (info.peopleKind === "jobs") return "Jobs";
  return null;
}

/** Roads and open ground render the compact card (name + land value + services). */
export function isCompact(info: Pick<TileInfo, "kind">): boolean {
  return info.kind === "road" || info.kind === "empty";
}

/** Land value as an integer on the 0..100 bar. */
export function clampLandValue(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}
