/**
 * Junction builder (docs/process/07-junction-builder.md, P0 amendment).
 *
 * Pure derived geometry: per-node layout with layered rings, per-side trims,
 * fillets, lot anchors and diagnostics. P2 scope: end (square cap), middle,
 * bend, transition and T/cross templates through ONE shared fillet routine;
 * crosswalks, stop lines, guide dashes, connectors and clear zones land in
 * P4+. The renderer and traffic keep using the incumbent machinery until P7.
 *
 * Conventions (all settled in the P0 amendment):
 * - units are tiles; ring vertices are 1e-3 quantised; rings are stored open
 *   (no duplicated closure point) and wound CCW (positive signed area);
 * - trims are corridor arclengths measured from the node INTO the segment
 *   (always >= 0; dead-end trims are +B, not -B);
 * - layers are exact uniform outward offsets: asphalt 0, kerb +kerb,
 *   sidewalk +kerb+sidewalk, boundary +kerb+sidewalk+clearance. At a convex
 *   corner the fillet centre sits outside the asphalt, so concentric arcs
 *   SHRINK outward (R, R-kerb, ...); a layer below 0.05 radius chamfers;
 * - classification and rings use ground arms only; bridge/tunnel arms are
 *   listed in excludedArms (their ribbons run to the node centre).
 */
import {
  baseRoadType, curvePoints, segElevation,
  type Pt, type RoadSegment, type RoadType, type World,
} from "./world";
import { nodeArms, nodeById, segById } from "./roads";
import { corridorsOf, profileOf } from "./corridor";
import { buildLaneConnectors, type LaneArrow, type LaneConnector } from "./lanes";

// ---------------------------------------------------------------- constants

/** Template membership: within 8 degrees of the template angles. */
export const TEMPLATE_TOL = (8 * Math.PI) / 180;
/** Two arms this close to opposition count as a straight pair (butt joint). */
export const STRAIGHT_TOL = 0.09;
/** Fillets below this radius become diagnosed chamfers (never dropped arcs). */
export const R_FLOOR = 0.2;
/** Outer layer below this radius chamfers (straight segment, same trims). */
export const LAYER_MIN_RADIUS = 0.05;
/** Arms closer than this merge (no sliver wedge). */
// A smaller threshold still leaves the offset mouths crossing after 1e-3
// quantisation.  Five degrees is the smallest tested gap that leaves room for
// a kerb return; narrower approaches are represented as a single mouth.
export const MERGE_GAP = (5 * Math.PI) / 180;
/** Minimum visible asphalt ribbon between two junction pads. */
const MIN_RIBBON = 0.12;
/** Crosswalk + stop-bar clearance required before end markings may coexist. */
const MARKING_RIBBON = 0.72;

/** Kerb return radius at the asphalt edge, by road class (07 recipe table). */
export function cornerRadiusFor(type: RoadType): number {
  const b = baseRoadType(type);
  return b === 1 ? 0.45 : b === 2 ? 0.6 : 1.2;
}

/** Boundary clearance outside the sidewalk, by road class. */
export function clearanceFor(type: RoadType): number {
  return baseRoadType(type) === 3 ? 0.25 : 0.1;
}

// ---------------------------------------------------------------- types

export type JunctionKind =
  | "end" | "middle" | "bend" | "transition" | "junction" | "roundabout" | "non-ground";
export type JunctionTemplate =
  | "end-square" | "straight" | "bend" | "tee" | "cross" | "general" | "none";
export type JunctionLayerName = "asphalt" | "kerb" | "sidewalk" | "boundary";

export interface JunctionTrimSet {
  asphalt: number;
  kerb: number;
  sidewalk: number;
  boundary: number;
}

export interface JunctionArm {
  segId: number;
  end: "a" | "b";
  type: RoadType;
  /** Unit tangent away from the node (outward). */
  dx: number;
  dz: number;
  angle: number;
  trimNeg: JunctionTrimSet;
  trimPos: JunctionTrimSet;
  /** The facing junction leaves too little ribbon for independent end marks. */
  markingsSuppressed?: boolean;
}

export type FilletKind = "convex" | "reflex" | "straight" | "merged";

export interface JunctionFillet {
  gapIndex: number;
  aSeg: number;
  bSeg: number;
  kind: FilletKind;
  /** Gap angle between arm centrelines, radians. */
  theta: number;
  rNominal: number;
  /** Effective radius (convex corner R, or reflex inner-arc r); 0 when N/A. */
  rEff: number;
  chamfered: boolean;
  /** Arc centre O (convex) or inner-arc centre (reflex), asphalt layer; null
   * when chamfered/straight/merged. */
  centre: Pt | null;
  /** Arc sweep (radians, signed) and sample steps; 0 when not an arc. */
  sweep: number;
  steps: number;
}

export interface LotAnchor {
  segId: number;
  end: "a" | "b";
  side: -1 | 1;
  /** Corridor arclength from the node into the segment: rows start here. */
  s: number;
}

export interface JunctionDiagnostic {
  code: string;
  detail?: string;
}

export interface ExcludedArm {
  segId: number;
  end: "a" | "b";
  layer: string;
}

/** Marker quad (crosswalk, stop line, guide dash); populated from P4 on. */
export interface MarkingQuad {
  kind: string;
  pts: [Pt, Pt, Pt, Pt];
}

export interface JunctionLayout {
  nodeId: number;
  kind: JunctionKind;
  template: JunctionTemplate;
  centre: Pt;
  /** Ground arms in angle order. */
  arms: JunctionArm[];
  asphalt: Pt[];
  kerbOuter: Pt[];
  sidewalkOuter: Pt[];
  boundary: Pt[];
  fillets: JunctionFillet[];
  lotAnchors: LotAnchor[];
  excludedArms: ExcludedArm[];
  /** P4+: emitted empty until markings land. */
  crosswalks: MarkingQuad[];
  stopLines: MarkingQuad[];
  guides: MarkingQuad[];
  clearZones: Pt[][];
  /** Derived drivable centre paths, keyed by arm and lane; never saved. */
  connectors: LaneConnector[];
  /** Allowed turn arrows for each inbound lane; exported for road markings. */
  laneArrows: LaneArrow[];
  hash: string;
  diagnostics: JunctionDiagnostic[];
}

// ---------------------------------------------------------------- math

const q = (n: number): number => Math.round(n * 1000) / 1000;
const qpt = (p: Pt): Pt => ({ x: q(p.x), z: q(p.z) });

function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], r = ring[(i + 1) % ring.length];
    a += p.x * r.z - r.x * p.z;
  }
  return a / 2;
}

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function onSeg(a: Pt, b: Pt, c: Pt, eps: number): boolean {
  return Math.min(a.x, c.x) - eps <= b.x && b.x <= Math.max(a.x, c.x) + eps &&
    Math.min(a.z, c.z) - eps <= b.z && b.z <= Math.max(a.z, c.z) + eps;
}

/** True when segments p1p2 and p3p4 intersect or touch (tolerance eps). */
function segsTouch(p1: Pt, p2: Pt, p3: Pt, p4: Pt, eps: number): boolean {
  const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
  if (Math.abs(d1) <= eps && onSeg(p3, p1, p4, eps)) return true;
  if (Math.abs(d2) <= eps && onSeg(p3, p2, p4, eps)) return true;
  if (Math.abs(d3) <= eps && onSeg(p1, p3, p2, eps)) return true;
  if (Math.abs(d4) <= eps && onSeg(p1, p4, p2, eps)) return true;
  return false;
}

/**
 * True when two edges from DIFFERENT layers properly cross with more than
 * 1e-3 clearance on both straddles. Contacts and sub-grid crossings are
 * legal nesting: mouth/back edges share stations across layers, and the
 * independent 1e-3 quantisation wobbles them by up to ~0.0007 — below the
 * representation precision, like the vertex check's own 1e-3 tolerance.
 */
function edgesProperCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
  const lb = Math.hypot(p4.x - p3.x, p4.z - p3.z) || 1;
  const la = Math.hypot(p2.x - p1.x, p2.z - p1.z) || 1;
  const t = 1e-3;
  const s1 = (d1 / lb > t && d2 / lb < -t) || (d1 / lb < -t && d2 / lb > t);
  const s2 = (d3 / la > t && d4 / la < -t) || (d3 / la < -t && d4 / la > t);
  return s1 && s2;
}

function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x, vz = b.z - a.z;
  const l2 = vx * vx + vz * vz;
  const u = l2 <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / l2));
  return Math.hypot(p.x - (a.x + vx * u), p.z - (a.z + vz * u));
}

