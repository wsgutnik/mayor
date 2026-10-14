// Portions adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10): zoning/GroundPlan.js#planLot,Bands.

/**
 * Per-lot ground plans (docs/process/09-fable-buildings-port.md §1.2, task V3).
 *
 * A verbatim port of fable's `GroundPlan.planLot` + `Bands`, rescaled from
 * metres to Mayor tiles (÷ 8). A lot becomes a set of disjoint rectangles in
 * the lot frame (u ∈ [0,w] along the road, v ∈ [0,d] away from it, v = 0 at
 * the kerb) that tile the lot exactly once, so built lots read as forecourt /
 * parking / yard instead of "buildings on a golf course".
 *
 * Pure and DOM-free: the renderer turns rects into pad instances via
 * `rectWorld` (position) and the surface tints in `plot-material.ts`.
 */
import { makeRng } from "./rng";

/** Material families — one instanced pad pool in the renderer. */
export const SURF = { PAVE: 0, ASPH: 1, CONC: 2, LAWN: 3, NONE: -1 } as const;
export type Surf = (typeof SURF)[keyof typeof SURF];

/** Procedural decal sets (drawn by a future ground shader; today only surf tints). */
export const KIND = {
  PLAIN: 0,
  BAYS: 1,
  YARD: 2,
  LAWN_MOWN: 3,
  DRIVE: 4,
  BED: 5,
  GRAVEL: 6,
  BACKLOT: 7,
  BACKYARD: 8,
  PLAZA: 9,
} as const;
export type GroundKind = (typeof KIND)[keyof typeof KIND];

export interface GroundRect {
  u0: number; v0: number; u1: number; v1: number;
  surf: Surf;
  kind: number;
}

export type FableLotType = "res-low" | "res-high" | "com-low" | "com-high" | "office" | "ind";

/** Minimum rect width/height in tiles (fable 0.35 m; the report pins 0.044). */
export const MIN_RECT_TILE = 0.044;
/** Lots below this size in tiles get no plan (fable: w,d > 2 m = 0.25 tile). */
export const MIN_LOT_TILE = 0.25;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/**
 * Band decomposition (fable `Bands`, metres ÷ 8). Bands run across the lot in
 * v; each band is split into columns given as absolute u stops
 * `[uEnd, surf, kind]` (the last stop always runs out to the lot edge).
 */
class Bands {
  v = 0;
  constructor(readonly w: number, readonly d: number, readonly out: GroundRect[]) {}
  band(dv: number, stops: [number, Surf, number][]): void {
    const v0 = this.v;
    const v1 = Math.min(this.d, v0 + dv);
    this.v = v1;
    if (v1 - v0 < MIN_RECT_TILE) return;
    let u = 0;
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      const u1 = i === stops.length - 1 ? this.w : clamp(s[0], u, this.w);
      if (u1 - u > MIN_RECT_TILE) this.out.push({ u0: u, v0, u1, v1, surf: s[1], kind: s[2] });
      u = u1;
      if (u >= this.w - 0.05 / 8) break;
    }
  }
  rest(...stops: [number, Surf, number][]): void {
    if (this.left > MIN_RECT_TILE) this.band(this.left, stops);
  }
  get left(): number {
    return this.d - this.v;
  }
}

/**
 * Disjoint ground rects for a w × d tile lot (fable `planLot`, every absolute
 * metre value ÷ 8, ratios unchanged). `rng` must return [0,1); exactly two
 * draws are consumed (layout jitter `r`, mirror `flip`).
 */
