// Adapted from fable-cities (MIT, (c) 2026 raw): simulation/infoview.js `_bake`
// (coverage R / boundary-distance G / developed-mask B) and `mark` (developed mask).
// Units: Fable metres ÷ 8 = Mayor tiles; SD_RANGE 240 m → 30 tiles.

import {
  BUS_STOP_RADIUS, COVER, FACILITY_INFO, FacilityKind, World, facilityAnchorAt, idx, inBounds, isLand,
} from "./world";

/** One crisp radius ring per facility of the selected service (like Fable's MAX_RINGS). */
export const MAX_RINGS = 48;
/** Metres-of-distance-ramp equivalent: Fable SD_RANGE 240 m ÷ 8 m/tile. */
export const SD_RANGE_TILES = 30;
/** Tiles from the coverage edge at which served land reads fully served. */
export const STRENGTH_RAMP_TILES = 3;

export interface CoverageRing { x: number; z: number; r: number }

export interface CoverageField {
  size: number;
  /** RGBA size×size: R served strength, G boundary distance (0.5 at the edge), B developed mask. */
  data: Uint8Array;
  /** Facility rings, capped at MAX_RINGS in tile-scan order. */
  rings: CoverageRing[];
  /** Facilities of this service before the cap (legend count). */
  facilities: number;
  /** Developed tiles (zoned, built, facility or road, on land). */
  developed: number;
  /** Share of developed tiles the service reaches (legend average marker). */
  servedFrac: number;
}

const COVER_BITS = new Set<number>(Object.values(COVER));

/** True for the single-bit service layers the coverage plane handles (not land value / traffic / soil). */
export function isCoverageLayer(layer: number): boolean {
  return COVER_BITS.has(layer);
}

/** Two-pass 3-4 chamfer distance to the source set, in thirds of a tile. */
function chamfer(size: number, isSource: (i: number) => boolean, dist: Float32Array): void {
  const INF = 1e6;
  for (let i = 0; i < dist.length; i++) dist[i] = isSource(i) ? 0 : INF;
  const W = size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * W + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 3);
      if (y > 0) {
        d = Math.min(d, dist[i - W] + 3);
        if (x > 0) d = Math.min(d, dist[i - W - 1] + 4);
        if (x < W - 1) d = Math.min(d, dist[i - W + 1] + 4);
      }
      dist[i] = d;
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * W + x;
      let d = dist[i];
      if (x < W - 1) d = Math.min(d, dist[i + 1] + 3);
      if (y < size - 1) {
        d = Math.min(d, dist[i + W] + 3);
        if (x < W - 1) d = Math.min(d, dist[i + W + 1] + 4);
        if (x > 0) d = Math.min(d, dist[i + W - 1] + 4);
      }
      dist[i] = d;
    }
  }
}

/**
 * Bake the coverage field for one service bit. Coverage is Mayor's binary
 * `w.cover` bit; strength ramps with the chamfer distance to the nearest
 * uncovered tile so the shader can grade edge → interior. Gaps (developed
 * but uncovered) and undeveloped land fall out of R/B, not out of extra code.
 * `out` reuses a caller buffer (render texture backing) when it fits.
 */
