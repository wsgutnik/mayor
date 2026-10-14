// Portions adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10): zoning/ZoneGrid.js#_blocked, #_occupied, #_rasterise, #_buildFrame, #_resolveConflicts, #_better.
import {
  baseRoadType, blocksBuilding, curvePoints, heightAt, idx, inBounds, isLand, segElevation,
  type Pt, type RoadSegment, type World,
} from "./world";
import {
  BLOCK_MAX_ROWS, CELL_DEPTH, CELL_SLOPE_LIMIT, type CellPose, type CellRef, type Side, type ZoneBlock,
} from "./zonecells";
import { profileOf } from "./corridor";
import { STRAIGHT_TOL, cornerRadiusFor, junctionsOf } from "./junction";

const MIGRATE_RADIUS = 0.75;
/** Clearance around another road's footprint (fable 0.6m / 8). */
const ROAD_CLEARANCE = 0.075;
/** Corner/edge samples are pulled this fraction toward the cell centre (fable S=0.93). */
const SAMPLE_SHRINK = 0.93;
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

interface CellInfo {
  b: ZoneBlock;
  row: number;
  col: number;
  index: number;
  x: number;
  z: number;
  yaw: number;
  /** Lateral offset of the cell centre from its own centreline (lat0 + col). */
  depth: number;
  grow: number;
  corners: Float32Array;
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

function tileOf(w: World, x: number, z: number): number {
  return idx(w, Math.floor(x), Math.floor(z));
}

function touchesTileIndex(w: World, map: Map<number, Set<string>>, b: ZoneBlock, row: number, col: number): void {
  const pose = cellPose(b, row, col);
  const corners = new Float32Array(8);
  cellCorners(b, row, col, corners);
  for (let i = -1; i < 4; i++) {
    const x = i < 0 ? pose.x : corners[i * 2], z = i < 0 ? pose.z : corners[i * 2 + 1];
    const tx = Math.floor(x), ty = Math.floor(z);
    if (!inBounds(w, tx, ty)) continue;
    const t = idx(w, tx, ty);
    let keys = map.get(t);
    if (!keys) map.set(t, keys = new Set());
    keys.add(b.key);
  }
}

function distPointToSegment(px: number, pz: number, a: Pt, b: Pt): number {
  const vx = b.x - a.x, vz = b.z - a.z;
  const l2 = vx * vx + vz * vz;
  const u = l2 <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / l2));
  const x = a.x + vx * u, z = a.z + vz * u;
  return Math.hypot(px - x, pz - z);
}

function distToCenterline(px: number, pz: number, s: Sampled, flatA = false, flatB = false): number {
  const p = s.pts;
  let best = Infinity;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    if ((flatA && i === 1) || (flatB && i === p.length - 1)) {
      // Flat cap: beyond a node that has a junction polygon the footprint ends; the polygon covers the node area.
      const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
      const u = l2 <= 1e-9 ? 0 : ((px - a.x) * vx + (pz - a.z) * vz) / l2;
      if ((flatA && i === 1 && u < 0) || (flatB && i === p.length - 1 && u > 1)) continue;
    }
    best = Math.min(best, distPointToSegment(px, pz, a, b));
  }
  return best;
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

interface KeepOutPoly { xs: Float64Array; zs: Float64Array; minX: number; maxX: number; minZ: number; maxZ: number }

/**
 * Hard surface of every junction (05 §1.4 c): the `sidewalkOuter` ring of each node layout (asphalt, kerb returns
 * and sidewalk around the corner). Nodes with >= 3 ground arms but no layout fall back to the disc above.
 */
