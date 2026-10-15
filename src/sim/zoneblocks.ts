// Portions adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10): zoning/ZoneGrid.js#_blocked, #_occupied, #_rasterise, #_buildFrame, #_resolveConflicts, #_better.
import {
  baseRoadType, blocksBuilding, curvePoints, heightAt, idx, inBounds, segElevation,
  type Pt, type RoadSegment, type World,
} from "./world";
import {
  BLOCK_MAX_ROWS, CELL_DEPTH, CELL_SLOPE_LIMIT, type CellPose, type CellRef, type Side, type ZoneBlock,
} from "./zonecells";
import { profileOf } from "./corridor";
import { STRAIGHT_TOL, cornerRadiusFor, junctionsOf } from "./junction";
import { zpEnd, zpStart } from "./zoneprof";

const MIGRATE_RADIUS = 0.75;
/**
 * |cos| of the largest angle between an old cell's road and the new cell's road for migration (15 degrees). Splits,
 * merges and small reshapes keep the direction; a road built across a zoned block does not, and CS1 clears the cells
 * it covers instead of re-zoning the new road's own cells (05 §1.6, §1.8): without this, a diagonal drawn through a
 * zoned area came out dotted with rotated zoned cells and lots copied from the old grid.
 */
const MIGRATE_ALIGN = Math.cos((15 * Math.PI) / 180);
/** Clearance around another road's footprint (fable 0.6m / 8). */
const ROAD_CLEARANCE = 0.075;
/** Corner/edge samples are pulled this fraction toward the cell centre (fable S=0.93). */
const SAMPLE_SHRINK = 0.93;
/**
 * Extra corner samples, pulled only 3 % in (05 §1.8). On the trapezoids of tight curves a corner can poke into the
 * road between the 7 % samples; corners sit exactly on the offset curve elsewhere, so this never rejects a cell on a
 * straight road or on the outer side of a curve. Only curved rows pay for them: on a straight frame the 7 % corner
 * gap (0.05 tile) is inside ROAD_CLEARANCE for other roads and exactly on the kerb line for the own road.
 */
const CORNER_SHRINK = 0.97;
const CELL_SAMPLES = 13;
const STRAIGHT_SAMPLES = 9;
/**
 * The exact ring/road tests use the cell pulled 3 % in (0.015 tile from every edge): what the renderer draws inside a
 * cell or lot (pads inset 0.02, kerb strips 0.015 behind the front edge) never reaches that band.
 */
const EXACT_SHRINK = 0.97;
/** Water level threshold matching isLand's 0.05 corner rule. */
const WATER_H = 0.05;

export interface ZoneBlockSet {
  graphRevision: number;
  blocks: Map<string, ZoneBlock>;
  bySeg: Map<number, ZoneBlock[]>;
  /** Spatial index: tile index -> block keys whose cells' centres or corners touch that tile. */
  tileIndex: Map<number, string[]>;
}

export interface MigrationReport { moved: number; dropped: CellRef[]; lotsBroken: number[] }

const setCache = new WeakMap<World, { graphRevision: number; obstacleRevision: number; set: ZoneBlockSet }>();

interface Sampled {
  pts: Pt[];
  cum: number[];
  length: number;
}


/** Rival-cell conflict distance (fable CONFLICT_DIST 6.4m / 8). */
const CONFLICT_DIST = 0.8;

export const cellIndex = (row: number, col: number): number => row * CELL_DEPTH + col;

const blockKey = (seg: number, side: Side, block: number) => `${seg}:${side}:${block}`;

function sample(pts: Pt[], step = 0.25): Sampled {
  if (pts.length === 2) {
    const length = Math.hypot(pts[1].x - pts[0].x, pts[1].z - pts[0].z);
    return { pts, cum: [0, length], length };
  }
  const p = curvePoints(pts, step);
  const cum = new Array<number>(p.length);
  cum[0] = 0;
  for (let i = 1; i < p.length; i++) cum[i] = cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
  return { pts: p, cum, length: cum[cum.length - 1] ?? 0 };
}

function at(s: Sampled, dist: number): CellPose {
  const d = Math.max(0, Math.min(s.length, dist));
  let i = 0;
  while (i < s.cum.length - 2 && s.cum[i + 1] < d) i++;
  const a = s.pts[i], b = s.pts[Math.min(s.pts.length - 1, i + 1)];
  const span = Math.max(1e-9, s.cum[i + 1] - s.cum[i]);
  const u = (d - s.cum[i]) / span;
  let tx = b.x - a.x, tz = b.z - a.z;
  const l = Math.hypot(tx, tz) || 1;
  tx /= l; tz /= l;
  return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, yaw: Math.atan2(tx, tz), tx, tz, nx: -tz, nz: tx };
}

