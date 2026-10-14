/** Optional, non-destructive angle guides for road drafts (world X/Z plane). */
import type { Pt } from "../sim/world";

export interface RoadGuide { angle: number; source: "world" | "road"; }
export interface GuideOptions { fifteen?: boolean; }
export interface GuideHit { pt: Pt; guide: RoadGuide | null; angularError: number; }

export const GUIDE_TOLERANCE_DEG = 4;
const TAU = Math.PI * 2;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;
const delta = (a: number, b: number) => Math.abs(((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI);

/** World 45° rays plus a unique, road-relative 45° fan when a tangent is known. */
export function guideAngles(_anchor: Pt, roadTangentAtAnchor: number | null = null, opts: GuideOptions = {}): RoadGuide[] {
  const step = (opts.fifteen ? 15 : 45) * Math.PI / 180;
  const out: RoadGuide[] = [];
  for (const [base, source] of [[0, "world"], [roadTangentAtAnchor, "road"]] as const) {
    if (base === null) continue;
    for (let a = 0; a < TAU - 1e-9; a += step) {
      const angle = norm(base + a);
      if (!out.some((g) => delta(g.angle, angle) < 1e-7)) out.push({ angle, source });
    }
  }
  return out.sort((a, b) => a.angle - b.angle || a.source.localeCompare(b.source));
}

/**
 * Select a ray only inside its angular cone. `tolPx` widens the cone at short
 * distances, keeping a roughly 14–18px touch target without forcing odd angles.
 */
export function resolveGuide(anchor: Pt, cursor: Pt, guides: readonly RoadGuide[], tolPx = 0, tolDeg = GUIDE_TOLERANCE_DEG, previous: RoadGuide | null = null): GuideHit {
  const dx = cursor.x - anchor.x, dz = cursor.z - anchor.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-9) return { pt: cursor, guide: null, angularError: Infinity };
  const angle = Math.atan2(dz, dx);
  const tolerance = Math.max(tolDeg * Math.PI / 180, Math.atan2(tolPx, distance));
  const held = previous && guides.find((g) => delta(g.angle, previous.angle) < 1e-7);
  let best: RoadGuide | null = null, error = Infinity;
  for (const g of guides) {
    const e = delta(angle, g.angle);
    const limit = g === held ? tolerance * 1.35 : tolerance;
    if (e <= limit && (e < error - 1e-10 || (Math.abs(e - error) < 1e-10 && g.angle < (best?.angle ?? Infinity)))) { best = g; error = e; }
  }
  return best ? { pt: { x: anchor.x + Math.cos(best.angle) * distance, z: anchor.z + Math.sin(best.angle) * distance }, guide: best, angularError: error } : { pt: cursor, guide: null, angularError: Infinity };
}