function distToRing(p: Pt, ring: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    best = Math.min(best, pointSegDist(p, ring[i], ring[(i + 1) % ring.length]));
  }
  return best;
}

function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > p.z) !== (b.z > p.z) &&
      p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function lineHit(
  px: number, pz: number, dx: number, dz: number,
  qx: number, qz: number, ex: number, ez: number,
): Pt | null {
  const denom = dx * ez - dz * ex;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((qx - px) * ez - (qz - pz) * ex) / denom;
  return { x: px + dx * t, z: pz + dz * t };
}

/** Arc step bound for sagitta <= 1e-3: d <= 2*acos(1 - 1e-3/R). */
function arcStepMax(r: number): number {
  if (r <= 1e-3) return Math.PI;
  return 2 * Math.acos(Math.min(1, Math.max(-1, 1 - 1e-3 / r)));
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------- arms & gaps

interface JArm {
  segId: number;
  end: "a" | "b";
  type: RoadType;
  dx: number;
  dz: number;
  angle: number;
  h: number;
  kerb: number;
  sidewalk: number;
  clearance: number;
  R: number;
}

function toJArm(
  segId: number, end: "a" | "b", type: RoadType, dx: number, dz: number, angle: number,
): JArm {
  const p = profileOf(type);
  return {
    segId, end, type, dx, dz, angle,
    h: p.asphaltHalf, kerb: p.kerb, sidewalk: p.sidewalk,
    clearance: clearanceFor(type), R: cornerRadiusFor(type),
  };
}

function armsAt(w: World, nodeId: number): { ground: JArm[]; excluded: ExcludedArm[] } {
  const node = nodeById(w, nodeId);
  if (!node) return { ground: [], excluded: [] };
  const ground: JArm[] = [];
  const excluded: ExcludedArm[] = [];
  for (const a of nodeArms(w, nodeId)) {
    const seg = segById(w, a.segId);
    const layer = seg ? segElevation(seg) : "ground";
    if (layer !== "ground") {
      excluded.push({ segId: a.segId, end: a.end, layer });
      continue;
    }
    ground.push(toJArm(a.segId, a.end, a.type, a.dx, a.dz, a.angle));
  }
  ground.sort((x, y) => x.angle - y.angle || x.segId - y.segId);
  excluded.sort((x, y) => x.segId - y.segId);
  return { ground, excluded };
}

interface Gap {
  i: number;
  j: number;
  gap: number;
  kind: FilletKind;
  sideA: -1 | 1;
  sideB: -1 | 1;
}

function gapsOf(arms: JArm[]): Gap[] {
  const n = arms.length;
  const out: Gap[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let g = arms[j].angle - arms[i].angle;
    while (g <= 0) g += 2 * Math.PI;
    const mid = arms[i].angle + g / 2;
    const ix = Math.cos(mid), iz = Math.sin(mid);
    const sideA = ((-arms[i].dz * ix + arms[i].dx * iz) >= 0 ? 1 : -1) as -1 | 1;
    const sideB = ((-arms[j].dz * ix + arms[j].dx * iz) >= 0 ? 1 : -1) as -1 | 1;
    const kind: FilletKind =
      g < MERGE_GAP ? "merged"
      : Math.abs(g - Math.PI) < STRAIGHT_TOL ? "straight"
      : g < Math.PI ? "convex" : "reflex";
    out.push({ i, j, gap: g, kind, sideA, sideB });
  }
  return out;
}

// ---------------------------------------------------------------- corners

interface Nominal {
  tA: number;
  tB: number;
  ox: number;
  oz: number;
  ok: boolean;
}

/**
 * The shared corner solution: offset-line intersection with EACH arm's own
 * half-width. Reflex corners anchor at the ray starts (inner arcs, trims 0);
 * straight/merged gaps have no corner. No budget, no chamfer: the
 * neighbour-trim oracle for the joint budget.
 */
function nominalCorner(cx: number, cz: number, a: JArm, b: JArm, g: Gap): Nominal {
  const nax = -a.dz * g.sideA, naz = a.dx * g.sideA;
  const nbx = -b.dz * g.sideB, nbz = b.dx * g.sideB;
  if (g.kind !== "convex") {
    return { tA: 0, tB: 0, ox: cx, oz: cz, ok: true };
  }
  const R = Math.max(a.R, b.R);
  const o = lineHit(
    cx + nax * (a.h + R), cz + naz * (a.h + R), a.dx, a.dz,
    cx + nbx * (b.h + R), cz + nbz * (b.h + R), b.dx, b.dz,
  );
  if (!o) return { tA: 0, tB: 0, ox: cx, oz: cz, ok: false };
  return {
    tA: (o.x - cx - nax * a.h) * a.dx + (o.z - cz - naz * a.h) * a.dz,
    tB: (o.x - cx - nbx * b.h) * b.dx + (o.z - cz - nbz * b.h) * b.dz,
    ox: o.x, oz: o.z, ok: true,
  };
}

function segLength(w: World, seg: RoadSegment): number {
  const c = corridorsOf(w).bySeg.get(seg.id);
  if (c && c.centre.length > 1) return c.centre[c.centre.length - 1].s;
  const pts = curvePoints(seg.pts, 0.25);
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return L;
}

/** Per-node corner nominals, shared across a junctionsOf pass (each segment end
 * is budgeted once here and once from its neighbour; without the cache every
 * lookup recomputes arms, gaps and nominals). */
interface NodeNoms {
  ground: JArm[]; excluded: ExcludedArm[]; gaps: Gap[]; noms: Nominal[];
}
function getNoms(w: World, nodeId: number, cache?: Map<number, NodeNoms>): NodeNoms | null {
  const hit = cache?.get(nodeId);
  if (hit) return hit;
  const node = nodeById(w, nodeId);
  if (!node) return null;
  const { ground, excluded } = armsAt(w, nodeId);
  const gaps = gapsOf(ground);
  const noms = gaps.map((g) => nominalCorner(node.x, node.z, ground[g.i], ground[g.j], g));
  const out: NodeNoms = { ground, excluded, gaps, noms };
  cache?.set(nodeId, out);
  return out;
}

/** Nominal (unbudgeted) trim of one segment end on one side; 0 when the end
 * has no corner there. Side flips at the far end (same physical edge). */
function nominalTrimAt(
  w: World, nodeId: number, segId: number, side: -1 | 1, cache?: Map<number, NodeNoms>,
): number {
  const nn = getNoms(w, nodeId, cache);
  if (!nn) return 0;
  const ground = nn.ground;
  const idx = ground.findIndex((a) => a.segId === segId);
  if (idx < 0) return 0;
  if (ground.length < 2) {
    const p = profileOf(ground[idx].type);
    return Math.max(p.kerb + p.sidewalk, 0.1);
  }
  for (let k = 0; k < nn.gaps.length; k++) {
    const g = nn.gaps[k];
    const hitA = g.i === idx && g.sideA === side;
    const hitB = g.j === idx && g.sideB === side;
    if (!hitA && !hitB) continue;
    const n = nn.noms[k];
    if (!n.ok) return 0;
    return Math.max(0, hitA ? n.tA : n.tB);
  }
  return 0;
}

/** Joint two-end share of L for one side (P0.2 item 2). */
function allowance(L: number, tNom: number, tNbr: number, ribbon = 0): number {
  if (tNom <= 1e-9) return 0;
  const denom = tNom + Math.max(0, tNbr);
  if (denom <= 1e-9) return Math.max(0, L - ribbon);
  return Math.max(0, L - ribbon) * (tNom / denom);
}

/** A visible ribbon is only meaningful between two actual junction pads;
 * ordinary junction-to-end runs keep their established cap behaviour. */
function ribbonReserve(w: World, nodeId: number, otherId: number, cache?: Map<number, NodeNoms>): number {
  const here = getNoms(w, nodeId, cache)?.ground.length ?? 0;
  const there = getNoms(w, otherId, cache)?.ground.length ?? 0;
  return here >= 3 && there >= 3 ? MIN_RIBBON : 0;
}

interface FinalCorner {
  rEff: number;
  chamfered: boolean;
  tA: number;
  tB: number;
  ox: number;
  oz: number;
}

/** Apply the segment budget to one convex corner: shrink R, else chamfer. */
function finalizeConvex(
  cx: number, cz: number, a: JArm, b: JArm, g: Gap, nom: Nominal,
  allowA: number, allowB: number, diags: JunctionDiagnostic[],
): FinalCorner {
  const R = Math.max(a.R, b.R);
  if (nom.tA <= allowA + 1e-9 && nom.tB <= allowB + 1e-9) {
    return { rEff: R, chamfered: false, tA: Math.max(0, nom.tA), tB: Math.max(0, nom.tB), ox: nom.ox, oz: nom.oz };
  }
  const tanH = Math.tan(g.gap / 2);
  const rEff = Math.min(R, allowA * tanH - a.h, allowB * tanH - b.h);
  if (rEff >= R_FLOOR) {
    diags.push({ code: "radius-shrunk", detail: `arms ${a.segId}/${b.segId} R ${R.toFixed(2)}->${rEff.toFixed(3)}` });
    const nax = -a.dz * g.sideA, naz = a.dx * g.sideA;
    const nbx = -b.dz * g.sideB, nbz = b.dx * g.sideB;
    const o = lineHit(
      cx + nax * (a.h + rEff), cz + naz * (a.h + rEff), a.dx, a.dz,
      cx + nbx * (b.h + rEff), cz + nbz * (b.h + rEff), b.dx, b.dz,
    );
    if (o) {
      return {
        rEff, chamfered: false,
        tA: Math.max(0, (o.x - cx - nax * a.h) * a.dx + (o.z - cz - naz * a.h) * a.dz),
        tB: Math.max(0, (o.x - cx - nbx * b.h) * b.dx + (o.z - cz - nbz * b.h) * b.dz),
        ox: o.x, oz: o.z,
      };
    }
  }
  diags.push({
    code: "chamfered-corner",
    detail: `arms ${a.segId}/${b.segId} theta ${(g.gap * 180 / Math.PI).toFixed(1)} rEff ${rEff.toFixed(3)}`,
  });
  return {
    rEff, chamfered: true,
    tA: Math.min(Math.max(0, nom.tA), allowA),
    tB: Math.min(Math.max(0, nom.tB), allowB),
    ox: nom.ox, oz: nom.oz,
  };
}

/** Sample the arc from pa to pb around (ox,oz); endpoints stay exact. */
function arcPoints(
  ox: number, oz: number, r: number, pa: Pt, pb: Pt, dirSign: -1 | 1,
): { pts: Pt[]; sweep: number; steps: number } {
  const a0 = Math.atan2(pa.z - oz, pa.x - ox);
  const a1 = Math.atan2(pb.z - oz, pb.x - ox);
  let d = a1 - a0;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  const sweep = dirSign * Math.abs(d);
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / arcStepMax(r)));
  const pts: Pt[] = [];
  for (let k = 0; k <= steps; k++) {
    const a = a0 + (sweep * k) / steps;
    pts.push({ x: ox + r * Math.cos(a), z: oz + r * Math.sin(a) });
  }
  pts[0] = { ...pa };
  pts[pts.length - 1] = { ...pb };
  return { pts, sweep, steps };
}