/** Centreline frame extrapolated beyond the ends (so end rows keep full width). */
function atUnclamped(s: Sampled, dist: number): CellPose {
  if (dist < 0) {
    const a = s.pts[0], b = s.pts[Math.min(1, s.pts.length - 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    return { x: a.x + tx * dist, z: a.z + tz * dist, yaw: Math.atan2(tx, tz), tx, tz, nx: -tz, nz: tx };
  }
  if (dist > s.length) {
    const n = s.pts.length, a = s.pts[Math.max(0, n - 2)], b = s.pts[n - 1];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    const over = dist - s.length;
    return { x: b.x + tx * over, z: b.z + tz * over, yaw: Math.atan2(tx, tz), tx, tz, nx: -tz, nz: tx };
  }
  return at(s, dist);
}

/** Minimum cell area as a fraction of 1 tile^2 (fable MIN_AREA_FRAC). */
export const MIN_AREA_FRAC = 0.42;

/** Signed quad area (shoelace / 2). */
export function quadArea(q: Float32Array): number {
  return 0.5 * (
    (q[0] * q[3] - q[2] * q[1]) + (q[2] * q[5] - q[4] * q[3]) +
    (q[4] * q[7] - q[6] * q[5]) + (q[6] * q[1] - q[0] * q[7])
  );
}

function roadHalfWidth(seg: RoadSegment): number {
  return profileOf(seg.type).drawHalf + profileOf(seg.type).sidewalk + profileOf(seg.type).setback;
}

function shapeKey(b: ZoneBlock): string {
  const parts: string[] = [String(b.seg), String(b.side), String(b.block), String(b.rows), String(b.s0), String(b.lat0)];
  for (let i = 0; i < b.frame.length; i++) parts.push(String(Math.round(b.frame[i] * 10000) / 10000));
  return parts.join("|");
}

function zoneable(seg: RoadSegment): boolean {
  return segElevation(seg) === "ground" && baseRoadType(seg.type) !== 3 && roughLength(seg.pts) > 0.05;
}

function roughLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return len;
}

export function blocksForSegment(_w: World, seg: RoadSegment): ZoneBlock[] {
  if (!zoneable(seg)) return [];
  const hw = roadHalfWidth(seg);
  const lat0 = hw + 0.5;
  const s0 = hw < 1 ? 0 : 0.5;
  const len = sample(seg.pts).length;
  const rows = hw < 1 ? Math.floor(len + 0.1) + 1 : Math.floor(len + 0.1);
  if (rows <= 0) return [];
  const nBlocks = Math.ceil(rows / BLOCK_MAX_ROWS);
  const base = Math.floor(rows / nBlocks), extra = rows % nBlocks;
  const sampled = sample(seg.pts);
  const out: ZoneBlock[] = [];
  let rowStart = 0;
  for (let block = 0; block < nBlocks; block++) {
    const blockRows = base + (block < extra ? 1 : 0);
    const s0b = s0 + rowStart;
    const edge = new Float32Array((blockRows + 1) * 4);
    for (let k = 0; k <= blockRows; k++) {
      const p = atUnclamped(sampled, s0b + k - 0.5);
      edge[k * 4] = p.x; edge[k * 4 + 1] = p.z; edge[k * 4 + 2] = p.tx; edge[k * 4 + 3] = p.tz;
    }
    for (const side of [-1, 1] as const) {
      const frame = new Float32Array(blockRows * 4);
      for (let r = 0; r < blockRows; r++) {
        const p = at(sampled, s0 + rowStart + r);
        const lat = side * lat0;
        frame[r * 4] = p.x + lat * p.nx;
        frame[r * 4 + 1] = p.z + lat * p.nz;
        frame[r * 4 + 2] = p.tx;
        frame[r * 4 + 3] = p.tz;
      }
      const n = blockRows * CELL_DEPTH;
      out.push({
        key: blockKey(seg.id, side, block),
        seg: seg.id, side, block, rows: blockRows, s0: s0b, lat0,
        frame, edge: edge.slice(),
        valid: new Uint8Array(n),
        zone: new Uint8Array(n),
        level: new Uint8Array(n),
        lot: new Int32Array(n).fill(-1),
        age: seg.id,
      });
    }
    rowStart += blockRows;
  }
  return out;
}

export function cellPose(b: ZoneBlock, row: number, col: number): CellPose {
  const o = row * 4;
  const tx = b.frame[o + 2], tz = b.frame[o + 3], nx = -tz, nz = tx;
  const lat = b.side * col;
  return { x: b.frame[o] + lat * nx, z: b.frame[o + 1] + lat * nz, yaw: Math.atan2(tx, tz), tx, tz, nx, nz };
}

export function cellCorners(b: ZoneBlock, row: number, col: number, out: Float32Array): void {
  // Trapezoid from the two boundary frames (fable `_buildFrame`); falls back to
  // unit squares for fixtures without an edge table. Straight streets are identical.
  const e = b.edge;
  if (e && e.length >= (b.rows + 1) * 4) {
    const o0 = row * 4, o1 = (row + 1) * 4;
    const x0 = e[o0], z0 = e[o0 + 1], tx0 = e[o0 + 2], tz0 = e[o0 + 3];
    const x1 = e[o1], z1 = e[o1 + 1], tx1 = e[o1 + 2], tz1 = e[o1 + 3];
    const nx0 = -tz0 * b.side, nz0 = tx0 * b.side, nx1 = -tz1 * b.side, nz1 = tx1 * b.side;
    const d0 = b.lat0 - 0.5 + col, d1 = d0 + 1;
    out[0] = x0 + nx0 * d0; out[1] = z0 + nz0 * d0;
    out[2] = x1 + nx1 * d0; out[3] = z1 + nz1 * d0;
    out[4] = x1 + nx1 * d1; out[5] = z1 + nz1 * d1;
    out[6] = x0 + nx0 * d1; out[7] = z0 + nz0 * d1;
    return;
  }
  const p = cellPose(b, row, col);
  const nx = p.nx * b.side, nz = p.nz * b.side;
  const ax = p.tx * 0.5, az = p.tz * 0.5, bx = nx * 0.5, bz = nz * 0.5;
  out[0] = p.x - ax - bx; out[1] = p.z - az - bz;
  out[2] = p.x + ax - bx; out[3] = p.z + az - bz;
  out[4] = p.x + ax + bx; out[5] = p.z + az + bz;
  out[6] = p.x - ax + bx; out[7] = p.z - az + bz;
}

// ---------------------------------------------------------------- per-template cell geometry (zperf)

/**
 * Everything about a block's cells that depends only on its geometry (frame, edge, rows, s0, lat0 and the owner
 * segment's centreline), computed once per block template and shared by every build that reuses the template:
 * centre poses, Float32 corners (cellCorners' output), the area test, the road point of each row (slope test), tile
 * boxes, and the cached conflict neighbours of resolveOverlaps. Frames are never mutated, so the frame array is the key.
 */
interface Geo {
  rows: number;
  n: number;
  seg: number;
  side: Side;
  s0: number;
  lat0: number;
  px: Float64Array;
  pz: Float64Array;
  ptx: Float64Array;
  ptz: Float64Array;
  corners: Float32Array;
  areaOk: Uint8Array;
  /** at(centreline, s0 + r) per row; NaN when the block came without its segment (fixtures). */
  roadX: Float64Array;
  roadZ: Float64Array;
  /** floor of the centre per cell. */
  ftx: Int32Array;
  ftz: Int32Array;
  /** Centre tile box and real box (centres and corners). */
  ctx0: number; ctx1: number; ctz0: number; ctz1: number;
  bx0: number; bx1: number; bz0: number; bz1: number;
  /** Heights grid points any heightAt/isLand of the terrain test can read (clamped like heightAt), for `hgSize`. */
  hgx0: number; hgx1: number; hgz0: number; hgz1: number; hgSize: number;
  /** Conflict neighbours (CSR over cells): neighbour k's of geos, valid while no geo near it appeared or vanished. */
  nbrStart: Int32Array | null;
  nbrGeo: Geo[];
  nbrK: Int32Array;
  /** The alive (pre-resolution valid) mask the lists were built with. */
  nbrAlive: Uint8Array | null;
  /** Global cell base in the current build, and the build that set it. */
  gbase: number;
  gstamp: number;
}

const geoOfFrame = new WeakMap<Float32Array, Geo>();

/** Cell centres of a block (exactly cellPose(b, row, col).x/.z at index cellIndex(row, col)), cached per template. */
export function cellCentres(b: ZoneBlock): { px: Float64Array; pz: Float64Array } {
  return geoOf(b);
}

function geoOf(b: ZoneBlock, centreline?: Sampled): Geo {
  const hit = geoOfFrame.get(b.frame);
  if (hit && hit.rows === b.rows && (!centreline || !Number.isNaN(hit.roadX[0] ?? 0))) return hit;
  const n = b.rows * CELL_DEPTH;
  const g: Geo = {
    rows: b.rows, n, seg: b.seg, side: b.side, s0: b.s0, lat0: b.lat0,
    px: new Float64Array(n), pz: new Float64Array(n), ptx: new Float64Array(n), ptz: new Float64Array(n),
    corners: new Float32Array(n * 8), areaOk: new Uint8Array(n),
    roadX: new Float64Array(b.rows).fill(NaN), roadZ: new Float64Array(b.rows).fill(NaN),
    ftx: new Int32Array(n), ftz: new Int32Array(n),
    ctx0: Infinity, ctx1: -Infinity, ctz0: Infinity, ctz1: -Infinity,
    bx0: Infinity, bx1: -Infinity, bz0: Infinity, bz1: -Infinity,
    hgx0: 0, hgx1: -1, hgz0: 0, hgz1: -1, hgSize: -1,
    nbrStart: null, nbrGeo: [], nbrK: new Int32Array(0), nbrAlive: null, gbase: -1, gstamp: -1,
  };
  const corners = new Float32Array(8);
  for (let r = 0; r < b.rows; r++) {
    if (centreline) { const road = at(centreline, b.s0 + r); g.roadX[r] = road.x; g.roadZ[r] = road.z; }
    for (let c = 0; c < CELL_DEPTH; c++) {
      const k = cellIndex(r, c);
      const p = cellPose(b, r, c);
      cellCorners(b, r, c, corners);
      g.px[k] = p.x; g.pz[k] = p.z; g.ptx[k] = p.tx; g.ptz[k] = p.tz;
      g.corners.set(corners, k * 8);
      g.areaOk[k] = Math.abs(quadArea(corners)) >= MIN_AREA_FRAC ? 1 : 0;
      const tx = Math.floor(p.x), tz = Math.floor(p.z);
      g.ftx[k] = tx; g.ftz[k] = tz;
      g.ctx0 = Math.min(g.ctx0, tx); g.ctx1 = Math.max(g.ctx1, tx); g.ctz0 = Math.min(g.ctz0, tz); g.ctz1 = Math.max(g.ctz1, tz);
      g.bx0 = Math.min(g.bx0, p.x); g.bx1 = Math.max(g.bx1, p.x); g.bz0 = Math.min(g.bz0, p.z); g.bz1 = Math.max(g.bz1, p.z);
      for (let i = 0; i < 4; i++) {
        g.bx0 = Math.min(g.bx0, corners[i * 2]); g.bx1 = Math.max(g.bx1, corners[i * 2]);
        g.bz0 = Math.min(g.bz0, corners[i * 2 + 1]); g.bz1 = Math.max(g.bz1, corners[i * 2 + 1]);
      }
    }
  }
  geoOfFrame.set(b.frame, g);
  return g;
}



/**
 * Keep-out discs at junctions (fable `_rasterise` node stamp, analytic form).
 * Nodes with >= 3 ground arms get radius max(drawHalf + sidewalk + cornerR).
 * Only a fallback now: validity tests the real junction surface (`junctionKeepOut`), because a disc also
 * removes the cells across the through road from a T stem and the depth-0 cells of every arm near a Y.
 */
export function junctionDiscs(w: World): { x: number; z: number; r: number }[] {
  const byId = new Map(w.segments.map((s) => [s.id, s]));
  const out: { x: number; z: number; r: number }[] = [];
  for (const n of w.nodes) {
    let r = 0, arms = 0;
    for (const id of n.segs) {
      const s = byId.get(id);
      if (!s || segElevation(s) !== "ground") continue;
      arms++;
      const p = profileOf(s.type);
      r = Math.max(r, p.drawHalf + p.sidewalk + cornerRadiusFor(s.type));
    }
    if (arms >= 3 && r > 0) out.push({ x: n.x, z: n.z, r });
  }
  return out;
}

interface KeepOutPoly { xs: Float64Array; zs: Float64Array; minX: number; maxX: number; minZ: number; maxZ: number; mark: number }

/** Junction rings by layout object: junctionsOf keeps a layout object until its node changes. */
const polyOfLayout = new WeakMap<object, KeepOutPoly>();

function keepOutPoly(l: { sidewalkOuter: Pt[] }): KeepOutPoly {
  const hit = polyOfLayout.get(l);
  if (hit) return hit;
  const ring = l.sidewalkOuter;
  const xs = new Float64Array(ring.length), zs = new Float64Array(ring.length);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    xs[i] = ring[i].x; zs[i] = ring[i].z;
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]); minZ = Math.min(minZ, zs[i]); maxZ = Math.max(maxZ, zs[i]);
  }
  const poly = { xs, zs, minX, maxX, minZ, maxZ, mark: 0 };
  polyOfLayout.set(l, poly);
  return poly;
}

/**
 * Hard surface of every junction (05 §1.4 c): the `sidewalkOuter` ring of each node layout (asphalt, kerb returns
 * and sidewalk around the corner). Nodes with >= 3 ground arms but no layout fall back to the disc above.
 */
function junctionKeepOut(w: World): { polys: Map<number, KeepOutPoly>; discs: { x: number; z: number; r: number }[]; nodes: Set<number> } {
  const polys = new Map<number, KeepOutPoly>();
  const nodes = new Set<number>();
  const byNode = junctionsOf(w).byNode;
  for (const l of byNode.values()) {
    const ring = l.sidewalkOuter;
    if (!ring || ring.length < 3) continue;
    nodes.add(l.nodeId);
    polys.set(l.nodeId, keepOutPoly(l));
  }
  const discs = junctionDiscs(w).filter((d) => {
    for (const n of w.nodes) if (n.x === d.x && n.z === d.z) return !nodes.has(n.id);
    return true;
  });
  return { polys, discs, nodes };
}

/** Junction rings by tile (every tile of a ring's floor box), as linked lists over the rings' tile box. */
class PolyGrid {
  readonly next: number[] = [];
  readonly poly: KeepOutPoly[] = [];
  private cells: Int32Array;
  private x0 = 0;
  private z0 = 0;
  private w = 0;
  private h = 0;
  constructor(polys: KeepOutPoly[]) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of polys) {
      x0 = Math.min(x0, Math.floor(p.minX)); x1 = Math.max(x1, Math.floor(p.maxX));
      z0 = Math.min(z0, Math.floor(p.minZ)); z1 = Math.max(z1, Math.floor(p.maxZ));
    }
    if (polys.length) { this.x0 = x0; this.z0 = z0; this.w = x1 - x0 + 1; this.h = z1 - z0 + 1; }
    this.cells = new Int32Array(this.w * this.h).fill(-1);
    for (const p of polys) {
      for (let ty = Math.floor(p.minZ); ty <= Math.floor(p.maxZ); ty++) for (let tx = Math.floor(p.minX); tx <= Math.floor(p.maxX); tx++) {
        const c = (ty - this.z0) * this.w + tx - this.x0;
        this.next.push(this.cells[c]); this.poly.push(p); this.cells[c] = this.next.length - 1;
      }
    }
  }

  /** First entry of tile (tx, tz), -1 when none (follow `next`). */
  head(tx: number, tz: number): number {
    const x = tx - this.x0, z = tz - this.z0;
    return x < 0 || z < 0 || x >= this.w || z >= this.h ? -1 : this.cells[z * this.w + x];
  }
}

function inKeepOut(p: KeepOutPoly, x: number, z: number): boolean {
  if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) return false;
  let inside = false;
  const n = p.xs.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const zi = p.zs[i], zj = p.zs[j];
    if ((zi > z) !== (zj > z) && x < ((p.xs[j] - p.xs[i]) * (z - zi)) / (zj - zi) + p.xs[i]) inside = !inside;
  }
  return inside;
}

