// Portions adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10): zoning/ZoneGrid.js#_buildFrame, #rebuildLots, #_makeLot; buildings/lots.js#lotsOverlap.
import { ROAD, curvePoints } from "./world";
import type { Pt, World, ZoneType } from "./world";
import type { OrientedLot, ZoneBlock, ZoneBlockSet } from "./zonecells";
import { CELL_DEPTH } from "./zonecells";

export interface PlanOpts { rng: () => number; keep?: readonly OrientedLot[]; seed?: number }

const CURVE_YAW_LIMIT = Math.PI / 30; // 6 degrees.

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash2(a: number, b: number): number {
  let h = (a | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (b | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Preferred lot widths per zone/level (cells along the road). */
function prefWidth(zone: number, level: number): readonly [number, number] {
  if (zone === 1) return level <= 1 ? [1, 2] : [2, 3];
  if (zone === 2) return [2, 4];
  if (zone === 3) return [3, 4];
  return [1, 4];
}

const cellIndex = (row: number, col: number): number => row * CELL_DEPTH + col;

function cellCentre(b: ZoneBlock, row: number, col: number): { x: number; z: number } {
  const o = row * 4;
  const ox = b.frame[o], oz = b.frame[o + 1], tx = b.frame[o + 2], tz = b.frame[o + 3];
  const nx = -tz, nz = tx;
  return { x: ox + b.side * col * nx, z: oz + b.side * col * nz };
}

function yawAtRow(b: ZoneBlock, row: number): number {
  const o = row * 4;
  return Math.atan2(b.frame[o + 2], b.frame[o + 3]);
}

function angleDelta(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function blockOf(set: ZoneBlockSet, lot: Pick<OrientedLot, "seg" | "side" | "block">): ZoneBlock | undefined {
  return set.get(`${lot.seg}:${lot.side}:${lot.block}`);
}

function lotCells(lot: Pick<OrientedLot, "row" | "col" | "w" | "d">): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  for (let row = lot.row; row < lot.row + lot.w; row++) {
    for (let col = lot.col; col < lot.col + lot.d; col++) out.push({ row, col });
  }
  return out;
}

function shapeFits(b: ZoneBlock, row: number, col: number, w: number, d: number, zone: number, level: number): boolean {
  if (row + w > b.rows || col + d > CELL_DEPTH) return false;
  const yaw0 = yawAtRow(b, row);
  for (let r = row; r < row + w; r++) {
    if (angleDelta(yawAtRow(b, r), yaw0) > CURVE_YAW_LIMIT) return false;
    for (let c = col; c < col + d; c++) {
      const i = cellIndex(r, c);
      if (!b.valid[i] || b.zone[i] !== zone || b.level[i] !== level || b.lot[i] !== -1) return false;
    }
  }
  return true;
}

function markLot(b: ZoneBlock, lot: OrientedLot): void {
  for (const c of lotCells(lot)) {
    b.lot[cellIndex(c.row, c.col)] = lot.id;
    b.level[cellIndex(c.row, c.col)] = lot.level;
  }
}

function withPose(b: ZoneBlock, lot: Omit<OrientedLot, "cx" | "cz" | "yaw" | "tiles">): OrientedLot {
  const pose = lotPose(b, lot);
  return { ...lot, ...pose, tiles: [] };
}

function nextIdAfter(keep: readonly OrientedLot[] | undefined): number {
  let next = 1;
  for (const lot of keep ?? []) next = Math.max(next, lot.id + 1);
  return next;
}

/** Lot centre and facing yaw in the segment frame. */
export function lotPose(b: ZoneBlock, lot: Pick<OrientedLot, "row" | "col" | "w" | "d">): { cx: number; cz: number; yaw: number } {
  const a = cellCentre(b, lot.row, lot.col);
  const b0 = cellCentre(b, lot.row + lot.w - 1, lot.col);
  const c = cellCentre(b, lot.row, lot.col + lot.d - 1);
  const d = cellCentre(b, lot.row + lot.w - 1, lot.col + lot.d - 1);
  const midRow = Math.min(b.rows - 1, Math.max(0, lot.row + (lot.w - 1) / 2));
  const r0 = Math.floor(midRow), r1 = Math.ceil(midRow), t = midRow - r0;
  const o0 = r0 * 4, o1 = r1 * 4;
  const tx = b.frame[o0 + 2] * (1 - t) + b.frame[o1 + 2] * t;
  const tz = b.frame[o0 + 3] * (1 - t) + b.frame[o1 + 3] * t;
  const nx = -tz, nz = tx;
  const fx = -b.side * nx, fz = -b.side * nz;
  return {
    cx: (a.x + b0.x + c.x + d.x) / 4,
    cz: (a.z + b0.z + c.z + d.z) / 4,
    yaw: Math.atan2(fx, fz),
  };
}

/** Four lot corners, counter-clockwise, in world x/z. */
export function lotCorners(b: ZoneBlock, lot: OrientedLot, out: Float32Array): void {
  // Same trapezoid corners as the cells (Z2): lot edges coincide with cell edges.
  const e = b.edge;
  if (e && e.length >= (b.rows + 1) * 4) {
    const o0 = lot.row * 4, o1 = (lot.row + lot.w) * 4;
    const x0 = e[o0], z0 = e[o0 + 1], tx0 = e[o0 + 2], tz0 = e[o0 + 3];
    const x1 = e[o1], z1 = e[o1 + 1], tx1 = e[o1 + 2], tz1 = e[o1 + 3];
    const nx0 = -tz0 * b.side, nz0 = tx0 * b.side, nx1 = -tz1 * b.side, nz1 = tx1 * b.side;
    const d0 = b.lat0 - 0.5 + lot.col, d1 = d0 + lot.d;
    out[0] = x0 + nx0 * d0; out[1] = z0 + nz0 * d0;
    out[2] = x1 + nx1 * d0; out[3] = z1 + nz1 * d0;
    out[4] = x1 + nx1 * d1; out[5] = z1 + nz1 * d1;
    out[6] = x0 + nx0 * d1; out[7] = z0 + nz0 * d1;
    return;
  }
  const minRow = lot.row - 0.5, maxRow = lot.row + lot.w - 0.5;
  const minCol = lot.col - 0.5, maxCol = lot.col + lot.d - 0.5;
  const corners = [[minRow, minCol], [maxRow, minCol], [maxRow, maxCol], [minRow, maxCol]] as const;
  for (let k = 0; k < corners.length; k++) {
    const row = Math.max(0, Math.min(b.rows - 1, Math.round(corners[k][0])));
    const o = row * 4, ox = b.frame[o], oz = b.frame[o + 1], tx = b.frame[o + 2], tz = b.frame[o + 3];
    const nx = -tz, nz = tx;
    const ds = corners[k][0] - row;
    out[k * 2] = ox + ds * tx + b.side * corners[k][1] * nx;
    out[k * 2 + 1] = oz + ds * tz + b.side * corners[k][1] * nz;
  }
}

export function lotContains(lot: OrientedLot, b: ZoneBlock, x: number, z: number): boolean {
  const pose = lotPose(b, lot);
  const s = Math.sin(pose.yaw), c = Math.cos(pose.yaw);
  const dx = x - pose.cx, dz = z - pose.cz;
  const along = Math.abs(dx * c - dz * s);
  const deep = Math.abs(dx * s + dz * c);
  return along <= lot.w / 2 + 1e-6 && deep <= lot.d / 2 + 1e-6;
}

/**
 * Deterministically cover zoned, valid, lot-less front cells with lots (fable `rebuildLots`).
 * Per contiguous run of same zone+level fronts: exact DP over widths 1..4 maximising
 * Σ w·minDepth, with -1.2 outside the preferred range and +0.6 for the seeded want.
 * The want is keyed on the front-left cell's world position + zone + world seed, so a
 * repaint elsewhere never re-partitions this run. Back cells beyond a lot's depth stay
 * unlotted (see lotCoverage); col>0 fallback lots are gone (they never grew).
 */
export function planOrientedLots(set: ZoneBlockSet, opts: PlanOpts): OrientedLot[] {
  void opts.rng;
  const seed = opts.seed ?? 0;
  const lots: OrientedLot[] = [];
  let nextId = nextIdAfter(opts.keep);
  for (const b of set.values()) b.lot.fill(-1);

  const kept = [...(opts.keep ?? [])].sort((a, b) => a.id - b.id);
  for (const old of kept) {
    const b = blockOf(set, old);
    if (!b) continue;
    if (!shapeFits(b, old.row, old.col, old.w, old.d, old.zone, old.level)) continue;
    const lot = withPose(b, { id: old.id, seg: old.seg, side: old.side, block: old.block, row: old.row, col: old.col, w: old.w, d: old.d, zone: old.zone, level: old.level });
    markLot(b, lot);
    lots.push(lot);
  }

  for (const b of [...set.values()].sort((a, b2) => a.key.localeCompare(b2.key))) {
    const colDepth = new Uint8Array(b.rows);
    const colZone = new Uint8Array(b.rows);
    const colLevel = new Uint8Array(b.rows);
    for (let r = 0; r < b.rows; r++) {
      const front = cellIndex(r, 0);
      if (!b.valid[front] || !b.zone[front] || b.lot[front] !== -1) continue;
      const z = b.zone[front], lv = b.level[front];
      let d = 1;
      while (d < CELL_DEPTH) {
        const i = cellIndex(r, d);
        if (!b.valid[i] || b.zone[i] !== z || b.level[i] !== lv || b.lot[i] !== -1) break;
        d++;
      }
      colDepth[r] = d; colZone[r] = z; colLevel[r] = lv;
    }
    let r = 0;
    while (r < b.rows) {
      if (!colDepth[r]) { r++; continue; }
      const z = colZone[r], lv = colLevel[r];
      let end = r + 1;
      while (end < b.rows && colDepth[end] && colZone[end] === z && colLevel[end] === lv) end++;
      const L = end - r;
      const rec = prefWidth(z, lv);
      const depthAt = (p: number, w: number): number => {
        let dd = CELL_DEPTH;
        for (let j = p; j < p + w; j++) dd = Math.min(dd, colDepth[r + j]);
        return dd;
      };
      const yawOk = (p: number, w: number): boolean => {
        const y0 = yawAtRow(b, r + p);
        for (let j = 1; j < w; j++) if (angleDelta(yawAtRow(b, r + p + j), y0) > CURVE_YAW_LIMIT) return false;
        return true;
      };
      const wantAt = (p: number): number => {
        const c = cellCentre(b, r + p, 0);
        const rng = mulberry(hash2(hashString(`${Math.round(c.x * 2)},${Math.round(c.z * 2)},${z}`), seed));
        return rec[0] + Math.floor(rng() * (rec[1] - rec[0] + 1));
      };
      const best = new Float64Array(L + 1);
      const choice = new Int8Array(L + 1);
      for (let p = L - 1; p >= 0; p--) {
        const want = wantAt(p);
        let bs = -1e9, bw = 0;
        for (let w = 1; w <= Math.min(4, L - p); w++) {
          if (!yawOk(p, w)) continue;
          const dd = depthAt(p, w);
          let sc = w * dd + best[p + w];
          if (w < rec[0] || w > rec[1]) sc -= 1.2;
          if (w === want) sc += 0.6;
          if (sc > bs) { bs = sc; bw = w; }
        }
        best[p] = bs; choice[p] = bw;
      }
      for (let p = 0; p < L && choice[p];) {
        const w = choice[p];
        const d = Math.max(1, Math.min(depthAt(p, w), CELL_DEPTH));
        const lot = withPose(b, { id: nextId++, seg: b.seg, side: b.side, block: b.block, row: r + p, col: 0, w, d, zone: z as ZoneType, level: lv });
        markLot(b, lot);
        lots.push(lot);
        p += w;
      }
      r = end;
    }
  }
  return lots.sort((a, b) => a.id - b.id);
}

/** Share of zoned valid cells covered by lots (fable `coverage`; 1 when nothing zoned). */
export function lotCoverage(set: ZoneBlockSet): number {
  let zoned = 0, lotted = 0;
  for (const b of set.values()) for (let i = 0; i < b.zone.length; i++) {
    if (!b.valid[i] || !b.zone[i]) continue;
    zoned++;
    if (b.lot[i] >= 0) lotted++;
  }
  return zoned ? lotted / zoned : 1;
}

/**
 * A front cell is served when a connected street or avenue tile touches its tile (8 neighbours: on a diagonal street the
 * kerb tile is often only diagonally adjacent to the cell centre's tile). Highways carry traffic but serve no lots.
 */
function touchesConnectedRoad(w: World, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
      const j = ny * w.size + nx;
      if (w.connected[j] && w.roadSurface[j] && w.roadSurface[j] !== ROAD.HIGHWAY) return true;
    }
  }
  return false;
}

export function lotsReady(w: World, set: ZoneBlockSet, lots: readonly OrientedLot[]): Set<number> {
  const ready = new Set<number>();
  for (const lot of lots) {
    if (lot.col !== 0) continue;
    const b = blockOf(set, lot);
    if (!b) continue;
    let ok = true;
    for (let row = lot.row; row < lot.row + lot.w && ok; row++) {
      const o = row * 4;
      const tileX = Math.floor(b.frame[o]);
      const tileY = Math.floor(b.frame[o + 1]);
      if (tileX < 0 || tileY < 0 || tileX >= w.size || tileY >= w.size || !touchesConnectedRoad(w, tileX, tileY)) ok = false;
    }
    if (ok) ready.add(lot.id);
  }
  return ready;
}

type Obb = { x: number; z: number; w: number; d: number; yaw: number };

function obbCorners(l: Obb): { x: number; z: number }[] {
  const c = Math.cos(l.yaw), s = Math.sin(l.yaw);
  const ax = { x: c, z: -s }, az = { x: s, z: c };
  const hw = l.w / 2, hd = l.d / 2;
  return [
    { x: l.x + ax.x * hw + az.x * hd, z: l.z + ax.z * hw + az.z * hd },
    { x: l.x - ax.x * hw + az.x * hd, z: l.z - ax.z * hw + az.z * hd },
    { x: l.x - ax.x * hw - az.x * hd, z: l.z - ax.z * hw - az.z * hd },
    { x: l.x + ax.x * hw - az.x * hd, z: l.z + ax.z * hw - az.z * hd },
  ];
}

function projectObb(corners: { x: number; z: number }[], ax: { x: number; z: number }): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const c of corners) { const p = c.x * ax.x + c.z * ax.z; if (p < lo) lo = p; if (p > hi) hi = p; }
  return [lo, hi];
}

