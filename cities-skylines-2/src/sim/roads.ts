import {
  Pt, RoadSegment, RoadType, World, curvePoints, rasterizeRoad, ROAD_DRAW_WIDTH,
  Elevation, segElevation,
} from "./world";

/** A junction (or dead end) where segment ends meet. */
export interface RoadNode {
  id: number;
  x: number;
  z: number;
  /** Ids of the segments attached here. */
  segs: number[];
}

/** Snap radius for a new road end onto an existing node, in tiles. */
export const SNAP_RADIUS = 0.6;
/** Paint-mode steps merge into a straight segment ending this close to its tip. */
const EXTEND_RADIUS = 1.3;
/** A painted tile this close to a road (4-neighbour adjacency plus slack) is linked to it. */
const JOIN_RADIUS = 1.05;
/** Two centrelines closer than this count as the same road (upgrade, not a duplicate). */
const COINCIDE_TOL = 0.35;

/** Kerb width beside the asphalt, by road class (highways have no kerbs). */
export function kerbWidth(type: RoadType): number {
  return type === 1 ? 0.07 : type === 2 ? 0.09 : 0;
}

/** Half the asphalt width (drawn width minus kerbs). */
export function halfAsphalt(type: RoadType): number {
  return ROAD_DRAW_WIDTH[type] / 2 - kerbWidth(type);
}

/** Kerb fillet radius at corners: tighter for streets, wider for avenues and highways. */
export function cornerRadius(type: RoadType): number {
  return type === 1 ? 0.25 : 0.4;
}

export const segById = (w: World, id: number): RoadSegment | undefined =>
  w.segments.find((s) => s.id === id);
export const nodeById = (w: World, id: number): RoadNode | undefined =>
  w.nodes.find((n) => n.id === id);

const dist = (ax: number, az: number, bx: number, bz: number): number =>
  Math.hypot(ax - bx, az - bz);

function bezPoint(pts: Pt[], t: number): Pt {
  if (pts.length === 3) {
    const [a, b, c] = pts;
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
      z: u * u * a.z + 2 * u * t * b.z + t * t * c.z,
    };
  }
  return { x: pts[0].x + (pts[1].x - pts[0].x) * t, z: pts[0].z + (pts[1].z - pts[0].z) * t };
}

/** Split a 2- or 3-point road at curve parameter t into two point lists. */
function splitPts(pts: Pt[], t: number): [Pt[], Pt[]] {
  if (pts.length === 3) {
    const [p0, c, p2] = pts;
    const a = { x: p0.x + (c.x - p0.x) * t, z: p0.z + (c.z - p0.z) * t };
    const b = { x: c.x + (p2.x - c.x) * t, z: c.z + (p2.z - c.z) * t };
    const m = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    return [[{ ...p0 }, a, m], [m, b, { ...p2 }]];
  }
  const m = bezPoint(pts, t);
  return [[{ ...pts[0] }, m], [m, { ...pts[1] }]];
}

/** Centreline length, cheap (chord + control polygon). */
function roughLength(pts: Pt[]): number {
  if (pts.length === 3) {
    return dist(pts[0].x, pts[0].z, pts[1].x, pts[1].z)
      + dist(pts[1].x, pts[1].z, pts[2].x, pts[2].z);
  }
  return dist(pts[0].x, pts[0].z, pts[1].x, pts[1].z);
}

/** Nearest point on a segment's centreline to p, with an arclength-ish parameter. */
function projectOnSegment(seg: RoadSegment, p: Pt): { x: number; z: number; t: number; d: number } {
  const samples = curvePoints(seg.pts, 0.1);
  let best = 0, bd = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const d = dist(p.x, p.z, samples[i].x, samples[i].z);
    if (d < bd) { bd = d; best = i; }
  }
  // Refine between the neighbouring samples.
  let bx = samples[best].x, bz = samples[best].z, bt = best / Math.max(1, samples.length - 1);
  for (const j of [best - 1, best + 1]) {
    if (j < 0 || j >= samples.length) continue;
    const a = samples[Math.min(best, j)], b = samples[Math.max(best, j)];
    const vx = b.x - a.x, vz = b.z - a.z;
    const l2 = vx * vx + vz * vz;
    if (l2 < 1e-12) continue;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / l2));
    const cx = a.x + vx * u, cz = a.z + vz * u;
    const d = dist(p.x, p.z, cx, cz);
    if (d < bd) {
      bd = d;
      bx = cx; bz = cz;
      bt = (Math.min(best, j) + u) / Math.max(1, samples.length - 1);
    }
  }
  return { x: bx, z: bz, t: bt, d: bd };
}

