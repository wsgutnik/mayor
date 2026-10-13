import { makeRng } from "./rng";
import { CityState } from "./sim";
import { ROAD, World, ZONE, idx, inBounds, TransitKind, updateConnectivity, layerClass, RoadLayer, curvePoints } from "./world";
import { SignalInfo, signalNodes, signalPhase } from "./roads";
import { straightTiles } from "./transit";
import { RAIN_SPEED_FACTOR } from "./weather";

/** Tiles per second on an empty road, and vehicles a tile holds before it slows, by class. */
export const ROAD_SPEED: Record<number, number> = { [ROAD.STREET]: 3, [ROAD.AVENUE]: 4.5, [ROAD.HIGHWAY]: 7, [ROAD.ONEWAY_STREET]: 3, [ROAD.ONEWAY_AVENUE]: 4.5 };
export const ROAD_CAPACITY: Record<number, number> = { [ROAD.STREET]: 4, [ROAD.AVENUE]: 10, [ROAD.HIGHWAY]: 20, [ROAD.ONEWAY_STREET]: 4, [ROAD.ONEWAY_AVENUE]: 10 };

const MAX_VEHICLES = 260;
const MIN_SPEED_FACTOR = 0.15;
const SMOOTH_RADIUS = 2;
const NEIGHBOURS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export interface Vehicle {
  id: number;
  /** 0 = commuter car, 1 = goods truck. */
  kind: 0 | 1;
  tiles: number[];
  /** Road layer per tile (0 ground, 1 deck, 2 tunnel); absent means ground. */
  layers?: Uint8Array;
  /** Smoothed centreline, x/z pairs, one per tile, so cars follow curved roads. */
  pts: Float32Array;
  /** Index into `tiles`, fractional. */
  progress: number;
  /** Current speed as a fraction of free flow (1 = no congestion). */
  speedFactor: number;
}

/** A bus or metro train looping over its line's stops. */
export interface TransitVehicle {
  id: number;
  lineId: number;
  kind: TransitKind;
  color: string;
  /** Index in line.stops of the stop being driven to. */
  stopIdx: number;
  tiles: number[];
  layers?: Uint8Array;
  pts: Float32Array;
  progress: number;
  /** Seconds left standing at a stop. */
  dwell: number;
}

const METRO_SPEED = 8;
const DWELL_SECONDS = 1.2;

export interface TrafficState {
  vehicles: Vehicle[];
  transit: TransitVehicle[];
  transitRevision: number;
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
  /** Game seconds driven (signal phases derive from this). */
  time: number;
  /** Signalised nodes, refreshed when the road graph revision moves. */
  sigRev: number;
  sigNodes: SignalInfo[];
  /** Signal approaches near each road tile, rebuilt with sigNodes. */
  sigByTile: Map<number, SignalInfo[]>;
}

export function newTraffic(size: number, seed = 7): TrafficState {
  return {
    vehicles: [], transit: [], transitRevision: -1, load: new Uint16Array(size * size), completed: 0, nextId: 1,
    rng: makeRng(seed), spawnCarry: 0, truckCarry: 0, listRevision: -1,
    homes: [], shops: [], factories: [], jobs: [],
    time: 0, sigRev: -1, sigNodes: [], sigByTile: new Map(),
  };
}

/** Crawl factor while entering a signalised junction against a red light. */
const RED_CRAWL = 0.3;

/**
 * 1 when the route from `tile` to `next` may proceed, RED_CRAWL when it enters
 * a signalised node against the phase. Allocation-free over the cached nodes.
 */
export function redCrawl(w: World, t: TrafficState, tile: number, next: number, phase: 0 | 1): number {
  const hx = (next % w.size) - (tile % w.size);
  const hz = ((next / w.size) | 0) - ((tile / w.size) | 0);
  if (hx === 0 && hz === 0) return 1;
  const hl = Math.hypot(hx, hz);
  const cx = (tile % w.size) + 0.5, cz = ((tile / w.size) | 0) + 0.5;
  const here = t.sigByTile.get(tile);
  const ahead = next === tile ? undefined : t.sigByTile.get(next);
  if (!here && !ahead) return 1;
  const visit = (signals: SignalInfo[] | undefined, skip: SignalInfo[] | undefined): number => {
    if (!signals) return 1;
    for (const sn of signals) {
      if (skip?.includes(sn)) continue;
      const vx = sn.x - cx, vz = sn.z - cz;
      const d = Math.hypot(vx, vz);
      if (d > 1.7 || d < 1e-6) continue;
      if ((vx * hx + vz * hz) / (d * hl) < 0.5) continue; // not heading at this node
      const ux = hx / hl, uz = hz / hl;
      let best = 0, bd = -Infinity;
      for (let k = 0; k < sn.arms.length; k++) {
        // The arm being travelled: its outward direction opposes the heading.
        const s = -(sn.arms[k].dx * ux + sn.arms[k].dz * uz);
        if (s > bd) { bd = s; best = k; }
      }
      if (bd > 0.3 && (sn.arms[best].ns ? phase !== 0 : phase !== 1)) return RED_CRAWL;
    }
    return 1;
  };
  const first = visit(here, undefined);
  return first === RED_CRAWL ? first : visit(ahead, here);
}

