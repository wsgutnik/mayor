import { idx, inBounds, type World, ZONE } from "./world";
import type { OrientedLot } from "./zonecells";

export type LandmarkId = "opera" | "cathedral" | "artdeco" | "hotel" | "conservatory" | "clocktower" | "observatory" | "palace";
export interface Landmark { id: LandmarkId; name: string; nameEn: string; footprint: 2 | 4; zones: readonly number[]; radius: number; landValue: number; happiness: number; jobs?: number }
export const LANDMARKS: readonly Landmark[] = [
  { id: "opera", name: "Grande Casa de Ópera", nameEn: "Grand Opera House", footprint: 4, zones: [ZONE.COM], radius: 10, landValue: 16, happiness: 7 },
  { id: "cathedral", name: "Catedral", nameEn: "Cathedral", footprint: 4, zones: [ZONE.RES, ZONE.COM], radius: 10, landValue: 12, happiness: 9 },
  { id: "artdeco", name: "Arranha-céu Art Déco", nameEn: "Art Deco Skyscraper", footprint: 4, zones: [ZONE.COM], radius: 8, landValue: 14, happiness: 2, jobs: 70 },
  { id: "hotel", name: "Grande Hotel", nameEn: "Grand Hotel", footprint: 4, zones: [ZONE.COM], radius: 8, landValue: 16, happiness: 3, jobs: 35 },
  { id: "conservatory", name: "Conservatório Botânico", nameEn: "Botanical Conservatory", footprint: 4, zones: [ZONE.RES, ZONE.COM], radius: 11, landValue: 8, happiness: 10 },
  { id: "clocktower", name: "Praça da Torre do Relógio", nameEn: "Clock Tower Plaza", footprint: 2, zones: [ZONE.COM, ZONE.RES], radius: 7, landValue: 14, happiness: 3 },
  { id: "observatory", name: "Observatório", nameEn: "Observatory", footprint: 2, zones: [ZONE.RES, ZONE.COM], radius: 8, landValue: 6, happiness: 6 },
  { id: "palace", name: "Palácio", nameEn: "Palace", footprint: 4, zones: [ZONE.RES], radius: 10, landValue: 18, happiness: 5 },
];
export const landmarkById = (id: unknown): Landmark | undefined => LANDMARKS.find((v) => v.id === id);
const mix = (v: number) => { v = Math.imul(v ^ (v >>> 16), 0x45d9f3b); v = Math.imul(v ^ (v >>> 16), 0x45d9f3b); return (v ^ (v >>> 16)) >>> 0; };
export const landmarkRoll = (seed: number, day: number, lot: OrientedLot) => mix(seed ^ Math.imul(day, 0x9e3779b1) ^ Math.imul(lot.id, 0x85ebca6b));
export const landmarkCap = (population: number) => Math.max(0, Math.floor(population / 750));
export const LANDMARK_COOLDOWN = 45;

/** Adds bounded radial desirability. Called after the normal field has been calculated. */
export function applyLandmarkLandValue(w: World, lots: readonly OrientedLot[]): boolean {
  let changed = false;
  for (const lot of lots) {
    const mark = landmarkById(lot.landmark); if (!mark) continue;
    for (let y = Math.floor(lot.cz - mark.radius); y <= Math.ceil(lot.cz + mark.radius); y++) for (let x = Math.floor(lot.cx - mark.radius); x <= Math.ceil(lot.cx + mark.radius); x++) {
      if (!inBounds(w, x, y)) continue;
      const d = Math.hypot(x + .5 - lot.cx, y + .5 - lot.cz); if (d > mark.radius) continue;
      const i = idx(w, x, y), v = Math.min(100, w.landValue[i] + Math.round(mark.landValue * (1 - d / mark.radius)));
      if (v !== w.landValue[i]) { w.landValue[i] = v; changed = true; }
    }
  }
  return changed;
}
export function landmarkHappiness(lots: readonly OrientedLot[]): number { return Math.min(20, lots.reduce((n, l) => n + (landmarkById(l.landmark)?.happiness ?? 0), 0)); }
export function landmarkJobs(lots: readonly OrientedLot[]): number { return lots.reduce((n, l) => n + (landmarkById(l.landmark)?.jobs ?? 0), 0); }