function junctionKeepOut(w: World): { polys: KeepOutPoly[]; discs: { x: number; z: number; r: number }[]; nodes: Set<number> } {
  const polys: KeepOutPoly[] = [];
  const nodes = new Set<number>();
  const byNode = junctionsOf(w).byNode;
  for (const l of byNode.values()) {
    const ring = l.sidewalkOuter;
    if (!ring || ring.length < 3) continue;
    nodes.add(l.nodeId);
    const xs = new Float64Array(ring.length), zs = new Float64Array(ring.length);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      xs[i] = ring[i].x; zs[i] = ring[i].z;
      minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]); minZ = Math.min(minZ, zs[i]); maxZ = Math.max(maxZ, zs[i]);
    }
    polys.push({ xs, zs, minX, maxX, minZ, maxZ });
  }
  const discs = junctionDiscs(w).filter((d) => {
    for (const n of w.nodes) if (n.x === d.x && n.z === d.z) return !nodes.has(n.id);
    return true;
  });
  return { polys, discs, nodes };
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

/** 9 sample points: centre, 4 corners and 4 edge midpoints pulled 7% inward (fable `_blocked`). */
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

function applyValidity(w: World, blocks: ZoneBlock[]): void {
  const roads = w.segments.filter((s) => segElevation(s) === "ground");
  const skipRoadDistance = roads.length > 1000;
  const segById = new Map(w.segments.map((s) => [s.id, s]));
  const roadSamples = new Map<number, Sampled>();
  const roadClear = new Map<number, number>();
  const roadBody = new Map<number, number>();
  const roadCandidates = new Map<number, RoadSegment[]>();
  for (const seg of skipRoadDistance ? [] : roads) {
    roadSamples.set(seg.id, sample(seg.pts));
    const p = profileOf(seg.type);
    roadClear.set(seg.id, p.drawHalf + p.sidewalk + ROAD_CLEARANCE);
    roadBody.set(seg.id, p.drawHalf + p.sidewalk);
    for (const t of seg.tiles) {
      const x = t % w.size, y = (t / w.size) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const tx = x + dx, ty = y + dy;
        if (!inBounds(w, tx, ty)) continue;
        const k = idx(w, tx, ty);
        const arr = roadCandidates.get(k) ?? [];
        if (arr[arr.length - 1] !== seg) arr.push(seg);
        roadCandidates.set(k, arr);
      }
    }
  }
  const keepOut = skipRoadDistance ? { polys: [], discs: [], nodes: new Set<number>() } : junctionKeepOut(w);
  const discs = keepOut.discs;
  const polyAt = new Map<number, KeepOutPoly[]>();
  for (const poly of keepOut.polys) {
    for (let ty = Math.floor(poly.minZ); ty <= Math.floor(poly.maxZ); ty++) for (let tx = Math.floor(poly.minX); tx <= Math.floor(poly.maxX); tx++) {
      const k = ty * 65536 + tx;
      const arr = polyAt.get(k);
      if (arr) arr.push(poly); else polyAt.set(k, [poly]);
    }
  }
  // Straight continuations through shared nodes, once per world (pairs only meet at nodes).
  const continuations = new Map<number, Set<number>>();
  if (!skipRoadDistance) for (const n of w.nodes) {
    if (n.segs.length < 2) continue;
    for (const ia of n.segs) for (const ib of n.segs) {
      if (ia >= ib) continue;
      const sa = segById.get(ia), sb = segById.get(ib);
      if (!sa || !sb || !continues(sa, sb)) continue;
      (continuations.get(ia) ?? continuations.set(ia, new Set()).get(ia)!).add(ib);
      (continuations.get(ib) ?? continuations.set(ib, new Set()).get(ib)!).add(ia);
    }
  }
  const corners = new Float32Array(8);
  const samples = new Float32Array(18);
  for (const b of blocks) {
    const seg = segById.get(b.seg);
    if (!seg) continue;
    const centreline = sample(seg.pts);
    const straightOn = continuations.get(seg.id);
    for (let r = 0; r < b.rows; r++) {
      const road = at(centreline, b.s0 + r);
      for (let c = 0; c < CELL_DEPTH; c++) {
        const p = cellPose(b, r, c);
        const tx = Math.floor(p.x), ty = Math.floor(p.z);
        const k = cellIndex(r, c);
        cellCorners(b, r, c, corners);
        let ok = Math.abs(quadArea(corners)) >= MIN_AREA_FRAC &&
          inBounds(w, tx, ty) && Math.abs(heightAt(w, p.x, p.z) - heightAt(w, road.x, road.z)) <= CELL_SLOPE_LIMIT &&
          isLand(w, tx, ty) && w.facility[tileOf(w, p.x, p.z)] === 0;
        for (let i = 0; ok && i < 4; i++) ok = corners[i * 2] >= 0 && corners[i * 2] <= w.size && corners[i * 2 + 1] >= 0 && corners[i * 2 + 1] <= w.size;
        // Corner water: any corner under water blocks the cell (fable `_blocked`).
        if (ok && (heightAt(w, p.x, p.z) < WATER_H ||
          heightAt(w, corners[0], corners[1]) < WATER_H || heightAt(w, corners[2], corners[3]) < WATER_H ||
          heightAt(w, corners[4], corners[5]) < WATER_H || heightAt(w, corners[6], corners[7]) < WATER_H)) ok = false;
        const ti = ok ? tileOf(w, p.x, p.z) : -1;
        // The road raster marks every tile a centreline touches; on a diagonal that tile reaches ~1.4 tiles from the
        // centreline, so testing it rejected the depth-0 cells beside their own road (and the cut-off then the row).
        // Ground roads are tested analytically below; the raster still rejects decks and non-ground roads.
        if (ok && blocksBuilding(w, ti) && (skipRoadDistance || w.roadSurface[ti] === 0 || w.roadDeck[ti] !== 0)) ok = false;
        if (ok && !skipRoadDistance) {
          cellSamples(p.x, p.z, corners, samples);
          const cands = roadCandidates.get(ti) ?? [];
          for (let s = 0; ok && s < 9; s++) {
            const sx = samples[s * 2], sz = samples[s * 2 + 1];
            for (const other of cands) {
              // Own road (and its straight continuation): only the physical body (asphalt + sidewalk), so depth 0
              // always touches the sidewalk; other roads keep ROAD_CLEARANCE beyond their sidewalk.
              const limit = other.id === b.seg || straightOn?.has(other.id) ? roadBody.get(other.id)! : roadClear.get(other.id)!;
              if (distToCenterline(sx, sz, roadSamples.get(other.id)!, keepOut.nodes.has(other.a), keepOut.nodes.has(other.b)) < limit) { ok = false; break; }
            }
            if (ok) {
              const near = polyAt.get(Math.floor(sz) * 65536 + Math.floor(sx));
              if (near) for (const poly of near) if (inKeepOut(poly, sx, sz)) { ok = false; break; }
            }
            if (ok) for (const d of discs) {
              if ((sx - d.x) * (sx - d.x) + (sz - d.z) * (sz - d.z) < d.r * d.r) { ok = false; break; }
            }
          }
        }
        b.valid[k] = ok ? 1 : 0;
      }
      for (let c = 1; c < CELL_DEPTH; c++) if (!b.valid[cellIndex(r, c - 1)]) b.valid[cellIndex(r, c)] = 0;
    }
  }
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

