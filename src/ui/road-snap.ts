/** Road-draft snapping: pure geometry and option plumbing (DOM-free, tested). */
import { baseRoadType, curvePoints, segElevation, type Pt, type RoadSegment, type RoadType, type World } from "../sim/world";
import { nearestOnSegment, nodeArms, nodeById, segById, SNAP_RADIUS, type RoadNode } from "../sim/roads";
import { profileOf } from "../sim/corridor";
import { teeSpacing, TOO_CLOSE_TO_JUNCTION_REASON } from "../sim/sim";

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
  /** Faint 45° guide rays; unlike legacy angle snap these never force a stroke outside their cone. */
  guides: boolean;
  /** Lift a touch draft endpoint above the finger so it remains visible. */
  touchOffset: boolean;
}

/** Out of the box the draft behaves as before UI-2: only road snap is on. */
export const DEFAULT_ROAD_SNAP: RoadSnapOptions = { angle: 0, length: 0, roads: true, guides: true, touchOffset: true };

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
    // Old preferences had only `angle`; retain it and make the new optional guide visible by default.
    guides: typeof o.guides === "boolean" ? o.guides : d.guides,
    touchOffset: typeof o.touchOffset === "boolean" ? o.touchOffset : d.touchOffset,
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

// ------------------------------------------------------------ road snapping v2 (docs/process/17-road-snapping.md)

/** Snap acquire radius in CSS pixels: a finger needs more than a mouse pointer. */
export const SNAP_PX_TOUCH = 36;
export const SNAP_PX_MOUSE = 16;
/** World radius clamp (tiles): never below a quarter tile, never more than 6 tiles. */
export const SNAP_MIN_TILES = 0.25;
export const SNAP_MAX_TILES = 6;
/** A held target keeps winning until the pointer leaves this multiple of the radius. */
export const SNAP_HYSTERESIS = 1.35;
/** Node acquire radius cap (tiles), so a T stays reachable next to a junction at far zoom. */
export const NODE_SNAP_MAX = 1.5;

/** World units (tiles) per CSS pixel at distance `camToPoint` from a perspective camera. */
export function worldPerPixel(camToPoint: number, fovDeg: number, viewportH: number): number {
  return (2 * Math.tan((fovDeg * Math.PI) / 360) * camToPoint) / Math.max(1, viewportH);
}

/** Acquire radius in tiles for a pointer: a constant pixel radius, clamped. */
export function snapRadiusTiles(touch: boolean, tilesPerPx: number): number {
  const px = touch ? SNAP_PX_TOUCH : SNAP_PX_MOUSE;
  return Math.min(SNAP_MAX_TILES, Math.max(SNAP_MIN_TILES, px * tilesPerPx));
}

export type SnapKind = "node" | "segment" | "free";

/** What the draft point is attached to; also the hysteresis memory. */
export interface SnapTarget { kind: "node" | "segment"; id: number }

export interface SnapHit {
  kind: SnapKind;
  /** The resolved draft point (exact node position or exact centreline point when attached). */
  pt: Pt;
  target: SnapTarget | null;
  /** Direction (atan2) of the attached road at `pt`; the angle-guide reference. */
  tangent: number | null;
  /** Raw planRoad-style reason when this point cannot become a junction. */
  refused?: string;
}

export interface SnapQuery {
  roadType: RoadType;
  /** Acquire radius in tiles (snapRadiusTiles). */
  radius: number;
  opts: RoadSnapOptions;
  /** Last placed draft point, or null for the first point. */
  anchor: Pt | null;
  /** Angle-guide reference (previous leg or the start road's tangent); null = map axes. */
  refAngle: number | null;
  /** Target held on the previous pointer event (hysteresis). */
  prev?: SnapTarget | null;
}

/** Can a ground road of `type` end on `seg`? Highways only join highways; decks and tunnels never. */
function connectable(seg: RoadSegment, type: RoadType): boolean {
  if (segElevation(seg) !== "ground") return false;
  if (seg.pts.length < 2) return false;
  const hw = baseRoadType(seg.type) === 3;
  return !hw || baseRoadType(type) === 3;
}

function tangentAt(seg: RoadSegment, t: number): number {
  const s = curvePoints(seg.pts, 0.1);
  const i = Math.max(0, Math.min(s.length - 2, Math.floor(t * (s.length - 1))));
  return Math.atan2(s[i + 1].z - s[i].z, s[i + 1].x - s[i].x);
}

/** First crossing of the ray anchor→dir with a segment's centreline, as a distance along the ray. */
function rayHit(seg: RoadSegment, anchor: Pt, ang: number): Pt | null {
  const dx = Math.cos(ang), dz = Math.sin(ang);
  const s = curvePoints(seg.pts, 0.1);
  let best: Pt | null = null, bt = Infinity;
  for (let i = 0; i + 1 < s.length; i++) {
    const ex = s[i + 1].x - s[i].x, ez = s[i + 1].z - s[i].z;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const qx = s[i].x - anchor.x, qz = s[i].z - anchor.z;
    const t = (qx * ez - qz * ex) / den;
    const u = (qx * dz - qz * dx) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && t < bt) { bt = t; best = { x: anchor.x + dx * t, z: anchor.z + dz * t }; }
  }
  return best;
}

