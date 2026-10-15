/**
 * FROZEN ORACLE (task zperf): verbatim copy of src/sim/mirror.ts at 8afbab1, before the zone pipeline was made incremental.
 * Test-only (zone-perf.diff.test.ts swaps it in through zoneHooks and asserts byte-identical results). Never import it
 * from game code and never "fix" it: it defines the expected output.
 */
import { lotContains } from "./orientedlots";
import { cellIndex, cellPose, type ZoneBlockSet } from "./zoneblocks";
import { blocksBuilding, idx, inBounds, isLand, type World, type WorldLot } from "../world";
import type { CellRef, OrientedLot, ZoneBlock } from "../zonecells";

export { nearestCell } from "./zoneblocks";

interface TileCell { ref: CellRef; block: ZoneBlock; index: number; col: number; age: number; row: number }

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

/** Rewrite w.zone, w.level, w.lotAt and w.lots from cells and oriented lots. Idempotent. */
export function rasterizeMirror(w: World, set: ZoneBlockSet, lots: readonly OrientedLot[]): void {
  clearMirror(w);
  const index = new Int32Array(w.size * w.size).fill(-1);
  const order = new Map<string, number>();
  let n = 0;
  for (const key of [...set.blocks.keys()].sort()) order.set(key, n++);
  const winners = new Map<number, TileCell>();
  for (const b of set.blocks.values()) {
    for (let row = 0; row < b.rows; row++) for (let col = 0; col < 4; col++) {
      const i = cellIndex(row, col);
      if (!b.valid[i] || !b.zone[i]) continue;
      const p = cellPose(b, row, col);
      const x = Math.floor(p.x), y = Math.floor(p.z);
      if (!inBounds(w, x, y)) continue;
      const tile = idx(w, x, y);
      if (!tileAllowed(w, tile)) continue;
      const cur = winners.get(tile);
      const next = { ref: { seg: b.seg, side: b.side, block: b.block, row, col }, block: b, index: i, col, age: b.age, row };
      if (!cur || col < cur.col || (col === cur.col && (b.age < cur.age || (b.age === cur.age && row < cur.row)))) winners.set(tile, next);
    }
  }
  for (const [tile, cell] of winners) {
    w.zone[tile] = cell.block.zone[cell.index];
    w.level[tile] = cell.block.level[cell.index];
    index[tile] = pack(order.get(cell.block.key) ?? 0, cell.ref.row, cell.ref.col);
  }

  for (const lot of lots) {
    const b = set.blocks.get(`${lot.seg}:${lot.side}:${lot.block}`);
    lot.tiles = [];
    if (!b) continue;
    const claimed = new Set<number>();
    for (let row = lot.row; row < lot.row + lot.w; row++) for (let col = lot.col; col < lot.col + lot.d; col++) {
      const p = cellPose(b, row, col);
      const x = Math.floor(p.x), y = Math.floor(p.z);
      if (inBounds(w, x, y)) claimed.add(idx(w, x, y));
    }
    for (let y = Math.max(0, Math.floor(lot.cz - lot.d - 1)); y <= Math.min(w.size - 1, Math.ceil(lot.cz + lot.d + 1)); y++) {
      for (let x = Math.max(0, Math.floor(lot.cx - lot.w - 1)); x <= Math.min(w.size - 1, Math.ceil(lot.cx + lot.w + 1)); x++) {
        const tile = idx(w, x, y);
        if (lotContains(lot, b, x + 0.5, y + 0.5)) claimed.add(tile);
      }
    }
    for (const tile of [...claimed].sort((a, b) => a - b)) {
      if (!tileAllowed(w, tile)) continue;
      const win = winners.get(tile);
      if (win && win.block.lot[win.index] !== lot.id) continue;
      w.lotAt[tile] = lot.id;
      if (!lot.tiles.includes(tile)) lot.tiles.push(tile);
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