function projectQuad(poly: Float32Array, ax: number, az: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 4; i++) {
    const v = poly[i * 2] * ax + poly[i * 2 + 1] * az;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return [lo, hi];
}

/** SAT overlap; touching within 1mm is not an overlap (shared cell edges). */
function quadsOverlap(a: Float32Array, b: Float32Array): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      const ex = poly[j * 2] - poly[i * 2], ez = poly[j * 2 + 1] - poly[i * 2 + 1];
      const ax = -ez, az = ex;
      const pa = projectQuad(a, ax, az), pb = projectQuad(b, ax, az);
      if (Math.min(pa[1], pb[1]) - Math.max(pa[0], pb[0]) <= 1e-3) return false;
    }
  }
  return true;
}

/**
 * Priority order for contested cells: the cell nearer its own centreline wins (lateral offset lat0 + col, exact on
 * straight and curved frames), so where two roads' blocks meet each cell goes to the road it is nearest to. Ties
 * (equal depth: two depth-0 cells in an acute wedge, a shared corner cell) go to the older segment, then side, row.
 * The old CS1 col band (col <= 1 beats col >= 2, then wider road) let an older road's depth-1 cell evict a younger
 * road's depth-0 cell and the cut-off then emptied that row: the zone floated away from the kerb.
 */
