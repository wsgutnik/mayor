import { lotPose } from "./orientedlots";
import { cellCentres, cellIndex, cellPose, type ZoneBlockSet } from "./zoneblocks";
import { CELL_DEPTH } from "./zonecells";
import { blocksBuilding, idx, inBounds, isLand, type World, type WorldLot } from "./world";
import type { CellRef, OrientedLot, ZoneBlock } from "./zonecells";

export { nearestCell } from "./zoneblocks";

const cellTiles = new WeakMap<World, Int32Array>();

function pack(block: number, row: number, col: number): number {
  return (block << 6) | (row << 2) | col;
}

function unpack(v: number): { block: number; row: number; col: number } {
  return { block: v >> 6, row: (v >> 2) & 15, col: v & 3 };
}

function clearMirror(w: World): void {
  w.zone.fill(0);
  w.level.fill(0);
  w.lotAt.fill(-1);
  w.lots = [];
}

function legacyFacing(yaw: number): WorldLot["facing"] {
  const sx = Math.sin(yaw), sz = Math.cos(yaw);
  if (Math.abs(sx) > Math.abs(sz)) return { dx: sx > 0 ? 1 : -1, dy: 0 };
  return { dx: 0, dy: sz > 0 ? 1 : -1 };
}

function legacyLot(w: World, lot: OrientedLot): WorldLot | null {
  if (!lot.tiles.length) return null;
  let minX = w.size, minY = w.size, maxX = -1, maxY = -1;
  for (const t of lot.tiles) {
    const x = t % w.size, y = (t / w.size) | 0;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return {
    id: lot.id, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
    facing: legacyFacing(lot.yaw), zone: lot.zone, level: lot.level, depthFromRoad: lot.col,
  };
}

function tileAllowed(w: World, tile: number): boolean {
  const x = tile % w.size, y = (tile / w.size) | 0;
  return inBounds(w, x, y) && !blocksBuilding(w, tile) && !w.facility[tile] && isLand(w, x, y);
}

/** Sorted block keys -> ordinal, per block set (the keys never change within a set). */
const keyOrder = new WeakMap<ZoneBlockSet, Map<string, number>>();

function orderOf(set: ZoneBlockSet): Map<string, number> {
  let order = keyOrder.get(set);
  if (order && order.size === set.blocks.size) {
    let same = true;
    for (const key of set.blocks.keys()) if (!order.has(key)) { same = false; break; }
    if (same) return order;
  }
  order = new Map<string, number>();
  let n = 0;
  for (const key of [...set.blocks.keys()].sort()) order.set(key, n++);
  keyOrder.set(set, order);
  return order;
}

let mCap = 0;
let mBlock = new Int32Array(0), mIndex = new Int32Array(0), mCol = new Int32Array(0), mRow = new Int32Array(0);
let mAge = new Float64Array(0);

/**
 * Rewrite w.zone, w.level, w.lotAt and w.lots from cells and oriented lots. Idempotent.
 * (zperf: same decisions as before on flat per-tile arrays; each lot's pose is computed once instead of per tile.)
 */
export function rasterizeMirror(w: World, set: ZoneBlockSet, lots: readonly OrientedLot[]): void {
  clearMirror(w);
  const N = w.size * w.size;
  const index = new Int32Array(N).fill(-1);
  const order = orderOf(set);
  if (mCap < N) {
    mCap = N;
    mBlock = new Int32Array(N); mIndex = new Int32Array(N); mCol = new Int32Array(N); mRow = new Int32Array(N); mAge = new Float64Array(N);
  }
  mBlock.fill(-1, 0, N);
  const blocks: ZoneBlock[] = [];
  const touched: number[] = [];
  for (const b of set.blocks.values()) {
    const bi = blocks.length;
    blocks.push(b);
    let cc: { px: Float64Array; pz: Float64Array } | null = null;
    for (let row = 0; row < b.rows; row++) for (let col = 0; col < 4; col++) {
      const i = cellIndex(row, col);
      if (!b.valid[i] || !b.zone[i]) continue;
      cc ??= cellCentres(b);
      const x = Math.floor(cc.px[i]), y = Math.floor(cc.pz[i]);
      if (!inBounds(w, x, y)) continue;
      const tile = idx(w, x, y);
      if (!tileAllowed(w, tile)) continue;
      const cur = mBlock[tile];
      if (cur < 0) touched.push(tile);
      if (cur < 0 || col < mCol[tile] || (col === mCol[tile] && (b.age < mAge[tile] || (b.age === mAge[tile] && row < mRow[tile])))) {
        mBlock[tile] = bi; mIndex[tile] = i; mCol[tile] = col; mAge[tile] = b.age; mRow[tile] = row;
      }
    }
  }
  for (const tile of touched) {
    const b = blocks[mBlock[tile]];
    w.zone[tile] = b.zone[mIndex[tile]];
    w.level[tile] = b.level[mIndex[tile]];
    index[tile] = pack(order.get(b.key) ?? 0, mRow[tile], mCol[tile]);
  }

  const claimed: number[] = [];
  for (const lot of lots) {
    const b = set.blocks.get(`${lot.seg}:${lot.side}:${lot.block}`);
    lot.tiles = [];
    if (!b) continue;
    claimed.length = 0;
    const cc = cellCentres(b);
    for (let row = lot.row; row < lot.row + lot.w; row++) for (let col = lot.col; col < lot.col + lot.d; col++) {
      const inside = row >= 0 && row < b.rows && col >= 0 && col < CELL_DEPTH;
      const p = inside ? null : cellPose(b, row, col);
      const x = Math.floor(p ? p.x : cc.px[cellIndex(row, col)]), y = Math.floor(p ? p.z : cc.pz[cellIndex(row, col)]);
      if (inBounds(w, x, y)) claimed.push(idx(w, x, y));
    }
    // lotContains(lot, b, x + 0.5, y + 0.5), with the pose hoisted (it depends on the lot only).
    const pose = lotPose(b, lot);
    const s = Math.sin(pose.yaw), c = Math.cos(pose.yaw);
    const hw = lot.w / 2 + 1e-6, hd = lot.d / 2 + 1e-6;
    // The old scan box, cut to the rectangle's own extent (|dx| <= hw |cos| + hd |sin|, plus slack): tiles outside it
    // can never pass the test below.
    const ex = hw * Math.abs(c) + hd * Math.abs(s) + 0.01, ez = hw * Math.abs(s) + hd * Math.abs(c) + 0.01;
    const y0 = Math.max(0, Math.floor(lot.cz - lot.d - 1), Math.ceil(pose.cz - ez - 0.5));
    const y1 = Math.min(w.size - 1, Math.ceil(lot.cz + lot.d + 1), Math.floor(pose.cz + ez - 0.5));
    const x0 = Math.max(0, Math.floor(lot.cx - lot.w - 1), Math.ceil(pose.cx - ex - 0.5));
    const x1 = Math.min(w.size - 1, Math.ceil(lot.cx + lot.w + 1), Math.floor(pose.cx + ex - 0.5));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - pose.cx, dz = y + 0.5 - pose.cz;
        if (Math.abs(dx * c - dz * s) <= hw && Math.abs(dx * s + dz * c) <= hd) claimed.push(idx(w, x, y));
      }
    }
    claimed.sort((p, q) => p - q);
    let last = -1;
    for (const tile of claimed) {
      if (tile === last) continue;
      last = tile;
      if (!tileAllowed(w, tile)) continue;
      const wb = mBlock[tile];
      if (wb >= 0 && blocks[wb].lot[mIndex[tile]] !== lot.id) continue;
      w.lotAt[tile] = lot.id;
      lot.tiles.push(tile);
    }
    const legacy = legacyLot(w, lot);
    if (legacy) w.lots.push(legacy);
  }
  cellTiles.set(w, index);
}

/** Cell whose centre tile is `tile`, if any (the inverse map the mirror writes). */
export function cellAt(w: World, tile: number): CellRef | null {
  const packed = cellTiles.get(w)?.[tile] ?? -1;
  if (packed < 0 || !w.cells) return null;
  const { block, row, col } = unpack(packed);
  const cells = w.cells as unknown as ZoneBlockSet;
  const key = [...cells.blocks.keys()].sort()[block];
  const b = key ? cells.blocks.get(key) : undefined;
  return b ? { seg: b.seg, side: b.side, block: b.block, row, col } : null;
}

/** Test hook: the packed cell index the mirror wrote (cellAt's inverse map). */
export function mirrorIndex(w: World): Int32Array | undefined {
  return cellTiles.get(w);
}