export function buildCoverageField(w: World, bit: number, out?: Uint8Array): CoverageField {
  const size = w.size, n = size * size;
  const data = out && out.length === n * 4 ? out : new Uint8Array(n * 4);
  const covered = (i: number): boolean => (w.cover[i] & bit) !== 0;
  const dUnc = new Float32Array(n);
  const dCov = new Float32Array(n);
  chamfer(size, (i) => !covered(i), dUnc);
  chamfer(size, covered, dCov);
  let developed = 0, served = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = idx(w, x, y);
      const cov = covered(i);
      const strength = cov ? Math.min(1, dUnc[i] / 3 / STRENGTH_RAMP_TILES) : 0;
      const signedTiles = cov ? dUnc[i] / 3 : -dCov[i] / 3;
      const g = Math.max(0, Math.min(1, 0.5 + signedTiles / (2 * SD_RANGE_TILES)));
      const dev = isLand(w, x, y) && (w.zone[i] !== 0 || w.level[i] > 0 || w.facility[i] !== 0 || w.road[i] !== 0);
      if (dev) {
        developed++;
        if (cov) served++;
      }
      const k = i * 4;
      data[k] = Math.round(Math.min(1, strength) * 255);
      data[k + 1] = Math.round(g * 255);
      data[k + 2] = dev ? 255 : 0;
      data[k + 3] = 255;
    }
  }
  const rings: CoverageRing[] = [];
  let facilities = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = idx(w, x, y);
      const f = w.facility[i] as FacilityKind;
      if (!f) continue;
      const info = FACILITY_INFO[f];
      if (!info || info.bit !== bit) continue;
      const anchor = facilityAnchorAt(w, i);
      if (anchor && (anchor.x !== x || anchor.y !== y)) continue;
      facilities++;
      if (rings.length < MAX_RINGS) {
        rings.push({
          x: anchor ? anchor.x + anchor.w / 2 : x + 0.5,
          z: anchor ? anchor.y + anchor.h / 2 : y + 0.5,
          r: info.radius,
        });
      }
    }
  }
  if (bit === COVER.TRANSIT) {
    for (const stop of w.stops) {
      if (stop.kind !== "bus" || !inBounds(w, stop.tile % size, (stop.tile / size) | 0)) continue;
      facilities++;
      if (rings.length < MAX_RINGS) {
        rings.push({ x: (stop.tile % size) + 0.5, z: ((stop.tile / size) | 0) + 0.5, r: BUS_STOP_RADIUS });
      }
    }
  }
  return { size, data, rings, facilities, developed, servedFrac: developed ? served / developed : 0 };
}

/** Service colour per coverage bit (mirrors OVERLAY_COLOR in render/scene.ts). */
export const COVERAGE_HEX: Record<number, string> = {
  [COVER.POWER]: "#f2c230",
  [COVER.WATER]: "#2ea8e8",
  [COVER.SEWAGE]: "#a07848",
  [COVER.GARBAGE]: "#9aa3ad",
  [COVER.POLICE]: "#3d6ee8",
  [COVER.FIRE]: "#ee5a4c",
  [COVER.HEALTH]: "#f2f6fb",
  [COVER.EDU]: "#f59a4a",
  [COVER.PARK]: "#48b85a",
  [COVER.TRANSIT]: "#9b7bff",
  [COVER.CULTURE]: "#e8b35a",
};

/** The three-stop ramp for one layer: crimson gap → amber edge → service whisper. */
export interface CoverageRamp { covered: string; warn: string; bad: string; ring: string }

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Ramp colours for a layer. Near-white services (health) would wash out, so
 * they fall back to green — Fable's `cov.r + cov.g + cov.b > 2.6` rule; the
 * ring is the service colour lerped 42 % toward white, like Fable.
 */
export function coverageRamp(layer: number): CoverageRamp {
  let covered = COVERAGE_HEX[layer] ?? "#35d38a";
  const [r, g, b] = hexToRgb(covered);
  if (r + g + b > 2.6) covered = "#35d38a";
  const [cr, cg, cb] = hexToRgb(covered);
  const t = 0.42;
  return { covered, warn: "#e8a33d", bad: "#d6392c", ring: rgbToHex(cr + (1 - cr) * t, cg + (1 - cg) * t, cb + (1 - cb) * t) };
}

/**
 * Facilities of one service layer, uncapped (legend stats). Mirrors the
 * ring scan in buildCoverageField: anchor tiles count once, bus stops
 * count for transit.
 */
export function countLayerFacilities(w: World, bit: number): number {
  let n = 0;
  for (let y = 0; y < w.size; y++) {
    for (let x = 0; x < w.size; x++) {
      const i = idx(w, x, y);
      const f = w.facility[i] as FacilityKind;
      if (!f) continue;
      const info = FACILITY_INFO[f];
      if (!info || info.bit !== bit) continue;
      const anchor = facilityAnchorAt(w, i);
      if (anchor && (anchor.x !== x || anchor.y !== y)) continue;
      n++;
    }
  }
  if (bit === COVER.TRANSIT) {
    for (const stop of w.stops) {
      if (stop.kind !== "bus" || !inBounds(w, stop.tile % w.size, (stop.tile / w.size) | 0)) continue;
      n++;
    }
  }
  return n;
}

/**
 * Traffic load ratio for one road tile, encoded as an R8 texel: green (free)
 * to red (jammed). Guards zero capacity (old saves) as free flow.
 */
export function trafficByte(load: number, capacity: number): number {
  if (!(capacity > 0)) return 0;
  return Math.round(Math.max(0, Math.min(1, load / capacity)) * 255);
}