/** Nearest existing node within `radius` of p, or null. */
function nearestNode(w: World, x: number, z: number, radius: number): RoadNode | null {
  let best: RoadNode | null = null, bd = radius;
  for (const n of w.nodes) {
    const d = dist(x, z, n.x, n.z);
    if (d <= bd) { bd = d; best = n; }
  }
  return best;
}

function makeNode(w: World, x: number, z: number): RoadNode {
  const n: RoadNode = { id: w.nextNodeId++, x, z, segs: [] };
  w.nodes.push(n);
  return n;
}

function attach(w: World, nodeId: number, segId: number): void {
  const n = nodeById(w, nodeId);
  if (n && !n.segs.includes(segId)) n.segs.push(segId);
}

function detach(w: World, nodeId: number, segId: number): void {
  const n = nodeById(w, nodeId);
  if (n) n.segs = n.segs.filter((id) => id !== segId);
}

function retile(w: World, seg: RoadSegment): void {
  seg.tiles = rasterizeRoad(w, seg.type, seg.pts).tiles;
}

/**
 * Split `seg` at the centreline point (x, z). Returns the node there: either a
 * fresh split node, or the existing end node when the point is at a tip.
 */
function splitSegment(w: World, seg: RoadSegment, x: number, z: number): RoadNode {
  const aNode = nodeById(w, seg.a), bNode = nodeById(w, seg.b);
  const proj = projectOnSegment(seg, { x, z });
  if (proj.t < 0.02 && aNode) return aNode;
  if (proj.t > 0.98 && bNode) return bNode;
  const [left, right] = splitPts(seg.pts, proj.t);
  // The node sits exactly on the shared joint so both pieces (and any later
  // rebuild matching their endpoints) agree on its position bit-for-bit.
  const joint = left[left.length - 1];
  const n = makeNode(w, joint.x, joint.z);
  const rightSeg: RoadSegment = {
    id: w.nextSegmentId++, type: seg.type, pts: right, tiles: [], a: n.id, b: seg.b,
    ...(seg.fixed ? { fixed: true } : {}),
    ...(seg.elevation !== undefined ? { elevation: seg.elevation } : {}),
  };
  seg.pts = left;
  seg.b = n.id;
  retile(w, seg);
  retile(w, rightSeg);
  w.segments.push(rightSeg);
  n.segs.push(seg.id, rightSeg.id);
  if (bNode) {
    bNode.segs = bNode.segs.map((id) => (id === seg.id ? rightSeg.id : id));
    attach(w, bNode.id, rightSeg.id);
  }
  return n;
}

/** Snap an end of a new road: existing node, T-split of a segment side, or null. */
function snapEnd(w: World, p: Pt, excludeDegenerate = true): RoadNode | null {
  const hit = nearestNode(w, p.x, p.z, SNAP_RADIUS);
  if (hit) return hit;
  let bestSeg: RoadSegment | null = null;
  let best = { x: 0, z: 0, t: 0, d: SNAP_RADIUS };
  for (const seg of w.segments) {
    if (excludeDegenerate && roughLength(seg.pts) < 1e-6) continue;
    const pr = projectOnSegment(seg, p);
    if (pr.d <= best.d && pr.t > 0.03 && pr.t < 0.97) {
      bestSeg = seg;
      best = pr;
    }
  }
  if (bestSeg) return splitSegment(w, bestSeg, best.x, best.z);
  return null;
}

/** Proper (transverse) crossings between a polyline and one segment's centreline. */
function crossingsWith(poly: Pt[], seg: RoadSegment): Pt[] {
  if (roughLength(seg.pts) < 1e-6) return [];
  const out: Pt[] = [];
  const q = curvePoints(seg.pts, 0.25);
  for (let i = 0; i + 1 < poly.length; i++) {
    const ax = poly[i].x, az = poly[i].z, bx = poly[i + 1].x, bz = poly[i + 1].z;
    const vx = bx - ax, vz = bz - az;
    const l2 = vx * vx + vz * vz;
    if (l2 < 1e-12) continue;
    for (let j = 0; j + 1 < q.length; j++) {
      const cx = q[j].x, cz = q[j].z, dx = q[j + 1].x - cx, dz = q[j + 1].z - cz;
      const denom = vx * dz - vz * dx;
      if (Math.abs(denom) < 1e-9) continue; // parallel or collinear: not a crossing
      const t = ((cx - ax) * dz - (cz - az) * dx) / denom;
      const u = ((cx - ax) * vz - (cz - az) * vx) / denom;
      // A crossing may land exactly on a sample joint (grid-aligned roads
      // always do), so both parameters accept the joints. Contacts at segment
      // tips already carry nodes and are filtered by the caller; anything
      // left either splits inside or snaps to its end node in splitSegment.
      if (t > -1e-3 && t < 1 + 1e-3 && u > -1e-3 && u < 1 + 1e-3) {
        out.push({ x: ax + vx * t, z: az + vz * t });
      }
    }
  }
  return out;
}