export function indexSignals(w: World, signals: SignalInfo[]): Map<number, SignalInfo[]> {
  const out = new Map<number, SignalInfo[]>();
  for (const sn of signals) {
    const x0 = Math.max(0, Math.ceil(sn.x - 2.2));
    const x1 = Math.min(w.size - 1, Math.floor(sn.x + 1.2));
    const y0 = Math.max(0, Math.ceil(sn.z - 2.2));
    const y1 = Math.min(w.size - 1, Math.floor(sn.z + 1.2));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = sn.x - (x + 0.5), dz = sn.z - (y + 0.5);
      if (Math.hypot(dx, dz) > 1.7 || (dx === 0 && dz === 0)) continue;
      const tile = y * w.size + x;
      const list = out.get(tile);
      if (list) list.push(sn); else out.set(tile, [sn]);
    }
  }
  return out;
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

const scratch = { n: 0, g: new Float32Array(0), prev: new Int32Array(0), stamp: new Uint32Array(0), gen: 0 };

const preferredLayer = (w: World, tile: number): RoadLayer =>
  w.roadSurface[tile] ? 0 : w.roadDeck[tile] ? 1 : 2;

export interface LayeredPath { tiles: number[]; layers: Uint8Array }

/** Layer-aware fastest route: deck/tunnel and ground meet only at ramp links. */
export function findLayeredPath(w: World, load: Uint16Array, from: number, to: number): LayeredPath | null {
  if (!w.road[from] || !w.road[to]) return null;
  const fromLayer = preferredLayer(w, from);
  const toLayer = preferredLayer(w, to);
  if (from === to) return { tiles: [from], layers: new Uint8Array([fromLayer]) };
  const n = w.size * w.size;
  const states = n * 3;
  if (scratch.n !== states) {
    scratch.n = states;
    scratch.g = new Float32Array(states);
    scratch.prev = new Int32Array(states);
    scratch.stamp = new Uint32Array(states);
    scratch.gen = 0;
  }
  const gen = ++scratch.gen;
  const { g, prev, stamp } = scratch;
  const G = (i: number) => (stamp[i] === gen ? g[i] : Infinity);
  const heap = new MinHeap();
  const minCost = 1 / ROAD_SPEED[ROAD.HIGHWAY];
  const tx = to % w.size, ty = (to / w.size) | 0;
  const start = from * 3 + fromLayer;
  const goal = to * 3 + toLayer;
  stamp[start] = gen; g[start] = 0; prev[start] = -1;
  heap.push(0, start);
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    const tile = (cur / 3) | 0, layer = (cur % 3) as RoadLayer;
    const cx = tile % w.size, cy = (tile / w.size) | 0;
    const gc = G(cur);
    // Layer switch only at ramp links (shared ground/elevated nodes).
    if (w.roadLink[tile]) {
      for (const l of [0, 1, 2] as RoadLayer[]) {
        if (l === layer || !layerClass(w, tile, l)) continue;
        const ns = tile * 3 + l;
        const ng = gc + 0.01;
        if (ng < G(ns)) { stamp[ns] = gen; g[ns] = ng; prev[ns] = cur; heap.push(ng + (Math.abs(cx - tx) + Math.abs(cy - ty)) * minCost, ns); }
      }
    }
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBounds(w, nx, ny)) continue;
      const j = ny * w.size + nx;
      const cls = layerClass(w, j, layer);
      if (!cls) continue;
      if ((w.dirX[tile] || w.dirZ[tile]) && w.dirX[tile] * dx + w.dirZ[tile] * dy < -0.35) continue;
      if ((w.dirX[j] || w.dirZ[j]) && w.dirX[j] * dx + w.dirZ[j] * dy < -0.35) continue;
      const ns = j * 3 + layer;
      const ng = gc + crossCost(cls, load[j]);
      if (ng < G(ns)) {
        stamp[ns] = gen; g[ns] = ng; prev[ns] = cur;
        heap.push(ng + (Math.abs(nx - tx) + Math.abs(ny - ty)) * minCost, ns);
      }
    }
  }
  if (stamp[goal] !== gen) return null;
  const revTiles: number[] = [];
  const revLayers: number[] = [];
  for (let c = goal; c !== -1; c = prev[c]) {
    const t = (c / 3) | 0;
    if (revTiles.length && revTiles[revTiles.length - 1] === t) { revLayers[revLayers.length - 1] = c % 3; continue; }
    revTiles.push(t); revLayers.push(c % 3);
  }
  revTiles.reverse(); revLayers.reverse();
  return { tiles: revTiles, layers: new Uint8Array(revLayers) };
}

