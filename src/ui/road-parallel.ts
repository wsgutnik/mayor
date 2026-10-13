/** Parallel-road helper (UI-2): pure offset geometry and option plumbing (DOM-free, tested). */
import type { Pt } from "../sim/world";

/** Gap between the player's road and its parallel twin, in tiles. */
export type ParallelGap = 1 | 2 | 3;
/**
 * Which side of the player's path the twin runs on, facing the direction of
 * travel: left is +90° in atan2(z, x) angle space, i.e. the (-dz, dx) normal.
 */
export type ParallelSide = "left" | "right";

/** Parallel-road options for the road draft (Line/Curve). The simulation never sees these. */
export interface RoadParallelOptions {
  enabled: boolean;
  gap: ParallelGap;
  side: ParallelSide;
}

/** Out of the box the draft behaves as before: no second road. */
export const DEFAULT_ROAD_PARALLEL: RoadParallelOptions = { enabled: false, gap: 2, side: "left" };

const GAPS: readonly ParallelGap[] = [1, 2, 3];
const SIDES: readonly ParallelSide[] = ["left", "right"];

/** Validate stored options field by field; anything unknown falls back to the default. */
export function normalizeRoadParallel(v: unknown): RoadParallelOptions {
  const d = DEFAULT_ROAD_PARALLEL;
  if (typeof v !== "object" || v === null) return { ...d };
  const o = v as Partial<Record<keyof RoadParallelOptions, unknown>>;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : d.enabled,
    gap: GAPS.includes(o.gap as ParallelGap) ? (o.gap as ParallelGap) : d.gap,
    side: SIDES.includes(o.side as ParallelSide) ? (o.side as ParallelSide) : d.side,
  };
}

const KEY = "mayor:road-parallel";

/** Load the persisted parallel choice; storage may be missing or blocked. */
export function loadRoadParallel(): RoadParallelOptions {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_ROAD_PARALLEL };
    return normalizeRoadParallel(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_ROAD_PARALLEL };
  }
}

/** Persist the parallel choice; silently keeps it session-only when storage is blocked. */
export function saveRoadParallel(opts: RoadParallelOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(opts));
  } catch {
    /* storage blocked: the choice lasts for this session only */
  }
}

/**
 * Offset a road control polygon sideways by `gapTiles` tiles.
 *
 * Works on the 2-point Line draft or the 3-point Curve control polygon (and any
 * longer polyline): endpoints shift along their leg's normal, interior points
 * use a miter join clamped to twice the gap so sharp bends stay sane instead
 * of spiking. Hairpins (legs doubling back) and zero-length legs fall back to
 * the exit leg's normal. Returns fresh points; the input is never mutated.
 */
export function offsetPolyline(pts: Pt[], gapTiles: number, side: ParallelSide): Pt[] {
  const out = pts.map((p) => ({ x: p.x, z: p.z }));
  if (pts.length < 2 || !(gapTiles > 0)) return out;
  const s = side === "left" ? 1 : -1;
  // Per-leg sideways normals (zero for degenerate legs).
  const normals: Pt[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const dx = pts[i + 1].x - pts[i].x, dz = pts[i + 1].z - pts[i].z;
    const len = Math.hypot(dx, dz);
    normals.push(len < 1e-9 ? { x: 0, z: 0 } : { x: (-dz / len) * s, z: (dx / len) * s });
  }
  const isZero = (n: Pt): boolean => n.x === 0 && n.z === 0;
  const last = pts.length - 1;
  for (let i = 0; i <= last; i++) {
    const prev = normals[Math.max(0, i - 1)], next = normals[Math.min(normals.length - 1, i)];
    if (i === 0 || i === last || isZero(prev) || isZero(next)) {
      // Endpoint, or a degenerate neighbour: follow one leg's normal.
      const n = i === last ? next : prev;
      const pick = isZero(n) ? (i === last ? prev : next) : n;
      if (isZero(pick)) continue; // wholly degenerate: leave the point
      out[i] = { x: pts[i].x + pick.x * gapTiles, z: pts[i].z + pick.z * gapTiles };
      continue;
    }
    // Interior point: miter join with a limit of 2 (bevel past it).
    const mx = prev.x + next.x, mz = prev.z + next.z;
    const mlen = Math.hypot(mx, mz);
    if (mlen < 1e-9) {
      // Hairpin: the normals cancel out, so follow the exit leg.
      out[i] = { x: pts[i].x + next.x * gapTiles, z: pts[i].z + next.z * gapTiles };
      continue;
    }
    const ux = mx / mlen, uz = mz / mlen;
    const denom = ux * prev.x + uz * prev.z;
    if (Math.abs(denom) < 0.5) {
      // Past the miter limit: bevel (a plain gap step along the bisector).
      out[i] = { x: pts[i].x + ux * gapTiles, z: pts[i].z + uz * gapTiles };
      continue;
    }
    const scale = Math.max(-2 * gapTiles, Math.min(2 * gapTiles, gapTiles / denom));
    out[i] = { x: pts[i].x + ux * scale, z: pts[i].z + uz * scale };
  }
  return out;
}