/** Parameter along `poly` of the closest point to p. */
function polyParam(poly: Pt[], p: Pt): number {
  let best = 0, bd = Infinity, bi = 0;
  for (let i = 0; i < poly.length; i++) {
    const d = dist(p.x, p.z, poly[i].x, poly[i].z);
    if (d < bd) { bd = d; bi = i; }
  }
  best = bi / Math.max(1, poly.length - 1);
  return best;
}

/**
 * Add one painted tile: extend a straight dead-end segment when the tile
 * continues it, otherwise start (or join) a zero-length pad. This is what
 * keeps tile-by-tile painting to one segment per straight run.
 */
function addPad(w: World, type: RoadType, p: Pt, fixedId: number): number[] {
  // Grow a lone pad into a real segment: the second painted tile turns the
  // first tile's pad into [pad, here], so straight runs become one segment.
  {
    let grow: RoadSegment | null = null, growNode: RoadNode | null = null, bd = EXTEND_RADIUS;
    for (const seg of w.segments) {
      if (seg.type !== type || seg.fixed || roughLength(seg.pts) >= 1e-6) continue;
      const node = nodeById(w, seg.a); // pads have a === b
      if (!node || seg.a !== seg.b) continue;
      const d = dist(p.x, p.z, node.x, node.z);
      if (d < 1e-6 || d >= bd) continue;
      grow = seg;
      growNode = node;
      bd = d;
    }
    if (grow && growNode) {
      const nb = nearestNode(w, p.x, p.z, SNAP_RADIUS);
      if (nb && nb.id !== growNode.id) {
        grow.pts = [{ x: growNode.x, z: growNode.z }, { x: nb.x, z: nb.z }];
        grow.b = nb.id;
        attach(w, nb.id, grow.id);
      } else {
        const nn = makeNode(w, p.x, p.z);
        grow.pts = [{ x: growNode.x, z: growNode.z }, { x: nn.x, z: nn.z }];
        grow.b = nn.id;
        attach(w, nn.id, grow.id);
      }
      retile(w, grow);
      return [grow.id];
    }
  }
  // Prefer extending a live straight tip: same class, dead end, roughly aligned.
  let bestSeg: RoadSegment | null = null;
  let bestEnd: "a" | "b" | null = null;
  let bd = EXTEND_RADIUS;
  for (const seg of w.segments) {
    if (seg.type !== type || seg.fixed || roughLength(seg.pts) < 1e-6 || seg.pts.length !== 2) continue;
    for (const end of ["a", "b"] as const) {
      const node = nodeById(w, end === "a" ? seg.a : seg.b);
      if (!node || node.segs.length !== 1) continue;
      const d = dist(p.x, p.z, node.x, node.z);
      if (d >= bd) continue;
      const tip = end === "a" ? seg.pts[0] : seg.pts[1];
      const root = end === "a" ? seg.pts[1] : seg.pts[0];
      const sx = tip.x - root.x, sz = tip.z - root.z;
      const sl = Math.hypot(sx, sz) || 1;
      const vx = p.x - node.x, vz = p.z - node.z;
      const vl = Math.hypot(vx, vz);
      // A zero-length drag keeps the direction; anything within ~25° extends.
      if (vl > 1e-9 && (sx * vx + sz * vz) / (sl * vl) < 0.9) continue;
      bestSeg = seg;
      bestEnd = end;
      bd = d;
    }
  }
  if (bestSeg && bestEnd) {
    const node = nodeById(w, bestEnd === "a" ? bestSeg.a : bestSeg.b)!;
    node.x = p.x;
    node.z = p.z;
    if (bestEnd === "a") bestSeg.pts[0] = { ...p };
    else bestSeg.pts[bestSeg.pts.length - 1] = { ...p };
    retile(w, bestSeg);
    return [bestSeg.id];
  }
  const at = nearestNode(w, p.x, p.z, SNAP_RADIUS);
  if (!at) {
    // A tile painted beside an existing road (a bend, or a side street meeting the side of a road) joins it with a
    // one-tile link, so the graph stays connected and the junction gets proper corners.
    let join: RoadNode | null = nearestNode(w, p.x, p.z, JOIN_RADIUS);
    if (!join) {
      let sideSeg: RoadSegment | null = null;
      let side = { x: 0, z: 0, t: 0, d: JOIN_RADIUS };
      for (const seg of w.segments) {
        if (roughLength(seg.pts) < 1e-6) continue;
        const pr = projectOnSegment(seg, p);
        if (pr.d <= side.d && pr.t > 0.03 && pr.t < 0.97) { sideSeg = seg; side = pr; }
      }
      if (sideSeg) join = splitSegment(w, sideSeg, side.x, side.z);
    }
    if (join) {
      const nn = makeNode(w, p.x, p.z);
      const link: RoadSegment = {
        id: fixedId, type, pts: [{ x: join.x, z: join.z }, { ...p }], tiles: [], a: join.id, b: nn.id,
      };
      retile(w, link);
      w.segments.push(link);
      attach(w, join.id, link.id);
      attach(w, nn.id, link.id);
      return [link.id];
    }
  }
  const node = at ?? makeNode(w, p.x, p.z);
  const seg: RoadSegment = {
    id: fixedId, type, pts: [{ ...p }, { ...p }], tiles: [], a: node.id, b: node.id,
  };
  retile(w, seg);
  w.segments.push(seg);
  attach(w, node.id, seg.id);
  return [seg.id];
}

