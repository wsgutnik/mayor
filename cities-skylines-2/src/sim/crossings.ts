import {
  Pt, RoadType, World, baseRoadType, curvePoints, heightAt, idx, inBounds, segElevation, segmentLength,
} from "./world";
import { TUNNEL_RISE, detectSpan } from "./elevation";

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
  blockedReason?: "interchange" | "elevated-join";
}

/** A highway crossing needs this much clear road at both ends for ramps. */
export const HIGHWAY_END_CLEARANCE = 4;
/** Crossings closer than this to an elevated road's end fall back to grade. */
export const RAMP_FALLBACK_TILES = 3;
export const INTERCHANGE_REASON = "Highways need an interchange";
export const ELEVATED_JOIN_REASON = "Cannot connect to a bridge or tunnel";

const SNAP = 0.6;
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
      const hw = nearNode.segs.find((id) => { const s = w.segments.find((x) => x.id === id); return s && baseRoadType(s.type) === 3 && segElevation(s) === "ground"; });
      if (hw !== undefined) onHighway = { x: p.x, z: p.z, segIds: [hw] };
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