/** Fastest route over road tiles given current loads, or null when unreachable. */
export function findPath(w: World, load: Uint16Array, from: number, to: number): number[] | null {
  return findLayeredPath(w, load, from, to)?.tiles ?? null;
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

/** Per-world index: road centreline polylines (x/z pairs) by segment id, and the segments covering each tile. */
const centreIndex = new WeakMap<World, { rev: number; lines: Map<number, Float32Array>; byTile: Map<number, number[]> }>();

function getCentreIndex(w: World): { lines: Map<number, Float32Array>; byTile: Map<number, number[]> } {
  const hit = centreIndex.get(w);
  if (hit && hit.rev === w.graphRevision + w.segments.length * 1e6) return hit;
  const lines = new Map<number, Float32Array>();
  const byTile = new Map<number, number[]>();
  for (const seg of w.segments) {
    const pts = curvePoints(seg.pts, 0.5);
    const a = new Float32Array(pts.length * 2);
    pts.forEach((p, i) => { a[i * 2] = p.x; a[i * 2 + 1] = p.z; });
    lines.set(seg.id, a);
    for (const t of seg.tiles) {
      const l = byTile.get(t);
      if (l) l.push(seg.id); else byTile.set(t, [seg.id]);
    }
  }
  const next = { rev: w.graphRevision + w.segments.length * 1e6, lines, byTile };
  centreIndex.set(w, next);
  return next;
}

/** Closest point of a polyline to (x, z): returns [px, pz, squared distance]. */
function nearestOnLine(line: Float32Array, x: number, z: number): [number, number, number] {
  let bx = x, bz = z, bd = Infinity;
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = line[i], az = line[i + 1], cx = line[i + 2], cz = line[i + 3];
    const dx = cx - ax, dz = cz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const px = ax + dx * t, pz = az + dz * t;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bd) { bd = d; bx = px; bz = pz; }
  }
  return [bx, bz, bd];
}

/**
 * Pull a tile-centre path onto the actual road centrelines. The A* path walks tile centres, which on diagonal and
 * curved roads zig-zags and cuts corners outside the road; each point is projected onto the centreline of the
 * segment that owns its tile (staying on the previous segment while it still covers the tile, so junction tiles do
 * not flip between roads). Tiles with no owning segment keep their smoothed position.
 */
export function snapToCentrelines(w: World, tiles: number[], pts: Float32Array): Float32Array {
  const { lines, byTile } = getCentreIndex(w);
  const out = new Float32Array(pts.length);
  let current = -1;
  let px = NaN, pz = NaN;
  for (let i = 0; i < tiles.length; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1];
    const segs = byTile.get(tiles[i]);
    let nx = x, nz = z;
    if (segs && segs.length) {
      let pick = -1;
      if (segs.includes(current)) pick = current;
      else {
        let bd = Infinity;
        for (const id of segs) {
          const line = lines.get(id);
          if (!line) continue;
          const d = nearestOnLine(line, x, z)[2];
          if (d < bd) { bd = d; pick = id; }
        }
      }
      const line = pick >= 0 ? lines.get(pick) : undefined;
      if (line) {
        const [sx, sz, d2] = nearestOnLine(line, x, z);
        // Far from the centreline means the tile only brushes this segment: keep the smoothed point.
        if (d2 <= 1.5 * 1.5) { nx = sx; nz = sz; current = pick; }
      }
    }
    // Two tiles that project to the same spot would give a zero-length step (no heading): keep the smoothed point.
    if (i > 0 && (nx - px) ** 2 + (nz - pz) ** 2 < 1e-4) { nx = x; nz = z; }
    out[i * 2] = nx; out[i * 2 + 1] = nz;
    px = nx; pz = nz;
  }
  return out;
}

/**
 * Round the corners of a snapped route in place of a hard 90-degree kink: points around a turn sharper than ~25
 * degrees get a (1,2,1) average, twice. Point count and order are unchanged (progress indexes tiles), and the
 * displacement is at most about a fifth of a tile, which stays inside any carriageway.
 */
