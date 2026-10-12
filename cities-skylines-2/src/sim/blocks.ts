import { ROAD, World, ZoneType, idx, isLand } from "./world";

/** Maximum number of cells between a kerb and the back of its zoning strip. */
export const ZONE_DEPTH = 4;

export interface Facing { dx: -1 | 0 | 1; dy: -1 | 0 | 1 }

/** Allocation-light, per-tile result. -1 means that a tile has no zoneable frontage. */
export interface FrontageMap {
  road: Int32Array;
  distance: Int8Array;
  dx: Int8Array;
  dy: Int8Array;
  corner: Uint8Array;
}

export interface BlockTile { blockId: number; depth: number; facing: Facing; corner: boolean }

export interface BlockInfo {
  frontage: FrontageMap;
  blockId: Int32Array;
  depth: Int8Array;
  dx: Int8Array;
  dy: Int8Array;
  corner: Uint8Array;
  blockCount: number;
  tile(index: number): BlockTile | undefined;
}

export interface Lot {
  x: number;
  y: number;
  w: number;
  h: number;
  facing: Facing;
  zone: ZoneType;
  depthFromRoad: number;
}

const DIRS = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;

function roadFacing(w: World, rx: number, ry: number, x: number, y: number): Facing {
  const at = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w.size && yy < w.size && !!w.road[idx(w, xx, yy)];
  const horizontal = +at(rx - 1, ry) + +at(rx + 1, ry);
  const vertical = +at(rx, ry - 1) + +at(rx, ry + 1);
  const vx = rx - x, vy = ry - y;
  if (horizontal > vertical && vy) return { dx: 0, dy: vy < 0 ? -1 : 1 };
  if (vertical > horizontal && vx) return { dx: vx < 0 ? -1 : 1, dy: 0 };
  // Ends and junctions use the largest displacement, then a fixed vertical tie-break.
  if (Math.abs(vy) >= Math.abs(vx) && vy) return { dx: 0, dy: vy < 0 ? -1 : 1 };
  return { dx: vx < 0 ? -1 : 1, dy: 0 };
}