/** 13 sample points: centre, 4 corners and 4 edge midpoints pulled 7% inward (fable `_blocked`), 4 corners 3% in. */
function cellSamples(cx: number, cz: number, corners: Float32Array, out: Float32Array): void {
  out[0] = cx; out[1] = cz;
  for (let e = 0; e < 4; e++) {
    const ax = corners[e * 2], az = corners[e * 2 + 1];
    const bx = corners[((e + 1) & 3) * 2], bz = corners[((e + 1) & 3) * 2 + 1];
    out[(1 + e * 2) * 2] = cx + (ax - cx) * SAMPLE_SHRINK;
    out[(1 + e * 2) * 2 + 1] = cz + (az - cz) * SAMPLE_SHRINK;
    const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
    out[(2 + e * 2) * 2] = cx + (mx - cx) * SAMPLE_SHRINK;
    out[(2 + e * 2) * 2 + 1] = cz + (mz - cz) * SAMPLE_SHRINK;
    out[(9 + e) * 2] = cx + (ax - cx) * CORNER_SHRINK;
    out[(9 + e) * 2 + 1] = cz + (az - cz) * CORNER_SHRINK;
  }
}

/** Outward unit tangent of a segment at its end `end` (pointing from the node into the segment). */
function endTangent(seg: RoadSegment, end: "a" | "b"): { x: number; z: number } {
  const p = seg.pts, n = p.length;
  const o = end === "a" ? p[0] : p[n - 1], q = end === "a" ? p[1] : p[n - 2];
  const l = Math.hypot(q.x - o.x, q.z - o.z) || 1;
  return { x: (q.x - o.x) / l, z: (q.z - o.z) / l };
}

/**
 * True when `other` continues `own` straight through a shared node (a split street, or the through road of a T).
 * Its sidewalk is the same kerb line as the own road's, so it gets the own-road limit (body, no clearance):
 * otherwise the row centred on the node is rejected from both sides and the frontage shows a one-cell notch.
 */
function continues(own: RoadSegment, other: RoadSegment): boolean {
  for (const ea of ["a", "b"] as const) for (const eb of ["a", "b"] as const) {
    if (own[ea] !== other[eb]) continue;
    const t0 = endTangent(own, ea), t1 = endTangent(other, eb);
    if (t0.x * t1.x + t0.z * t1.z < -Math.cos(STRAIGHT_TOL)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- validity (incremental, exact)
//
// A cell is valid when its terrain test (area, map, slope, land, facility, corners, water, deck raster: cheap, redone
// on every build because heights and facilities change without a revision) AND its road test (samples against the
// candidate ground roads, junction rings and fallback discs, exact quad tests: the expensive part) pass, then the
// row cut-off runs. The road test is a pure function of the block geometry, the candidate roads (geometry, raster
// tiles, flat ends), the straight continuations of the own segment, the junction rings and discs near the block. It
// is cached per block and reused when none of those changed: a road counts as changed when its type, points, raster
// tiles or flat ends differ from the previous build (or it appeared/vanished), and it can only be a candidate of a
// block whose cell tiles lie within 2 tiles of its raster (the candidate rule below). Rings and discs are matched by
// their tile/real bounding boxes against the block's. So the cached bits are exactly what a full recompute gives.

/** Pieces per chunk of a sampled centreline (chunk bounding boxes skip far pieces in one test). */
const CHUNK = 8;
/**
 * Slack for skipping by bounding box: far beyond float error (samples and shrunk quads are Float32: up to ~1.5e-5
 * off their double position on a 512 map), far below any limit.
 */
const CULL_EPS = 1e-3;

interface RoadRec {
  id: number;
  seg: RoadSegment;
  type: number;
  /** Copies of the inputs, to detect in-place edits (upgrades mutate type and tiles, splits replace points). */
  srcPts: Float64Array;
  srcTiles: Int32Array;
  /** Sampled centreline (exactly `sample(seg.pts).pts`). */
  xs: Float64Array;
  zs: Float64Array;
  n: number;
  /** Chunk bounding boxes: [minX, maxX, minZ, maxZ] per CHUNK pieces. */
  chunks: Float64Array;
  body: number;
  clear: number;
  a: number;
  b: number;
  flatA: boolean;
  flatB: boolean;
  /** Raster tile bounding box. */
  tx0: number; tx1: number; tz0: number; tz1: number;
}

interface BCache { own: RoadRec; geo: Geo; straight: string; bits: Int8Array }

interface ValidityCtx {
  size: number;
  roads: Map<number, RoadRec>;
  polys: Map<number, KeepOutPoly>;
  discs: string;
  discList: { x: number; z: number; r: number }[];
  straight: Map<number, string>;
  bcache: Map<string, BCache>;
  /** Terrain inputs at the previous build (heights grid and the per-tile arrays the terrain test reads). */
  snap: TerrainSnap | null;
  /** Terrain bits per geo from the previous build. */
  terrain: Map<Geo, Uint8Array>;
}

interface TerrainSnap {
  heights: Float32Array; facility: Uint8Array; road: Uint8Array; tunnel: Uint8Array; surface: Uint8Array; deck: Uint8Array;
}

/** Above this many changed heights/tiles every block's terrain is recomputed (matching them all costs more). */
const TERRAIN_CHANGES_MAX = 512;

/**
 * Grid points and tiles whose terrain inputs changed since the previous build (heights and facilities change without
 * any revision: levelling under new roads and zones, terraforming, tests poking arrays). null = everything.
 */
function terrainChanges(ctx: ValidityCtx, w: World): { pts: number[]; tiles: number[] } | null {
  const snap = ctx.snap;
  const fresh = (): TerrainSnap => ({
    heights: w.heights.slice(), facility: w.facility.slice(), road: w.road.slice(),
    tunnel: w.roadTunnel.slice(), surface: w.roadSurface.slice(), deck: w.roadDeck.slice(),
  });
  if (!snap || snap.heights.length !== w.heights.length || snap.facility.length !== w.facility.length) { ctx.snap = fresh(); return null; }
  const pts: number[] = [], tiles: number[] = [];
  let over = false;
  const h = w.heights, sh = snap.heights;
  for (let i = 0; i < h.length; i++) if (h[i] !== sh[i] && !(h[i] !== h[i] && sh[i] !== sh[i])) { sh[i] = h[i]; if (pts.length < TERRAIN_CHANGES_MAX) pts.push(i); else over = true; }
  const pairs: [ArrayLike<number>, Uint8Array][] = [
    [w.facility, snap.facility], [w.road, snap.road], [w.roadTunnel, snap.tunnel], [w.roadSurface, snap.surface], [w.roadDeck, snap.deck],
  ];
  const seen = new Set<number>();
  for (const [a, b] of pairs) for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    b[i] = a[i];
    if (seen.has(i)) continue;
    seen.add(i);
    if (tiles.length < TERRAIN_CHANGES_MAX) tiles.push(i); else over = true;
  }
  return over ? null : { pts, tiles };
}

/** Does a changed grid point or tile fall inside what the terrain test of geo g reads? */
function terrainHit(g: Geo, size: number, ch: { pts: number[]; tiles: number[] }): boolean {
  const s1 = size + 1;
  for (const i of ch.pts) {
    const x = i % s1, z = (i / s1) | 0;
    if (x >= g.hgx0 && x <= g.hgx1 && z >= g.hgz0 && z <= g.hgz1) return true;
  }
  for (const i of ch.tiles) {
    const x = i % size, z = (i / size) | 0;
    if (x >= g.ctx0 && x <= g.ctx1 && z >= g.ctz0 && z <= g.ctz1) return true;
  }
  return false;
}

const validityCtx = new WeakMap<World, ValidityCtx>();

function sameRoad(r: RoadRec, seg: RoadSegment): boolean {
  if (r.type !== seg.type || r.srcPts.length !== seg.pts.length * 2 || r.srcTiles.length !== seg.tiles.length) return false;
  for (let i = 0; i < seg.pts.length; i++) if (r.srcPts[i * 2] !== seg.pts[i].x || r.srcPts[i * 2 + 1] !== seg.pts[i].z) return false;
  for (let i = 0; i < seg.tiles.length; i++) if (r.srcTiles[i] !== seg.tiles[i]) return false;
  return true;
}

function roadRec(seg: RoadSegment, size: number): RoadRec {
  const srcPts = new Float64Array(seg.pts.length * 2);
  for (let i = 0; i < seg.pts.length; i++) { srcPts[i * 2] = seg.pts[i].x; srcPts[i * 2 + 1] = seg.pts[i].z; }
  const sp = sample(seg.pts).pts;
  const n = sp.length;
  const xs = new Float64Array(n), zs = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = sp[i].x; zs[i] = sp[i].z; }
  const nch = Math.max(0, Math.ceil((n - 1) / CHUNK));
  const chunks = new Float64Array(nch * 4);
  for (let c = 0; c < nch; c++) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = c * CHUNK; i <= Math.min(n - 1, (c + 1) * CHUNK); i++) {
      minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]); minZ = Math.min(minZ, zs[i]); maxZ = Math.max(maxZ, zs[i]);
    }
    chunks[c * 4] = minX; chunks[c * 4 + 1] = maxX; chunks[c * 4 + 2] = minZ; chunks[c * 4 + 3] = maxZ;
  }
  let tx0 = Infinity, tx1 = -Infinity, tz0 = Infinity, tz1 = -Infinity;
  for (const t of seg.tiles) {
    const x = t % size, y = (t / size) | 0;
    tx0 = Math.min(tx0, x); tx1 = Math.max(tx1, x); tz0 = Math.min(tz0, y); tz1 = Math.max(tz1, y);
  }
  const p = profileOf(seg.type);
  return {
    id: seg.id, seg, type: seg.type, srcPts, srcTiles: Int32Array.from(seg.tiles), xs, zs, n, chunks,
    body: p.drawHalf + p.sidewalk, clear: p.drawHalf + p.sidewalk + ROAD_CLEARANCE,
    a: seg.a, b: seg.b, flatA: false, flatB: false, tx0, tx1, tz0, tz1,
  };
}

/** Bounding boxes of what changed since the previous build; a block is recomputed when one overlaps it. */
interface Changes {
  /** Raster tile boxes of changed roads (old and new), already grown by the 2-tile candidate reach. */
  roadBoxes: number[];
  /** Tile boxes of changed junction rings. */
  ringBoxes: number[];
  /** Real boxes of changed discs. */
  discBoxes: number[];
  /** Segments whose own road changed or vanished. */
  segs: Set<number>;
}

function boxHit(boxes: number[], x0: number, x1: number, z0: number, z1: number): boolean {
  for (let i = 0; i < boxes.length; i += 4) {
    if (boxes[i] <= x1 && boxes[i + 1] >= x0 && boxes[i + 2] <= z1 && boxes[i + 3] >= z0) return true;
  }
  return false;
}

/** Does any sample within the cell box come within `limit` of a piece of chunk c? (conservative: false = never) */
function chunkNear(r: RoadRec, c: number, limit: number, x0: number, x1: number, z0: number, z1: number): boolean {
  const ch = r.chunks, m = limit + CULL_EPS;
  return !(ch[c * 4 + 1] < x0 - m || ch[c * 4] > x1 + m || ch[c * 4 + 3] < z0 - m || ch[c * 4 + 2] > z1 + m);
}

