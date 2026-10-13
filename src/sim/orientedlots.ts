import { ROAD } from "./world";
import type { World, ZoneType } from "./world";
import type { OrientedLot, ZoneBlock, ZoneBlockSet } from "./zonecells";
import { CELL_DEPTH } from "./zonecells";

export interface PlanOpts { rng: () => number; keep?: readonly OrientedLot[] }

type Shape = readonly [number, number];
const BASE_SHAPES: readonly Shape[] = [[4, 4], [4, 2], [2, 2], [2, 1], [1, 2], [1, 1]];
const CURVE_YAW_LIMIT = Math.PI / 30; // 6 degrees.

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

/** Deterministically cover zoned, valid, lot-less cells of every block with front-fronting lots. */
export function planOrientedLots(set: ZoneBlockSet, opts: PlanOpts): OrientedLot[] {
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

  for (const b of [...set.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const fronts: number[] = [];
    for (let row = 0; row < b.rows; row++) {
      const i = cellIndex(row, 0);
      if (b.valid[i] && b.zone[i] && b.lot[i] === -1) fronts.push(row);
    }
    for (let i = fronts.length - 1; i > 0; i--) {
      const j = Math.floor(opts.rng() * (i + 1));
      [fronts[i], fronts[j]] = [fronts[j], fronts[i]];
    }
    for (const row of fronts) {
      const front = cellIndex(row, 0);
      if (b.lot[front] !== -1) continue;
      const zone = b.zone[front] as ZoneType, level = b.level[front];
      const shapes = zone !== 1 && level >= 2 ? [[4, 4], [3, 3], ...BASE_SHAPES.slice(2)] : BASE_SHAPES.slice(2);
      for (const [w, d] of shapes) {
        if (!shapeFits(b, row, 0, w, d, zone, level)) continue;
        const lot = withPose(b, { id: nextId++, seg: b.seg, side: b.side, block: b.block, row, col: 0, w, d, zone, level });
        while (lot.col + lot.d < CELL_DEPTH && shapeFits(b, lot.row, lot.col, lot.w, lot.d + 1, lot.zone, lot.level)) lot.d++;
        Object.assign(lot, lotPose(b, lot));
        markLot(b, lot);
        lots.push(lot);
        break;
      }
    }
    for (let row = 0; row < b.rows; row++) for (let col = 1; col < CELL_DEPTH; col++) {
      const i = cellIndex(row, col);
      if (!b.valid[i] || !b.zone[i] || b.lot[i] !== -1) continue;
      const lot = withPose(b, { id: nextId++, seg: b.seg, side: b.side, block: b.block, row, col, w: 1, d: 1, zone: b.zone[i] as ZoneType, level: b.level[i] });
      markLot(b, lot);
      lots.push(lot);
    }
  }
  return lots.sort((a, b) => a.id - b.id);
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
