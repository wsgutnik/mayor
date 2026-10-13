import { Pt, RoadType, World, curvePoints, idx, isLand, tileHeight } from "./world";

/** Longest water/low span a bridge of each class may cross, in raster tiles. */
export const BRIDGE_SPAN_LIMIT: Record<RoadType, number> = { 1: 12, 2: 20, 3: 20, 4: 12, 5: 20 };
/** Cost multiplier per tile on the elevated middle piece. */
export const BRIDGE_COST_MULT = 3;
export const TUNNEL_COST_MULT = 4;
/** Tunnel spans shorter than this are levelled as ground road; longer ones are refused. */
export const TUNNEL_MIN_SPAN = 3;
export const TUNNEL_MAX_SPAN = 16;
/** Ground above the higher end by this much counts as hill (tunnel); below the lower end as valley (bridge). */
export const TUNNEL_RISE = 1.2;
export const VALLEY_DROP = 1.2;

export interface SpanSplit {
  kind: "bridge" | "tunnel";
  /** Curve parameters where the elevated middle starts and ends (at the shore / hill foot). */
  t0: number;
  t1: number;
  /** Distinct raster tiles between the boundaries. */
  spanTiles: number;
  before: Pt[];
  middle: Pt[];
  after: Pt[];
}

export type SpanFound =
  | { ok: true; span: SpanSplit | null }
  | { ok: false; reason: string };

/** Split a 2- or 3-point road at curve parameters t0 < t1 into three point lists. */
export function splitPtsAt(pts: Pt[], t0: number, t1: number): [Pt[], Pt[], Pt[]] {
  const a = Math.max(0, Math.min(1, t0)), b = Math.max(0, Math.min(1, t1));
  const cut = (p: Pt[], t: number): [Pt[], Pt[]] => {
    if (p.length === 3) {
      const [p0, c, p2] = p;
      const m0 = { x: p0.x + (c.x - p0.x) * t, z: p0.z + (c.z - p0.z) * t };
      const m1 = { x: c.x + (p2.x - c.x) * t, z: c.z + (p2.z - c.z) * t };
      const m = { x: m0.x + (m1.x - m0.x) * t, z: m0.z + (m1.z - m0.z) * t };
      return [[{ ...p0 }, m0, m], [m, m1, { ...p2 }]];
    }
    const m = { x: p[0].x + (p[1].x - p[0].x) * t, z: p[0].z + (p[1].z - p[0].z) * t };
    return [[{ ...p[0] }, m], [m, { ...p[1] }]];
  };
  const [before, rest] = cut(pts, a);
  const local = (b - a) / Math.max(1e-9, 1 - a);
  const [middle, after] = cut(rest, Math.max(0, Math.min(1, local)));
  return [before, middle, after];
}

/**
 * Find the elevated middle of a planned road: a water/valley run becomes a
 * bridge, a hill run a tunnel. The split lands on the last normal sample
 * outside the span, so the middle piece starts at the shore (deck ramps meet
 * dry ground) and ground approaches stay ground. Returns null for plain roads.
 *
 * Simplifications: one span per road (two ponds read as one span over both),
 * and a road that both dips and climbs only bridges the dip.
 */
export function detectSpan(w: World, type: RoadType, pts: Pt[]): SpanFound {
  const samples = curvePoints(pts, 0.5);
  const n = samples.length;
  if (n < 2) return { ok: true, span: null };
  const tileOf = (i: number): number => {
    const x = Math.floor(samples[i].x), y = Math.floor(samples[i].z);
    return idx(w, x, y);
  };
  const land: boolean[] = [];
  const h: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = Math.floor(samples[i].x), y = Math.floor(samples[i].z);
    land.push(isLand(w, x, y));
    h.push(tileHeight(w, x, y));
  }
  const h0 = h[0], h1 = h[n - 1];
  const isWaterLow = (i: number): boolean => !land[i] || (land[i] && h[i] < Math.min(h0, h1) - VALLEY_DROP);
  const isHill = (i: number): boolean => h[i] > Math.max(h0, h1) + TUNNEL_RISE;

  let wFirst = -1, wLast = -1;
  for (let i = 0; i < n; i++) {
    if (isWaterLow(i)) { if (wFirst < 0) wFirst = i; wLast = i; }
  }
  const distinctTiles = (a: number, b: number): number => {
    const seen = new Set<number>();
    for (let i = a; i <= b; i++) seen.add(tileOf(i));
    return seen.size;
  };
  const split = (kind: "bridge" | "tunnel", first: number, last: number, count: number): SpanSplit => {
    const t0 = Math.max(0, first - 1) / (n - 1);
    const t1 = Math.min(n - 1, last + 1) / (n - 1);
    const [before, middle, after] = splitPtsAt(pts, t0, t1);
    return { kind, t0, t1, spanTiles: count, before, middle, after };
  };

  if (wFirst >= 0) {
    if (!land[0] || !land[n - 1]) return { ok: false, reason: "Road would cross water" };
    const count = distinctTiles(wFirst, wLast);
    if (count > BRIDGE_SPAN_LIMIT[type]) return { ok: false, reason: "Bridge span too long" };
    return { ok: true, span: split("bridge", wFirst, wLast, count) };
  }
  let hFirst = -1, hLast = -1;
  for (let i = 0; i < n; i++) {
    if (isHill(i)) { if (hFirst < 0) hFirst = i; hLast = i; }
  }
  if (hFirst >= 0) {
    const count = distinctTiles(hFirst, hLast);
    if (count < TUNNEL_MIN_SPAN) return { ok: true, span: null };
    if (count > TUNNEL_MAX_SPAN) return { ok: false, reason: "Tunnel span too long" };
    return { ok: true, span: split("tunnel", hFirst, hLast, count) };
  }
  return { ok: true, span: null };
}
