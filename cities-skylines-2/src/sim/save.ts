import {
  CityState, newCity, refreshDerived,
} from "./sim";
import { BIOMES, Biome, generateWorld, RoadSegment, Stop, TransitLine } from "./world";

export const SAVE_VERSION = 1;

interface SaveFile {
  v: number;
  seed: number;
  /** Terrain preset; absent in older saves, which were all plains. */
  biome?: Biome;
  size: number;
  day: number;
  money: number;
  taxRate: number;
  population: number;
  happiness: number;
  fires: number;
  monthIncome: number;
  monthExpenses: number;
  lastMonth: { income: number; expenses: number };
  heights: string;
  zone: string;
  level: string;
  facility: string;
  segments: RoadSegment[];
  stops: Stop[];
  lines: TransitLine[];
  nextSegmentId: number;
  nextTransitId: number;
  /** dx/dy absent in older saves: the entry was always on the left edge. */
  entry: { x: number; y: number; dx?: number; dy?: number };
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Serialise only what the player created; everything else is derived on load. */
export function serialize(s: CityState): string {
  const w = s.world;
  const file: SaveFile = {
    v: SAVE_VERSION,
    seed: s.rngState,
    biome: w.biome,
    size: w.size,
    day: s.day,
    money: s.money,
    taxRate: s.taxRate,
    population: s.population,
    happiness: s.happiness,
    fires: s.fires,
    monthIncome: s.monthIncome,
    monthExpenses: s.monthExpenses,
    lastMonth: s.lastMonth,
    heights: toB64(new Uint8Array(w.heights.buffer, w.heights.byteOffset, w.heights.byteLength)),
    zone: toB64(w.zone),
    level: toB64(w.level),
    facility: toB64(w.facility),
    segments: w.segments,
    stops: w.stops,
    lines: w.lines,
    nextSegmentId: w.nextSegmentId,
    nextTransitId: w.nextTransitId,
    entry: w.entry,
  };
  return JSON.stringify(file);
}

export class SaveError extends Error {}

/** Everything a hand-edited or truncated save could break must fail here as a SaveError. */
function validateStructure(f: SaveFile, n: number): void {
  const bad = () => { throw new SaveError("The save file is damaged"); };
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const tile = (t: unknown) => Number.isInteger(t) && (t as number) >= 0 && (t as number) < n * n;
  for (const k of ["day", "money", "taxRate", "population", "happiness", "fires", "monthIncome", "monthExpenses", "nextSegmentId", "nextTransitId"] as const) {
    if (!finite(f[k])) bad();
  }
  if (!f.entry || !finite(f.entry.x) || !finite(f.entry.y)) bad();
  if (!f.lastMonth || !finite(f.lastMonth.income) || !finite(f.lastMonth.expenses)) bad();
  if (!Array.isArray(f.segments) || !Array.isArray(f.stops) || !Array.isArray(f.lines)) bad();
  for (const seg of f.segments) {
    if (!seg || ![1, 2, 3].includes(seg.type) || !Array.isArray(seg.tiles) || !Array.isArray(seg.pts)) bad();
    if (seg.pts.length < 2 || seg.pts.length > 3 || seg.tiles.length > n * n) bad();
    if (!seg.tiles.every(tile)) bad();
    if (!seg.pts.every((p) => p && finite(p.x) && finite(p.z))) bad();
  }
  const stopIds = new Set<number>();
  for (const st of f.stops) {
    if (!st || !tile(st.tile) || (st.kind !== "bus" && st.kind !== "metro") || !finite(st.id)) bad();
    stopIds.add(st.id);
  }
  for (const l of f.lines) {
    if (!l || !Array.isArray(l.stops) || !l.stops.every((id) => stopIds.has(id))) bad();
    if (!finite(l.vehicles) || l.vehicles < 0 || l.vehicles > 64) bad();
  }
}

export function deserialize(json: string): CityState {
  let f: SaveFile;
  try {
    f = JSON.parse(json) as SaveFile;
  } catch {
    throw new SaveError("The save file is damaged");
  }
  if (!f || typeof f !== "object" || f.v !== SAVE_VERSION) throw new SaveError("This save is from a different version");
  const n = f.size;
  if (!Number.isInteger(n) || n < 8 || n > 512) throw new SaveError("The save file is damaged");
  validateStructure(f, n);
  const biome: Biome = f.biome && BIOMES.includes(f.biome) ? f.biome : "plains";
  const s = newCity(f.seed, n, biome);
  const w = s.world;
  const heights = fromB64(f.heights);
  const bytes = (b64: string, len: number) => {
    const a = fromB64(b64);
    if (a.length !== len) throw new SaveError("The save file is damaged");
    return a;
  };
  if (heights.length !== (n + 1) * (n + 1) * 4) throw new SaveError("The save file is damaged");
  w.heights.set(new Float32Array(heights.buffer, heights.byteOffset, heights.byteLength / 4));
  w.zone.set(bytes(f.zone, n * n));
  w.level.set(bytes(f.level, n * n));
  w.facility.set(bytes(f.facility, n * n));
  if (w.zone.some((v) => v > 3) || w.level.some((v) => v > 3) || w.facility.some((v) => v > 10)) {
    throw new SaveError("The save file is damaged");
  }
  w.segments = f.segments;
  w.stops = f.stops;
  w.lines = f.lines;
  w.nextSegmentId = f.nextSegmentId;
  w.nextTransitId = f.nextTransitId;
  w.entry = { x: f.entry.x, y: f.entry.y, dx: f.entry.dx ?? 1, dy: f.entry.dy ?? 0 };
  s.day = f.day;
  s.money = f.money;
  s.taxRate = f.taxRate;
  s.population = f.population;
  s.happiness = f.happiness;
  s.fires = f.fires;
  s.monthIncome = f.monthIncome;
  s.monthExpenses = f.monthExpenses;
  s.lastMonth = f.lastMonth;
  refreshDerived(s);
  return s;
}

/** One-line description for a save slot list. */
export function describe(s: CityState): { pop: number; money: number; day: number } {
  return { pop: Math.round(s.population), money: Math.round(s.money), day: s.day };
}

export { generateWorld };