/**
 * Exactly `distToCenterline(px, pz, sampled, flatA, flatB) < limit` of the pre-zperf code (same arithmetic per
 * piece; `min < limit` is `any < limit`), visiting only the chunks marked in `mask`.
 */
function nearCentreline(px: number, pz: number, r: RoadRec, limit: number, mask: Uint8Array, mOff: number): boolean {
  const xs = r.xs, zs = r.zs, n = r.n, nch = r.chunks.length >> 2;
  const m = limit + CULL_EPS, lo2 = (limit - CULL_EPS) * (limit - CULL_EPS), hi2 = m * m;
  for (let c = 0; c < nch; c++) {
    if (!mask[mOff + c]) continue;
    const i1 = Math.min(n - 1, (c + 1) * CHUNK);
    for (let i = Math.max(1, c * CHUNK + 1); i <= i1; i++) {
      const ax = xs[i - 1], az = zs[i - 1], bx = xs[i], bz = zs[i];
      // A piece whose box is farther than the limit (plus slack) cannot be nearer than it.
      if (px < Math.min(ax, bx) - m || px > Math.max(ax, bx) + m || pz < Math.min(az, bz) - m || pz > Math.max(az, bz) + m) continue;
      if ((r.flatA && i === 1) || (r.flatB && i === n - 1)) {
        const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
        const u = l2 <= 1e-9 ? 0 : ((px - ax) * vx + (pz - az) * vz) / l2;
        if ((r.flatA && i === 1 && u < 0) || (r.flatB && i === n - 1 && u > 1)) continue;
      }
      // distPointToSegment, verbatim; Math.hypot only when the squared distance is within slack of the limit.
      const vx = bx - ax, vz = bz - az;
      const l2 = vx * vx + vz * vz;
      const u = l2 <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2));
      const dx = px - (ax + vx * u), dz = pz - (az + vz * u);
      const d2 = dx * dx + dz * dz;
      if (d2 > hi2) continue;
      if (d2 < lo2 || Math.hypot(dx, dz) < limit) return true;
    }
  }
  return false;
}

/** Raster tile -> ground roads (linked lists), for the candidate rule. */
interface TileRoads { head: Int32Array; next: number[]; road: number[]; stamp: Int32Array; tick: number }

function tileRoads(size: number, recs: RoadRec[]): TileRoads {
  const head = new Int32Array(size * size).fill(-1);
  const next: number[] = [], road: number[] = [];
  for (let ri = 0; ri < recs.length; ri++) {
    for (const t of recs[ri].srcTiles) {
      if (t < 0 || t >= size * size) continue;
      next.push(head[t]); road.push(ri); head[t] = next.length - 1;
    }
  }
  return { head, next, road, stamp: new Int32Array(recs.length), tick: 0 };
}

/**
 * Candidate roads of the cell centred in tile (x, y): every ground road with a raster tile within 2 tiles (Chebyshev)
 * of it, i.e. the old `roadCandidates` map (each road's tiles grown by 2) without building it. Order is irrelevant:
 * every use is an OR.
 */
function candidates(tr: TileRoads, size: number, x: number, y: number, out: number[]): number {
  const tick = ++tr.tick;
  let n = 0;
  for (let ty = Math.max(0, y - 2); ty <= Math.min(size - 1, y + 2); ty++) for (let tx = Math.max(0, x - 2); tx <= Math.min(size - 1, x + 2); tx++) {
    for (let e = tr.head[ty * size + tx]; e >= 0; e = tr.next[e]) {
      const ri = tr.road[e];
      if (tr.stamp[ri] === tick) continue;
      tr.stamp[ri] = tick;
      out[n++] = ri;
    }
  }
  return n;
}

const vCorners = new Float32Array(8);
const vSamples = new Float32Array(CELL_SAMPLES * 2);
const vCand: number[] = [];
const vLimit: number[] = [];
const vOther: number[] = [];
let vMask = new Uint8Array(256);
const vMaskOff: number[] = [];

function applyValidity(w: World, blocks: ZoneBlock[]): void {
  let tp = zpStart();
  const size = w.size;
  let ctx = validityCtx.get(w);
  if (!ctx || ctx.size !== size) {
    ctx = { size, roads: new Map(), polys: new Map(), discs: "", discList: [], straight: new Map(), bcache: new Map(), snap: null, terrain: new Map() };
    validityCtx.set(w, ctx);
  }
  const ch: Changes = { roadBoxes: [], ringBoxes: [], discBoxes: [], segs: new Set() };
  const addRoadBox = (r: RoadRec) => { if (r.tx0 <= r.tx1) ch.roadBoxes.push(r.tx0 - 2, r.tx1 + 2, r.tz0 - 2, r.tz1 + 2); };
  const segById = new Map<number, RoadSegment>();
  for (const s of w.segments) segById.set(s.id, s);
  // Ground roads, reusing the sampled centreline of unchanged ones.
  const recs: RoadRec[] = [];
  const recById = new Map<number, RoadRec>();
  const changedRec = new Set<RoadRec>();
  for (const seg of w.segments) {
    if (segElevation(seg) !== "ground") continue;
    const old = ctx.roads.get(seg.id);
    let r: RoadRec;
    if (old && sameRoad(old, seg)) { r = old; r.seg = seg; r.a = seg.a; r.b = seg.b; }
    else { r = roadRec(seg, size); changedRec.add(r); if (old) addRoadBox(old); }
    recs.push(r);
    recById.set(seg.id, r);
  }
  for (const [id, old] of ctx.roads) if (!recById.has(id)) { addRoadBox(old); ch.segs.add(id); }
  zpEnd("valid.prepRoads", tp); tp = zpStart();
  const keepOut = junctionKeepOut(w);
  const discs = keepOut.discs;
  // Flat ends follow the junction layouts; a road whose flags or end nodes changed is a changed road.
  for (const r of recs) {
    const old = ctx.roads.get(r.id);
    const fa = keepOut.nodes.has(r.seg.a), fb = keepOut.nodes.has(r.seg.b);
    if (r === old && (r.flatA !== fa || r.flatB !== fb)) changedRec.add(r);
    r.flatA = fa; r.flatB = fb;
  }
  for (const r of changedRec) { addRoadBox(r); ch.segs.add(r.id); }
  // Junction rings: a ring object is reused while its layout lives; otherwise compare the vertices.
  for (const [node, poly] of keepOut.polys) {
    const old = ctx.polys.get(node);
    if (old === poly) continue;
    let same = !!old && old.xs.length === poly.xs.length;
    for (let i = 0; same && i < poly.xs.length; i++) same = old!.xs[i] === poly.xs[i] && old!.zs[i] === poly.zs[i];
    if (same) continue;
    ch.ringBoxes.push(Math.floor(poly.minX), Math.floor(poly.maxX), Math.floor(poly.minZ), Math.floor(poly.maxZ));
    if (old) ch.ringBoxes.push(Math.floor(old.minX), Math.floor(old.maxX), Math.floor(old.minZ), Math.floor(old.maxZ));
  }
  for (const [node, old] of ctx.polys) {
    if (!keepOut.polys.has(node)) ch.ringBoxes.push(Math.floor(old.minX), Math.floor(old.maxX), Math.floor(old.minZ), Math.floor(old.maxZ));
  }
  const discKey = discs.map((d) => `${d.x},${d.z},${d.r}`).join(";");
  if (discKey !== ctx.discs) {
    for (const d of [...discs, ...ctx.discList]) ch.discBoxes.push(d.x - d.r, d.x + d.r, d.z - d.r, d.z + d.r);
  }
  const polyAt = new PolyGrid([...keepOut.polys.values()]);
  // Straight continuations through shared nodes (pairs only meet at nodes).
  const continuations = new Map<number, Set<number>>();
  for (const n of w.nodes) {
    if (n.segs.length < 2) continue;
    for (const ia of n.segs) for (const ib of n.segs) {
      if (ia >= ib) continue;
      const sa = segById.get(ia), sb = segById.get(ib);
      if (!sa || !sb || !continues(sa, sb)) continue;
      (continuations.get(ia) ?? continuations.set(ia, new Set()).get(ia)!).add(ib);
      (continuations.get(ib) ?? continuations.set(ib, new Set()).get(ib)!).add(ia);
    }
  }
  const straightKey = new Map<number, string>();
  for (const [id, set] of continuations) straightKey.set(id, [...set].sort((p, q) => p - q).join(","));
  const tr = tileRoads(size, recs);
  zpEnd("valid.prepJunctions", tp); tp = zpStart();

  const corners = vCorners, samples = vSamples;
  const bcache = new Map<string, BCache>();
  const hs = w.heights, s1 = size + 1;
  const tch = terrainChanges(ctx, w);
  const terrainNext = new Map<Geo, Uint8Array>();
  for (const b of blocks) {
    const seg = segById.get(b.seg);
    if (!seg) continue;
    const own = recById.get(seg.id);
    const cached = geoOfFrame.get(b.frame);
    const g = cached && cached.rows === b.rows && !Number.isNaN(cached.roadX[0] ?? 0) ? cached : geoOf(b, sample(seg.pts));
    const straightOn = continuations.get(seg.id);
    const sKey = straightKey.get(seg.id) ?? "";
    // Terrain pass: heights, facilities and the raster change without a revision, so the bits are reused only when
    // nothing this block's test reads (heights grid box, centre tiles) changed since the previous build.
    if (g.hgSize !== size) {
      const cl = (v: number) => Math.floor(Math.min(size - 1e-6, Math.max(0, v)));
      let x0 = g.bx0, x1 = g.bx1, z0 = g.bz0, z1 = g.bz1;
      for (let r = 0; r < b.rows; r++) {
        x0 = Math.min(x0, g.roadX[r]); x1 = Math.max(x1, g.roadX[r]); z0 = Math.min(z0, g.roadZ[r]); z1 = Math.max(z1, g.roadZ[r]);
      }
      g.hgx0 = cl(x0); g.hgx1 = cl(x1) + 1; g.hgz0 = cl(z0); g.hgz1 = cl(z1) + 1; g.hgSize = size;
    }
    let terrain = ctx.terrain.get(g);
    if (!terrain || !tch || terrainHit(g, size, tch)) {
      terrain = new Uint8Array(g.n);
      for (let r = 0; r < b.rows; r++) {
        const roadH = heightAt(w, g.roadX[r], g.roadZ[r]);
        for (let c = 0; c < CELL_DEPTH; c++) {
          const k = cellIndex(r, c);
          const px = g.px[k], pz = g.pz[k], tx = g.ftx[k], ty = g.ftz[k], o = k * 8, q = g.corners;
          let ok = g.areaOk[k] === 1 && tx >= 0 && ty >= 0 && tx < size && ty < size;
          let hc = 0;
          if (ok) {
            hc = heightAt(w, px, pz);
            // isLand(w, tx, ty), inlined.
            ok = Math.abs(hc - roadH) <= CELL_SLOPE_LIMIT &&
              hs[ty * s1 + tx] >= 0.05 && hs[ty * s1 + tx + 1] >= 0.05 && hs[(ty + 1) * s1 + tx] >= 0.05 && hs[(ty + 1) * s1 + tx + 1] >= 0.05 &&
              w.facility[ty * size + tx] === 0;
          }
          for (let i = 0; ok && i < 4; i++) ok = q[o + i * 2] >= 0 && q[o + i * 2] <= size && q[o + i * 2 + 1] >= 0 && q[o + i * 2 + 1] <= size;
          // Corner water: any corner under water blocks the cell (fable `_blocked`).
          if (ok && (hc < WATER_H ||
            heightAt(w, q[o], q[o + 1]) < WATER_H || heightAt(w, q[o + 2], q[o + 3]) < WATER_H ||
            heightAt(w, q[o + 4], q[o + 5]) < WATER_H || heightAt(w, q[o + 6], q[o + 7]) < WATER_H)) ok = false;
          // The road raster marks every tile a centreline touches; on a diagonal that tile reaches ~1.4 tiles from the
          // centreline, so testing it rejected the depth-0 cells beside their own road (and the cut-off then the row).
          // Ground roads are tested analytically below; the raster still rejects decks and non-ground roads.
          if (ok) {
            const ti = ty * size + tx;
            if (blocksBuilding(w, ti) && (w.roadSurface[ti] === 0 || w.roadDeck[ti] !== 0)) ok = false;
          }
          terrain[k] = ok ? 1 : 0;
        }
      }
    }
    terrainNext.set(g, terrain);
    // Road test: reuse the cached bits unless something it reads changed near this block.
    const prev = ctx.bcache.get(b.key);
    const tb0 = Math.floor(g.bx0 - CULL_EPS), tb1 = Math.floor(g.bx1 + CULL_EPS);
    const tbz0 = Math.floor(g.bz0 - CULL_EPS), tbz1 = Math.floor(g.bz1 + CULL_EPS);
    const n = b.rows * CELL_DEPTH;
    let bits: Int8Array;
    if (prev && own && prev.own === own && prev.geo === g && prev.straight === sKey && !ch.segs.has(seg.id) &&
      !boxHit(ch.roadBoxes, g.ctx0, g.ctx1, g.ctz0, g.ctz1) && !boxHit(ch.ringBoxes, tb0, tb1, tbz0, tbz1) &&
      !boxHit(ch.discBoxes, g.bx0 - CULL_EPS, g.bx1 + CULL_EPS, g.bz0 - CULL_EPS, g.bz1 + CULL_EPS)) {
      bits = prev.bits;
    } else {
      bits = new Int8Array(n).fill(-1);
    }
    if (own) bcache.set(b.key, { own, geo: g, straight: sKey, bits });
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < CELL_DEPTH; c++) {
        const k = cellIndex(r, c);
        let ok = terrain[k] === 1;
        if (ok && bits[k] < 0) {
          for (let i = 0; i < 8; i++) corners[i] = g.corners[k * 8 + i];
          bits[k] = roadTest(b, r, g.px[k], g.pz[k], corners, samples, recs, tr, size, straightOn, polyAt, discs) ? 1 : 0;
        }
        if (ok) ok = bits[k] === 1;
        b.valid[k] = ok ? 1 : 0;
      }
      for (let c = 1; c < CELL_DEPTH; c++) if (!b.valid[cellIndex(r, c - 1)]) b.valid[cellIndex(r, c)] = 0;
    }
  }
  ctx.roads = recById;
  ctx.polys = keepOut.polys;
  ctx.discs = discKey;
  ctx.discList = discs;
  ctx.straight = straightKey;
  ctx.bcache = bcache;
  ctx.terrain = terrainNext;
  zpEnd("valid.cells", tp);
}