/** Separating-axis test for two oriented rectangles, with padding (fable `lotsOverlap`, verbatim). */
export function lotsOverlap(a: Obb, b: Obb, pad = 0.4): boolean {
  const ca = obbCorners(a), cb = obbCorners(b);
  for (const l of [a, b]) {
    const c = Math.cos(l.yaw), s = Math.sin(l.yaw);
    for (const ax of [{ x: c, z: -s }, { x: s, z: c }]) {
      const [a0, a1] = projectObb(ca, ax), [b0, b1] = projectObb(cb, ax);
      if (a1 + pad < b0 || b1 + pad < a0) return false;
    }
  }
  return true;
}

function quadProject(q: Float32Array, ax: number, az: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 4; i++) {
    const v = q[i * 2] * ax + q[i * 2 + 1] * az;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return [lo, hi];
}

/** Quad SAT; touching within 1mm is not an overlap (shared lot edges). */
function quadsOverlap(a: Float32Array, b: Float32Array): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      const ex = poly[j * 2] - poly[i * 2], ez = poly[j * 2 + 1] - poly[i * 2 + 1];
      const ax = -ez, az = ex;
      const pa = quadProject(a, ax, az), pb = quadProject(b, ax, az);
      if (Math.min(pa[1], pb[1]) - Math.max(pa[0], pb[0]) <= 1e-3) return false;
    }
  }
  return true;
}

