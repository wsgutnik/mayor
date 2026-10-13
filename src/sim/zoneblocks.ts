import {
  ROAD_TILE_WIDTH, baseRoadType, blocksBuilding, curvePoints, heightAt, idx, inBounds, isLand, segElevation,
  type Pt, type RoadSegment, type World,
} from "./world";
import {
  BLOCK_MAX_ROWS, CELL_DEPTH, CELL_SLOPE_LIMIT, type CellPose, type CellRef, type Side, type ZoneBlock,
} from "./zonecells";

const MIGRATE_RADIUS = 0.75;

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
}

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

function roadHalfWidth(seg: RoadSegment): number {
  return ROAD_TILE_WIDTH[seg.type] / 2;
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
        seg: seg.id, side, block, rows: blockRows, s0: s0 + rowStart, lat0,
        frame,
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

function distToCenterline(px: number, pz: number, s: Sampled): number {
  const p = s.pts;
  let best = Infinity;
  for (let i = 1; i < p.length; i++) best = Math.min(best, distPointToSegment(px, pz, p[i - 1], p[i]));
  return best;
}

function applyValidity(w: World, blocks: ZoneBlock[]): void {
  const roads = w.segments.filter((s) => segElevation(s) === "ground");
  const skipRoadDistance = roads.length > 1000;
  const segById = new Map(w.segments.map((s) => [s.id, s]));
  const roadSamples = new Map<number, Sampled>();
  const roadCandidates = new Map<number, RoadSegment[]>();
  for (const seg of skipRoadDistance ? [] : roads) {
    roadSamples.set(seg.id, sample(seg.pts));
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
  const corners = new Float32Array(8);
  for (const b of blocks) {
    const seg = segById.get(b.seg);
    if (!seg) continue;
    const centreline = sample(seg.pts);
    for (let r = 0; r < b.rows; r++) {
      const road = at(centreline, b.s0 + r);
      for (let c = 0; c < CELL_DEPTH; c++) {
        const p = cellPose(b, r, c);
        const tx = Math.floor(p.x), ty = Math.floor(p.z);
        const k = cellIndex(r, c);
        cellCorners(b, r, c, corners);
        let ok = inBounds(w, tx, ty) && Math.abs(heightAt(w, p.x, p.z) - heightAt(w, road.x, road.z)) <= CELL_SLOPE_LIMIT &&
          isLand(w, tx, ty) && w.facility[tileOf(w, p.x, p.z)] === 0;
        for (let i = 0; ok && i < 4; i++) ok = corners[i * 2] >= 0 && corners[i * 2] <= w.size && corners[i * 2 + 1] >= 0 && corners[i * 2 + 1] <= w.size;
        const ti = ok ? tileOf(w, p.x, p.z) : -1;
        if (ok && blocksBuilding(w, ti)) ok = false;
        if (!skipRoadDistance) {
          for (const other of roadCandidates.get(ti) ?? []) {
            if (!ok) break;
            if (other.id === b.seg) continue;
            if (distToCenterline(p.x, p.z, roadSamples.get(other.id)!) < roadHalfWidth(other) + 0.45) ok = false;
          }
        }
        b.valid[k] = ok ? 1 : 0;
      }
      for (let c = 1; c < CELL_DEPTH; c++) if (!b.valid[cellIndex(r, c - 1)]) b.valid[cellIndex(r, c)] = 0;
    }
  }
}

function yawShared(a: number, b: number): boolean {
  const q = Math.PI / 2;
  const d = Math.abs((((a - b) % q) + q) % q);
  return Math.min(d, q - d) < q * 0.01;
}

function project(poly: Float32Array, ax: number, az: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 4; i++) {
    const v = poly[i * 2] * ax + poly[i * 2 + 1] * az;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return [lo, hi];
}

function overlaps(a: Float32Array, b: Float32Array): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      const ex = poly[j * 2] - poly[i * 2], ez = poly[j * 2 + 1] - poly[i * 2 + 1];
      const ax = -ez, az = ex;
      const pa = project(a, ax, az), pb = project(b, ax, az);
      if (Math.min(pa[1], pb[1]) - Math.max(pa[0], pb[0]) <= 0.05) return false;
    }
  }
  return true;
}

function loser(a: CellInfo, b: CellInfo, shared: boolean): CellInfo {
  if (shared) {
    if (a.col !== b.col) return a.col < b.col ? b : a;
    if (a.b.age !== b.b.age) return a.b.age < b.b.age ? b : a;
  } else {
    const ba = a.col <= 1 ? 0 : 1, bb = b.col <= 1 ? 0 : 1;
    if (ba !== bb) return ba < bb ? b : a;
    if (a.b.age !== b.b.age) return a.b.age < b.b.age ? b : a;
  }
  if (a.b.key !== b.b.key) return a.b.key < b.b.key ? b : a;
  return a.row <= b.row ? b : a;
}

function validCells(b: ZoneBlock): CellInfo[] {
  const out: CellInfo[] = [];
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
    const k = cellIndex(r, c);
    if (!b.valid[k]) continue;
    const p = cellPose(b, r, c);
    out.push({ b, row: r, col: c, index: k, x: p.x, z: p.z, yaw: p.yaw });
  }
  return out;
}

function resolveOverlaps(blocks: ZoneBlock[], rawIndex: Map<number, Set<string>>): void {
  void rawIndex;
  if (blocks.length > 3000) return;
  const byTile = new Map<string, CellInfo[]>();
  for (const b of blocks) for (const cell of validCells(b)) {
    const corners = new Float32Array(8);
    cellCorners(b, cell.row, cell.col, corners);
    for (let i = -1; i < 4; i++) {
      const x = i < 0 ? cell.x : corners[i * 2], z = i < 0 ? cell.z : corners[i * 2 + 1];
      const key = `${Math.floor(x)},${Math.floor(z)}`;
      const arr = byTile.get(key) ?? [];
      arr.push(cell); byTile.set(key, arr);
    }
  }
  const seen = new Set<string>();
  const ca = new Float32Array(8), cb = new Float32Array(8);
  for (const list of byTile.values()) {
    for (let ai = 0; ai < list.length; ai++) for (let bi = ai + 1; bi < list.length; bi++) {
      const a = list[ai], b = list[bi];
      const aid = `${a.b.key}:${a.index}`, bid = `${b.b.key}:${b.index}`;
      if (aid === bid) continue;
      const pair = aid <= bid ? `${aid}|${bid}` : `${bid}|${aid}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      if (!a.b.valid[a.index] || !b.b.valid[b.index]) continue;
      const d2 = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
      if (d2 >= 1) continue;
      const shared = d2 < 0.01 && yawShared(a.yaw, b.yaw);
      if (!shared) {
        cellCorners(a.b, a.row, a.col, ca); cellCorners(b.b, b.row, b.col, cb);
        if (!overlaps(ca, cb)) continue;
      }
      const lose = loser(a, b, shared);
      lose.b.valid[lose.index] = 0;
    }
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
  resolveOverlaps(blocks, indexBlocks(w, blocks));
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
