import {
  Pt, ROAD, RoadType, World, baseRoadType, curvePoints, heightAt, idx, inBounds, segElevation, segmentLength,
} from "./world";
import { TUNNEL_RISE, detectSpan } from "./elevation";
import { profileOf } from "./corridor";
import { junctionsOf } from "./junction";

/** How a planned road meets an existing road at one point. */
export type CrossingKind = "junction" | "overpass" | "underpass" | "blocked";

export interface Crossing {
  kind: CrossingKind;
  /** World position of the meeting point. */
  x: number;
  z: number;
  /** Tile containing the meeting point. */
  tile: number;
  /** Existing segment met here (first of any sharing the point). */
  segId?: number;
  existingType?: RoadType;
  existingElevation?: "ground" | "bridge" | "tunnel";
  /** Arc length from the drawn road's start / to its end, in tiles. */
  distFromStart: number;
  distFromEnd: number;
  /** True when the meeting is at a drawn end (T-junction / join), not a crossing. */
  atEnd?: boolean;
  /** True when a ground plan must be elevated to achieve this crossing. */
  autoElevate?: boolean;
  /** Machine reason for blocked crossings. */
  blockedReason?: "interchange" | "elevated-join" | "ramp-angle" | "ramp-direction" | "ramp-curvature" | "gore-proximity";
}

/** A highway crossing needs this much clear road at both ends for ramps. */
export const HIGHWAY_END_CLEARANCE = 4;
/** Crossings closer than this to an elevated road's end fall back to grade. */
export const RAMP_FALLBACK_TILES = 3;
export const INTERCHANGE_REASON = "Highways need an interchange";
export const ELEVATED_JOIN_REASON = "Cannot connect to a bridge or tunnel";
/** Ramps join a highway only at a shallow merge/diverge angle, in its direction. */
export const RAMP_MIN_ANGLE_DEG = 10;
export const RAMP_MAX_ANGLE_DEG = 30;
export const RAMP_ANGLE_REASON = "Ramps join a highway at 10 to 30 degrees";
export const RAMP_DIRECTION_REASON = "Ramp joins the highway against its direction";
export const RAMP_CURVATURE_REASON = "Ramps need a straight stretch of highway";
export const GORE_PROXIMITY_REASON = "Too close to another ramp";

const SNAP = 0.6;
const GORE_TAIL_FRACTION = 0.17;
const SAME_DIRECTION_MARGIN = 0.25;
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const rank = (e: "ground" | "bridge" | "tunnel") => (e === "bridge" ? 2 : e === "ground" ? 1 : 0);

/** Arc lengths along a sampled polyline. */
function cumLengths(poly: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + dist(poly[i].x, poly[i].z, poly[i - 1].x, poly[i - 1].z));
  return cum;
}

/** Closest point on a polyline: arc length from its start and distance to it. */
function nearestOnPoly(poly: Pt[], cum: number[], p: Pt): { along: number; d: number } {
  let best = 0, bd = Infinity;
  for (let i = 0; i + 1 < poly.length; i++) {
    const ax = poly[i].x, az = poly[i].z, vx = poly[i + 1].x - ax, vz = poly[i + 1].z - az;
    const l2 = vx * vx + vz * vz;
    const u = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.z - az) * vz) / l2));
    const d = dist(p.x, p.z, ax + vx * u, az + vz * u);
    if (d < bd) { bd = d; best = cum[i] + Math.sqrt(l2) * u; }
  }
  return { along: best, d: bd };
}

interface RawHit { x: number; z: number; segIds: number[] }

