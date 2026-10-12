import { makeRng } from "./rng";
import { CityState } from "./sim";
import { ROAD, World, ZONE, idx, inBounds } from "./world";

/** Tiles per second on an empty road, and vehicles a tile holds before it slows, by class. */
export const ROAD_SPEED: Record<number, number> = { [ROAD.STREET]: 3, [ROAD.AVENUE]: 4.5, [ROAD.HIGHWAY]: 7 };
export const ROAD_CAPACITY: Record<number, number> = { [ROAD.STREET]: 4, [ROAD.AVENUE]: 10, [ROAD.HIGHWAY]: 20 };

const MAX_VEHICLES = 260;
const MIN_SPEED_FACTOR = 0.15;
const SMOOTH_RADIUS = 2;
const NEIGHBOURS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export interface Vehicle {
  id: number;
  /** 0 = commuter car, 1 = goods truck. */
  kind: 0 | 1;
  tiles: number[];
  /** Smoothed centreline, x/z pairs, one per tile, so cars follow curved roads. */
  pts: Float32Array;
  /** Index into `tiles`, fractional. */
  progress: number;
  /** Current speed as a fraction of free flow (1 = no congestion). */
  speedFactor: number;
}

export interface TrafficState {
  vehicles: Vehicle[];
  /** Vehicles currently on each tile. */
  load: Uint16Array;
  completed: number;
  nextId: number;
  rng: () => number;
  spawnCarry: number;
  truckCarry: number;
  listRevision: number;
  homes: number[];
  shops: number[];
  factories: number[];
  jobs: number[];
}

export function newTraffic(size: number, seed = 7): TrafficState {
  return {
    vehicles: [], load: new Uint16Array(size * size), completed: 0, nextId: 1,
    rng: makeRng(seed), spawnCarry: 0, truckCarry: 0, listRevision: -1,
    homes: [], shops: [], factories: [], jobs: [],
  };
}

// ---------------------------------------------------------------- pathfinding

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() { return this.keys.length; }
  push(k: number, v: number) {
    const keys = this.keys, vals = this.vals;
    let i = keys.length;
    keys.push(k); vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p]; vals[i] = vals[p]; i = p;
    }
    keys[i] = k; vals[i] = v;
  }
  pop(): number {
    const keys = this.keys, vals = this.vals;
    const top = vals[0];
    const lk = keys.pop()!, lv = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lk) break;
        keys[i] = keys[c]; vals[i] = vals[c]; i = c;
      }
      keys[i] = lk; vals[i] = lv;
    }
    return top;
  }
}

/** Free-flow time to cross one tile of class `cls`, inflated by how full it is. */
function crossCost(cls: number, load: number): number {
  return (1 / ROAD_SPEED[cls]) * (1 + load / ROAD_CAPACITY[cls]);
}

/** Fastest route over road tiles given current loads, or null when unreachable. */
export function findPath(w: World, load: Uint16Array, from: number, to: number): number[] | null {
  if (!w.road[from] || !w.road[to]) return null;
  if (from === to) return [from];
  const n = w.size * w.size;
  const g = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  const minCost = 1 / ROAD_SPEED[ROAD.HIGHWAY];
  const tx = to % w.size, ty = (to / w.size) | 0;
  g[from] = 0;
  heap.push(0, from);
  while (heap.size) {
    const cur = heap.pop();
    if (cur === to) break;
    const cx = cur % w.size, cy = (cur / w.size) | 0;
    const gc = g[cur];
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBounds(w, nx, ny)) continue;
      const j = ny * w.size + nx;
      const cls = w.road[j];
      if (!cls) continue;
      const ng = gc + crossCost(cls, load[j]);
      if (ng < g[j]) {
        g[j] = ng;
        prev[j] = cur;
        heap.push(ng + (Math.abs(nx - tx) + Math.abs(ny - ty)) * minCost, j);
      }
    }
  }
  if (prev[to] === -1) return null;
  const out: number[] = [];
  for (let c = to; c !== -1; c = prev[c]) out.push(c);
  return out.reverse();
}

/** Moving average over tile centres, endpoints pinned, so vehicles round curves. */
function smoothPath(w: World, tiles: number[]): Float32Array {
  const n = tiles.length;
  const pts = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    let sx = 0, sz = 0, c = 0;
    const r = i === 0 || i === n - 1 ? 0 : Math.min(SMOOTH_RADIUS, i, n - 1 - i);
    for (let k = i - r; k <= i + r; k++) {
      sx += (tiles[k] % w.size) + 0.5;
      sz += ((tiles[k] / w.size) | 0) + 0.5;
      c++;
    }
    pts[i * 2] = sx / c;
    pts[i * 2 + 1] = sz / c;
  }
  return pts;
}