/** The road/junction part of the validity test of one cell (pre-zperf semantics, see applyValidity). */
function roadTest(
  b: ZoneBlock, r: number, px: number, pz: number, corners: Float32Array, samples: Float32Array, recs: RoadRec[],
  tr: TileRoads, size: number, straightOn: Set<number> | undefined, polyAt: PolyGrid,
  discs: { x: number; z: number; r: number }[],
): boolean {
  cellSamples(px, pz, corners, samples);
  const e = b.edge;
  const curved = !!e && e.length >= (b.rows + 1) * 4 &&
    e[r * 4 + 2] * e[(r + 1) * 4 + 2] + e[r * 4 + 3] * e[(r + 1) * 4 + 3] < 1 - 1e-9;
  const nSamples = curved ? CELL_SAMPLES : STRAIGHT_SAMPLES;
  // Cell box (centre, corners, samples): every point any test below looks at lies inside it.
  let x0 = px, x1 = px, z0 = pz, z1 = pz;
  for (let i = 0; i < 4; i++) {
    x0 = Math.min(x0, corners[i * 2]); x1 = Math.max(x1, corners[i * 2]); z0 = Math.min(z0, corners[i * 2 + 1]); z1 = Math.max(z1, corners[i * 2 + 1]);
  }
  for (let s = 0; s < CELL_SAMPLES; s++) {
    x0 = Math.min(x0, samples[s * 2]); x1 = Math.max(x1, samples[s * 2]); z0 = Math.min(z0, samples[s * 2 + 1]); z1 = Math.max(z1, samples[s * 2 + 1]);
  }
  const nc = candidates(tr, size, Math.floor(px), Math.floor(pz), vCand);
  // Per candidate: its limit and which chunks can reach the cell at all.
  let nUse = 0, maskLen = 0;
  for (let j = 0; j < nc; j++) {
    const rec = recs[vCand[j]];
    const ownish = rec.id === b.seg || !!straightOn?.has(rec.id);
    const limit = ownish ? rec.body : rec.clear;
    const nch = rec.chunks.length >> 2;
    if (maskLen + nch > vMask.length) { const m = new Uint8Array((maskLen + nch) * 2); m.set(vMask); vMask = m; }
    let any = false;
    for (let c = 0; c < nch; c++) {
      const hit = chunkNear(rec, c, limit, x0, x1, z0, z1);
      vMask[maskLen + c] = hit ? 1 : 0;
      any ||= hit;
    }
    if (!any) continue;
    vOther[nUse] = vCand[j]; vLimit[nUse] = ownish ? -limit : limit; vMaskOff[nUse] = maskLen;
    maskLen += nch; nUse++;
  }
  for (let s = 0; s < nSamples; s++) {
    const sx = samples[s * 2], sz = samples[s * 2 + 1];
    for (let j = 0; j < nUse; j++) {
      // Own road (and its straight continuation): only the physical body (asphalt + sidewalk), so depth 0
      // always touches the sidewalk; other roads keep ROAD_CLEARANCE beyond their sidewalk.
      if (nearCentreline(sx, sz, recs[vOther[j]], Math.abs(vLimit[j]), vMask, vMaskOff[j])) return false;
    }
    for (let e = polyAt.head(Math.floor(sx), Math.floor(sz)); e >= 0; e = polyAt.next[e]) if (inKeepOut(polyAt.poly[e], sx, sz)) return false;
    for (const d of discs) {
      if ((sx - d.x) * (sx - d.x) + (sz - d.z) * (sz - d.z) < d.r * d.r) return false;
    }
  }
  // Junction rings are polygons with corners: a kerb-return vertex can poke into a cell edge between the
  // samples, so the ring is also tested exactly against the cell quad (05 §1.8).
  if (quadTouchesRings(corners, px, pz, polyAt)) return false;
  // The 9/13 samples leave 0.5-tile gaps along the cell edges, and another road's round end or a crossing
  // centreline can bulge into the cell between them by more than ROAD_CLEARANCE: test those exactly.
  for (let j = 0; j < nUse; j++) {
    if (vLimit[j] < 0) continue;
    if (quadNearRoad(corners, px, pz, recs[vOther[j]], vLimit[j])) return false;
  }
  return true;
}

function segsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function pointSegDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
  const u = l2 <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2));
  const dx = ax + vx * u - px, dz = az + vz * u - pz;
  return dx * dx + dz * dz;
}

const near4 = new Float32Array(8);
/**
 * Exact test of a cell quad (pulled EXACT_SHRINK in) against another road's swept body of half width `limit`
 * around its sampled centreline: interior pieces are capsules; an end piece at a junction-layout node is cut flat
 * at the node (the junction ring covers the node area, §1.4 c), so it is a rectangle there.
 * (Pre-zperf arithmetic per piece; whole chunks are skipped by the same bounding-box rule the pieces use.)
 */
function quadNearRoad(q: Float32Array, cx: number, cz: number, r: RoadRec, limit: number): boolean {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < 4; i++) {
    near4[i * 2] = cx + (q[i * 2] - cx) * EXACT_SHRINK;
    near4[i * 2 + 1] = cz + (q[i * 2 + 1] - cz) * EXACT_SHRINK;
    minX = Math.min(minX, near4[i * 2]); maxX = Math.max(maxX, near4[i * 2]);
    minZ = Math.min(minZ, near4[i * 2 + 1]); maxZ = Math.max(maxZ, near4[i * 2 + 1]);
  }
  const l2 = limit * limit, n = r.n, xs = r.xs, zs = r.zs, chunks = r.chunks, nch = chunks.length >> 2;
  const flatA = r.flatA, flatB = r.flatB;
  for (let c = 0; c < nch; c++) {
    // Every piece of the chunk has max(a.x, b.x) <= chunk max etc., so the piece test below would skip each one.
    if (chunks[c * 4 + 1] < minX - limit || chunks[c * 4] > maxX + limit ||
      chunks[c * 4 + 3] < minZ - limit || chunks[c * 4 + 2] > maxZ + limit) continue;
    const i1 = Math.min(n - 1, (c + 1) * CHUNK);
    for (let i = Math.max(1, c * CHUNK + 1); i <= i1; i++) {
      const ax = xs[i - 1], az = zs[i - 1], bx = xs[i], bz = zs[i];
      if (Math.max(ax, bx) < minX - limit || Math.min(ax, bx) > maxX + limit ||
        Math.max(az, bz) < minZ - limit || Math.min(az, bz) > maxZ + limit) continue;
      const cutA = flatA && i === 1, cutB = flatB && i === n - 1;
      if (cutA || cutB) {
        // Flat end(s): the swept rectangle of this piece (SAT against the quad), plus a disc at a non-cut end.
        if (rectOverlapsQuad(ax, az, bx, bz, limit, near4)) return true;
        if (!cutA && discTouchesQuad(ax, az, l2, near4)) return true;
        if (!cutB && discTouchesQuad(bx, bz, l2, near4)) return true;
        continue;
      }
      if (pointInQuad(near4, ax, az) || pointInQuad(near4, bx, bz)) return true;
      for (let e = 0; e < 4; e++) {
        const f = (e + 1) & 3;
        const ex = near4[e * 2], ez = near4[e * 2 + 1], fx = near4[f * 2], fz = near4[f * 2 + 1];
        if (segsCross(ax, az, bx, bz, ex, ez, fx, fz)) return true;
        if (pointSegDist2(ex, ez, ax, az, bx, bz) < l2) return true;
        if (pointSegDist2(ax, az, ex, ez, fx, fz) < l2 || pointSegDist2(bx, bz, ex, ez, fx, fz) < l2) return true;
      }
    }
  }
  return false;
}