/** Geometric meeting points between the drawn polyline and existing segments (pure). */
function rawHits(w: World, poly: Pt[]): RawHit[] {
  const hits: RawHit[] = [];
  for (const seg of w.segments) {
    const q = curvePoints(seg.pts, 0.25);
    for (let i = 0; i + 1 < poly.length; i++) {
      const ax = poly[i].x, az = poly[i].z, vx = poly[i + 1].x - ax, vz = poly[i + 1].z - az;
      if (vx * vx + vz * vz < 1e-12) continue;
      for (let j = 0; j + 1 < q.length; j++) {
        const cx = q[j].x, cz = q[j].z, dx = q[j + 1].x - cx, dz = q[j + 1].z - cz;
        const denom = vx * dz - vz * dx;
        if (Math.abs(denom) < 1e-9) continue;
        const t = ((cx - ax) * dz - (cz - az) * dx) / denom;
        const u = ((cx - ax) * vz - (cz - az) * vx) / denom;
        if (t < -1e-3 || t > 1 + 1e-3 || u < -1e-3 || u > 1 + 1e-3) continue;
        const x = ax + vx * t, z = az + vz * t;
        const near = hits.find((h) => dist(h.x, h.z, x, z) < SNAP);
        if (near) { if (!near.segIds.includes(seg.id)) near.segIds.push(seg.id); }
        else hits.push({ x, z, segIds: [seg.id] });
      }
    }
  }
  return hits;
}

/** Unit tangent of a segment's centreline at the point nearest `p`, oriented a→b. */
function tangentAtNearest(seg: { pts: Pt[] }, p: Pt): { dx: number; dz: number } {
  const q = curvePoints(seg.pts, 0.1);
  let bi = 0, bd = Infinity;
  q.forEach((s, i) => { const d = dist(p.x, p.z, s.x, s.z); if (d < bd) { bd = d; bi = i; } });
  const a = q[Math.max(0, bi - 1)], b = q[Math.min(q.length - 1, bi + 1)];
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  return l < 1e-9 ? { dx: 1, dz: 0 } : { dx: (b.x - a.x) / l, dz: (b.z - a.z) / l };
}

/**
 * Ramps join only straight highway: the segment must be a 2-point line and,
 * where the contact is a node shared with other highway segments, those must
 * be straight too and continue the line within 2 degrees.
 */
export function rampHighwayCurvatureOk(w: World, hwSegId: number, contact: Pt): boolean {
  const seg = w.segments.find((s) => s.id === hwSegId);
  if (!seg) return true;
  if (seg.pts.length !== 2) return false;
  for (const end of [seg.pts[0], seg.pts[1]]) {
    if (dist(end.x, end.z, contact.x, contact.z) > SNAP) continue;
    const away = (sg: { pts: Pt[] }): { dx: number; dz: number } => {
      const q = sg.pts, atA = dist(q[0].x, q[0].z, end.x, end.z) <= SNAP;
      const from = atA ? q[0] : q[q.length - 1], to = atA ? q[1] : q[q.length - 2];
      const l = Math.hypot(to.x - from.x, to.z - from.z) || 1;
      return { dx: (to.x - from.x) / l, dz: (to.z - from.z) / l };
    };
    const mine = away(seg);
    for (const other of w.segments) {
      if (other.id === seg.id || baseRoadType(other.type) !== ROAD.HIGHWAY || segElevation(other) !== "ground") continue;
      const touches = dist(other.pts[0].x, other.pts[0].z, end.x, end.z) <= SNAP
        || dist(other.pts[other.pts.length - 1].x, other.pts[other.pts.length - 1].z, end.x, end.z) <= SNAP;
      if (!touches) continue;
      if (other.pts.length !== 2) return false;
      const o = away(other);
      const ang = Math.acos(Math.max(-1, Math.min(1, mine.dx * o.dx + mine.dz * o.dz))) * 180 / Math.PI;
      if (ang < 178) return false;
    }
  }
  return true;
}