export function roundCorners(pts: Float32Array, tiles: number): Float32Array {
  let cur = Float32Array.from(pts);
  for (let pass = 0; pass < 2; pass++) {
    const next = Float32Array.from(cur);
    for (let i = 1; i + 1 < tiles; i++) {
      const ax = cur[i * 2] - cur[i * 2 - 2], az = cur[i * 2 + 1] - cur[i * 2 - 1];
      const bx = cur[i * 2 + 2] - cur[i * 2], bz = cur[i * 2 + 3] - cur[i * 2 + 1];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 1e-4 || lb < 1e-4) continue;
      const cos = (ax * bx + az * bz) / (la * lb);
      if (cos > 0.906) continue;                      // straighter than ~25 degrees: leave it
      next[i * 2] = (cur[i * 2 - 2] + 2 * cur[i * 2] + cur[i * 2 + 2]) / 4;
      next[i * 2 + 1] = (cur[i * 2 - 1] + 2 * cur[i * 2 + 1] + cur[i * 2 + 3]) / 4;
    }
    cur = next;
  }
  return cur;
}

/** Vehicle route geometry: tile centres smoothed, snapped onto the road centrelines, corners rounded. */
export function routePath(w: World, tiles: number[]): Float32Array {
  return roundCorners(snapToCentrelines(w, tiles, smoothPath(w, tiles)), tiles.length);
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
    if (w.connected[j] && w.roadSurface[j] !== ROAD.NONE && w.roadSurface[j] !== ROAD.HIGHWAY) opts.push(j);
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

/** Route a transit vehicle from the previous stop to the one it is heading for. */
function planLeg(w: World, t: TrafficState, v: TransitVehicle): boolean {
  const line = w.lines.find((l) => l.id === v.lineId);
  if (!line) return false;
  const n = line.stops.length;
  const from = w.stops.find((x) => x.id === line.stops[(v.stopIdx - 1 + n) % n]);
  const to = w.stops.find((x) => x.id === line.stops[v.stopIdx % n]);
  if (!from || !to) return false;
  let tiles: number[] | null;
  let layers: Uint8Array | undefined;
  if (line.kind === "metro") tiles = straightTiles(w, from.tile, to.tile);
  else { const lp = findLayeredPath(w, t.load, from.tile, to.tile); tiles = lp?.tiles ?? null; layers = lp?.layers; }
  if (!tiles) return false;
  if (tiles.length < 2) tiles = [from.tile, to.tile];
  v.tiles = tiles;
  v.layers = layers;
  v.pts = line.kind === "metro" ? centres(w, tiles) : routePath(w, tiles);
  v.progress = 0;
  return true;
}

function centres(w: World, tiles: number[]): Float32Array {
  const pts = new Float32Array(tiles.length * 2);
  tiles.forEach((tile, i) => {
    pts[i * 2] = (tile % w.size) + 0.5;
    pts[i * 2 + 1] = ((tile / w.size) | 0) + 0.5;
  });
  return pts;
}

/** Keep one vehicle object per purchased vehicle on each line. */
function syncTransit(w: World, t: TrafficState): void {
  t.transitRevision = w.revision;
  const byLine = new Map<number, TransitVehicle[]>();
  for (const v of t.transit) {
    const line = w.lines.find((l) => l.id === v.lineId);
    if (!line) continue;
    v.color = line.color;
    (byLine.get(v.lineId) ?? byLine.set(v.lineId, []).get(v.lineId)!).push(v);
  }
  const next: TransitVehicle[] = [];
  for (const line of w.lines) {
    const have = (byLine.get(line.id) ?? []).slice(0, line.vehicles);
    // A vehicle whose stop was removed cannot continue; replace it from the first stop.
    const ok = have.filter((v) => v.stopIdx < line.stops.length);
    next.push(...ok);
    for (let k = ok.length; k < line.vehicles; k++) {
      const v: TransitVehicle = {
        id: t.nextId++, lineId: line.id, kind: line.kind, color: line.color,
        stopIdx: 1 % line.stops.length, tiles: [], pts: new Float32Array(0), progress: 0,
        dwell: (k * DWELL_SECONDS * 3) / Math.max(1, line.vehicles),
      };
      if (planLeg(w, t, v)) next.push(v);
    }
  }
  t.transit = next;
}

function spawn(s: CityState, t: TrafficState, kind: 0 | 1): void {
  const w = s.world;
  const origins = kind === 0 ? t.homes : t.factories;
  const dests = kind === 0 ? t.jobs : t.shops;
  if (!origins.length || !dests.length) return;
  const a = accessTile(w, origins[Math.floor(t.rng() * origins.length)], t.rng);
  const b = accessTile(w, dests[Math.floor(t.rng() * dests.length)], t.rng);
  if (a < 0 || b < 0) return;
  const lp = findLayeredPath(w, t.load, a, b);
  if (!lp || lp.tiles.length < 2) return;
  t.vehicles.push({ id: t.nextId++, kind, tiles: lp.tiles, layers: lp.layers, pts: routePath(w, lp.tiles), progress: 0, speedFactor: 1 });
}

function moveTransit(w: World, t: TrafficState, dt: number, weather: number): void {
  for (const v of t.transit) {
    if (v.dwell > 0) { v.dwell -= dt; continue; }
    if (!v.tiles.length) continue;
    const tile = v.tiles[Math.min(v.tiles.length - 1, Math.floor(v.progress))];
    let speed = METRO_SPEED;
    if (v.kind === "bus") {
      const cls = w.road[tile];
      if (!cls) { v.progress = v.tiles.length; continue; }
      const f = Math.max(MIN_SPEED_FACTOR, Math.min(1, ROAD_CAPACITY[cls] / Math.max(1, t.load[tile])));
      speed = ROAD_SPEED[cls] * f * 0.9 * weather;
    }
    v.progress += speed * dt;
    if (v.progress >= v.tiles.length - 1) {
      const line = w.lines.find((l) => l.id === v.lineId);
      if (!line) { v.tiles = []; continue; }
      v.stopIdx = (v.stopIdx + 1) % line.stops.length;
      v.dwell = DWELL_SECONDS;
      if (!planLeg(w, t, v)) v.tiles = [];
    }
  }
  t.transit = t.transit.filter((v) => v.tiles.length > 0);
}

/** Advance traffic by `dt` seconds of game time and publish stats onto the city state. */
export function tickTraffic(s: CityState, t: TrafficState, dt: number): void {
  const w = s.world;
  // Roads change while paused; spawn points must not read a stale connectivity map.
  if (w.connectivityDirty) updateConnectivity(w);
  if (t.listRevision !== w.revision) refreshLists(w, t);
  if (t.transitRevision !== w.revision) syncTransit(w, t);
  if (dt <= 0) return;

  // Spawn: commuters scale with residents, trucks with industry.
  t.spawnCarry += (s.population / 150) * (1 - 0.6 * s.transit.share) * dt;
  t.truckCarry += (s.capacity.ind / 120) * dt;
  while (t.spawnCarry >= 1 && t.vehicles.length < MAX_VEHICLES) { t.spawnCarry -= 1; spawn(s, t, 0); }
  while (t.truckCarry >= 1 && t.vehicles.length < MAX_VEHICLES) { t.truckCarry -= 1; spawn(s, t, 1); }
  t.spawnCarry = Math.min(t.spawnCarry, 3);
  t.truckCarry = Math.min(t.truckCarry, 3);

  t.load.fill(0);
  for (const v of t.vehicles) t.load[v.tiles[Math.min(v.tiles.length - 1, Math.floor(v.progress))]]++;
  for (const v of t.transit) {
    if (v.kind === "bus" && v.tiles.length) t.load[v.tiles[Math.min(v.tiles.length - 1, Math.floor(v.progress))]]++;
  }
  moveTransit(w, t, dt, s.raining ? RAIN_SPEED_FACTOR : 1);

  if (t.sigRev !== (w.graphRevision ?? 0)) {
    t.sigRev = w.graphRevision ?? 0;
    t.sigNodes = signalNodes(w);
    t.sigByTile = indexSignals(w, t.sigNodes);
  }
  t.time += dt;
  const phase = signalPhase(t.time);

  let slow = 0;
  const alive: Vehicle[] = [];
  for (const v of t.vehicles) {
    const at = Math.min(v.tiles.length - 1, Math.floor(v.progress));
    const tile = v.tiles[at];
    const cls = w.road[tile];
    if (!cls) continue;
    let f = Math.max(MIN_SPEED_FACTOR, Math.min(1, ROAD_CAPACITY[cls] / Math.max(1, t.load[tile])));
    // Vehicles on a deck or in a tunnel ignore ground signals (M24).
    const onGround = !v.layers || v.layers[at] === 0;
    if (onGround && f > RED_CRAWL && t.sigNodes.length) f = Math.min(f, redCrawl(w, t, tile, v.tiles[Math.min(v.tiles.length - 1, at + 1)], phase));
    v.speedFactor = f;
    if (f < 0.6) slow++;
    v.progress += ROAD_SPEED[cls] * f * (s.raining ? RAIN_SPEED_FACTOR : 1) * dt;
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