function discTouchesQuad(x: number, z: number, r2: number, q: Float32Array): boolean {
  if (pointInQuad(q, x, z)) return true;
  for (let e = 0; e < 4; e++) {
    const f = (e + 1) & 3;
    if (pointSegDist2(x, z, q[e * 2], q[e * 2 + 1], q[f * 2], q[f * 2 + 1]) < r2) return true;
  }
  return false;
}

const rect4 = new Float32Array(8);
/** SAT: does the rectangle swept by segment a-b with half width h overlap quad q (strictly)? */
function rectOverlapsQuad(ax0: number, az0: number, bx0: number, bz0: number, h: number, q: Float32Array): boolean {
  let tx = bx0 - ax0, tz = bz0 - az0;
  const l = Math.hypot(tx, tz);
  if (l < 1e-9) return false;
  tx /= l; tz /= l;
  const nx = -tz * h, nz = tx * h;
  rect4[0] = ax0 + nx; rect4[1] = az0 + nz; rect4[2] = bx0 + nx; rect4[3] = bz0 + nz;
  rect4[4] = bx0 - nx; rect4[5] = bz0 - nz; rect4[6] = ax0 - nx; rect4[7] = az0 - nz;
  for (let pass = 0; pass < 2; pass++) {
    const poly = pass === 0 ? rect4 : q;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      const ax = -(poly[j * 2 + 1] - poly[i * 2 + 1]), az = poly[j * 2] - poly[i * 2];
      let alo = Infinity, ahi = -Infinity, blo = Infinity, bhi = -Infinity;
      for (let k = 0; k < 4; k++) {
        const va = rect4[k * 2] * ax + rect4[k * 2 + 1] * az, vb = q[k * 2] * ax + q[k * 2 + 1] * az;
        alo = Math.min(alo, va); ahi = Math.max(ahi, va); blo = Math.min(blo, vb); bhi = Math.max(bhi, vb);
      }
      if (ahi <= blo || bhi <= alo) return false;
    }
  }
  return true;
}

const shrunk = new Float32Array(8);
let ringStamp = 0;
/** Exact overlap of a cell quad (pulled EXACT_SHRINK toward its centre) with any junction ring near it. */
function quadTouchesRings(q: Float32Array, cx: number, cz: number, polyAt: PolyGrid): boolean {
  const stamp = ++ringStamp;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < 4; i++) {
    shrunk[i * 2] = cx + (q[i * 2] - cx) * EXACT_SHRINK;
    shrunk[i * 2 + 1] = cz + (q[i * 2 + 1] - cz) * EXACT_SHRINK;
    minX = Math.min(minX, shrunk[i * 2]); maxX = Math.max(maxX, shrunk[i * 2]);
    minZ = Math.min(minZ, shrunk[i * 2 + 1]); maxZ = Math.max(maxZ, shrunk[i * 2 + 1]);
  }
  for (let tz = Math.floor(minZ); tz <= Math.floor(maxZ); tz++) for (let tx = Math.floor(minX); tx <= Math.floor(maxX); tx++) {
    for (let en = polyAt.head(tx, tz); en >= 0; en = polyAt.next[en]) {
      const poly = polyAt.poly[en];
      if (poly.mark === stamp) continue;
      poly.mark = stamp;
      if (poly.maxX < minX || poly.minX > maxX || poly.maxZ < minZ || poly.minZ > maxZ) continue;
      const n = poly.xs.length;
      for (let i = 0; i < n; i++) if (pointInQuad(shrunk, poly.xs[i], poly.zs[i])) return true;
      for (let e = 0; e < 4; e++) if (inKeepOut(poly, shrunk[e * 2], shrunk[e * 2 + 1])) return true;
      for (let i = 0, j = n - 1; i < n; j = i++) for (let e = 0; e < 4; e++) {
        const f = (e + 1) & 3;
        if (segsCross(poly.xs[j], poly.zs[j], poly.xs[i], poly.zs[i], shrunk[e * 2], shrunk[e * 2 + 1], shrunk[f * 2], shrunk[f * 2 + 1])) return true;
      }
    }
  }
  return false;
}

function pointInQuad(q: Float32Array, x: number, z: number): boolean {
  let pos = 0, neg = 0;
  for (let e = 0; e < 4; e++) {
    const ax = q[e * 2], az = q[e * 2 + 1];
    const bx = q[((e + 1) & 3) * 2], bz = q[((e + 1) & 3) * 2 + 1];
    const cr = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    if (cr > 0) pos++; else if (cr < 0) neg++;
  }
  return pos === 0 || neg === 0;
}

function pointInQuadAt(q: Float32Array, o: number, x: number, z: number): boolean {
  let pos = 0, neg = 0;
  for (let e = 0; e < 4; e++) {
    const ax = q[o + e * 2], az = q[o + e * 2 + 1];
    const bx = q[o + ((e + 1) & 3) * 2], bz = q[o + ((e + 1) & 3) * 2 + 1];
    const cr = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    if (cr > 0) pos++; else if (cr < 0) neg++;
  }
  return pos === 0 || neg === 0;
}

/** SAT overlap of quad qa@oa and quad qb@ob; touching within 1mm is not an overlap (shared cell edges). Symmetric. */
function quadsOverlapAt(qa: Float32Array, oa: number, qb: Float32Array, ob: number): boolean {
  for (let pass = 0; pass < 2; pass++) {
    const q = pass === 0 ? qa : qb, op = pass === 0 ? oa : ob;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      const ex = q[op + j * 2] - q[op + i * 2], ez = q[op + j * 2 + 1] - q[op + i * 2 + 1];
      const ax = -ez, az = ex;
      let alo = Infinity, ahi = -Infinity, blo = Infinity, bhi = -Infinity;
      for (let k = 0; k < 4; k++) {
        const va = qa[oa + k * 2] * ax + qa[oa + k * 2 + 1] * az;
        alo = Math.min(alo, va); ahi = Math.max(ahi, va);
      }
      for (let k = 0; k < 4; k++) {
        const vb = qb[ob + k * 2] * ax + qb[ob + k * 2 + 1] * az;
        blo = Math.min(blo, vb); bhi = Math.max(bhi, vb);
      }
      if (Math.min(ahi, bhi) - Math.max(alo, blo) <= 1e-3) return false;
    }
  }
  return true;
}

/** The pre-zperf `fits` pair test (centre distance, point-in-quad either way, SAT), minus the frame-neighbour rule. */
function cellsConflict(O: Geo, ko: number, T: Geo, k: number): boolean {
  const cx = T.px[k], cz = T.pz[k];
  const d2 = (O.px[ko] - cx) ** 2 + (O.pz[ko] - cz) ** 2;
  return d2 < CONFLICT_DIST * CONFLICT_DIST || pointInQuadAt(O.corners, ko * 8, cx, cz) ||
    pointInQuadAt(T.corners, k * 8, O.px[ko], O.pz[ko]) || quadsOverlapAt(O.corners, ko * 8, T.corners, k * 8);
}

let buildStamp = 0;
const resolveGeos = new WeakMap<World, Set<Geo>>();

/**
 * Conflict neighbours of the alive (pre-resolution valid) cells of the dirty geos: the alive cells (of any current
 * block) the old `fits` would have tested against it and found conflicting: centre tiles within 2 (the 5 x 5
 * bucket search), not frame neighbours (same segment, side and col, rows <= 1.01 apart), and conflicting. Only alive
 * cells are ever kept, and `fits` only runs for alive cells, so nothing else matters. The pair test is symmetric and
 * purely geometric, so the lists stay exact until a geo near the cell appears, vanishes or changes its alive cells
 * (each geo keeps the alive mask its lists were built with). Each pair of dirty cells is tested once.
 */
function computeNeighbours(geos: Geo[], blocks: ZoneBlock[], total: number, dirty: Geo[]): void {
  let tx0 = Infinity, tx1 = -Infinity, tz0 = Infinity, tz1 = -Infinity;
  for (const g of geos) {
    tx0 = Math.min(tx0, g.ctx0); tx1 = Math.max(tx1, g.ctx1); tz0 = Math.min(tz0, g.ctz0); tz1 = Math.max(tz1, g.ctz1);
  }
  const gx0 = tx0 - 2, gz0 = tz0 - 2, gw = tx1 - tx0 + 5, gh = tz1 - tz0 + 5;
  const head = new Int32Array(gw * gh).fill(-1);
  const next = new Int32Array(total), owner = new Int32Array(total);
  const isDirty = new Uint8Array(geos.length);
  const dirtySet = new Set(dirty);
  for (let gi = 0; gi < geos.length; gi++) {
    const g = geos[gi], valid = blocks[gi].valid;
    if (dirtySet.has(g)) isDirty[gi] = 1;
    for (let k = 0; k < g.n; k++) {
      if (!valid[k]) continue;
      const id = g.gbase + k, t = (g.ftz[k] - gz0) * gw + g.ftx[k] - gx0;
      next[id] = head[t]; head[t] = id; owner[id] = gi;
    }
  }
  // Pairs (a in a dirty geo, o alive anywhere); a pair of two dirty cells is kept once (a < o).
  const pa: number[] = [], po: number[] = [];
  const count = new Int32Array(total);
  for (let gi = 0; gi < geos.length; gi++) {
    if (!isDirty[gi]) continue;
    const T = geos[gi], valid = blocks[gi].valid;
    for (let k = 0; k < T.n; k++) {
      if (!valid[k]) continue;
      const a = T.gbase + k;
      const col = k & 3, grow = T.s0 + (k >> 2);
      const ccx = T.ftx[k] - gx0, ccz = T.ftz[k] - gz0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        for (let o = head[(ccz + dz) * gw + ccx + dx]; o >= 0; o = next[o]) {
          if (o === a) continue;
          const oi = owner[o];
          if (isDirty[oi] && o < a) continue;
          const O = geos[oi], ko = o - O.gbase;
          if (O.seg === T.seg && O.side === T.side && (ko & 3) === col && Math.abs(O.s0 + (ko >> 2) - grow) <= 1.01) continue;
          if (!cellsConflict(O, ko, T, k)) continue;
          pa.push(a); po.push(o);
          count[a]++;
          if (isDirty[oi]) count[o]++;
        }
      }
    }
  }
  const byOwner = new Map<Geo, { start: Int32Array; g: Geo[]; k: Int32Array; fill: Int32Array }>();
  for (let gi = 0; gi < geos.length; gi++) {
    if (!isDirty[gi]) continue;
    const T = geos[gi];
    const start = new Int32Array(T.n + 1);
    for (let k = 0; k < T.n; k++) start[k + 1] = start[k] + count[T.gbase + k];
    byOwner.set(T, { start, g: new Array<Geo>(start[T.n]), k: new Int32Array(start[T.n]), fill: start.slice(0, T.n) });
  }
  const add = (from: number, to: number): void => {
    const F = geos[owner[from]], e = byOwner.get(F)!, kf = from - F.gbase, O = geos[owner[to]];
    const j = e.fill[kf]++;
    e.g[j] = O; e.k[j] = to - O.gbase;
  };
  for (let i = 0; i < pa.length; i++) {
    add(pa[i], po[i]);
    if (isDirty[owner[po[i]]]) add(po[i], pa[i]);
  }
  for (let gi = 0; gi < geos.length; gi++) {
    if (!isDirty[gi]) continue;
    const T = geos[gi], e = byOwner.get(T)!;
    T.nbrStart = e.start; T.nbrGeo = e.g; T.nbrK = e.k; T.nbrAlive = blocks[gi].valid.slice();
  }
}