export function planLot(w: number, d: number, type: FableLotType, rng: () => number): GroundRect[] {
  const out: GroundRect[] = [];
  if (!(w > MIN_LOT_TILE) || !(d > MIN_LOT_TILE)) return out;
  const B = new Bands(w, d, out);
  const r = rng();
  const flip = rng() < 0.5;
  const L = SURF.LAWN, P = SURF.PAVE, A = SURF.ASPH, C = SURF.CONC;
  // Res-low keeps the terrain's own grass between the hard elements: laying
  // our own lawn quad over it would put a visible tone seam around every plot.
  const G = SURF.NONE;

  switch (type) {
    case "res-low": {
      const dw = clamp(w * 0.19, 2.8 / 8, 3.6 / 8);
      const margin = clamp(w * 0.12, 0.9 / 8, 2.6 / 8);
      const dx = flip ? margin : Math.max(margin, w - dw - margin);
      const vDrive = clamp(d * (0.4 + 0.12 * r), 5.0 / 8, Math.max(5.0 / 8, d - 3.2 / 8));
      const pw = 1.25 / 8;
      const px = flip ? dx + dw + 1.6 / 8 : Math.max(0.8 / 8, dx - 1.6 / 8 - pw);
      B.band(1.4 / 8, [[dx, P, KIND.PLAIN], [dx + dw, A, KIND.DRIVE], [w, P, KIND.PLAIN]]);
      const stops: [number, Surf, number][] = [];
      if (px + pw < dx - 0.3 / 8) stops.push([px, G, 0], [px + pw, P, KIND.PLAIN]);
      stops.push([dx, G, 0], [dx + dw, A, KIND.DRIVE]);
      if (px > dx + dw + 0.3 / 8 && px + pw < w - 0.3 / 8) stops.push([px, G, 0], [px + pw, P, KIND.PLAIN]);
      stops.push([w, G, 0]);
      B.band(vDrive - 1.4 / 8, stops);
      B.band(Math.max(0, d - vDrive - 2.1 / 8), [[w, G, 0]]);
      B.rest([w * 0.18, G, 0], [w * 0.82, L, KIND.BED], [w, G, 0]);
      break;
    }
    case "res-high": {
      const pw = clamp(w * 0.27, 5.0 / 8, 7.2 / 8);
      const lw = clamp(w * 0.2, 3.2 / 8, 6.0 / 8);
      const yd = clamp(d * 0.13, 2.4 / 8, 3.6 / 8);
      B.band(2.6 / 8, [[w, P, KIND.PLAZA]]);
      const body = Math.max(0.8 / 8, d - 2.6 / 8 - yd);
      if (flip) B.band(body, [[pw, A, KIND.BAYS], [w - lw, P, KIND.PLAIN], [w, L, KIND.LAWN_MOWN]]);
      else B.band(body, [[lw, L, KIND.LAWN_MOWN], [w - pw, P, KIND.PLAIN], [w, A, KIND.BAYS]]);
      B.rest([w, C, KIND.YARD]);
      break;
    }
    case "com-low": {
      const pd = clamp(d * 0.42, 6.0 / 8, 13.0 / 8);
      B.band(2.2 / 8, [[w, P, KIND.PLAZA]]);
      B.band(pd, [[w, A, KIND.BAYS]]);
      B.band(Math.max(0, d - 2.2 / 8 - pd - 2.6 / 8), [[w, P, KIND.PLAIN]]);
      B.rest([w, C, KIND.YARD]);
      break;
    }
    case "com-high": {
      const sl = clamp(w * 0.16, 3.2 / 8, 4.6 / 8);
      const yd = clamp(d * 0.2, 3.6 / 8, 6.0 / 8);
      B.band(3.4 / 8, [[w, P, KIND.PLAZA]]);
      const body = Math.max(0.8 / 8, d - 3.4 / 8 - yd);
      if (flip) B.band(body, [[sl, A, KIND.BACKLOT], [w, P, KIND.PLAIN]]);
      else B.band(body, [[w - sl, P, KIND.PLAIN], [w, A, KIND.BACKLOT]]);
      B.rest([w * 0.58, C, KIND.YARD], [w, A, KIND.BAYS]);
      break;
    }
    case "office": {
      const pd = clamp(d * 0.4, 6.5 / 8, 14.0 / 8);
      if (r < 0.55) B.band(1.7 / 8, [[w, L, KIND.LAWN_MOWN]]);
      B.band(3.4 / 8, [[w, P, KIND.PLAZA]]);
      B.band(Math.max(0, d - B.v - pd), [[w, P, KIND.PLAIN]]);
      B.rest([w, A, KIND.BAYS]);
      break;
    }
    case "ind":
    default: {
      const ad = clamp(d * 0.34, 6.0 / 8, 11.0 / 8);
      const gd = clamp(d * 0.2, 3.0 / 8, 6.5 / 8);
      B.band(1.6 / 8, [[w, P, KIND.PLAIN]]);
      B.band(ad, [[w, A, KIND.BAYS]]);
      B.band(Math.max(0, d - 1.6 / 8 - ad - gd), [[w, C, KIND.YARD]]);
      if (flip) B.rest([w * 0.62, C, KIND.YARD], [w, L, KIND.GRAVEL]);
      else B.rest([w * 0.38, L, KIND.GRAVEL], [w, C, KIND.YARD]);
      break;
    }
  }
  return out;
}

/** Mayor (zone, level, area) → fable ground type (§1.2 mapping). Zone ids are ZONE.* (1/2/3). */
export function mayorGroundType(zone: number, level: number, area: number): FableLotType {
  if (zone === 1) {
    if (level >= 3) return "res-high";
    if (level === 2) return area >= 4 ? "res-high" : "res-low";
    return "res-low";
  }
  if (zone === 2) {
    if (level >= 3) return area >= 9 ? "office" : "com-high";
    return "com-low";
  }
  return "ind";
}

/** Ground plan for a Mayor lot, seeded by lot id so repaints never reshape it. */
export function planMayorLot(w: number, d: number, zone: number, level: number, lotId: number): GroundRect[] {
  return planLot(w, d, mayorGroundType(zone, level, w * d), makeRng(lotId));
}

export interface LotPose {
  cx: number; cz: number; yaw: number; w: number; d: number;
}

export interface GroundInstance {
  x: number; z: number; sx: number; sz: number; yaw: number;
}

/**
 * Lot-local rect → world pad instance. The lot frame matches orientedlots:
 * +x runs along the road, +z points toward it, so u = 0 sits at −x and the
 * kerb band (v = 0) at +d/2. Rotation matches lots.ts `rotateCell`.
 */
export function rectWorld(rect: GroundRect, pose: LotPose): GroundInstance {
  const uc = (rect.u0 + rect.u1) / 2 - pose.w / 2;
  const vc = pose.d / 2 - (rect.v0 + rect.v1) / 2;
  const s = Math.sin(pose.yaw), c = Math.cos(pose.yaw);
  return {
    x: pose.cx + uc * c + vc * s,
    z: pose.cz - uc * s + vc * c,
    sx: rect.u1 - rect.u0,
    sz: rect.v1 - rect.v0,
    yaw: pose.yaw,
  };
}

/** Invariant checker for tests and the visual report: disjoint, inside, tiling. */
export function checkGroundPlan(w: number, d: number, rects: GroundRect[]): {
  inside: boolean; minSide: number; area: number; overlap: number;
} {
  let inside = true, minSide = Infinity, area = 0, overlap = 0;
  for (const r of rects) {
    if (r.u0 < -1e-9 || r.v0 < -1e-9 || r.u1 > w + 1e-9 || r.v1 > d + 1e-9) inside = false;
    minSide = Math.min(minSide, r.u1 - r.u0, r.v1 - r.v0);
    area += (r.u1 - r.u0) * (r.v1 - r.v0);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      overlap += Math.max(0, Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0)) *
        Math.max(0, Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0));
    }
  }
  return { inside, minSide: rects.length ? minSide : 0, area, overlap };
}