/** Angle in degrees between the ramp's end tangent and the highway at the contact, 0..90. */
export function rampContactAngle(w: World, rampPts: Pt[], end: "a" | "b", hwSegId: number): number {
  const n = rampPts.length;
  const tip = end === "a" ? rampPts[0] : rampPts[n - 1];
  const inner = end === "a" ? rampPts[1] : rampPts[n - 2];
  const rl = Math.hypot(inner.x - tip.x, inner.z - tip.z) || 1;
  const rx = (inner.x - tip.x) / rl, rz = (inner.z - tip.z) / rl;
  const seg = w.segments.find((s) => s.id === hwSegId);
  const h = seg ? tangentAtNearest(seg, tip) : { dx: 1, dz: 0 };
  const dot = Math.abs(Math.max(-1, Math.min(1, rx * h.dx + rz * h.dz)));
  return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * Right-hand traffic: the carriageway on the right of travel a→b is the +offset
 * side. A ramp on the + side must travel with a→b, on the − side with b→a. The
 * ramp's travel at the contact leaves (exit) for end "a" and arrives (entry) for
 * end "b" (one-way dir 1 travels a→b).
 */
function rampDirectionOk(w: World, rampPts: Pt[], end: "a" | "b", hwSegId: number): boolean {
  const seg = w.segments.find((s) => s.id === hwSegId);
  if (!seg) return false;
  const n = rampPts.length;
  const contact = end === "a" ? rampPts[0] : rampPts[n - 1];
  const far = end === "a" ? rampPts[n - 1] : rampPts[0];
  const h = tangentAtNearest(seg, contact);
  const side = h.dx * (far.z - contact.z) - h.dz * (far.x - contact.x);
  const inner = end === "a" ? rampPts[1] : rampPts[n - 2];
  const tip = end === "a" ? rampPts[0] : rampPts[n - 1];
  // One-way travel at the contact: leaves along pts[1]-pts[0] for end "a",
  // arrives along pts[n-1]-pts[n-2] for end "b".
  const tx = end === "a" ? inner.x - tip.x : tip.x - inner.x;
  const tz = end === "a" ? inner.z - tip.z : tip.z - inner.z;
  const tl = Math.hypot(tx, tz) || 1;
  const along = (tx * h.dx + tz * h.dz) / tl > 0;
  return (side > 0) === along;
}

/** Highway segments connected to segId through highway-only nodes. */
function highwayComponent(w: World, segId: number): Set<number> {
  const out = new Set<number>(), pending = [segId];
  while (pending.length) {
    const id = pending.pop()!;
    if (out.has(id)) continue;
    const seg = w.segments.find((s) => s.id === id);
    if (!seg || baseRoadType(seg.type) !== 3 || segElevation(seg) !== "ground") continue;
    out.add(id);
    for (const nodeId of [seg.a, seg.b]) {
      const node = w.nodes.find((n) => n.id === nodeId);
      for (const next of node?.segs ?? []) if (!out.has(next)) pending.push(next);
    }
  }
  return out;
}

/**
 * Existing and proposed gores occupy directed intervals on one carriageway.
 * Refuse only when those intervals overlap on the same side of the same
 * connected highway; opposite-side and back-to-back merge/diverge pads stay legal.
 */
function rampGoreTooClose(w: World, rampPts: Pt[], end: "a" | "b", hwSegId: number): boolean {
  const contact = end === "a" ? rampPts[0] : rampPts[rampPts.length - 1];
  const far = end === "a" ? rampPts[rampPts.length - 1] : rampPts[0];
  const h = tangentAtNearest(w.segments.find((s) => s.id === hwSegId)!, contact);
  const side = h.dx * (far.z - contact.z) - h.dz * (far.x - contact.x) >= 0 ? 1 : -1;
  const travel = side > 0 ? h : { dx: -h.dx, dz: -h.dz };
  // A pad is a wedge that narrows to nothing at its full length. Its extent is
  // the full length (same formula as goreWants/buildGore) minus the last
  // GORE_TAIL_FRACTION, where the wedge is under half a tile wide; two pads
  // may meet there. Measured against the emitted pads, this accepts the pairs
  // whose pad/pad overlap is <= 1e-4 and refuses every pair that really overlaps.
  const angle = rampContactAngle(w, rampPts, end, hwSegId) * Math.PI / 180;
  const hp = profileOf(ROAD.HIGHWAY), rp = profileOf(ROAD.RAMP);
  const nose = Math.max(1, (hp.asphaltHalf + rp.asphaltHalf * Math.cos(angle)) / Math.max(1e-9, Math.sin(angle)));
  const wanted = Math.max(2, Math.min(12, 6 * rp.asphaltHalf / Math.max(1e-9, Math.tan(angle))), nose + 0.5);
  const proposedKind = end === "a" ? "diverge" : "merge";
  const span = (len: number, same: boolean): number => same ? len + SAME_DIRECTION_MARGIN : len * (1 - GORE_TAIL_FRACTION);
  const component = highwayComponent(w, hwSegId);
  for (const layout of junctionsOf(w).byNode.values()) {
    if (!layout.gore || (layout.kind !== "merge" && layout.kind !== "diverge")) continue;
    if (!layout.arms.some((a) => a.type === ROAD.HIGHWAY && component.has(a.segId))) continue;
    const rampArm = layout.arms[layout.gore.rampArm];
    const rampSeg = w.segments.find((s) => s.id === rampArm.segId);
    if (!rampSeg) continue;
    const existingFar = rampArm.end === "a" ? rampSeg.pts[rampSeg.pts.length - 1] : rampSeg.pts[0];
    const existingSide = h.dx * (existingFar.z - layout.centre.z) - h.dz * (existingFar.x - layout.centre.x) >= 0 ? 1 : -1;
    if (existingSide !== side) continue;
    const at = (layout.centre.x - contact.x) * travel.dx + (layout.centre.z - contact.z) * travel.dz;
    // Same-direction pairs (exit-exit, entry-entry) put the second tail over
    // the highway ribbon trimmed for the first: use the full pad plus a margin.
    // Opposite-direction pairs only meet at thin tails.
    const same = layout.kind === proposedKind;
    const len = span(layout.gore.length, same);
    const proposedLen = span(wanted, same);
    const proposed: [number, number] = end === "a" ? [0, proposedLen] : [-proposedLen, 0];
    const interval: [number, number] = layout.kind === "diverge" ? [at, at + len] : [at - len, at];
    if (Math.min(proposed[1], interval[1]) - Math.max(proposed[0], interval[0]) > 1e-4) return true;
  }
  return false;
}

/**
 * Check a ground node after a type change: if any arm is a highway, every
 * other arm must be a highway or a ramp, and every ramp arm must meet the
 * highway at 10-30° in its direction on a straight stretch (same
 * angle/direction/straightness code
 * classifyCrossings uses for new ramps; at a bend/mid node the
 * smallest-angle highway arm wins). Returns the refusal reason, else null.
 */
export function highwayNodeIssue(w: World, nodeId: number, typeOverride?: Map<number, RoadType>): string | null {
  const node = w.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const arms: { segId: number; hw: boolean; ramp: boolean }[] = [];
  for (const segId of node.segs) {
    const seg = w.segments.find((s) => s.id === segId);
    if (!seg || segElevation(seg) !== "ground") continue;
    const t = typeOverride?.get(segId) ?? seg.type;
    arms.push({ segId, hw: baseRoadType(t) === 3, ramp: t === ROAD.RAMP });
  }
  if (!arms.some((a) => a.hw)) return null;
  if (arms.some((a) => !a.hw && !a.ramp)) return INTERCHANGE_REASON;
  const hwIds = arms.filter((a) => a.hw).map((a) => a.segId);
  for (const arm of arms.filter((a) => a.ramp)) {
    const seg = w.segments.find((s) => s.id === arm.segId)!;
    const end = seg.a === nodeId ? ("a" as const) : ("b" as const);
    let bestId = hwIds[0];
    let bestAng = rampContactAngle(w, seg.pts, end, bestId);
    for (const id of hwIds.slice(1)) {
      const a = rampContactAngle(w, seg.pts, end, id);
      if (a < bestAng) { bestAng = a; bestId = id; }
    }
    if (bestAng < RAMP_MIN_ANGLE_DEG || bestAng > RAMP_MAX_ANGLE_DEG) return RAMP_ANGLE_REASON;
    const contact = end === "a" ? seg.pts[0] : seg.pts[seg.pts.length - 1];
    if (!rampHighwayCurvatureOk(w, bestId, contact)) return RAMP_CURVATURE_REASON;
    if (!rampDirectionOk(w, seg.pts, end, bestId)) return RAMP_DIRECTION_REASON;
  }
  return null;
}

/** Parameter of `p` along a segment (0 at a, 1 at b), by nearest sample. */
function segParam(w: World, segId: number, p: Pt): number {
  const seg = w.segments.find((s) => s.id === segId);
  if (!seg) return 0;
  const q = curvePoints(seg.pts, 0.1);
  let bi = 0, bd = Infinity;
  q.forEach((s, i) => { const d = dist(p.x, p.z, s.x, s.z); if (d < bd) { bd = d; bi = i; } });
  return bi / Math.max(1, q.length - 1);
}

/** Could the drawn road bridge here? Hills bury a deck (use a tunnel) and an over-long water span defeats it. */
export function bridgePossibleAt(w: World, type: RoadType, pts: Pt[], c: { x: number; z: number }): boolean {
  const hEnds = Math.max(heightAt(w, pts[0].x, pts[0].z), heightAt(w, pts[pts.length - 1].x, pts[pts.length - 1].z));
  if (heightAt(w, c.x, c.z) > hEnds + TUNNEL_RISE) return false;
  const span = detectSpan(w, type, pts);
  if (!span.ok && span.reason === "Bridge span too long") return false;
  return true;
}

export type PlannedLevel = "ground" | "elevated" | "tunnel";

/**
 * Classify every meeting between a planned road and the existing network.
 * Pure: reads the world, never splits or snaps anything.
 */
export function classifyCrossings(w: World, type: RoadType, pts: Pt[], level: PlannedLevel = "ground"): Crossing[] {
  if (pts.length < 2) return [];
  const poly = curvePoints(pts, 0.25);
  const cum = cumLengths(poly);
  const total = cum[cum.length - 1] || segmentLength(pts);
  const newElev = level === "elevated" ? "bridge" : level === "tunnel" ? "tunnel" : "ground";
  const out: Crossing[] = [];
  const tileOf = (x: number, z: number) => {
    const tx = Math.floor(x), ty = Math.floor(z);
    return inBounds(w, tx, ty) ? idx(w, tx, ty) : -1;
  };
  const base = (hit: RawHit, segId: number | undefined, atEnd: boolean, along: number): Crossing => {
    const seg = segId !== undefined ? w.segments.find((s) => s.id === segId) : undefined;
    return {
      kind: "junction", x: hit.x, z: hit.z, tile: tileOf(hit.x, hit.z),
      ...(seg ? { segId: seg.id, existingType: seg.type, existingElevation: segElevation(seg) } : {}),
      distFromStart: along, distFromEnd: Math.max(0, total - along), atEnd,
    };
  };

  // Interior crossings (endpoint contacts are handled separately below).
  for (const hit of rawHits(w, poly)) {
    const along = nearestOnPoly(poly, cum, hit).along;
    if (along < SNAP || total - along < SNAP) continue;
    const segs = hit.segIds.map((id) => w.segments.find((s) => s.id === id)!).filter(Boolean);
    if (!segs.length) continue;
    // Prefer a segment on the planned level, else the first sharing the point.
    const seg = segs.find((s) => segElevation(s) === newElev) ?? segs[0];
    const c = base(hit, seg.id, false, along);
    const eElev = segElevation(seg);
    const nearEnd = Math.min(c.distFromStart, c.distFromEnd);
    const highway = baseRoadType(type) === 3 || segs.some((s) => baseRoadType(s.type) === 3);
    if (eElev !== newElev && newElev !== "ground" && eElev === "ground" && nearEnd < RAMP_FALLBACK_TILES) {
      // Inside the ramp the planned deck is still at grade here.
      if (highway) { c.kind = "blocked"; c.blockedReason = "interchange"; }
      else c.kind = "junction";
    } else if (eElev !== newElev) {
      c.kind = rank(newElev) > rank(eElev) ? "overpass" : "underpass";
    } else if (highway) {
      if (level !== "ground") {
        // An explicit deck/tunnel already separates; only ramp-room failure blocks.
        c.kind = nearEnd < RAMP_FALLBACK_TILES ? "blocked" : newElev === "bridge" ? "overpass" : "underpass";
        if (c.kind === "blocked") c.blockedReason = "interchange";
      } else if (nearEnd < HIGHWAY_END_CLEARANCE) {
        c.kind = "blocked"; c.blockedReason = "interchange";
      } else {
        c.kind = bridgePossibleAt(w, type, pts, hit) ? "overpass" : "underpass";
        c.autoElevate = true;
      }
    } else if (level !== "ground" && nearEnd < RAMP_FALLBACK_TILES) {
      c.kind = "junction"; // ramp zone: no room to climb, meet at grade
    } else {
      c.kind = "junction";
    }
    out.push(c);
  }

  // Endpoint contacts: T-junctions and joins at either drawn end.
  for (const endIdx of [0, pts.length - 1]) {
    const p = pts[endIdx];
    const along = endIdx === 0 ? 0 : total;
    // Ends on a bridge/tunnel interior never snap (rule 2).
    let onElevated: RawHit | null = null;
    let onHighway: RawHit | null = null;
    let onGround: RawHit | null = null;
    const nearNode = w.nodes.find((n) => dist(n.x, n.z, p.x, p.z) <= SNAP);
    if (nearNode) {
      const hwIds = nearNode.segs.filter((id) => { const s = w.segments.find((x) => x.id === id); return s && baseRoadType(s.type) === 3 && segElevation(s) === "ground"; });
      if (hwIds.length) onHighway = { x: p.x, z: p.z, segIds: hwIds };
    }
    for (const seg of w.segments) {
      const q = curvePoints(seg.pts, 0.25);
      const near = nearestOnPoly(q, cumLengths(q), p);
      if (near.d > SNAP) continue;
      const t = segParam(w, seg.id, p);
      const interior = t > 0.03 && t < 0.97;
      const hit: RawHit = { x: p.x, z: p.z, segIds: [seg.id] };
      if (interior && segElevation(seg) !== "ground") { onElevated ??= hit; continue; }
      if (baseRoadType(seg.type) === 3 && segElevation(seg) === "ground") onHighway ??= hit;
      else if (segElevation(seg) === "ground") onGround ??= hit;
    }
    if (onElevated) {
      const c = base(onElevated, onElevated.segIds[0], true, along);
      c.kind = "blocked"; c.blockedReason = "elevated-join";
      out.push(c);
    } else if (onHighway && level === "ground" && type === ROAD.RAMP) {
      const end = endIdx === 0 ? "a" as const : "b" as const;
      let bestId = onHighway.segIds[0];
      let ang = rampContactAngle(w, pts, end, bestId);
      for (const id of onHighway.segIds.slice(1)) {
        const a = rampContactAngle(w, pts, end, id);
        if (a < ang) { ang = a; bestId = id; }
      }
      const c = base(onHighway, bestId, true, along);
      if (ang < RAMP_MIN_ANGLE_DEG || ang > RAMP_MAX_ANGLE_DEG) {
        c.kind = "blocked"; c.blockedReason = "ramp-angle";
      } else if (!rampHighwayCurvatureOk(w, bestId, p)) {
        c.kind = "blocked"; c.blockedReason = "ramp-curvature";
      } else if (!rampDirectionOk(w, pts, end, bestId)) {
        c.kind = "blocked"; c.blockedReason = "ramp-direction";
      } else if (rampGoreTooClose(w, pts, end, bestId)) {
        c.kind = "blocked"; c.blockedReason = "gore-proximity";
      }
      out.push(c);
    } else if (onHighway && level === "ground" && baseRoadType(type) !== 3) {
      const c = base(onHighway, onHighway.segIds[0], true, along);
      c.kind = "blocked"; c.blockedReason = "interchange";
      out.push(c);
    } else if (onHighway && level === "ground" && baseRoadType(type) === 3) {
      out.push(base(onHighway, onHighway.segIds[0], true, along)); // highway meets highway: junction
    } else if (onGround) {
      out.push(base(onGround, onGround.segIds[0], true, along)); // ordinary T / join
    }
  }
  out.sort((a, b) => a.distFromStart - b.distFromStart);
  return out;
}

/** Counts per kind, for the one-line preview hint. */
export function summarizeCrossings(cs: Crossing[]): Record<CrossingKind, number> {
  const n: Record<CrossingKind, number> = { junction: 0, overpass: 0, underpass: 0, blocked: 0 };
  for (const c of cs) n[c.kind]++;
  return n;
}

// ------------------------------------------------------------ interchange helper

/** Unit direction from a node into one of its segments. */
function armDir(w: World, nodeId: number, segId: number): { dx: number; dz: number } | null {
  const seg = w.segments.find((s) => s.id === segId);
  const node = w.nodes.find((n) => n.id === nodeId);
  if (!seg || !node) return null;
  const inner = seg.a === nodeId ? seg.pts[Math.min(1, seg.pts.length - 1)] : seg.pts[Math.max(0, seg.pts.length - 2)];
  const dx = inner.x - node.x, dz = inner.z - node.z;
  const l = Math.hypot(dx, dz);
  return l < 1e-9 ? null : { dx: dx / l, dz: dz / l };
}

const norm = (dx: number, dz: number) => { const l = Math.hypot(dx, dz) || 1; return { dx: dx / l, dz: dz / l }; };

/** Four diamond ramps around a centre: highway point → elbow → cross-road point, 6 tiles out. */
export function diamondRamps(cx: number, cz: number, h: { dx: number; dz: number }, c: { dx: number; dz: number }): Pt[][] {
  const ramps: Pt[][] = [];
  for (const sh of [1, -1]) for (const sc of [1, -1]) {
    ramps.push([
      { x: cx + h.dx * 6 * sh, z: cz + h.dz * 6 * sh },
      { x: cx + h.dx * 3 * sh + c.dx * 3 * sc, z: cz + h.dz * 3 * sh + c.dz * 3 * sc },
      { x: cx + c.dx * 3 * sc, z: cz + c.dz * 3 * sc },
    ]);
  }
  return ramps;
}

/**
 * Ramp polylines for a diamond interchange at a highway/avenue (or highway/street)
 * junction node: two one-way ramp pairs reaching 6 tiles along the highway.
 * Returns [] when the node is not such a crossing. Geometry only; stamping is the caller's job.
 */
export function suggestInterchange(w: World, nodeId: number): Pt[][] {
  const node = w.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  let hDir: { dx: number; dz: number } | null = null;
  let cDir: { dx: number; dz: number } | null = null;
  for (const segId of node.segs) {
    const seg = w.segments.find((s) => s.id === segId);
    if (!seg) continue;
    const d = armDir(w, nodeId, segId);
    if (!d) continue;
    if (baseRoadType(seg.type) === 3) hDir ??= d; else cDir ??= d;
  }
  if (!hDir || !cDir) return [];
  // Make the cross axis perpendicular to the highway axis.
  const dot = cDir.dx * hDir.dx + cDir.dz * hDir.dz;
  const cPerp = norm(cDir.dx - dot * hDir.dx, cDir.dz - dot * hDir.dz);
  if (Math.hypot(cPerp.dx, cPerp.dz) < 1e-6) return [];
  return diamondRamps(node.x, node.z, hDir, cPerp);
}