let rCap = 0;
let rOrder = new Int32Array(0), rKept = new Uint8Array(0), rDropped = new Int32Array(0), rOwner = new Int32Array(0);

/**
 * Greedy priority-ordered independent set with second-chance passes (fable `_resolveConflicts`).
 * Sorted once by (depth from own centreline, age, side, row); a cell is kept when it fits against already-kept
 * rivals, then dropped cells get 3 re-admission passes. Because depth order visits col k-1 of a row before col k,
 * a cell whose col k-1 neighbour was dropped is dropped too instead of reserving space it can never use (that
 * phantom reservation left grass gaps beside the rival block). Frame neighbours never conflict.
 *
 * Priority order for contested cells: the cell nearer its own centreline wins (lateral offset lat0 + col, exact on
 * straight and curved frames), so where two roads' blocks meet each cell goes to the road it is nearest to. Ties
 * (equal depth: two depth-0 cells in an acute wedge, a shared corner cell) go to the older segment, then side, row.
 * The old CS1 col band (col <= 1 beats col >= 2, then wider road) let an older road's depth-1 cell evict a younger
 * road's depth-0 cell and the cut-off then emptied that row: the zone floated away from the kerb.
 *
 * zperf, same decisions as before: (1) the order (depth within 1e-6, age, side, row, col, key) is a strict total
 * order once distinct depths are more than 1e-6 apart, and then it is simply: depth classes ascending, blocks by
 * (age, side, s0), rows ascending: emitted in linear time (checked; otherwise the tolerant comparator sort runs as
 * before). (2) `fits` asks whether a kept cell conflicts: the conflicting cells are cached per block template
 * (computeNeighbours) and only recomputed near blocks that appeared or vanished.
 */
function resolveOverlaps(w: World, blocks: ZoneBlock[]): void {
  if (blocks.length > 3000) return;
  const stamp = ++buildStamp;
  const geos = blocks.map((b) => geoOf(b));
  let total = 0, alive = 0;
  for (let bi = 0; bi < blocks.length; bi++) {
    const g = geos[bi], b = blocks[bi];
    g.gbase = total; g.gstamp = stamp; total += g.n;
    for (let k = 0; k < g.n; k++) if (b.valid[k]) alive++;
  }
  if (rCap < total) {
    rCap = Math.max(total, rCap * 2, 1024);
    rOrder = new Int32Array(rCap); rKept = new Uint8Array(rCap); rDropped = new Int32Array(rCap); rOwner = new Int32Array(rCap);
  }
  for (let bi = 0; bi < blocks.length; bi++) rOwner.fill(bi, geos[bi].gbase, geos[bi].gbase + geos[bi].n);
  // Neighbour lists: recompute for new geos and for geos near any geo that appeared or vanished.
  const prev = resolveGeos.get(w);
  const cur = new Set(geos);
  const changed: Geo[] = [];
  for (let bi = 0; bi < geos.length; bi++) {
    const g = geos[bi];
    let same = !!prev?.has(g) && !!g.nbrAlive;
    for (let k = 0; same && k < g.n; k++) same = g.nbrAlive![k] === blocks[bi].valid[k];
    if (!same) changed.push(g);
  }
  if (prev) for (const g of prev) if (!cur.has(g)) changed.push(g);
  const dirty: Geo[] = [];
  // Many changes: recompute everything (cheaper than matching every geo against every change).
  const everything = changed.length > 64;
  for (const g of geos) {
    let d = everything || !g.nbrStart;
    for (let i = 0; !d && i < changed.length; i++) {
      const x = changed[i];
      d = g.ctx0 - 2 <= x.ctx1 && g.ctx1 + 2 >= x.ctx0 && g.ctz0 - 2 <= x.ctz1 && g.ctz1 + 2 >= x.ctz0;
    }
    if (d) dirty.push(g);
  }
  if (dirty.length) { const tn = zpStart(); computeNeighbours(geos, blocks, total, dirty); zpEnd("resolve.neighbours", tn); }
  resolveGeos.set(w, cur);
  if (!alive) return;

  // Priority order.
  const depthSet = new Set<number>();
  for (const b of blocks) for (let c = 0; c < CELL_DEPTH; c++) depthSet.add(b.lat0 + c);
  const depths = [...depthSet].sort((p, q) => p - q);
  let linear = true;
  for (let i = 1; i < depths.length; i++) if (depths[i] - depths[i - 1] <= 1e-6) { linear = false; break; }
  const gorder = blocks.map((_, i) => i).sort((i, j) => {
    const A = blocks[i], B = blocks[j];
    return A.age - B.age || A.side - B.side || A.s0 - B.s0;
  });
  for (let i = 1; linear && i < gorder.length; i++) {
    const A = blocks[gorder[i - 1]], B = blocks[gorder[i]];
    // Rows (grow = s0 + row) of blocks in one (age, side) group must not interleave.
    if (A.age === B.age && A.side === B.side && !(B.s0 > A.s0 + A.rows - 1)) linear = false;
  }
  let n = 0;
  if (linear) {
    for (const d of depths) for (const bi of gorder) {
      const b = blocks[bi], base = geos[bi].gbase;
      for (let c = 0; c < CELL_DEPTH; c++) {
        if (b.lat0 + c !== d) continue;
        for (let r = 0; r < b.rows; r++) if (b.valid[cellIndex(r, c)]) rOrder[n++] = base + cellIndex(r, c);
      }
    }
  } else {
    zpEnd("resolve.sortFallback", zpStart());
    const ids: number[] = [];
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi], base = geos[bi].gbase;
      for (let k = 0; k < b.rows * CELL_DEPTH; k++) if (b.valid[k]) ids.push(base + k);
    }
    const info = (id: number) => { const bi = rOwner[id], k = id - geos[bi].gbase; return { b: blocks[bi], k }; };
    ids.sort((x, y) => {
      const A = info(x), C = info(y);
      const da = A.b.lat0 + (A.k & 3), dc = C.b.lat0 + (C.k & 3);
      let better: boolean;
      if (Math.abs(da - dc) > 1e-6) better = da < dc;
      else if (A.b.age !== C.b.age) better = A.b.age < C.b.age;
      else if (A.b.side !== C.b.side) better = A.b.side < C.b.side;
      else if (A.b.s0 + (A.k >> 2) !== C.b.s0 + (C.k >> 2)) better = A.b.s0 + (A.k >> 2) < C.b.s0 + (C.k >> 2);
      else if ((A.k & 3) !== (C.k & 3)) better = (A.k & 3) < (C.k & 3);
      else better = A.b.key < C.b.key;
      return better ? -1 : 1;
    });
    for (const id of ids) rOrder[n++] = id;
  }

  // Greedy run on the cached neighbour lists.
  rKept.fill(0, 0, total);
  const reachable = (b: ZoneBlock, k: number): boolean => (k & 3) === 0 || b.valid[k - 1] === 1;
  const fits = (g: Geo, k: number): boolean => {
    const st = g.nbrStart!;
    for (let j = st[k]; j < st[k + 1]; j++) {
      const O = g.nbrGeo[j];
      if (O.gstamp === stamp && rKept[O.gbase + g.nbrK[j]]) return false;
    }
    return true;
  };
  let nd = 0;
  for (let i = 0; i < n; i++) {
    const id = rOrder[i], bi = rOwner[id], g = geos[bi], b = blocks[bi], k = id - g.gbase;
    if (reachable(b, k) && fits(g, k)) rKept[id] = 1;
    else { b.valid[k] = 0; rDropped[nd++] = id; }
  }
  for (let pass = 0; pass < 3 && nd; pass++) {
    let again = 0;
    for (let i = 0; i < nd; i++) {
      const id = rDropped[i], bi = rOwner[id], g = geos[bi], b = blocks[bi], k = id - g.gbase;
      if (b.valid[k] || !reachable(b, k) || !fits(g, k)) continue;
      b.valid[k] = 1; rKept[id] = 1; again++;
    }
    if (!again) break;
  }
  // No interior holes: a valid col-k cell always has a valid col-(k-1) cell (holds by construction; kept as a guard).
  for (const b of blocks) for (let r = 0; r < b.rows; r++) {
    for (let c = 1; c < CELL_DEPTH; c++) if (!b.valid[cellIndex(r, c - 1)]) b.valid[cellIndex(r, c)] = 0;
  }
}