function cellBetter(a: CellInfo, b: CellInfo): boolean {
  if (Math.abs(a.depth - b.depth) > 1e-6) return a.depth < b.depth;
  if (a.b.age !== b.b.age) return a.b.age < b.b.age;
  if (a.b.side !== b.b.side) return a.b.side < b.b.side;
  if (a.grow !== b.grow) return a.grow < b.grow;
  if (a.col !== b.col) return a.col < b.col;
  return a.b.key < b.b.key;
}

function validCells(b: ZoneBlock): CellInfo[] {
  const out: CellInfo[] = [];
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
    const k = cellIndex(r, c);
    if (!b.valid[k]) continue;
    const p = cellPose(b, r, c);
    const corners = new Float32Array(8);
    cellCorners(b, r, c, corners);
    out.push({ b, row: r, col: c, index: k, x: p.x, z: p.z, yaw: p.yaw, depth: b.lat0 + c, grow: b.s0 + r, corners });
  }
  return out;
}

/**
 * Greedy priority-ordered independent set with second-chance passes (fable `_resolveConflicts`).
 * Sorted once by (depth from own centreline, age, side, row); a cell is kept when it fits against already-kept
 * rivals, then dropped cells get 3 re-admission passes. Because depth order visits col k-1 of a row before col k,
 * a cell whose col k-1 neighbour was dropped is dropped too instead of reserving space it can never use (that
 * phantom reservation left grass gaps beside the rival block). Frame neighbours never conflict.
 */
function resolveOverlaps(_w: World, blocks: ZoneBlock[]): void {
  if (blocks.length > 3000) return;
  const alive: CellInfo[] = [];
  for (const b of blocks) alive.push(...validCells(b));
  alive.sort((a, b) => (cellBetter(a, b) ? -1 : 1));
  const buckets = new Map<number, CellInfo[]>();
  const keyOf = (cx: number, cz: number) => cz * 65536 + cx;
  const R2 = CONFLICT_DIST * CONFLICT_DIST;
  const reachable = (c: CellInfo): boolean => c.col === 0 || c.b.valid[c.index - 1] === 1;
  const fits = (c: CellInfo): boolean => {
    const ccx = Math.floor(c.x), ccz = Math.floor(c.z);
    // Two overlapping unit cells can have centres up to sqrt(2) apart, i.e. two buckets away on rotated frames.
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const list = buckets.get(keyOf(ccx + dx, ccz + dz));
      if (!list) continue;
      for (const o of list) {
        if (o.b.seg === c.b.seg && o.b.side === c.b.side && o.col === c.col && Math.abs(o.grow - c.grow) <= 1.01) continue;
        const d2 = (o.x - c.x) ** 2 + (o.z - c.z) ** 2;
        if (d2 < R2 || pointInQuad(o.corners, c.x, c.z) || pointInQuad(c.corners, o.x, o.z) || quadsOverlap(o.corners, c.corners)) return false;
      }
    }
    return true;
  };
  const keep = (c: CellInfo): void => {
    const k = keyOf(Math.floor(c.x), Math.floor(c.z));
    const arr = buckets.get(k);
    if (arr) arr.push(c); else buckets.set(k, [c]);
  };
  const dropped: CellInfo[] = [];
  for (const c of alive) {
    if (reachable(c) && fits(c)) keep(c);
    else { c.b.valid[c.index] = 0; dropped.push(c); }
  }
  for (let pass = 0; pass < 3 && dropped.length; pass++) {
    let again = 0;
    for (const c of dropped) {
      if (c.b.valid[c.index] || !reachable(c) || !fits(c)) continue;
      c.b.valid[c.index] = 1; keep(c); again++;
    }
    if (!again) break;
  }
  // No interior holes: a valid col-k cell always has a valid col-(k-1) cell (holds by construction; kept as a guard).
  for (const b of blocks) for (let r = 0; r < b.rows; r++) {
    for (let c = 1; c < CELL_DEPTH; c++) if (!b.valid[cellIndex(r, c - 1)]) b.valid[cellIndex(r, c)] = 0;
  }
}

