import type { World } from "./world";
import { idx } from "./world";
import { cellIndex, type ZoneBlockSet } from "./zoneblocks";
import { lotPose } from "./orientedlots";
import type { OrientedLot } from "./zonecells";

/** Minimum mean land value needed to begin each growable level (1 is initial construction). */
export const EVOLUTION_LAND_VALUE = [0, 0, 24, 42, 61, 78] as const;

/** Maximum target footprint (frontage × depth) by zone and resulting level. */
export function evolutionFootprint(zone: number, level: number): readonly [number, number] {
  // Residential reaches 4×4 at L5; commerce trails a level; industry gets
  // broad earlier sites. A smaller rectangle is valid if a block edge stops it.
  const res: readonly (readonly [number, number])[] = [[1, 2], [2, 2], [3, 3], [4, 3], [4, 4]];
  const com: readonly (readonly [number, number])[] = [[1, 1], [1, 2], [2, 2], [3, 3], [4, 4]];
  const ind: readonly (readonly [number, number])[] = [[1, 2], [2, 3], [3, 3], [4, 3], [4, 4]];
  const list = zone === 1 ? res : zone === 2 ? com : ind;
  return list[Math.max(0, Math.min(list.length - 1, level - 1))];
}

function key(lot: Pick<OrientedLot, "seg" | "side" | "block">): string { return `${lot.seg}:${lot.side}:${lot.block}`; }

function lotTiles(w: World, lot: OrientedLot): number[] {
  return lot.tiles.length ? lot.tiles : [idx(w, Math.floor(lot.cx), Math.floor(lot.cz))];
}

export function lotLandValue(w: World, lot: OrientedLot): number {
  const tiles = lotTiles(w, lot);
  return tiles.reduce((sum, tile) => sum + w.landValue[tile], 0) / Math.max(1, tiles.length);
}

/**
 * Merge a growable lot with lower/equal-level neighbours in its own segment
 * block. The original lot ID owns the merged rectangle; all cells are checked
 * before mutation, so roads, invalid cells, zones and higher buildings are
 * hard boundaries. Candidate origins are ordered by a stable position hash.
 */
export function evolveOrientedLot(w: World, set: ZoneBlockSet, lots: OrientedLot[], lot: OrientedLot, nextLevel: number): OrientedLot | null {
  const b = set.blocks.get(key(lot));
  if (!b || lotLandValue(w, lot) < EVOLUTION_LAND_VALUE[nextLevel]) return null;
  const [wantW, wantD] = evolutionFootprint(lot.zone, nextLevel);
  const maxW = Math.min(4, wantW), maxD = Math.min(4, wantD);
  const byId = new Map(lots.map((l) => [l.id, l]));
  const candidates: { row: number; col: number; w: number; d: number; score: number }[] = [];
  for (let d = maxD; d >= 1; d--) for (let width = maxW; width >= 1; width--) {
    if (width < lot.w || d < lot.d || width * d <= lot.w * lot.d) continue;
    for (let row = Math.max(0, lot.row + lot.w - width); row <= Math.min(lot.row, b.rows - width); row++) {
      for (let col = Math.max(0, lot.col + lot.d - d); col <= Math.min(lot.col, 4 - d); col++) {
        const score = (((row * 31 + col) * 31 + width) * 31 + d + lot.id * 17) >>> 0;
        candidates.push({ row, col, w: width, d, score });
      }
    }
  }
  candidates.sort((a, b2) => b2.w * b2.d - a.w * a.d || a.score - b2.score || a.row - b2.row || a.col - b2.col);
  for (const c of candidates) {
    const absorbed = new Set<number>();
    let ok = true;
    for (let row = c.row; row < c.row + c.w && ok; row++) for (let col = c.col; col < c.col + c.d; col++) {
      const i = cellIndex(row, col), id = b.lot[i], other = id < 0 ? undefined : byId.get(id);
      if (!b.valid[i] || b.zone[i] !== lot.zone || (other && other.level > lot.level)) { ok = false; break; }
      if (id >= 0) absorbed.add(id);
    }
    if (!ok || !absorbed.has(lot.id)) continue;
    const replacement: OrientedLot = { ...lot, row: c.row, col: c.col, w: c.w, d: c.d, level: nextLevel, build: 0, ...lotPose(b, c), tiles: [] };
    for (let row = c.row; row < c.row + c.w; row++) for (let col = c.col; col < c.col + c.d; col++) {
      const i = cellIndex(row, col); b.lot[i] = replacement.id; b.level[i] = nextLevel;
    }
    const at = lots.findIndex((l) => l.id === lot.id);
    if (at >= 0) lots[at] = replacement;
    for (let i = lots.length - 1; i >= 0; i--) if (lots[i].id !== replacement.id && absorbed.has(lots[i].id)) lots.splice(i, 1);
    return replacement;
  }
  return null;
}