/** Find the deterministic nearest zoneable (street/avenue) road for every non-road tile. */
export function findFrontage(w: World): FrontageMap {
  const n = w.size * w.size;
  const road = new Int32Array(n); road.fill(-1);
  const distance = new Int8Array(n); distance.fill(127);
  const dxOut = new Int8Array(n), dyOut = new Int8Array(n), corner = new Uint8Array(n);
  // Expanding only from road cells is substantially cheaper than asking every
  // map cell to inspect its full diamond (roads are normally the sparse set).
  for (let ry = 0; ry < w.size; ry++) for (let rx = 0; rx < w.size; rx++) {
    const ri = idx(w, rx, ry), cls = w.road[ri];
    if (!cls || cls === ROAD.HIGHWAY) continue;
    for (let oy = -ZONE_DEPTH; oy <= ZONE_DEPTH; oy++) {
      const span = ZONE_DEPTH - Math.abs(oy);
      for (let ox = -span; ox <= span; ox++) {
        const d = Math.abs(ox) + Math.abs(oy);
        if (!d) continue;
        const x = rx + ox, y = ry + oy;
        if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
        const out = idx(w, x, y);
        if (w.road[out]) continue;
        const f = roadFacing(w, rx, ry, x, y), oldDist = distance[out] + 1, oldRoad = road[out];
        if (d < oldDist) corner[out] = 0;
        else if (d === oldDist && (f.dx !== dxOut[out] || f.dy !== dyOut[out])) corner[out] = 1;
        const oldClass = oldRoad < 0 ? -1 : w.road[oldRoad];
        if (d < oldDist || (d === oldDist && (cls > oldClass || (cls === oldClass && ri < oldRoad)))) {
          road[out] = ri; distance[out] = d - 1; dxOut[out] = f.dx; dyOut[out] = f.dy;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) if (road[i] < 0) distance[i] = -1;
  return { road, distance, dx: dxOut, dy: dyOut, corner };
}

/** Group zoned cells by connected road component and the side of that component they face. */
export function computeBlocks(w: World, frontage: FrontageMap = findFrontage(w)): BlockInfo {
  const n = w.size * w.size;
  const roadComponent = new Int32Array(n); roadComponent.fill(-1);
  const queue = new Int32Array(n);
  let components = 0;
  for (let start = 0; start < n; start++) {
    if (!w.road[start] || w.road[start] === ROAD.HIGHWAY || roadComponent[start] >= 0) continue;
    let head = 0, tail = 0; queue[tail++] = start; roadComponent[start] = components;
    while (head < tail) {
      const i = queue[head++], x = i % w.size, y = (i / w.size) | 0;
      for (const [ddx, ddy] of DIRS) {
        const nx = x + ddx, ny = y + ddy;
        if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
        const j = idx(w, nx, ny);
        if (w.road[j] && w.road[j] !== ROAD.HIGHWAY && roadComponent[j] < 0) {
          roadComponent[j] = components; queue[tail++] = j;
        }
      }
    }
    components++;
  }
  const blockId = new Int32Array(n); blockId.fill(-1);
  let blockCount = 0;
  for (let start = 0; start < n; start++) {
    if (!w.zone[start] || frontage.road[start] < 0 || blockId[start] >= 0) continue;
    const comp = roadComponent[frontage.road[start]], fx = frontage.dx[start], fy = frontage.dy[start];
    let head = 0, tail = 0; queue[tail++] = start; blockId[start] = blockCount;
    while (head < tail) {
      const i = queue[head++], x = i % w.size, y = (i / w.size) | 0;
      for (const [ddx, ddy] of DIRS) {
        const nx = x + ddx, ny = y + ddy;
        if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
        const j = idx(w, nx, ny);
        if (blockId[j] < 0 && w.zone[j] && frontage.road[j] >= 0 &&
            roadComponent[frontage.road[j]] === comp && frontage.dx[j] === fx && frontage.dy[j] === fy) {
          blockId[j] = blockCount; queue[tail++] = j;
        }
      }
    }
    blockCount++;
  }
  return {
    frontage, blockId, depth: frontage.distance, dx: frontage.dx, dy: frontage.dy,
    corner: frontage.corner, blockCount,
    tile(i) {
      if (i < 0 || i >= n || blockId[i] < 0) return undefined;
      return { blockId: blockId[i], depth: frontage.distance[i],
        facing: { dx: frontage.dx[i] as Facing["dx"], dy: frontage.dy[i] as Facing["dy"] },
        corner: !!frontage.corner[i] };
    },
  };
}

type Shape = readonly [number, number];

/** Deterministically subdivide the still-empty cells of each block into road-fronting lots. */
export function planLots(w: World, blocks: BlockInfo, rng: () => number): Lot[] {
  const n = w.size * w.size, used = new Uint8Array(n), lots: Lot[] = [];
  const cells: number[][] = Array.from({ length: blocks.blockCount }, () => []);
  for (let i = 0; i < n; i++) if (blocks.blockId[i] >= 0 && blocks.depth[i] === 0) cells[blocks.blockId[i]].push(i);
  const tryShape = (front: number, along: number, deep: number): Lot | undefined => {
    const fx = blocks.dx[front], fy = blocks.dy[front], ax = fy, ay = -fx;
    const x0 = front % w.size, y0 = (front / w.size) | 0, zone = w.zone[front] as ZoneType, level = w.level[front];
    let minX = w.size, minY = w.size, maxX = -1, maxY = -1;
    for (let d = 0; d < deep; d++) for (let a = 0; a < along; a++) {
      const x = x0 + ax * a - fx * d, y = y0 + ay * a - fy * d;
      if (x < 0 || y < 0 || x >= w.size || y >= w.size) return undefined;
      const i = idx(w, x, y);
      if (used[i] || blocks.blockId[i] !== blocks.blockId[front] || blocks.depth[i] !== d ||
          w.zone[i] !== zone || w.level[i] !== level || w.road[i] || w.facility[i] || !isLand(w, x, y)) return undefined;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) used[idx(w, x, y)] = 1;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
      facing: { dx: fx as Facing["dx"], dy: fy as Facing["dy"] }, zone, depthFromRoad: 0 };
  };
  for (let b = 0; b < cells.length; b++) {
    const fronts = cells[b];
    // Fisher-Yates makes the seed affect subdivision without changing validity.
    for (let i = fronts.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [fronts[i], fronts[j]] = [fronts[j], fronts[i]]; }
    for (const front of fronts) {
      if (used[front]) continue;
      const zone = w.zone[front], level = w.level[front];
      const shapes: Shape[] = zone !== 1 && level >= 2 ? [[4, 4], [3, 3], [2, 2], [2, 1], [1, 2], [1, 1]] : [[2, 2], [2, 1], [1, 2], [1, 1]];
      const rotate = Math.floor(rng() * shapes.length);
      let lot: Lot | undefined;
      for (let k = 0; k < shapes.length && !lot; k++) { const s = shapes[(k + rotate) % shapes.length]; lot = tryShape(front, s[0], s[1]); }
      if (lot) lots.push(lot);
    }
  }
  return lots;
}

const frontageCache = new WeakMap<World, { roadRevision: number; frontage: FrontageMap }>();
const blockCache = new WeakMap<World, { roadRevision: number; zoneRevision: number; blocks: BlockInfo }>();

/** Street frontage, cached by road revision; zone painting never invalidates it. */
export function getFrontage(w: World): FrontageMap {
  const hit = frontageCache.get(w);
  if (hit && hit.roadRevision === w.roadRevision) return hit.frontage;
  const frontage = findFrontage(w);
  frontageCache.set(w, { roadRevision: w.roadRevision, frontage });
  return frontage;
}

/** Zone blocks, cached by road/zone revision; tools bump those on structural edits. */
export function getBlocks(w: World): BlockInfo {
  const hit = blockCache.get(w);
  if (hit && hit.roadRevision === w.roadRevision && hit.zoneRevision === w.zoneRevision) return hit.blocks;
  return refreshBlockCache(w);
}

/** Recompute blocks unconditionally and re-prime the cache (frontage keeps its own revision). */
export function refreshBlockCache(w: World): BlockInfo {
  const blocks = computeBlocks(w, getFrontage(w));
  blockCache.set(w, { roadRevision: w.roadRevision, zoneRevision: w.zoneRevision, blocks });
  return blocks;
}

/** Return lots whose complete front edge is at depth zero and touches connected, non-highway road. */
export function lotsReadyToBuild(w: World, blocks: BlockInfo, lots: readonly Lot[]): Lot[] {
  return lots.filter((lot) => {
    const { dx, dy } = lot.facing;
    const count = dx ? lot.h : lot.w;
    for (let a = 0; a < count; a++) {
      const x = dx > 0 ? lot.x + lot.w - 1 : dx < 0 ? lot.x : lot.x + a;
      const y = dy > 0 ? lot.y + lot.h - 1 : dy < 0 ? lot.y : lot.y + a;
      const i = idx(w, x, y);
      const road = blocks.frontage.road[i];
      if (blocks.depth[i] !== 0 || road < 0 || !w.connected[road] || w.road[road] === ROAD.HIGHWAY) return false;
    }
    return true;
  });
}