function indexBlocks(w: World, blocks: ZoneBlock[]): Map<number, Set<string>> {
  const index = new Map<number, Set<string>>();
  if (blocks.length > 3000) {
    for (const b of blocks) for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
      if (!b.valid[cellIndex(r, c)]) continue;
      const p = cellPose(b, r, c);
      const tx = Math.floor(p.x), ty = Math.floor(p.z);
      if (!inBounds(w, tx, ty)) continue;
      const t = idx(w, tx, ty);
      const keys = index.get(t) ?? new Set<string>();
      keys.add(b.key); index.set(t, keys);
    }
    return index;
  }
  for (const b of blocks) {
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
      if (b.valid[cellIndex(r, c)]) touchesTileIndex(w, index, b, r, c);
    }
  }
  return index;
}

function finalizeSet(w: World, blocks: ZoneBlock[]): ZoneBlockSet {
  const raw = indexBlocks(w, blocks);
  const tileIndex = new Map<number, string[]>();
  for (const [k, v] of raw) tileIndex.set(k, [...v].sort());
  const bySeg = new Map<number, ZoneBlock[]>();
  const map = new Map<string, ZoneBlock>();
  for (const b of blocks.sort((a, z) => a.seg - z.seg || a.side - z.side || a.block - z.block)) {
    map.set(b.key, b);
    const arr = bySeg.get(b.seg) ?? [];
    arr.push(b); bySeg.set(b.seg, arr);
  }
  return { graphRevision: w.graphRevision, blocks: map, bySeg, tileIndex };
}

export function buildZoneBlocks(w: World, prev?: ZoneBlockSet): ZoneBlockSet {
  if (!prev) {
    const hit = setCache.get(w);
    if (hit && hit.graphRevision === w.graphRevision && hit.obstacleRevision === w.obstacleRevision) return hit.set;
  }
  const blocks = w.segments.filter(zoneable).sort((a, b) => a.id - b.id).flatMap((seg) => blocksForSegment(w, seg));
  applyValidity(w, blocks);
  resolveOverlaps(w, blocks);
  const next = finalizeSet(w, blocks);
  if (prev) migrateCells(prev, next);
  else setCache.set(w, { graphRevision: w.graphRevision, obstacleRevision: w.obstacleRevision, set: next });
  return next;
}

export function nearestCell(set: ZoneBlockSet, x: number, z: number, radius: number): CellRef | null {
  let best: CellRef | null = null, bd = radius * radius;
  for (const b of set.blocks.values()) for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
    if (!b.valid[cellIndex(r, c)]) continue;
    const p = cellPose(b, r, c);
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d <= bd) { bd = d; best = { seg: b.seg, side: b.side, block: b.block, row: r, col: c }; }
  }
  return best;
}

function blockOf(set: ZoneBlockSet, ref: CellRef): ZoneBlock | undefined {
  return set.blocks.get(blockKey(ref.seg, ref.side, ref.block));
}

export function migrateCells(prev: ZoneBlockSet, next: ZoneBlockSet): MigrationReport {
  const report: MigrationReport = { moved: 0, dropped: [], lotsBroken: [] };
  const lotsBroken = new Set<number>();
  const nextTaken = new Map<string, { level: number; age: number }>();
  for (const old of prev.blocks.values()) {
    const same = next.blocks.get(old.key);
    if (same && same.rows === old.rows && shapeKey(same) === shapeKey(old)) {
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
      const ref = nearestCell(next, p.x, p.z, MIGRATE_RADIUS);
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
