import { makeRng } from "./rng";

export const ZONE = { NONE: 0, RES: 1, COM: 2, IND: 3 } as const;
export type ZoneType = (typeof ZONE)[keyof typeof ZONE];

export interface World {
  size: number;
  /** (size+1)^2 corner heights; water level is 0. */
  heights: Float32Array;
  road: Uint8Array;
  zone: Uint8Array;
  /** Building level per tile, 0 = no building, 1..3. */
  level: Uint8Array;
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
