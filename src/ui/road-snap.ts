/** Road-draft snapping: pure geometry and option plumbing (DOM-free, tested). */
import type { Pt } from "../sim/world";

/** Angle snap step in degrees, measured from the reference direction; 0 disables. */
export type AngleSnap = 0 | 15 | 45;
/** Length snap step in tiles; 0 disables. */
export type LengthSnap = 0 | 1 | 2 | 4;

/** Snap options for the road draft (Line/Curve). The simulation never sees these. */
export interface RoadSnapOptions {
  angle: AngleSnap;
  length: LengthSnap;
  /** Snap onto the centre of an existing road tile so new roads connect cleanly. */
  roads: boolean;
}

/** Out of the box the draft behaves as before UI-2: only road snap is on. */
export const DEFAULT_ROAD_SNAP: RoadSnapOptions = { angle: 0, length: 0, roads: true };

const ANGLES: readonly AngleSnap[] = [0, 15, 45];
const LENGTHS: readonly LengthSnap[] = [0, 1, 2, 4];

/** Validate stored options field by field; anything unknown falls back to the default. */
export function normalizeRoadSnap(v: unknown): RoadSnapOptions {
  const d = DEFAULT_ROAD_SNAP;
  if (typeof v !== "object" || v === null) return { ...d };
  const o = v as Partial<Record<keyof RoadSnapOptions, unknown>>;
  return {
    angle: ANGLES.includes(o.angle as AngleSnap) ? (o.angle as AngleSnap) : d.angle,
    length: LENGTHS.includes(o.length as LengthSnap) ? (o.length as LengthSnap) : d.length,
    roads: typeof o.roads === "boolean" ? o.roads : d.roads,
  };
}

const KEY = "mayor:road-snap";

/** Load the persisted snap choice; storage may be missing or blocked. */
export function loadRoadSnap(): RoadSnapOptions {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_ROAD_SNAP };
    return normalizeRoadSnap(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_ROAD_SNAP };
  }
}

/** Persist the snap choice; silently keeps it session-only when storage is blocked. */
export function saveRoadSnap(opts: RoadSnapOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(opts));
  } catch {
    /* storage blocked: the choice lasts for this session only */
  }
}

/**
 * Snap a raw draft point around its anchor (the last placed draft point).
 * The angle snaps to multiples of `opts.angle` from `refAngle` — the previous
 * segment's direction when continuing a road, the map axes (`null`) otherwise —
 * and the length snaps to multiples of `opts.length` tiles. With no anchor
 * (the draft's first point) or with everything off, the raw point is returned.
 */
export function snapPoint(
  prev: Pt | null,
  raw: Pt,
  opts: RoadSnapOptions,
  refAngle: number | null = null,
): Pt {
  if (!prev) return raw;
  if (!opts.angle && !opts.length) return raw;
  const dx = raw.x - prev.x, dz = raw.z - prev.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-9) return { x: prev.x, z: prev.z };
  let ang = Math.atan2(dz, dx);
  let len = dist;
  if (opts.angle) {
    const step = (opts.angle * Math.PI) / 180;
    const ref = refAngle ?? 0;
    ang = ref + Math.round((ang - ref) / step) * step;
  }
  if (opts.length) len = Math.round(dist / opts.length) * opts.length;
  return { x: prev.x + Math.cos(ang) * len, z: prev.z + Math.sin(ang) * len };
}

/**
 * Exit direction of a committed road (its last leg), used as the angle-snapping
 * reference while the player keeps drawing from its end; null when degenerate.
 */
export function exitAngle(pts: Pt[]): number | null {
  if (pts.length < 2) return null;
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-9) return null;
  return Math.atan2(b.z - a.z, b.x - a.x);
}

/**
 * Snap onto the centre of an existing road tile (the pre-UI-2 behaviour).
 * The road lookup is injected so this stays pure; tile bounds are the caller's.
 */
export function snapToRoadTile(isRoad: (x: number, y: number) => boolean, p: Pt): Pt {
  const x = Math.floor(p.x), y = Math.floor(p.z);
  if (isRoad(x, y)) return { x: x + 0.5, z: y + 0.5 };
  return p;
}