/**
 * Add a road to the graph: ends snap to nodes within 0.6 tiles, ends landing
 * on a segment side split it (T-junction), and transverse crossings gain a
 * node that splits both roads. Returns the new segment ids.
 */
export interface AddSegmentOpts {
  /** Mark every created piece (entry road on the load path). */
  fixed?: boolean;
  /** Vertical placement of every created piece (bridges/tunnels from the planner). */
  elevation?: Elevation;
}

export function addSegment(w: World, type: RoadType, pts: Pt[], opts?: AddSegmentOpts): number[] {
  const src = pts.map((p) => ({ ...p }));
  if (src.length < 2) return [];
  if (roughLength(src) < 0.05 && src.length === 2) {
    return addPad(w, type, src[0], w.nextSegmentId++);
  }
  const created: number[] = [];
  const addPiece = (piece: Pt[]): number | null => {
    const p0 = piece[0], p1 = piece[piece.length - 1];
    let na = nearestNode(w, p0.x, p0.z, SNAP_RADIUS);
    let nb = nearestNode(w, p1.x, p1.z, SNAP_RADIUS);
    if (na) { p0.x = na.x; p0.z = na.z; } else na = makeNode(w, p0.x, p0.z);
    if (nb) { p1.x = nb.x; p1.z = nb.z; } else nb = makeNode(w, p1.x, p1.z);
    // Paving over the same path upgrades the road instead of doubling it.
    for (const seg of w.segments) {
      const pair = (seg.a === na.id && seg.b === nb.id) || (seg.a === nb.id && seg.b === na.id);
      if (pair && seg.type <= type && coincides(seg.pts, piece)) {
        seg.type = type;
        retile(w, seg);
        return seg.id;
      }
    }
    const seg: RoadSegment = {
      id: w.nextSegmentId++, type, pts: piece, tiles: [], a: na.id, b: nb.id,
      ...(opts?.fixed ? { fixed: true } : {}),
      ...(opts?.elevation !== undefined ? { elevation: opts.elevation } : {}),
    };
    retile(w, seg);
    w.segments.push(seg);
    attach(w, na.id, seg.id);
    if (nb.id !== na.id) attach(w, nb.id, seg.id);
    created.push(seg.id);
    return seg.id;
  };

  // 1-2. Snap the ends (splitting a segment side for a T-junction).
  const endA = snapEnd(w, src[0]);
  const endB = snapEnd(w, src[src.length - 1]);
  const poly = curvePoints(src, 0.25);
  if (endA) { poly[0] = { x: endA.x, z: endA.z }; }
  if (endB) { poly[poly.length - 1] = { x: endB.x, z: endB.z }; }

  // 3. Transverse crossings split the roads they cut.
  const cutAt: Pt[] = [];
  for (const seg of [...w.segments]) {
    for (const c of crossingsWith(poly, seg)) {
      if (nearestNode(w, c.x, c.z, SNAP_RADIUS)) continue;
      if (cutAt.some((k) => dist(k.x, k.z, c.x, c.z) < SNAP_RADIUS)) continue;
      const proj = projectOnSegment(seg, c);
      const node = splitSegment(w, seg, proj.x, proj.z);
      cutAt.push({ x: node.x, z: node.z });
    }
  }

  // 4-5. Cut the new road at every crossing node and add the pieces.
  if (!cutAt.length) {
    addPiece(src.map((p, i) => {
      if (i === 0 && endA) return { x: endA.x, z: endA.z };
      if (i === src.length - 1 && endB) return { x: endB.x, z: endB.z };
      return { ...p };
    }));
    return created;
  }
  const params = cutAt.map((c) => polyParam(poly, c)).sort((a, b) => a - b);
  // Bezier control points must move with the cut, so re-cut the source curve.
  const refined = cutBezierAt(src, params);
  for (const piece of refined) addPiece(piece);
  return created;
}

