import { makeRng } from "./rng";

export const ZONE = { NONE: 0, RES: 1, COM: 2, IND: 3 } as const;
export type ZoneType = (typeof ZONE)[keyof typeof ZONE];

/** Utility facility kinds stored per tile. */
export const FAC = { NONE: 0, POWER: 1, WATER: 2, SEWAGE: 3, LANDFILL: 4 } as const;
export type FacilityType = (typeof FAC)[keyof typeof FAC];

/** Bits in World.cover. */
export const COVER = { POWER: 1, WATER: 2, SEWAGE: 4, GARBAGE: 8 } as const;

export const FACILITY_INFO = {
  [FAC.POWER]: { name: "Power plant", cost: 800, upkeep: 60, radius: 14, capacity: 120, bit: COVER.POWER, nearWater: false },
  [FAC.WATER]: { name: "Water pump", cost: 500, upkeep: 40, radius: 10, capacity: 90, bit: COVER.WATER, nearWater: true },
  [FAC.SEWAGE]: { name: "Sewage outlet", cost: 400, upkeep: 40, radius: 10, capacity: 90, bit: COVER.SEWAGE, nearWater: true },
  [FAC.LANDFILL]: { name: "Landfill", cost: 300, upkeep: 30, radius: 12, capacity: 80, bit: COVER.GARBAGE, nearWater: false },
} as const;

export interface World {
  size: number;
  /** (size+1)^2 corner heights; water level is 0. */
  heights: Float32Array;
  road: Uint8Array;
  zone: Uint8Array;
  /** Building level per tile, 0 = no building, 1..3. */
  level: Uint8Array;
  /** Facility type per tile (FAC.*). */
  facility: Uint8Array;
  /** Bitmask of COVER.* services reaching each tile. */
  cover: Uint8Array;
  coverageDirty: boolean;
  /** 1 where a road tile is connected to the map entry. */
  connected: Uint8Array;
  entry: { x: number; y: number };
  /** Bumped on any change; renderers rebuild when it moves. */
  revision: number;
  connectivityDirty: boolean;
}

export const idx = (w: World, x: number, y: number) => y * w.size + x;
export const cidx = (w: World, x: number, y: number) => y * (w.size + 1) + x;
export const inBounds = (w: World, x: number, y: number) =>
  x >= 0 && y >= 0 && x < w.size && y < w.size;

function valueNoise(size: number, cell: number, rng: () => number) {
  const n = Math.ceil(size / cell) + 2;
  const lat = new Float32Array(n * n);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  return (x: number, y: number) => {
    const gx = x / cell, gy = y / cell;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = lat[y0 * n + x0], b = lat[y0 * n + x0 + 1];
    const c = lat[(y0 + 1) * n + x0], d = lat[(y0 + 1) * n + x0 + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

export function tileHeight(w: World, x: number, y: number): number {
  const s = w.size + 1;
  return (
    (w.heights[y * s + x] + w.heights[y * s + x + 1] +
      w.heights[(y + 1) * s + x] + w.heights[(y + 1) * s + x + 1]) / 4
  );
}

/** Land is buildable when no corner is under water. */
export function isLand(w: World, x: number, y: number): boolean {
  if (!inBounds(w, x, y)) return false;
  const s = w.size + 1;
  const h = w.heights;
  return (
    h[y * s + x] >= 0.05 && h[y * s + x + 1] >= 0.05 &&
    h[(y + 1) * s + x] >= 0.05 && h[(y + 1) * s + x + 1] >= 0.05
  );
}

export function generateWorld(size: number, seed: number): World {
  const rng = makeRng(seed);
  const n1 = valueNoise(size + 1, 32, rng);
  const n2 = valueNoise(size + 1, 16, rng);
  const n3 = valueNoise(size + 1, 8, rng);
  const s = size + 1;
  const heights = new Float32Array(s * s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const n = n1(x, y) * 0.6 + n2(x, y) * 0.28 + n3(x, y) * 0.12;
      heights[y * s + x] = (n - 0.4) * 7;
    }
  }
  const world: World = {
    size,
    heights,
    road: new Uint8Array(size * size),
    zone: new Uint8Array(size * size),
    level: new Uint8Array(size * size),
    facility: new Uint8Array(size * size),
    cover: new Uint8Array(size * size),
    coverageDirty: true,
    connected: new Uint8Array(size * size),
    entry: { x: 0, y: Math.floor(size / 2) },
    revision: 1,
    connectivityDirty: true,
  };
  // Guaranteed dry, flat landing strip with a pre-built entry road.
  const ey = world.entry.y;
  for (let y = ey - 1; y <= ey + 2; y++) {
    for (let x = 0; x <= 5; x++) heights[y * s + x] = 0.35;
  }
  for (let x = 0; x <= 2; x++) world.road[idx(world, x, ey)] = 1;
  return world;
}

/** Recompute which road tiles are reachable from the entry (4-neighbour BFS). */
export function updateConnectivity(w: World): void {
  w.connected.fill(0);
  w.connectivityDirty = false;
  const start = idx(w, w.entry.x, w.entry.y);
  if (!w.road[start]) return;
  const queue = [start];
  w.connected[start] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % w.size, y = (i / w.size) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(w, nx, ny)) continue;
      const j = idx(w, nx, ny);
      if (w.road[j] && !w.connected[j]) {
        w.connected[j] = 1;
        queue.push(j);
      }
    }
  }
}

/** Is the tile touching a road that is connected to the entry? */
export function isServed(w: World, x: number, y: number): boolean {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (inBounds(w, nx, ny) && w.connected[idx(w, nx, ny)]) return true;
  }
  return false;
}

/** Level the four corners of a tile to its mean height (simple terraforming). */
export function flattenTile(w: World, x: number, y: number): void {
  const s = w.size + 1;
  const h = tileHeight(w, x, y);
  w.heights[y * s + x] = h;
  w.heights[y * s + x + 1] = h;
  w.heights[(y + 1) * s + x] = h;
  w.heights[(y + 1) * s + x + 1] = h;
}

/** True if any tile within `r` (Chebyshev) of x,y is not land. */
export function nearWater(w: World, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(w, nx, ny) && !isLand(w, nx, ny)) return true;
    }
  }
  return false;
}

/** Recompute which services reach each tile (Euclidean radius around each facility). */
export function updateCoverage(w: World): void {
  w.cover.fill(0);
  w.coverageDirty = false;
  for (let y = 0; y < w.size; y++) {
    for (let x = 0; x < w.size; x++) {
      const f = w.facility[idx(w, x, y)] as FacilityType;
      if (!f) continue;
      const info = FACILITY_INFO[f as 1 | 2 | 3 | 4];
      const r = info.radius;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const nx = x + dx, ny = y + dy;
          if (inBounds(w, nx, ny)) w.cover[idx(w, nx, ny)] |= info.bit;
        }
      }
    }
  }
}