/**
 * Resolve a raw pointer position into a draft point (pure, deterministic).
 * Priority: an existing node within the radius, else the nearest centreline
 * whose kerb edge is within the radius (the end lands exactly on the
 * centreline, so the sim splits the road there), else the free point with the
 * optional angle/length guides. The angle of a free stroke is never changed
 * unless the player turned the angle guide on; with it on, an attached end
 * slides along the target road to where the guided ray meets it. A T that would
 * sit inside a neighbouring junction's keep-out is reported as refused rather
 * than moved; an end whose foot lies within the node merge radius joins that node.
 */
export function resolveRoadSnap(w: World, raw: Pt, q: SnapQuery): SnapHit {
  const free = (): SnapHit => ({ kind: "free", pt: snapPoint(q.anchor, raw, q.opts, q.refAngle), target: null, tangent: null });
  if (!q.opts.roads) return free();
  const hold = (k: SnapTarget["kind"], id: number) => (q.prev && q.prev.kind === k && q.prev.id === id ? SNAP_HYSTERESIS : 1);
  // 1. Nodes (junction centres, dead ends) first.
  // Tight node radius (so T-junctions stay reachable at far zoom); a wider one is used below near keep-outs.
  const nodeR = Math.min(NODE_SNAP_MAX, Math.max(q.radius, SNAP_RADIUS));
  let node: RoadNode | null = null, nd = Infinity;
  for (const n of w.nodes) {
    const d = Math.hypot(n.x - raw.x, n.z - raw.z);
    if (d > nodeR * hold("node", n.id) || d >= nd) continue;
    if (!n.segs.some((id) => { const s = segById(w, id); return !!s && connectable(s, q.roadType); })) continue;
    node = n; nd = d;
  }
  const atNode = (n: RoadNode): SnapHit => {
    const arm = nodeArms(w, n.id)[0];
    return { kind: "node", pt: { x: n.x, z: n.z }, target: { kind: "node", id: n.id }, tangent: arm ? arm.angle : null };
  };
  // Hysteresis: a held segment keeps winning over a not-held node until the pointer is within the merge radius.
  if (node && !(q.prev?.kind === "segment" && hold("node", node.id) === 1 && nd > SNAP_RADIUS)) return atNode(node);
  // 2. Centrelines: acquire when the pointer is within the radius of the kerb edge.
  let seg: RoadSegment | null = null, sp = { x: 0, z: 0, t: 0, d: Infinity }, se = Infinity;
  for (const s of w.segments) {
    if (!connectable(s, q.roadType)) continue;
    const pr = nearestOnSegment(s, raw);
    const edge = Math.max(0, pr.d - profileOf(s.type).drawHalf);
    if (edge > q.radius * hold("segment", s.id)) continue;
    if (edge < se - 1e-9 || (Math.abs(edge - se) <= 1e-9 && pr.d < sp.d)) { seg = s; sp = pr; se = edge; }
  }
  if (!seg) return node ? atNode(node) : free();
  let pt: Pt = { x: sp.x, z: sp.z };
  let t = sp.t;
  if (q.anchor && q.opts.angle) {
    // Optional guide: the guided ray from the anchor meets the road here.
    const guided = snapPoint(q.anchor, raw, { ...q.opts, length: 0 }, q.refAngle);
    const ang = Math.atan2(guided.z - q.anchor.z, guided.x - q.anchor.x);
    const hit = rayHit(seg, q.anchor, ang);
    if (hit && Math.hypot(hit.x - raw.x, hit.z - raw.z) <= q.radius + profileOf(seg.type).drawHalf) {
      const pr = nearestOnSegment(seg, hit);
      pt = { x: pr.x, z: pr.z };
      t = pr.t;
    }
  }
  const tangent = tangentAt(seg, t);
  for (const id of [seg.a, seg.b]) {
    const n = nodeById(w, id);
    if (!n) continue;
    const d = Math.hypot(n.x - pt.x, n.z - pt.z);
    if (d <= SNAP_RADIUS) return atNode(n);
    if (d < teeSpacing(w, id, seg.type, q.roadType)) {
      // Inside the junction keep-out: the junction itself when the pointer is within the radius of it, else refuse.
      if (Math.hypot(n.x - raw.x, n.z - raw.z) <= q.radius * hold("node", n.id)) return atNode(n);
      return { kind: "segment", pt, target: { kind: "segment", id: seg.id }, tangent, refused: TOO_CLOSE_TO_JUNCTION_REASON };
    }
  }
  return { kind: "segment", pt, target: { kind: "segment", id: seg.id }, tangent };
}