/** Subdivide a 2- or 3-point road at curve parameters ts (sorted 0..1). */
function cutBezierAt(src: Pt[], ts: number[]): Pt[][] {
  const cuts = [0, ...ts.filter((t) => t > 0.02 && t < 0.98), 1];
  const pieces: Pt[][] = [];
  let cur: Pt[] = src.map((p) => ({ ...p }));
  let prev = 0;
  for (let k = 1; k < cuts.length; k++) {
    const local = (cuts[k] - prev) / (1 - prev);
    const [left, right] = splitPts(cur, Math.max(0, Math.min(1, local)));
    if (k === cuts.length - 1) {
      pieces.push(left);
      if (roughLength(right) > 1e-6) pieces.push(right);
    } else {
      pieces.push(left);
    }
    cur = right;
    prev = cuts[k];
  }
  return pieces.filter((p) => p.length >= 2);
}

/** Try to merge a degree-2 node whose two arms form one straight road. */
function tryMergeNode(w: World, nodeId: number): void {
  const node = nodeById(w, nodeId);
  if (!node || node.segs.length !== 2) return;
  const [s1, s2] = node.segs.map((id) => segById(w, id));
  if (!s1 || !s2) return;
  if (s1.type !== s2.type || s1.fixed || s2.fixed) return;
  if (segElevation(s1) !== segElevation(s2)) return;
  if (roughLength(s1.pts) < 1e-6 || roughLength(s2.pts) < 1e-6) return;
  const arms = nodeArms(w, nodeId);
  if (arms.length !== 2) return;
  const dot = arms[0].dx * arms[1].dx + arms[0].dz * arms[1].dz;
  if (dot > -0.996) return; // not a straight continuation (needs > 175°)
  const far = (seg: RoadSegment, end: "a" | "b"): Pt => {
    const pts = seg.pts;
    if (end === "a") return { ...pts[0] };
    return { ...pts[pts.length - 1] };
  };
  // s1 survives: it now runs between the two far nodes.
  const side1 = s1.a === nodeId ? "a" : "b";
  const e1 = side1 === "a" ? "b" : "a";
  const e2 = s2.a === nodeId ? "b" : "a";
  const f1 = far(s1, e1), f2 = far(s2, e2);
  const farNode2 = e2 === "a" ? s2.a : s2.b;
  const straight = s1.pts.length === 2 && s2.pts.length === 2;
  s1.pts = straight ? [f1, f2] : [f1, { x: node.x, z: node.z }, f2];
  if (side1 === "a") s1.a = farNode2;
  else s1.b = farNode2;
  retile(w, s1);
  detach(w, farNode2, s2.id);
  attach(w, farNode2, s1.id);
  w.segments = w.segments.filter((s) => s.id !== s2.id);
  w.nodes = w.nodes.filter((n) => n.id !== nodeId);
}

/** Remove a segment; merges straight degree-2 nodes and drops orphan nodes. */
export function removeSegment(w: World, segId: number): boolean {
  const seg = segById(w, segId);
  if (!seg || seg.fixed) return false;
  w.segments = w.segments.filter((s) => s.id !== segId);
  for (const nodeId of [seg.a, seg.b]) {
    detach(w, nodeId, segId);
    const node = nodeById(w, nodeId);
    if (!node) continue;
    if (node.segs.length === 0) w.nodes = w.nodes.filter((n) => n.id !== nodeId);
    else tryMergeNode(w, nodeId);
  }
  return true;
}

/** Do two centrelines between the same nodes follow the same path? */
function coincides(a: Pt[], b: Pt[]): boolean {
  const pa = curvePoints(a, 0.25), pb = curvePoints(b, 0.25);
  const far = (from: Pt[], to: Pt[]): number => {
    let m = 0;
    for (const p of from) {
      let d = Infinity;
      for (const q of to) d = Math.min(d, dist(p.x, p.z, q.x, q.z));
      m = Math.max(m, d);
    }
    return m;
  };
  return Math.max(far(pa, pb), far(pb, pa)) < COINCIDE_TOL;
}

// ---------------------------------------------------------------- arms & layout

/** One road leaving a node, pointing away from it. */
export interface RoadArm {
  segId: number;
  end: "a" | "b";
  type: RoadType;
  /** Unit tangent away from the node. */
  dx: number;
  dz: number;
  /** atan2(dz, dx), for ordering. */
  angle: number;
  halfWidth: number;
  kerb: number;
}