/**
 * Pick the arc direction by construction: a convex fillet midpoint sits on
 * the SAME side of its chord as the node (it cuts the corner toward the
 * node); an inner-arc or dead-end U midpoint sits on the OPPOSITE side (it
 * bulges away from the node). A side test, not a distance test: both
 * candidate midpoints sit on the circle, so distances cannot discriminate
 * (notably for inner arcs centred at the node itself).
 */
function pickSweepDir(
  ox: number, oz: number, r: number, pa: Pt, pb: Pt, cx: number, cz: number, wantOpposite: boolean,
): -1 | 1 {
  const chord = { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 };
  const ccx = cx - chord.x, ccz = cz - chord.z;
  for (const s of [-1, 1] as const) {
    const { pts } = arcPoints(ox, oz, r, pa, pb, s);
    const mid = pts[Math.floor(pts.length / 2)];
    const dot = (mid.x - chord.x) * ccx + (mid.z - chord.z) * ccz;
    if (wantOpposite ? dot < 0 : dot > 0) return s;
  }
  return -1;
}

// ---------------------------------------------------------------- rings

const LAYERS: { name: JunctionLayerName; off: (a: JArm) => number }[] = [
  { name: "asphalt", off: (a) => a.h },
  { name: "kerb", off: (a) => a.h + a.kerb },
  { name: "sidewalk", off: (a) => a.h + a.kerb + a.sidewalk },
  { name: "boundary", off: (a) => a.h + a.kerb + a.sidewalk + a.clearance },
];

function footOnLine(p: Pt, lx: number, lz: number, dx: number, dz: number): Pt {
  const t = (p.x - lx) * dx + (p.z - lz) * dz;
  return { x: lx + dx * t, z: lz + dz * t };
}

function finalizeRing(pts: Pt[]): Pt[] {
  const clean = pts.filter((p, k) => k === 0 || p.x !== pts[k - 1].x || p.z !== pts[k - 1].z);
  if (clean.length > 1) {
    const f = clean[0], l = clean[clean.length - 1];
    if (f.x === l.x && f.z === l.z) clean.pop();
  }
  if (clean.length >= 3 && signedArea(clean) < 0) clean.reverse();
  return clean;
}

function emptyTrims(): JunctionTrimSet {
  return { asphalt: 0, kerb: 0, sidewalk: 0, boundary: 0 };
}

interface CornerPts {
  eA: Pt;
  eB: Pt;
  tA: number;
  tB: number;
  interior: Pt[];
  sweep: number;
  steps: number;
  ox: number;
  oz: number;
  rho: number;
  /** True for mitered outer layers (route via their own miter station). */
  miter: boolean;
}

function classify(ground: JArm[], gaps: Gap[]): { kind: JunctionKind; template: JunctionTemplate } {
  if (ground.length === 1) return { kind: "end", template: "end-square" };
  if (ground.length === 2) {
    const straight = gaps.some((g) => g.kind === "straight");
    const same = ground[0].h === ground[1].h &&
      ground[0].kerb === ground[1].kerb && ground[0].sidewalk === ground[1].sidewalk;
    if (straight && same) return { kind: "middle", template: "straight" };
    if (straight) return { kind: "transition", template: "straight" };
    return same
      ? { kind: "bend", template: "bend" }
      : { kind: "transition", template: "bend" };
  }
  if (ground.length === 3) {
    const degs = gaps.map((g) => (g.gap * 180) / Math.PI).sort((x, y) => x - y);
    const tol = (TEMPLATE_TOL * 180) / Math.PI;
    const tee = Math.abs(degs[0] - 90) < tol && Math.abs(degs[1] - 90) < tol && Math.abs(degs[2] - 180) < tol;
    return { kind: "junction", template: tee ? "tee" : "general" };
  }
  if (ground.length === 4) {
    const cross = gaps.every((g) => Math.abs(g.gap - Math.PI / 2) < TEMPLATE_TOL);
    return { kind: "junction", template: cross ? "cross" : "general" };
  }
  return { kind: "junction", template: "general" };
}

/**
 * Square dead-end cap (P0.7): stations measured from the node INTO the segment
 * (arm direction). Cap plane at the node (s = 0); ribbons end B before it, so
 * the asphalt rectangle spans s ∈ [0, B] and abuts the ribbon ends edge to
 * edge. Kerb/sidewalk/boundary wrap the tip as a U OUTSIDE (legs from the
 * mouth at s = B back to s = 0, quarter arcs around the tip corners, joined
 * across at s = -r).
 */
function buildEndCap(
  cx: number, cz: number, a: JArm, B: number,
): { rings: Pt[][]; } {
  const P = (s: number, l: number): Pt => ({
    x: cx + a.dx * s + -a.dz * l,
    z: cz + a.dz * s + a.dx * l,
  });
  const h = a.h;
  const rings: Pt[][] = [[P(0, -h), P(B, -h), P(B, h), P(0, h)]];
  const uRing = (o: number, r: number): Pt[] => {
    const pts: Pt[] = [P(B, -o), P(0, -o)];
    if (r > 1e-9) {
      const k1 = P(0, -h), e1 = P(-r, -h);
      const s1 = pickSweepDir(k1.x, k1.z, r, P(0, -o), e1, cx, cz, true);
      pts.push(...arcPoints(k1.x, k1.z, r, P(0, -o), e1, s1).pts.slice(1));
      pts.push(P(-r, h));
      const k2 = P(0, h), s2pt = P(-r, h), e2 = P(0, o);
      const s2 = pickSweepDir(k2.x, k2.z, r, s2pt, e2, cx, cz, true);
      pts.push(...arcPoints(k2.x, k2.z, r, s2pt, e2, s2).pts.slice(1));
    } else {
      pts.push(P(0, -h), P(0, h));
    }
    pts.push(P(B, o));
    return pts;
  };
  const k = a.kerb, sw = a.sidewalk, clr = a.clearance;
  rings.push(a.kerb > 0 ? uRing(h + k, k) : []);
  rings.push(a.sidewalk > 0 ? uRing(h + k + sw, k + sw) : []);
  rings.push(uRing(h + k + sw + clr, k + sw + clr));
  return { rings: rings.map((r) => (r.length === 0 ? r : finalizeRing(r.map(qpt)))) };
}