/**
 * Test oracle: counts lot-lot overlaps (trapezoid SAT; OBBs false-positive on
 * curves, so the exact lotCorners quads are used) and lot-road intrusions
 * (lot interior samples within half the drawn width of a centreline).
 */
export function checkLots(
  set: ZoneBlockSet,
  lots: readonly OrientedLot[],
  roads: readonly { pts: Pt[]; half: number }[],
): { lotLot: number; lotRoad: number } {
  let lotLot = 0, lotRoad = 0;
  const quads: Float32Array[] = [];
  for (const l of lots) {
    const b = blockOf(set, l);
    if (!b) continue;
    const q = new Float32Array(8);
    lotCorners(b, l, q);
    quads.push(q);
  }
  for (let i = 0; i < quads.length; i++) for (let j = i + 1; j < quads.length; j++) {
    if (quadsOverlap(quads[i], quads[j])) lotLot++;
  }
  const lines = roads.map((r) => ({ half: r.half, pts: curvePoints(r.pts, 0.25) }));
  const distTo = (x: number, z: number, pts: Pt[]): number => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
      const u = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
      best = Math.min(best, Math.hypot(a.x + vx * u - x, a.z + vz * u - z));
    }
    return best;
  };
  for (const l of lots) {
    const c = Math.cos(l.yaw), sn = Math.sin(l.yaw);
    let hit = false;
    for (let a = -l.w / 2 + 0.1; a <= l.w / 2 - 0.1 && !hit; a += 0.25) {
      for (let dd = -l.d / 2 + 0.1; dd <= l.d / 2 - 0.1 && !hit; dd += 0.25) {
        const x = l.cx + a * c + dd * sn, z = l.cz - a * sn + dd * c;
        for (const line of lines) if (distTo(x, z, line.pts) < line.half - 0.02) { hit = true; break; }
      }
    }
    if (hit) lotRoad++;
  }
  return { lotLot, lotRoad };
}