// ---------------------------------------------------------------- simulation

/** Connected street/avenue tile touching a building, or -1. */
function accessTile(w: World, i: number, rng: () => number): number {
  const x = i % w.size, y = (i / w.size) | 0;
  const opts: number[] = [];
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(w, nx, ny)) continue;
    const j = idx(w, nx, ny);
    if (w.connected[j] && w.road[j] !== ROAD.HIGHWAY) opts.push(j);
  }
  return opts.length ? opts[Math.floor(rng() * opts.length)] : -1;
}

function refreshLists(w: World, t: TrafficState): void {
  t.listRevision = w.revision;
  t.homes = []; t.shops = []; t.factories = []; t.jobs = [];
  for (let i = 0; i < w.zone.length; i++) {
    if (!w.level[i]) continue;
    const z = w.zone[i];
    if (z === ZONE.RES) t.homes.push(i);
    else if (z === ZONE.COM) { t.shops.push(i); t.jobs.push(i); }
    else if (z === ZONE.IND) { t.factories.push(i); t.jobs.push(i); }
  }
  // Drop vehicles whose route was cut by a bulldozed or rebuilt road.
  t.vehicles = t.vehicles.filter((v) => v.tiles.every((tile) => w.road[tile] > 0));
}

function spawn(s: CityState, t: TrafficState, kind: 0 | 1): void {
  const w = s.world;
  const origins = kind === 0 ? t.homes : t.factories;
  const dests = kind === 0 ? t.jobs : t.shops;
  if (!origins.length || !dests.length) return;
  const a = accessTile(w, origins[Math.floor(t.rng() * origins.length)], t.rng);
  const b = accessTile(w, dests[Math.floor(t.rng() * dests.length)], t.rng);
  if (a < 0 || b < 0) return;
  const tiles = findPath(w, t.load, a, b);
  if (!tiles || tiles.length < 2) return;
  t.vehicles.push({ id: t.nextId++, kind, tiles, pts: smoothPath(w, tiles), progress: 0, speedFactor: 1 });
}

/** Advance traffic by `dt` seconds of game time and publish stats onto the city state. */
export function tickTraffic(s: CityState, t: TrafficState, dt: number): void {
  const w = s.world;
  if (t.listRevision !== w.revision) refreshLists(w, t);
  if (dt <= 0) return;

  // Spawn: commuters scale with residents, trucks with industry.
  t.spawnCarry += (s.population / 150) * dt;
  t.truckCarry += (s.capacity.ind / 120) * dt;
  while (t.spawnCarry >= 1 && t.vehicles.length < MAX_VEHICLES) { t.spawnCarry -= 1; spawn(s, t, 0); }
  while (t.truckCarry >= 1 && t.vehicles.length < MAX_VEHICLES) { t.truckCarry -= 1; spawn(s, t, 1); }
  t.spawnCarry = Math.min(t.spawnCarry, 3);
  t.truckCarry = Math.min(t.truckCarry, 3);

  t.load.fill(0);
  for (const v of t.vehicles) t.load[v.tiles[Math.min(v.tiles.length - 1, Math.floor(v.progress))]]++;

  let slow = 0;
  const alive: Vehicle[] = [];
  for (const v of t.vehicles) {
    const tile = v.tiles[Math.min(v.tiles.length - 1, Math.floor(v.progress))];
    const cls = w.road[tile];
    if (!cls) continue;
    const f = Math.max(MIN_SPEED_FACTOR, Math.min(1, ROAD_CAPACITY[cls] / Math.max(1, t.load[tile])));
    v.speedFactor = f;
    if (f < 0.6) slow++;
    v.progress += ROAD_SPEED[cls] * f * dt;
    if (v.progress >= v.tiles.length - 1) { t.completed++; continue; }
    alive.push(v);
  }
  t.vehicles = alive;

  const n = t.vehicles.length;
  const measured = n ? slow / n : 0;
  // Smooth so the HUD and happiness do not flicker with single frames.
  const k = Math.min(1, dt * 0.5);
  s.congestion += (measured - s.congestion) * k;
  s.vehicles = n;
}