function buildAnchors(
  cx: number, cz: number, arms: JArm[], boundary: Pt[],
): LotAnchor[] {
  if (boundary.length === 0) return [];
  const out: LotAnchor[] = [];
  for (const a of arms) {
    const inX = a.dx;
    const inZ = a.dz;
    for (const side of [-1, 1] as const) {
      const nx = -a.dz * side, nz = a.dx * side;
      let best = 0;
      for (const v of boundary) {
        if ((v.x - cx) * nx + (v.z - cz) * nz < -1e-6) continue;
        const s = (v.x - cx) * inX + (v.z - cz) * inZ;
        if (s > best) best = s;
      }
      out.push({ segId: a.segId, end: a.end, side, s: q(Math.max(0, best)) });
    }
  }
  out.sort((x, y) => x.segId - y.segId || x.side - y.side);
  return out;
}

function hashLayout(l: JunctionLayout): string {
  const parts = [l.kind, l.template, `${l.centre.x.toFixed(3)},${l.centre.z.toFixed(3)}`];
  const t = (s: JunctionTrimSet) =>
    `${s.asphalt.toFixed(3)},${s.kerb.toFixed(3)},${s.sidewalk.toFixed(3)},${s.boundary.toFixed(3)}`;
  for (const a of l.arms) parts.push(`${a.dx.toFixed(4)},${a.dz.toFixed(4)}|${t(a.trimNeg)}|${t(a.trimPos)}|${a.markingsSuppressed ? "short" : "marks"}`);
  for (const r of [l.asphalt, l.kerbOuter, l.sidewalkOuter, l.boundary]) {
    parts.push(r.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`).join(";"));
  }
  return fnv1a(parts.join("#"));
}

// ---------------------------------------------------------------- builder

export function buildJunction(
  w: World, nodeId: number, nomsCache?: Map<number, NodeNoms>,
): JunctionLayout | null {
  const node = nodeById(w, nodeId);
  if (!node) return null;
  const cx = node.x, cz = node.z;
  const nn = getNoms(w, nodeId, nomsCache);
  if (!nn) return null;
  const ground = nn.ground, excluded = nn.excluded;
  const diags: JunctionDiagnostic[] = [];
  if (excluded.length > 0) {
    diags.push({ code: "layer-excluded", detail: `segs ${excluded.map((e) => e.segId).join(",")}` });
  }
  // Copies: the builder reclassifies degenerate gaps ("merged") below, which
  // must not leak into the cached nominals.
  const gaps = nn.gaps.map((g) => ({ ...g }));
  for (const g of gaps) {
    if (g.kind === "merged") {
      diags.push({ code: "min-gap-merged", detail: `gap ${g.i}-${g.j} ${((g.gap * 180) / Math.PI).toFixed(2)}deg` });
    }
  }
  const base: Omit<JunctionLayout, "kind" | "template" | "arms" | "asphalt" | "kerbOuter" | "sidewalkOuter" | "boundary" | "fillets" | "lotAnchors" | "hash"> = {
    nodeId, centre: { x: cx, z: cz }, excludedArms: excluded,
    crosswalks: [], stopLines: [], guides: [], clearZones: [], connectors: [], laneArrows: [], diagnostics: diags,
  };

  // --- no ground arms: pad node (P5) or non-ground node.
  if (ground.length === 0) {
    const pad = node.segs.length > 0 && excluded.length === 0;
    diags.push(pad
      ? { code: "pad-node-deferred", detail: "zero-length segs; square cap lands in P5" }
      : { code: "non-ground-node", detail: node.segs.length === 0 ? "orphan" : "no ground arms" });
    const layout: JunctionLayout = {
      ...base, kind: pad ? "end" : "non-ground", template: "none", arms: [],
      asphalt: [], kerbOuter: [], sidewalkOuter: [], boundary: [],
      fillets: [], lotAnchors: [], hash: "",
    };
    layout.hash = hashLayout(layout);
    return layout;
  }

  // --- dead end: square cap.
  if (ground.length === 1) {
    const a = ground[0];
    const seg = segById(w, a.segId)!;
    const L = segLength(w, seg);
    const nbr = a.end === "a" ? seg.b : seg.a;
    const Bnom = Math.max(a.kerb + a.sidewalk, 0.1);
    const tNbr = nbr === nodeId
      ? 0
      : Math.max(nominalTrimAt(w, nbr, a.segId, 1, nomsCache), nominalTrimAt(w, nbr, a.segId, -1, nomsCache));
    const Ballow = allowance(L, Bnom, tNbr, ribbonReserve(w, nodeId, nbr, nomsCache));
    let B = Bnom;
    if (Ballow < Bnom - 1e-9) {
      diags.push({ code: "trim-clamped", detail: `cap ${Bnom.toFixed(2)}->${Ballow.toFixed(3)}` });
      B = Math.max(Ballow, 0.05);
    }
    const Bq = q(B);
    const { rings } = buildEndCap(cx, cz, a, Bq);
    const set = { asphalt: Bq, kerb: Bq, sidewalk: Bq, boundary: Bq };
    const layout: JunctionLayout = {
      ...base, kind: "end", template: "end-square",
      arms: [{
        segId: a.segId, end: a.end, type: a.type, dx: a.dx, dz: a.dz, angle: a.angle,
        trimNeg: { ...set }, trimPos: { ...set },
      }],
      asphalt: rings[0], kerbOuter: rings[1], sidewalkOuter: rings[2], boundary: rings[3],
      fillets: [], lotAnchors: buildAnchors(cx, cz, ground, rings[3]), hash: "",
    };
    layout.hash = hashLayout(layout);
    return layout;
  }

  const { kind, template } = classify(ground, gaps);

  // --- middle / straight transition: a straight joint, no node geometry.
  // The straight transition is a hard width step (no taper in P2; taper is
  // P5): both ribbons butt at the node and the narrower cap sits inside the
  // wider one, so there is nothing to patch. The kind still matters for P4
  // (lane merge markings) and traffic (lane drops).
  if (kind === "middle" || (kind === "transition" && template === "straight")) {
    const layout: JunctionLayout = {
      ...base, kind, template,
      arms: ground.map((a) => ({
        segId: a.segId, end: a.end, type: a.type, dx: a.dx, dz: a.dz, angle: a.angle,
        trimNeg: emptyTrims(), trimPos: emptyTrims(),
      })),
      asphalt: [], kerbOuter: [], sidewalkOuter: [], boundary: [],
      fillets: gaps.map((g, k) => ({
        gapIndex: k, aSeg: ground[g.i].segId, bSeg: ground[g.j].segId,
        kind: g.kind, theta: q(g.gap), rNominal: 0, rEff: 0,
        chamfered: false, centre: null, sweep: 0, steps: 0,
      })),
      lotAnchors: [], hash: "",
    };
    layout.hash = hashLayout(layout);
    return layout;
  }

  // --- bend / transition / junction: nominals, budget, per-layer corners.
  const noms = nn.noms.map((n) => ({ ...n }));
  gaps.forEach((g, k) => {
    if (!noms[k].ok) {
      g.kind = "merged";
      noms[k] = { tA: 0, tB: 0, ox: cx, oz: cz, ok: true };
      diags.push({ code: "trim-clamped", detail: `gap ${k} degenerate` });
    }
  });
  const allowA = new Map<number, number>();
  const allowB = new Map<number, number>();
  gaps.forEach((g, k) => {
    if (g.kind !== "convex") return;
    const a = ground[g.i], b = ground[g.j];
    const segA = segById(w, a.segId)!, segB = segById(w, b.segId)!;
    const nbrA = a.end === "a" ? segA.b : segA.a;
    const nbrB = b.end === "a" ? segB.b : segB.a;
    const flipA = (g.sideA === 1 ? -1 : 1) as -1 | 1;
    const flipB = (g.sideB === 1 ? -1 : 1) as -1 | 1;
    allowA.set(k, allowance(segLength(w, segA), noms[k].tA, nbrA === nodeId ? 0 : nominalTrimAt(w, nbrA, a.segId, flipA, nomsCache), ribbonReserve(w, nodeId, nbrA, nomsCache)));
    allowB.set(k, allowance(segLength(w, segB), noms[k].tB, nbrB === nodeId ? 0 : nominalTrimAt(w, nbrB, b.segId, flipB, nomsCache), ribbonReserve(w, nodeId, nbrB, nomsCache)));
  });

  interface GapFinal {
    rNom: number; rEff: number; chamfered: boolean;
    tA: number; tB: number; mx: number; mz: number;
  }
  const finals: GapFinal[] = gaps.map((g, k) => {
    const a = ground[g.i], b = ground[g.j];
    if (g.kind === "convex") {
      const f = finalizeConvex(cx, cz, a, b, g, noms[k], allowA.get(k)!, allowB.get(k)!, diags);
      return { rNom: Math.max(a.R, b.R), rEff: f.rEff, chamfered: f.chamfered, tA: f.tA, tB: f.tB, mx: f.ox, mz: f.oz };
    }
    return { rNom: 0, rEff: 0, chamfered: false, tA: 0, tB: 0, mx: cx, mz: cz };
  });

  const layerData: CornerPts[][] = LAYERS.map(() => []);
  gaps.forEach((g, k) => {
    const a = ground[g.i], b = ground[g.j], f = finals[k];
    const nax = -a.dz * g.sideA, naz = a.dx * g.sideA;
    const nbx = -b.dz * g.sideB, nbz = b.dx * g.sideB;
    const E = (arm: JArm, nx: number, nz: number, t: number, off: number): Pt => ({
      x: cx + arm.dx * t + nx * off,
      z: cz + arm.dz * t + nz * off,
    });
    LAYERS.forEach((L, li) => {
      const offA = L.off(a), offB = L.off(b);
      if (f && (g.kind === "straight" || g.kind === "merged")) {
        layerData[li].push({ eA: E(a, nax, naz, 0, offA), eB: E(b, nbx, nbz, 0, offB), tA: 0, tB: 0, interior: [], sweep: 0, steps: 0, ox: cx, oz: cz, rho: 0, miter: false });
        return;
      }
      if (g.kind === "reflex") {
        // Inner arc tangent at both ray starts (trims stay 0); asymmetric
        // corners and degenerate radii chamfer straight across.
        const P0 = E(a, nax, naz, 0, offA);
        const P1 = E(b, nbx, nbz, 0, offB);
        const sym = a.h === b.h && a.kerb === b.kerb && a.sidewalk === b.sidewalk;
        const chamfer = (): void => {
          layerData[li].push({ eA: P0, eB: P1, tA: 0, tB: 0, interior: [], sweep: 0, steps: 0, ox: cx, oz: cz, rho: 0, miter: false });
        };
        if (!sym) {
          if (li === 0) diags.push({ code: "chamfered-corner", detail: "asymmetric reflex" });
          chamfer();
          return;
        }
        const o = lineHit(P0.x, P0.z, nax, naz, P1.x, P1.z, nbx, nbz);
        const r0 = o ? Math.hypot(P0.x - o.x, P0.z - o.z) : 0;
        const r1 = o ? Math.hypot(P1.x - o.x, P1.z - o.z) : 0;
        if (!o || Math.abs(r0 - r1) > 1e-6 || r0 < LAYER_MIN_RADIUS) {
          diags.push({ code: "chamfered-corner", detail: `layer ${L.name} reflex r ${r0.toFixed(3)}` });
          chamfer();
          return;
        }
        const dir = pickSweepDir(o.x, o.z, r0, P0, P1, cx, cz, true);
        const arc = arcPoints(o.x, o.z, r0, P0, P1, dir);
        layerData[li].push({
          eA: P0, eB: P1, tA: 0, tB: 0, interior: arc.pts.slice(1, -1),
          sweep: arc.sweep, steps: arc.steps, ox: o.x, oz: o.z, rho: r0, miter: false,
        });
        return;
      }
      // Convex: the asphalt layer arcs (or chamfers at its budgeted trims);
      // outer layers arc while their radius allows, else MITER along their
      // own edges (a chamfer at asphalt stations would swing past the
      // neighbouring mouth on acute wedges).
      const rho = f.chamfered ? 0 : f.rEff - Math.max(offA - a.h, offB - b.h);
      if (li === 0) {
        if (!f.chamfered) {
          const o = lineHit(
            cx + nax * (offA + rho), cz + naz * (offA + rho), a.dx, a.dz,
            cx + nbx * (offB + rho), cz + nbz * (offB + rho), b.dx, b.dz,
          );
          if (o) {
            const fA = footOnLine(o, cx + nax * offA, cz + naz * offA, a.dx, a.dz);
            const fB = footOnLine(o, cx + nbx * offB, cz + nbz * offB, b.dx, b.dz);
            const tA = q((fA.x - cx - nax * offA) * a.dx + (fA.z - cz - naz * offA) * a.dz);
            const tB = q((fB.x - cx - nbx * offB) * b.dx + (fB.z - cz - nbz * offB) * b.dz);
            // An asymmetric outer offset can put the mathematical tangent
            // behind a node.  It is not a usable trim: use the budgeted
            // chamfer/miter stations instead of folding the ring backwards.
            if (tA < 0 || tB < 0) {
              diags.push({ code: "trim-clamped", detail: `layer ${L.name} tangent behind node` });
              layerData[li].push({
                eA: E(a, nax, naz, q(f.tA), offA), eB: E(b, nbx, nbz, q(f.tB), offB),
                tA: q(f.tA), tB: q(f.tB), interior: [], sweep: 0, steps: 0,
                ox: f.mx, oz: f.mz, rho: 0, miter: false,
              });
              return;
            }
            const eA = E(a, nax, naz, tA, offA);
            const eB = E(b, nbx, nbz, tB, offB);
            const dir = pickSweepDir(o.x, o.z, rho, eA, eB, cx, cz, false);
            const arc = arcPoints(o.x, o.z, rho, eA, eB, dir);
            layerData[li].push({
              eA, eB, tA, tB, interior: arc.pts.slice(1, -1),
              sweep: arc.sweep, steps: arc.steps, ox: o.x, oz: o.z, rho, miter: false,
            });
            return;
          }
        }
        layerData[li].push({
          eA: E(a, nax, naz, q(f.tA), offA), eB: E(b, nbx, nbz, q(f.tB), offB),
          tA: q(f.tA), tB: q(f.tB), interior: [], sweep: 0, steps: 0, ox: f.mx, oz: f.mz, rho: 0, miter: false,
        });
        return;
      }
      if (!f.chamfered && rho >= LAYER_MIN_RADIUS) {
        const o = lineHit(
          cx + nax * (offA + rho), cz + naz * (offA + rho), a.dx, a.dz,
          cx + nbx * (offB + rho), cz + nbz * (offB + rho), b.dx, b.dz,
        );
        if (o) {
          const fA = footOnLine(o, cx + nax * offA, cz + naz * offA, a.dx, a.dz);
          const fB = footOnLine(o, cx + nbx * offB, cz + nbz * offB, b.dx, b.dz);
          const tA = q((fA.x - cx - nax * offA) * a.dx + (fA.z - cz - naz * offA) * a.dz);
          const tB = q((fB.x - cx - nbx * offB) * b.dx + (fB.z - cz - nbz * offB) * b.dz);
          if (tA < 0 || tB < 0) {
            diags.push({ code: "trim-clamped", detail: `layer ${L.name} tangent behind node` });
            layerData[li].push({
              eA: E(a, nax, naz, q(f.tA), offA), eB: E(b, nbx, nbz, q(f.tB), offB),
              tA: q(f.tA), tB: q(f.tB), interior: [], sweep: 0, steps: 0,
              ox: f.mx, oz: f.mz, rho: 0, miter: false,
            });
            return;
          }
          const eA = E(a, nax, naz, tA, offA);
          const eB = E(b, nbx, nbz, tB, offB);
          const dir = pickSweepDir(o.x, o.z, rho, eA, eB, cx, cz, false);
          const arc = arcPoints(o.x, o.z, rho, eA, eB, dir);
          layerData[li].push({
            eA, eB, tA, tB, interior: arc.pts.slice(1, -1),
            sweep: arc.sweep, steps: arc.steps, ox: o.x, oz: o.z, rho, miter: false,
          });
          return;
        }
      }
      diags.push({ code: "chamfered-corner", detail: `layer ${L.name} miter rho ${rho.toFixed(3)}` });
      const m = lineHit(
        cx + nax * offA, cz + naz * offA, a.dx, a.dz,
        cx + nbx * offB, cz + nbz * offB, b.dx, b.dz,
      );
      if (!m) {
        diags.push({ code: "trim-clamped", detail: `layer ${L.name} miter degenerate` });
        layerData[li].push({
          eA: E(a, nax, naz, q(f.tA), offA), eB: E(b, nbx, nbz, q(f.tB), offB),
          tA: q(f.tA), tB: q(f.tB), interior: [], sweep: 0, steps: 0, ox: f.mx, oz: f.mz, rho: 0, miter: false,
        });
        return;
      }
      const mtA = q((m.x - cx - nax * offA) * a.dx + (m.z - cz - naz * offA) * a.dz);
      const mtB = q((m.x - cx - nbx * offB) * b.dx + (m.z - cz - nbz * offB) * b.dz);
      layerData[li].push({
        eA: E(a, nax, naz, mtA, offA), eB: E(b, nbx, nbz, mtB, offB), tA: mtA, tB: mtB,
        interior: [{ x: m.x, z: m.z }], sweep: 0, steps: 0, ox: m.x, oz: m.z, rho: 0, miter: true,
      });
    });
  });

  // Mouth stations per arm per layer for the arc/chamfer/straight layers:
  // own trims, chained outward-monotonic (an outer across-edge must never
  // cut an inner along-edge at mixed-profile mouths). Mitered layers route
  // via their own miter stations instead.
  const computeMouth = (): number[][] => {
    const ownMax: number[][] = ground.map(() => LAYERS.map(() => 0));
    gaps.forEach((g, k) => {
      LAYERS.forEach((_, li) => {
        if (layerData[li][k].miter) return;
        ownMax[g.i][li] = Math.max(ownMax[g.i][li], layerData[li][k].tA);
        ownMax[g.j][li] = Math.max(ownMax[g.j][li], layerData[li][k].tB);
      });
    });
    const mouth: number[][] = ground.map(() => LAYERS.map(() => 0));
    ground.forEach((_a, idx) => {
      LAYERS.forEach((_, li) => {
        const prev = li > 0 ? mouth[idx][li - 1] : 0;
        mouth[idx][li] = Math.max(ownMax[idx][li], prev);
      });
    });
    return mouth;
  };
  let mouth = computeMouth();

  // Fit check, iterated to a fixed point: a convex corner whose flanking
  // mouths would cross strictly inside the road (or whose trim point swings
  // past the neighbour mouth line) cannot host mouths at its trims — pushing
  // the mouths out traces past the edge-line miter into an X-cross, so the
  // layer miters instead (single corner at the edge intersection, trims from
  // the miter projections, flagged when over allowance). Miters fit by
  // construction (mouths touch exactly at the shared miter vertex).
  const miterCorner = (g: Gap, k: number, li: number): void => {
    const a = ground[g.i], b = ground[g.j];
    const offA = LAYERS[li].off(a), offB = LAYERS[li].off(b);
    const nax = -a.dz * g.sideA, naz = a.dx * g.sideA;
    const nbx = -b.dz * g.sideB, nbz = b.dx * g.sideB;
    const m = lineHit(
      cx + nax * offA, cz + naz * offA, a.dx, a.dz,
      cx + nbx * offB, cz + nbz * offB, b.dx, b.dz,
    ) ?? { x: cx, z: cz };
    const tA = Math.max(0, q((m.x - cx - nax * offA) * a.dx + (m.z - cz - naz * offA) * a.dz));
    const tB = Math.max(0, q((m.x - cx - nbx * offB) * b.dx + (m.z - cz - nbz * offB) * b.dz));
    layerData[li][k] = {
      eA: { x: cx + a.dx * tA + nax * offA, z: cz + a.dz * tA + naz * offA },
      eB: { x: cx + b.dx * tB + nbx * offB, z: cz + b.dz * tB + nbz * offB },
      tA, tB, interior: [{ x: m.x, z: m.z }], sweep: 0, steps: 0, ox: m.x, oz: m.z, rho: 0, miter: true,
    };
  };
  for (let round = 0; round < gaps.length + 1; round++) {
    let converted = false;
    gaps.forEach((g, k) => {
      if (g.kind !== "convex") return;
      const a = ground[g.i], b = ground[g.j];
      LAYERS.forEach((L, li) => {
        const c = layerData[li][k];
        if (c.miter) return;
        const offA = L.off(a), offB = L.off(b);
        const mA = mouth[g.i][li], mB = mouth[g.j][li];
        // Mouth lines cross strictly inside both spans?
        const nax = -a.dz * g.sideA, naz = a.dx * g.sideA;
        const nbx = -b.dz * g.sideB, nbz = b.dx * g.sideB;
        // Solve C+d_a*mA+n_a*v = C+d_b*mB+n_b*u for (v,u).
        const ex = b.dx * mB - a.dx * mA, ez = b.dz * mB - a.dz * mA;
        const det = nax * -nbz - naz * -nbx;
        let cross = false;
        if (Math.abs(det) > 1e-9) {
          const v = (ex * -nbz - ez * -nbx) / det;
          const u = (nax * ez - naz * ex) / det;
          cross = Math.abs(v) < offA - 1e-3 && Math.abs(u) < offB - 1e-3;
        }
        // Either trim point strictly past the neighbour mouth line in-span?
        const sEbOnA = (c.eB.x - cx) * a.dx + (c.eB.z - cz) * a.dz;
        const lEbOnA = (c.eB.x - cx) * -a.dz + (c.eB.z - cz) * a.dx;
        const sEaOnB = (c.eA.x - cx) * b.dx + (c.eA.z - cz) * b.dz;
        const lEaOnB = (c.eA.x - cx) * -b.dz + (c.eA.z - cz) * b.dx;
        const swing = (sEbOnA > mA + 1e-3 && Math.abs(lEbOnA) < offA - 1e-3) ||
          (sEaOnB > mB + 1e-3 && Math.abs(lEaOnB) < offB - 1e-3);
        if (!cross && !swing) return;
        miterCorner(g, k, li);
        converted = true;
        if (li === 0) {
          finals[k].chamfered = true;
          const overA = layerData[0][k].tA - (allowA.get(k) ?? 0);
          const overB = layerData[0][k].tB - (allowB.get(k) ?? 0);
          const over = Math.max(overA, overB);
          diags.push({
            code: "chamfered-corner",
            detail: `arms ${a.segId}/${b.segId} miter unfittable mouths` +
              (over > 1e-9 ? ` (over allowance by ${over.toFixed(3)})` : ""),
          });
        } else {
          diags.push({ code: "chamfered-corner", detail: `layer ${L.name} miter unfittable mouths` });
        }
      });
    });
    if (!converted) break;
    mouth = computeMouth();
  }

  const fillets: JunctionFillet[] = [];
  gaps.forEach((g, k) => {
    const a = ground[g.i], b = ground[g.j], f = finals[k];
    const al = layerData[0][k];
    const arch = g.kind === "convex" ? !f.chamfered && al.steps > 0 : g.kind === "reflex" && al.steps > 0;
    fillets.push({
      gapIndex: k, aSeg: a.segId, bSeg: b.segId, kind: g.kind, theta: q(g.gap),
      rNominal: g.kind === "convex" ? q(f.rNom) : 0,
      rEff: g.kind === "convex" ? q(f.rEff) : g.kind === "reflex" ? q(al.rho) : 0,
      chamfered: (g.kind === "convex" || g.kind === "reflex") && !arch,
      centre: arch ? qpt({ x: al.ox, z: al.oz }) : null,
      sweep: q(al.sweep), steps: al.steps,
    });
  });

  const trimMap = new Map<string, JunctionTrimSet>();
  gaps.forEach((g, k) => {
    const setA = trimMap.get(`${g.i}:${g.sideA}`) ?? emptyTrims();
    const setB = trimMap.get(`${g.j}:${g.sideB}`) ?? emptyTrims();
    LAYERS.forEach((L, li) => {
      setA[L.name] = q(layerData[li][k].tA);
      setB[L.name] = q(layerData[li][k].tB);
    });
    trimMap.set(`${g.i}:${g.sideA}`, setA);
    trimMap.set(`${g.j}:${g.sideB}`, setB);
  });
  const arms: JunctionArm[] = ground.map((a, idx) => ({
    segId: a.segId, end: a.end, type: a.type, dx: a.dx, dz: a.dz, angle: a.angle,
    trimNeg: trimMap.get(`${idx}:-1`) ?? emptyTrims(),
    trimPos: trimMap.get(`${idx}:1`) ?? emptyTrims(),
  }));
  // Markings occupy substantially more longitudinal space than the bare
  // pad.  Keep the pad solve geometric (0.12 visible ribbon), then make a
  // second, conservative decision for end marks.  Both endpoint layouts make
  // the same decision from their shared nominal solve, so no zebra/stop bar
  // can pile up in the remaining short ribbon.
  for (const arm of arms) {
    const seg = segById(w, arm.segId)!;
    const other = arm.end === "a" ? seg.b : seg.a;
    if (ribbonReserve(w, nodeId, other, nomsCache) === 0) continue;
    const here = Math.max(arm.trimNeg.asphalt, arm.trimPos.asphalt);
    const there = Math.max(
      nominalTrimAt(w, other, arm.segId, -1, nomsCache),
      nominalTrimAt(w, other, arm.segId, 1, nomsCache),
    );
    if (segLength(w, seg) - here - there < MARKING_RIBBON - 1e-9) {
      arm.markingsSuppressed = true;
      diags.push({ code: "short-segment", detail: `seg ${arm.segId}: shared ribbon ${(segLength(w, seg) - here - there).toFixed(3)}` });
    }
  }

  const rings = LAYERS.map((L, li) => {
    if (L.name === "kerb" && ground.every((a) => a.kerb === 0)) return [];
    if (L.name === "sidewalk" && ground.every((a) => a.sidewalk === 0)) return [];
    const off = (idx: number): number => L.off(ground[idx]);
    const pts: Pt[] = [];
    layerData[li].forEach((c, k) => {
      const g = gaps[k];
      pts.push(qpt(c.eA));
      for (const p of c.interior) pts.push(qpt(p));
      pts.push(qpt(c.eB));
      // Mouth step on the shared arm, routed via the arm's mouth station:
      // along the low-side edge out, across at the station. (Equal trims
      // collapse to a straight mouth via dedupe.)
      const nk = (k + 1) % layerData[li].length;
      const nc = layerData[li][nk];
      const arm = ground[g.j];
      const tB = c.tB, tA = nc.tA;
      const miterStep = c.miter || nc.miter;
      const needStep = gaps[nk].sideA !== g.sideB &&
        (miterStep ? Math.abs(tB - tA) > 1e-9 : mouth[g.j][li] > Math.min(tB, tA) + 1e-9);
      if (needStep) {
        const mx = miterStep ? Math.max(tB, tA) : mouth[g.j][li];
        const nB = { x: -arm.dz * g.sideB, z: arm.dx * g.sideB };
        const nA = { x: -arm.dz * gaps[nk].sideA, z: arm.dx * gaps[nk].sideA };
        pts.push(qpt({ x: cx + arm.dx * mx + nB.x * off(g.j), z: cz + arm.dz * mx + nB.z * off(g.j) }));
        pts.push(qpt({ x: cx + arm.dx * mx + nA.x * off(g.j), z: cz + arm.dz * mx + nA.z * off(g.j) }));
      }
    });
    return finalizeRing(pts);
  });

  const layout: JunctionLayout = {
    ...base, kind, template, arms,
    asphalt: rings[0], kerbOuter: rings[1], sidewalkOuter: rings[2], boundary: rings[3],
    fillets, lotAnchors: buildAnchors(cx, cz, ground, rings[3]), hash: "",
  };
  // Ported lane graph is derived from the exact post-budget pad, never the
  // tile raster.  This keeps every accepted vehicle path inside asphalt.
  const laneGraph = buildLaneConnectors(layout.centre, layout.arms.map(a => ({
    segId: a.segId, end: a.end, type: a.type, dx: a.dx, dz: a.dz,
    trim: Math.max(a.trimNeg.asphalt, a.trimPos.asphalt),
  })), layout.asphalt);
  layout.connectors = laneGraph.connectors;
  layout.laneArrows = laneGraph.arrows;
  layout.hash = hashLayout(layout);
  return layout;
}

// ---------------------------------------------------------------- checker

const KNOWN_CODES = new Set([
  "radius-shrunk", "chamfered-corner", "trim-clamped", "crosswalk-dropped",
  "stopline-dropped", "min-gap-merged", "layer-excluded",
  "non-ground-node", "pad-node-deferred", "short-segment",
]);

function nearestVert(ring: Pt[], p: Pt): Pt {
  let best = ring[0], bd = Infinity;
  for (const v of ring) {
    const d = (v.x - p.x) ** 2 + (v.z - p.z) ** 2;
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

/**
 * The geometric invariants (07 section "Invariants" as amended by P0.6).
 * Returns the failure list; empty means the layout is sound. Used by tests
 * and (from P7) the debug overlay.
 */
export function checkJunction(l: JunctionLayout): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const err = (m: string): void => { errors.push(m); };
  const cx = l.centre.x, cz = l.centre.z;
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) err("centre not finite");
  for (let i = 1; i < l.arms.length; i++) {
    if (l.arms[i].angle < l.arms[i - 1].angle - 1e-12) err(`arms not angle-sorted at ${i}`);
  }
  const n = l.arms.length;
  const has = (c: string): boolean => l.diagnostics.some((d) => d.code === c);
  if (l.kind === "end" && n > 1) err("end with more than 1 arm");
  if (l.kind === "end" && n === 0 && !has("pad-node-deferred")) err("end with 0 arms but no pad diagnostic");
  if ((l.kind === "middle" || l.kind === "bend" || l.kind === "transition") && n !== 2) {
    err(`${l.kind} must have 2 arms`);
  }
  if (l.kind === "junction" && n < 3) err("junction must have 3+ arms");
  if (l.kind === "non-ground" && (n !== 0 || !has("non-ground-node"))) {
    err("non-ground must have 0 arms and its diagnostic");
  }
  const emptyRings = l.asphalt.length === 0 && l.kerbOuter.length === 0 &&
    l.sidewalkOuter.length === 0 && l.boundary.length === 0;
  const noGeom = l.kind === "middle" || l.kind === "non-ground" || l.template === "none" ||
    (l.kind === "transition" && l.template === "straight");
  if (noGeom && !emptyRings) {
    err("middle/straight-transition/non-ground/none must have empty rings");
  }
  if (noGeom && l.lotAnchors.length !== 0) {
    err("middle/straight-transition/non-ground/none must have no lot anchors");
  }
  for (const d of l.diagnostics) {
    if (!KNOWN_CODES.has(d.code)) err(`unknown diagnostic code ${d.code}`);
  }

  // Rings: quantised, closed, CCW, simple.
  const rings: [string, Pt[]][] = [
    ["asphalt", l.asphalt], ["kerb", l.kerbOuter],
    ["sidewalk", l.sidewalkOuter], ["boundary", l.boundary],
  ];
  for (const [name, r] of rings) {
    if (r.length === 0) continue;
    if (r.length < 3) { err(`${name}: fewer than 3 vertices`); continue; }
    for (const p of r) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) { err(`${name}: non-finite vertex`); break; }
      if (Math.abs(p.x * 1000 - Math.round(p.x * 1000)) > 1e-6 ||
        Math.abs(p.z * 1000 - Math.round(p.z * 1000)) > 1e-6) {
        err(`${name}: vertex off the 1e-3 grid`); break;
      }
    }
    if (signedArea(r) <= 1e-6) err(`${name}: not CCW (area ${signedArea(r).toFixed(6)})`);
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if (Math.hypot(a.x - b.x, a.z - b.z) < 1e-9) { err(`${name}: duplicate consecutive vertices`); break; }
    }
    let simple = true;
    for (let i = 0; i < r.length && simple; i++) {
      for (let j = i + 1; j < r.length && simple; j++) {
        if (j === i + 1 || (i === 0 && j === r.length - 1)) continue;
        if (r[i].x === r[j].x && r[i].z === r[j].z) { err(`${name}: repeated vertex`); simple = false; break; }
        if (segsTouch(r[i], r[(i + 1) % r.length], r[j], r[(j + 1) % r.length], 1e-9)) {
          err(`${name}: self-intersection at edges ${i},${j}`); simple = false;
        }
      }
    }
  }

  // Nesting across consecutive non-empty layers.
  const nonEmpty = rings.filter(([, r]) => r.length > 0);
  for (let k = 1; k < nonEmpty.length; k++) {
    const [ni, inner] = nonEmpty[k - 1], [no, outer] = nonEmpty[k];
    for (const p of inner) {
      if (distToRing(p, outer) <= 1e-3) continue;
      if (!pointInRing(p, outer)) { err(`${ni} vertex outside ${no}`); break; }
    }
    let crossed = false;
    for (let i = 0; i < inner.length && !crossed; i++) {
      for (let j = 0; j < outer.length && !crossed; j++) {
        if (edgesProperCross(inner[i], inner[(i + 1) % inner.length], outer[j], outer[(j + 1) % outer.length])) {
          err(`${ni}/${no} edges cross`); crossed = true;
        }
      }
    }
  }

  // Mouths: each arm-side edge point at its trim lies on the asphalt ring.
  // All trims measure from the node into the segment (dead-end caps span
  // s ∈ [0, B] along the arm), so no end-kind sign flip applies.
  if (l.asphalt.length > 0) {
    for (const a of l.arms) {
      const h = profileOf(a.type).asphaltHalf;
      for (const side of [-1, 1] as const) {
        const t = side < 0 ? a.trimNeg.asphalt : a.trimPos.asphalt;
        if (!Number.isFinite(t)) { err(`seg ${a.segId} side ${side}: trim not finite`); continue; }
        const e = {
          x: cx + a.dx * t + -a.dz * side * h,
          z: cz + a.dz * t + a.dx * side * h,
        };
        const d = distToRing(e, l.asphalt);
        if (d > 1e-3) err(`mouth seg ${a.segId} side ${side}: edge point ${d.toFixed(4)} off the asphalt ring`);
      }
      for (const s of [a.trimNeg, a.trimPos]) {
        for (const v of [s.asphalt, s.kerb, s.sidewalk, s.boundary]) {
          if (!Number.isFinite(v)) { err(`seg ${a.segId}: trim not finite`); break; }
          if (Math.abs(v * 1000 - Math.round(v * 1000)) > 1e-6) err(`seg ${a.segId}: trim off the 1e-3 grid`);
        }
      }
    }
  }

  // Fillets: tangency (2e-3 post-quantise), radius floor, sagitta bound.
  for (const f of l.fillets) {
    if (f.kind === "straight" || f.kind === "merged") continue;
    const A = l.arms.find((a) => a.segId === f.aSeg);
    const B = l.arms.find((a) => a.segId === f.bSeg);
    if (!A || !B) { err("fillet references a missing arm"); continue; }
    let dAB = B.angle - A.angle;
    while (dAB <= 0) dAB += 2 * Math.PI;
    const mid = Math.abs(dAB - f.theta) < 1e-3 ? A.angle + f.theta / 2 : A.angle - f.theta / 2;
    const ix = Math.cos(mid), iz = Math.sin(mid);
    const sideA = (-A.dz * ix + A.dx * iz) >= 0 ? 1 : -1;
    const sideB = (-B.dz * ix + B.dx * iz) >= 0 ? 1 : -1;
    const hA = profileOf(A.type).asphaltHalf, hB = profileOf(B.type).asphaltHalf;
    const tA = (sideA < 0 ? A.trimNeg : A.trimPos).asphalt;
    const tB = (sideB < 0 ? B.trimNeg : B.trimPos).asphalt;
    const nax = -A.dz * sideA, naz = A.dx * sideA;
    const nbx = -B.dz * sideB, nbz = B.dx * sideB;
    const eA = { x: cx + A.dx * tA + nax * hA, z: cz + A.dz * tA + naz * hA };
    const eB = { x: cx + B.dx * tB + nbx * hB, z: cz + B.dz * tB + nbz * hB };
    if (f.kind === "reflex") {
      // Inner arc tangent at the ray starts: trims are 0, the stored centre
      // is equidistant, and the sweep obeys the sagitta bound.
      if (Math.abs(tA) > 1e-9 || Math.abs(tB) > 1e-9) err("reflex trims must be 0");
      if (!f.chamfered) {
        if (!f.centre) { err("reflex fillet without centre"); continue; }
        const rA = Math.hypot(eA.x - f.centre.x, eA.z - f.centre.z);
        const rB = Math.hypot(eB.x - f.centre.x, eB.z - f.centre.z);
        if (Math.abs(rA - f.rEff) > 2e-3 || Math.abs(rB - f.rEff) > 2e-3) {
          err("reflex tangent points off the inner arc");
        }
        if (Math.abs(rA - rB) > 2e-3) err("reflex arc centre not equidistant");
        for (const e of [eA, eB]) {
          const v = nearestVert(l.asphalt, e);
          if (Math.hypot(v.x - e.x, v.z - e.z) > 2e-3) { err("reflex tangent point missing from the ring"); break; }
        }
        if (f.steps > 0) {
          const sag = f.rEff * (1 - Math.cos(Math.abs(f.sweep) / (2 * f.steps)));
          if (sag > 1e-3 + 1e-9) err(`reflex arc sagitta ${sag.toExponential(2)} over 1e-3`);
        }
      } else {
        if (f.centre) err("chamfered reflex must not carry an arc centre");
        const mid = { x: (eA.x + eB.x) / 2, z: (eA.z + eB.z) / 2 };
        if (l.asphalt.length > 0 && distToRing(mid, l.asphalt) > 1e-3) {
          err("reflex chamfer midpoint off the asphalt ring");
        }
      }
      continue;
    }
    // Convex.
    if (!f.chamfered) {
      if (f.rEff < R_FLOOR - 1e-9) err(`fillet radius ${f.rEff} below the 0.2 floor`);
      if (f.rEff > f.rNominal + 1e-9) err("fillet radius above nominal");
      if (!f.centre) { err("arc fillet without centre"); continue; }
      const rA = Math.hypot(eA.x - f.centre.x, eA.z - f.centre.z);
      const rB = Math.hypot(eB.x - f.centre.x, eB.z - f.centre.z);
      if (Math.abs(rA - f.rEff) > 2e-3 || Math.abs(rB - f.rEff) > 2e-3) {
        err("fillet tangent points off the arc circle");
      }
      // The stored ring vertices carry the same tangency (not just the
      // recomputed points): nearest stored vertex to each tangent point.
      for (const e of [eA, eB]) {
        const v = nearestVert(l.asphalt, e);
        if (Math.hypot(v.x - e.x, v.z - e.z) > 2e-3) { err("fillet tangent point missing from the ring"); break; }
      }
      if (f.steps > 0) {
        const sag = f.rEff * (1 - Math.cos(Math.abs(f.sweep) / (2 * f.steps)));
        if (sag > 1e-3 + 1e-9) err(`arc sagitta ${sag.toExponential(2)} over 1e-3`);
      }
    } else {
      if (f.centre) err("chamfered fillet must not carry an arc centre");
      const mid = { x: (eA.x + eB.x) / 2, z: (eA.z + eB.z) / 2 };
      if (l.asphalt.length > 0 && distToRing(mid, l.asphalt) > 1e-3) {
        err("chamfer midpoint off the asphalt ring");
      }
    }
  }

  // Anchors: live on their segment, at or past the boundary extent.
  for (const an of l.lotAnchors) {
    const arm = l.arms.find((a) => a.segId === an.segId);
    if (!arm) { err("anchor references a missing arm"); continue; }
    if (!Number.isFinite(an.s) || an.s < -1e-9) { err("anchor s invalid"); continue; }
    if (Math.abs(an.s * 1000 - Math.round(an.s * 1000)) > 1e-6) err("anchor s off the 1e-3 grid");
    if (l.boundary.length > 0) {
      const inX = arm.dx;
      const inZ = arm.dz;
      const nx = -arm.dz * an.side, nz = arm.dx * an.side;
      let best = 0;
      for (const v of l.boundary) {
        if ((v.x - cx) * nx + (v.z - cz) * nz < -1e-6) continue;
        best = Math.max(best, (v.x - cx) * inX + (v.z - cz) * inZ);
      }
      if (an.s < best - 1e-3) err("anchor inside the boundary extent");
    }
  }

  if (hashLayout(l) !== l.hash) err("hash mismatch");
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------- cache

const junctionCache = new WeakMap<World, { rev: number; map: Map<number, JunctionLayout> }>();

/**
 * Every node's layout, rebuilt wholesale when `graphRevision` moves
 * (incremental 1-ring rebuild is P7).
 */
export function junctionsOf(w: World): { graphRevision: number; byNode: Map<number, JunctionLayout> } {
  const rev = w.graphRevision ?? 0;
  const hit = junctionCache.get(w);
  if (hit && hit.rev === rev) return { graphRevision: hit.rev, byNode: hit.map };
  const map = new Map<number, JunctionLayout>();
  const nomsCache = new Map<number, NodeNoms>();
  for (const n of [...w.nodes].sort((a, b) => a.id - b.id)) {
    const l = buildJunction(w, n.id, nomsCache);
    if (l) map.set(n.id, l);
  }
  junctionCache.set(w, { rev, map });
  return { graphRevision: rev, byNode: map };
}