/** Tile index of the set (05 §1.3): built from the blocks in build order and their final valid bits. */
function indexBlocks(w: World, blocks: ZoneBlock[], valids: Uint8Array[]): Map<number, string[]> {
  const index = new Map<number, string[]>();
  if (blocks.length > 3000) {
    const sets = new Map<number, Set<string>>();
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi], valid = valids[bi];
      for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
        if (!valid[cellIndex(r, c)]) continue;
        const p = cellPose(b, r, c);
        const tx = Math.floor(p.x), ty = Math.floor(p.z);
        if (!inBounds(w, tx, ty)) continue;
        const t = idx(w, tx, ty);
        const keys = sets.get(t) ?? new Set<string>();
        keys.add(b.key); sets.set(t, keys);
      }
    }
    for (const [k, v] of sets) index.set(k, [...v].sort());
    return index;
  }
  // Tiles touched by each valid cell's centre or corners (the old touchesTileIndex), in the same visiting order
  // (blocks, row, col; the Map keeps first-touch order), deduplicated per block with a stamp instead of a Set per tile.
  const stamp = new Int32Array(w.size * w.size);
  const touch = (bi: number, b: ZoneBlock, x: number, z: number): void => {
    const tx = Math.floor(x), ty = Math.floor(z);
    if (!inBounds(w, tx, ty)) return;
    const t = idx(w, tx, ty);
    if (stamp[t] === bi + 1) return;
    stamp[t] = bi + 1;
    const keys = index.get(t);
    if (keys) keys.push(b.key); else index.set(t, [b.key]);
  };
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi], g = geoOf(b), valid = valids[bi];
    for (let k = 0; k < b.rows * CELL_DEPTH; k++) {
      if (!valid[k]) continue;
      touch(bi, b, g.px[k], g.pz[k]);
      for (let i = 0; i < 4; i++) touch(bi, b, g.corners[k * 8 + i * 2], g.corners[k * 8 + i * 2 + 1]);
    }
  }
  for (const v of index.values()) v.sort();
  return index;
}

/**
 * The set. `tileIndex` is built on first read (nothing in the game reads it on the edit path) from a snapshot of the
 * build order and final valid bits, so it is exactly what an eager build would have produced.
 */
function finalizeSet(w: World, blocks: ZoneBlock[]): ZoneBlockSet {
  const order = blocks.slice(), valids = blocks.map((b) => b.valid.slice());
  const bySeg = new Map<number, ZoneBlock[]>();
  const map = new Map<string, ZoneBlock>();
  for (const b of blocks.sort((a, z) => a.seg - z.seg || a.side - z.side || a.block - z.block)) {
    map.set(b.key, b);
    const arr = bySeg.get(b.seg) ?? [];
    arr.push(b); bySeg.set(b.seg, arr);
  }
  const set = { graphRevision: w.graphRevision, blocks: map, bySeg } as ZoneBlockSet;
  let tileIndex: Map<number, string[]> | undefined;
  Object.defineProperty(set, "tileIndex", {
    enumerable: true, configurable: true,
    get: () => (tileIndex ??= indexBlocks(w, order, valids)),
    set: (v: Map<number, string[]>) => { tileIndex = v; },
  });
  return set;
}

/** Block geometry per segment, reused while the segment's id, type and points stay (frames are never mutated). */
interface SegTemplates { type: number; pts: Float64Array; blocks: ZoneBlock[] }
const templateCache = new WeakMap<World, Map<number, SegTemplates>>();

function cachedBlocks(w: World, seg: RoadSegment, cache: Map<number, SegTemplates>, next: Map<number, SegTemplates>): ZoneBlock[] {
  let t = cache.get(seg.id);
  let same = !!t && t.type === seg.type && t.pts.length === seg.pts.length * 2;
  for (let i = 0; same && i < seg.pts.length; i++) same = t!.pts[i * 2] === seg.pts[i].x && t!.pts[i * 2 + 1] === seg.pts[i].z;
  if (!same) {
    const pts = new Float64Array(seg.pts.length * 2);
    for (let i = 0; i < seg.pts.length; i++) { pts[i * 2] = seg.pts[i].x; pts[i * 2 + 1] = seg.pts[i].z; }
    t = { type: seg.type, pts, blocks: blocksForSegment(w, seg) };
  }
  next.set(seg.id, t!);
  return t!.blocks.map((b) => {
    const n = b.rows * CELL_DEPTH;
    return {
      key: b.key, seg: b.seg, side: b.side, block: b.block, rows: b.rows, s0: b.s0, lat0: b.lat0,
      frame: b.frame, edge: b.edge,
      valid: new Uint8Array(n), zone: new Uint8Array(n), level: new Uint8Array(n), lot: new Int32Array(n).fill(-1),
      age: b.age,
    };
  });
}

export function buildZoneBlocks(w: World, prev?: ZoneBlockSet): ZoneBlockSet {
  if (!prev) {
    const hit = setCache.get(w);
    if (hit && hit.graphRevision === w.graphRevision && hit.obstacleRevision === w.obstacleRevision) return hit.set;
  }
  let tp = zpStart();
  const cache = templateCache.get(w) ?? new Map<number, SegTemplates>();
  const nextCache = new Map<number, SegTemplates>();
  const blocks = w.segments.filter(zoneable).sort((a, b) => a.id - b.id).flatMap((seg) => cachedBlocks(w, seg, cache, nextCache));
  templateCache.set(w, nextCache);
  zpEnd("blocksForSegment", tp);
  applyValidity(w, blocks);
  tp = zpStart();
  resolveOverlaps(w, blocks);
  zpEnd("resolveOverlaps", tp); tp = zpStart();
  const next = finalizeSet(w, blocks);
  zpEnd("finalize", tp); tp = zpStart();
  if (prev) { migrateCells(prev, next); zpEnd("migrate", tp); }
  else setCache.set(w, { graphRevision: w.graphRevision, obstacleRevision: w.obstacleRevision, set: next });
  return next;
}

/**
 * Nearest valid cell within `radius`. With `along` (a unit road tangent) only cells whose own road runs parallel or
 * anti-parallel to it within MIGRATE_ALIGN count: migration must not hand a zone to a crossing road's cells.
 */
export function nearestCell(set: ZoneBlockSet, x: number, z: number, radius: number, along?: { tx: number; tz: number }): CellRef | null {
  let best: CellRef | null = null, bd = radius * radius;
  for (const b of set.blocks.values()) for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
    if (!b.valid[cellIndex(r, c)]) continue;
    const p = cellPose(b, r, c);
    if (along && Math.abs(p.tx * along.tx + p.tz * along.tz) < MIGRATE_ALIGN) continue;
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d <= bd) { bd = d; best = { seg: b.seg, side: b.side, block: b.block, row: r, col: c }; }
  }
  return best;
}

/**
 * nearestCell over a bucket index of the set's valid cells (valid bits must not change while it is used): same
 * candidates, same distance arithmetic; the linear scan keeps the LAST cell (in set order) at the minimum distance,
 * so ties go to the larger visiting ordinal.
 */
class CellIndex {
  private buckets = new Map<number, number[]>();
  private blocks: ZoneBlock[] = [];
  private geos: Geo[] = [];
  private cells: number[] = []; // per entry: block ordinal, cell index
  constructor(set: ZoneBlockSet) {
    for (const b of set.blocks.values()) {
      const bi = this.blocks.length, g = geoOf(b);
      this.blocks.push(b);
      this.geos.push(g);
      for (let k = 0; k < b.rows * CELL_DEPTH; k++) {
        if (!b.valid[k]) continue;
        const e = this.cells.length / 2;
        this.cells.push(bi, k);
        const key = Math.floor(g.pz[k]) * 65536 + Math.floor(g.px[k]);
        const arr = this.buckets.get(key);
        if (arr) arr.push(e); else this.buckets.set(key, [e]);
      }
    }
  }

  nearest(x: number, z: number, radius: number, along?: { tx: number; tz: number }): CellRef | null {
    let best = -1, bd = radius * radius;
    for (let tz = Math.floor(z - radius); tz <= Math.floor(z + radius); tz++) for (let tx = Math.floor(x - radius); tx <= Math.floor(x + radius); tx++) {
      const list = this.buckets.get(tz * 65536 + tx);
      if (!list) continue;
      for (const e of list) {
        const g = this.geos[this.cells[e * 2]], k = this.cells[e * 2 + 1];
        if (along && Math.abs(g.ptx[k] * along.tx + g.ptz[k] * along.tz) < MIGRATE_ALIGN) continue;
        const d = (g.px[k] - x) ** 2 + (g.pz[k] - z) ** 2;
        if (d < bd || (d === bd && e > best)) { bd = d; best = e; }
      }
    }
    if (best < 0) return null;
    const b = this.blocks[this.cells[best * 2]], k = this.cells[best * 2 + 1];
    return { seg: b.seg, side: b.side, block: b.block, row: (k / CELL_DEPTH) | 0, col: k % CELL_DEPTH };
  }
}

function blockOf(set: ZoneBlockSet, ref: CellRef): ZoneBlock | undefined {
  return set.blocks.get(blockKey(ref.seg, ref.side, ref.block));
}

/** shapeKey per frame array: a frame belongs to one block template, and every input of the key comes with it. */
const shapeKeys = new WeakMap<Float32Array, string>();
function shapeKeyOf(b: ZoneBlock): string {
  const hit = shapeKeys.get(b.frame);
  if (hit !== undefined) return hit;
  const k = shapeKey(b);
  shapeKeys.set(b.frame, k);
  return k;
}

export function migrateCells(prev: ZoneBlockSet, next: ZoneBlockSet): MigrationReport {
  const report: MigrationReport = { moved: 0, dropped: [], lotsBroken: [] };
  const lotsBroken = new Set<number>();
  const nextTaken = new Map<string, { level: number; age: number }>();
  let index: CellIndex | undefined;
  for (const old of prev.blocks.values()) {
    const same = next.blocks.get(old.key);
    if (same && same.rows === old.rows && (same.frame === old.frame || shapeKeyOf(same) === shapeKeyOf(old))) {
      for (let i = 0; i < old.zone.length; i++) {
        if (!old.zone[i] || !same.valid[i]) continue;
        same.zone[i] = old.zone[i]; same.level[i] = old.level[i]; same.lot[i] = old.lot[i];
        report.moved++;
      }
      continue;
    }
    for (let r = 0; r < old.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
      const oi = cellIndex(r, c);
      if (!old.zone[oi]) continue;
      const p = cellPose(old, r, c);
      index ??= new CellIndex(next);
      const ref = index.nearest(p.x, p.z, MIGRATE_RADIUS, p);
      if (!ref) { report.dropped.push({ seg: old.seg, side: old.side, block: old.block, row: r, col: c }); if (old.lot[oi] >= 0) lotsBroken.add(old.lot[oi]); continue; }
      const nb = blockOf(next, ref);
      if (!nb) continue;
      const ni = cellIndex(ref.row, ref.col), key = `${nb.key}:${ni}`, cur = nextTaken.get(key);
      const contender = { level: old.level[oi], age: old.age };
      if (!cur || contender.level > cur.level || (contender.level === cur.level && contender.age < cur.age)) {
        nb.zone[ni] = old.zone[oi]; nb.level[ni] = old.level[oi]; nb.lot[ni] = old.lot[oi];
        nextTaken.set(key, contender); report.moved++;
      }
    }
  }
  report.lotsBroken = [...lotsBroken].sort((a, b) => a - b);
  return report;
}