/** Tangent of a segment at one end, pointing away from that end's node. */
function endTangent(seg: RoadSegment, end: "a" | "b"): { dx: number; dz: number } {
  const pts = seg.pts;
  const tip = end === "a" ? pts[0] : pts[pts.length - 1];
  const inner = end === "a"
    ? pts.length === 3 ? pts[1] : pts[1]
    : pts.length === 3 ? pts[1] : pts[pts.length - 2];
  const vx = tip.x - inner.x, vz = tip.z - inner.z;
  const l = Math.hypot(vx, vz) || 1;
  return { dx: vx / l, dz: vz / l };
}

/**
 * Arms of a node ordered by angle (then segment id, so ties are stable),
 * with half width and tangent. Zero-length pads have no direction and are skipped.
 */
export function nodeArms(w: World, nodeId: number): RoadArm[] {
  const node = nodeById(w, nodeId);
  if (!node) return [];
  const arms: RoadArm[] = [];
  for (const segId of node.segs) {
    const seg = segById(w, segId);
    if (!seg || roughLength(seg.pts) < 1e-6) continue;
    const end = seg.a === nodeId ? "a" : "b";
    if (seg.a !== nodeId && seg.b !== nodeId) continue;
    const { dx, dz } = endTangent(seg, end);
    arms.push({
      segId, end, type: seg.type, dx, dz,
      angle: Math.atan2(dz, dx),
      halfWidth: halfAsphalt(seg.type),
      kerb: kerbWidth(seg.type),
    });
  }
  arms.sort((a, b) => a.angle - b.angle || a.segId - b.segId);
  return arms;
}

/**
 * Junction geometry facts for one node: per-arm trims the ribbons must respect.
 * Trims are per side (neg/pos lateral sign): each side is touched by exactly
 * one neighbouring gap, so kerb bands meet ribbon starts edge-to-edge.
 */
export interface SideTrim { neg: number; pos: number }
export interface NodeLayoutArm extends RoadArm {
  /** Where the asphalt ribbon starts, per side (centreline distance from the node). */
  trimA: SideTrim;
  /** Where the kerb/sidewalk ribbons start, per side. */
  trimK: SideTrim;
}

/** One kerbed corner between two consecutive arms (world coordinates). */
export interface NodeCorner {
  aIdx: number;
  bIdx: number;
  /** Touch point on arm a's edge where the fillet starts. */
  pa: Pt;
  /** Touch point on arm b's edge. */
  pb: Pt;
  /** Fillet arc centre and radius (kerb inner edge). */
  ox: number;
  oz: number;
  r: number;
  /** Kerb width at this corner (max of the two arms). */
  kerb: number;
}

export interface NodeLayout {
  cx: number;
  cz: number;
  /** Largest arm half width plus fillet: the asphalt disc radius. */
  radius: number;
  fillet: number;
  arms: NodeLayoutArm[];
  corners: NodeCorner[];
}

const normAngle = (a: number): number => {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
};

interface Line2 { px: number; pz: number; dx: number; dz: number }

function lineIntersect(a: Line2, b: Line2): { x: number; z: number } | null {
  const denom = a.dx * b.dz - a.dz * b.dx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b.px - a.px) * b.dz - (b.pz - a.pz) * b.dx) / denom;
  return { x: a.px + a.dx * t, z: a.pz + a.dz * t };
}

/**
 * Per-arm ribbon trims so asphalt meets in the node with no gaps and kerbs
 * turn the corner with a fillet. Straight-through pairs trim at the centre;
 * sharp corners trim at the fillet tangent points.
 */
export function nodeLayout(w: World, nodeId: number): NodeLayout | null {
  const node = nodeById(w, nodeId);
  if (!node) return null;
  const cx = node.x, cz = node.z;
  const arms = nodeArms(w, nodeId);
  const fillet = Math.max(0.25, ...arms.map((a) => cornerRadius(a.type)));
  const radius = Math.max(0, ...arms.map((a) => a.halfWidth)) + fillet;
  const out: NodeLayoutArm[] = arms.map((a) => ({
    ...a, trimA: { neg: 0, pos: 0 }, trimK: { neg: 0, pos: 0 },
  }));
  const setTrim = (arm: NodeLayoutArm, side: -1 | 1, t: number): void => {
    const k = side < 0 ? "neg" : "pos";
    arm.trimA[k] = Math.max(arm.trimA[k], t);
    arm.trimK[k] = Math.max(arm.trimK[k], t);
  };
  const corners: NodeCorner[] = [];
  const n = out.length;
  const gapSide = (arm: RoadArm, bis: { x: number; z: number }): { x: number; z: number } => {
    const nx = -arm.dz, nz = arm.dx;
    const s = nx * bis.x + nz * bis.z >= 0 ? 1 : -1;
    return { x: nx * s, z: nz * s };
  };
  for (let i = 0; i < n; i++) {
    const a = out[i], b = out[(i + 1) % n];
    if (n < 2) break;
    let gap = normAngle(b.angle - a.angle);
    if (gap < 0) gap += 2 * Math.PI;
    if (gap < 0.02) continue; // duplicate arms (overlaid upgrade ghosts): no corner
    if (Math.abs(gap - Math.PI) < 0.09) continue; // straight through: butt joint at centre
    const bis = bisector(a, b);
    if (!bis) continue;
    const na = gapSide(a, bis), nb = gapSide(b, bis);
    if (gap > Math.PI) {
      // Inside of a bend: keep kerbs clear of each other past the miter point.
      if (gap < (150 * Math.PI) / 180) {
        const m = lineIntersect(
          { px: cx + na.x * a.halfWidth, pz: cz + na.z * a.halfWidth, dx: a.dx, dz: a.dz },
          { px: cx + nb.x * b.halfWidth, pz: cz + nb.z * b.halfWidth, dx: b.dx, dz: b.dz },
        );
        if (m) {
          const ta = (m.x - cx - na.x * a.halfWidth) * a.dx + (m.z - cz - na.z * a.halfWidth) * a.dz;
          const tb = (m.x - cx - nb.x * b.halfWidth) * b.dx + (m.z - cz - nb.z * b.halfWidth) * b.dz;
          if (ta > 0 && tb > 0 && ta < 1.2 && tb < 1.2) {
            setTrim(a, 1, ta);
            setTrim(b, -1, tb);
          }
        }
      }
      continue;
    }
    // Convex corner: fillet of radius `fillet` tangent to both edge lines.
    const o = lineIntersect(
      {
        px: cx + na.x * (a.halfWidth + fillet), pz: cz + na.z * (a.halfWidth + fillet),
        dx: a.dx, dz: a.dz,
      },
      {
        px: cx + nb.x * (b.halfWidth + fillet), pz: cz + nb.z * (b.halfWidth + fillet),
        dx: b.dx, dz: b.dz,
      },
    );
    if (!o) continue;
    const ta = (o.x - cx - na.x * a.halfWidth) * a.dx + (o.z - cz - na.z * a.halfWidth) * a.dz;
    const tb = (o.x - cx - nb.x * b.halfWidth) * b.dx + (o.z - cz - nb.z * b.halfWidth) * b.dz;
    if (ta < -0.05 || tb < -0.05) continue;
    const cta = Math.max(0, ta), ctb = Math.max(0, tb);
    setTrim(a, 1, cta);
    setTrim(b, -1, ctb);
    corners.push({
      aIdx: i,
      bIdx: (i + 1) % n,
      pa: { x: cx + a.dx * cta + na.x * a.halfWidth, z: cz + a.dz * cta + na.z * a.halfWidth },
      pb: { x: cx + b.dx * ctb + nb.x * b.halfWidth, z: cz + b.dz * ctb + nb.z * b.halfWidth },
      ox: o.x,
      oz: o.z,
      r: fillet,
      // Highway corners stay asphalt-only, like real merges.
      kerb: a.type === 3 || b.type === 3 ? 0 : Math.max(a.kerb, b.kerb),
    });
  }
  return { cx, cz, radius, fillet, arms: out, corners };
}

/** Unit bisector of the gap from arm a to arm b (null when opposed). */
function bisector(a: RoadArm, b: RoadArm): { x: number; z: number } | null {
  const mx = a.dx + b.dx, mz = a.dz + b.dz;
  const l = Math.hypot(mx, mz);
  if (l < 1e-6) return null;
  return { x: mx / l, z: mz / l };
}

// ---------------------------------------------------------------- signals

/** Nodes with 4+ arms, or 3 arms meeting an avenue, are signalised. */
export function hasSignal(w: World, nodeId: number): boolean {
  const arms = nodeArms(w, nodeId);
  return arms.length >= 4 || (arms.length === 3 && arms.some((a) => a.type === 2));
}

/** Snapshot of every signalised node for traffic and (later) signal props. */
export interface SignalArm { dx: number; dz: number; ns: boolean }
export interface SignalInfo { id: number; x: number; z: number; arms: SignalArm[] }

export function signalNodes(w: World): SignalInfo[] {
  const out: SignalInfo[] = [];
  for (const node of w.nodes) {
    const arms = nodeArms(w, node.id);
    if (arms.length >= 4 || (arms.length === 3 && arms.some((a) => a.type === 2))) {
      out.push({
        id: node.id, x: node.x, z: node.z,
        arms: arms.map((a) => ({ dx: a.dx, dz: a.dz, ns: Math.abs(a.dx) <= Math.abs(a.dz) })),
      });
    }
  }
  return out;
}

/** Two-phase cycle, deterministic in `tick` (game seconds): 8 s per phase. */
export function signalPhase(tick: number): 0 | 1 {
  return (Math.floor(tick / 8) % 2) as 0 | 1;
}

/** Does arm `armIdx` (into nodeArms order) have green at `tick`? */
export function armHasGreen(w: World, nodeId: number, armIdx: number, tick: number): boolean {
  const arms = nodeArms(w, nodeId);
  const arm = arms[armIdx];
  if (!arm || !hasSignal(w, nodeId)) return true;
  const eastWest = Math.abs(arm.dx) > Math.abs(arm.dz);
  return eastWest ? signalPhase(tick) === 1 : signalPhase(tick) === 0;
}

/**
 * Is a vehicle on `tile` heading (hx, hz) about to enter a signalised node
 * against a red light? Data for traffic.ts; the poles/heads render later.
 */
export function redHold(w: World, tick: number, tile: number, hx: number, hz: number): boolean {
  if (hx === 0 && hz === 0) return false;
  const hl = Math.hypot(hx, hz) || 1;
  const nx = hx / hl, nz = hz / hl;
  const cx = (tile % w.size) + 0.5, cz = ((tile / w.size) | 0) + 0.5;
  for (const node of w.nodes) {
    if (!hasSignal(w, node.id)) continue;
    const vx = node.x - cx, vz = node.z - cz;
    const d = Math.hypot(vx, vz);
    if (d > 1.7 || d < 1e-6) continue;
    if ((vx * nx + vz * nz) / d < 0.5) continue; // not heading at this node
    const arms = nodeArms(w, node.id);
    let best = 0, bd = -Infinity;
    for (let i = 0; i < arms.length; i++) {
      // The arm being travelled: its outward direction opposes the heading.
      const s = -(arms[i].dx * nx + arms[i].dz * nz);
      if (s > bd) { bd = s; best = i; }
    }
    if (bd > 0.3 && !armHasGreen(w, node.id, best, tick)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- load

/**
 * Rebuild the node graph from the segment list. Saves whose segments already
 * carry consistent a/b adopt them verbatim (round trips stay exact); anything
 * else (old saves) is re-added through the graph so T-junctions and crossings
 * heal into nodes.
 */
export function rebuildNodes(w: World): void {
  if (adoptNodes(w)) return;
  const keep = w.segments.map((s) => ({ type: s.type as RoadType, pts: s.pts, fixed: s.fixed }));
  w.segments = [];
  w.nodes = [];
  w.nextNodeId = 1;
  for (const s of keep) addSegmentKeepId(w, s.type, s.pts, 0, s.fixed);
  let maxSeg = 0;
  for (const s of w.segments) maxSeg = Math.max(maxSeg, s.id);
  w.nextSegmentId = Math.max(w.nextSegmentId, maxSeg + 1);
  for (const n of w.nodes) w.nextNodeId = Math.max(w.nextNodeId, n.id + 1);
}

/**
 * Re-add one saved segment through the graph (load path for old saves only).
 * Ids are renumbered; nothing outside the graph references them.
 */
function addSegmentKeepId(w: World, type: RoadType, pts: Pt[], _id: number, fixed?: boolean): void {
  addSegment(w, type, pts, { fixed });
}

/** Adopt saved a/b when every segment references consistent nodes. */
function adoptNodes(w: World): boolean {
  const byId = new Map<number, Pt[]>();
  for (const s of w.segments) {
    if (!Number.isInteger(s.a) || !Number.isInteger(s.b) || s.a <= 0 || s.b <= 0) return false;
    const pa = s.pts[0], pb = s.pts[s.pts.length - 1];
    const ea = byId.get(s.a) ?? [];
    ea.push(pa);
    byId.set(s.a, ea);
    const eb = byId.get(s.b) ?? [];
    eb.push(pb);
    byId.set(s.b, eb);
  }
  const nodes: RoadNode[] = [];
  let maxId = 0;
  for (const [id, ends] of byId) {
    const mx = ends.reduce((v, p) => v + p.x, 0) / ends.length;
    const mz = ends.reduce((v, p) => v + p.z, 0) / ends.length;
    if (!ends.every((p) => dist(p.x, p.z, mx, mz) <= SNAP_RADIUS)) return false;
    // A shared node id must not join two ends of the same segment unless it is a pad.
    nodes.push({ id, x: mx, z: mz, segs: [] });
    maxId = Math.max(maxId, id);
  }
  // Node ids are issued sequentially, so id order is creation order.
  nodes.sort((a, b) => a.id - b.id);
  w.nodes = nodes;
  w.nextNodeId = Math.max(w.nextNodeId, maxId + 1, 1);
  for (const n of w.nodes) {
    n.segs = w.segments.filter((s) => s.a === n.id || s.b === n.id).map((s) => s.id);
  }
  return true;
}
