import { makeRng } from "./rng";
import { CityState } from "./sim";
import { ROAD, World, ZONE, heightAt, idx, inBounds, isTunnelTile, TransitKind, updateConnectivity, layerClass, RoadLayer, curvePoints } from "./world";
import { SignalInfo, hasSignal, signalNodes, signalPhaseAt } from "./roads";
import { straightTiles } from "./transit";
import { RAIN_SPEED_FACTOR } from "./weather";
import { profileOf } from "./corridor";
import { JunctionLayout, junctionsOf } from "./junction";
import { ClaimSet, PRIORITY_CLAIM_TIMEOUT, newClaimSet, priorityTableOf, resolveClaims, sweepClaims, upsertClaim, removeClaim } from "./priority";
import { AdaptiveSignalState, newAdaptiveSignal, stepAdaptiveSignalInPlace } from "./signals";

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
  /** Physical distance along `pts`.  Traffic is transient, so this is never saved. */
  arc?: number;
  /** Cumulative geometry distance for `pts`; built once with the route. */
  arcs?: Float32Array;
  /** Current speed as a fraction of free flow (1 = no congestion). */
  speedFactor: number;
  /** Current speed in tiles/s (IDM state). */
  v: number;
  /** Driver factor, 0.86..1.10, on free-flow speed. */
  vf: number;
  /** Per-point cornering limit along `pts`, tiles/s. */
  vmax: Float32Array;
  /** Brake lamp 0..1 (render state, smoothed). */
  brake: number;
  /** Indicator: ±1 while lit (sign = side, +1 left), else 0. */
  blink: number;
  /** Blink phase offset, game seconds. */
  seed: number;
  /** Held up by traffic (a leader, a red light, or a full tile): feeds congestion. */
  stuck: boolean;
  /** Unsaved free-road no-motion watchdog, in simulation seconds. */
  stuckTime?: number;
  /** Junction movements on this route (derived from `pts`, never saved); null when none. */
  moves?: RouteMoves | null;
  /** Index of the next movement in `moves` not yet cleared. */
  moveAt?: number;
  /** Movement whose claim timed out: crossed without a claim. */
  prioSkip?: number;
  /** Right-of-way stop distance for this substep (front bumper to stop line), or Infinity. */
  prioStop?: number;
}

/**
 * Junction movements a route makes, recorded when `routePath` splices lane
 * connectors.  Index j: node id, connector index into that layout's
 * `connectors`, and the polyline point range [i0, i1] the connector occupies.
 */
export interface RouteMoves {
  n: number;
  node: Int32Array;
  conn: Int32Array;
  i0: Int32Array;
  i1: Int32Array;
  layouts: JunctionLayout[];
}
const movesByRoute = new WeakMap<Float32Array, RouteMoves>();
/** Movements recorded for a route polyline produced by `routePath`, or undefined. */
export function routeMovesOf(pts: Float32Array): RouteMoves | undefined {
  return movesByRoute.get(pts);
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
  /** Live, unsaved adaptive controllers keyed by signal node id. */
  adaptiveSignals: Map<number, AdaptiveSignalState>;
  /** Reused approach queue counters, in SignalInfo arm order. */
  signalQueues: Map<number, number[]>;
  /** Unsignalised right-of-way nodes and their live claims, rebuilt with sigNodes; never saved. */
  prioNodes: Map<number, ClaimSet>;
  /** Substep stamp for claim refresh. */
  prioStamp: number;
  /** Claims dropped by the 12 s inside-the-box timeout (diagnostic). */
  prioTimeouts: number;
  /** Vehicles that reached the box without a granted claim (diagnostic; should stay 0). */
  prioOverruns: number;
  /**
   * Test/debug hook: signalised node ids to run as unsignalised priority
   * junctions instead.  Absent in the game, so signalised nodes are unchanged.
   */
  forcePriority?: Set<number>;
}

export function newTraffic(size: number, seed = 7): TrafficState {
  return {
    vehicles: [], transit: [], transitRevision: -1, load: new Uint16Array(size * size), completed: 0, nextId: 1,
    rng: makeRng(seed), spawnCarry: 0, truckCarry: 0, listRevision: -1,
    homes: [], shops: [], factories: [], jobs: [],
    time: 0, sigRev: -1, sigNodes: [], sigByTile: new Map(), adaptiveSignals: new Map(), signalQueues: new Map(),
    prioNodes: new Map(), prioStamp: 0, prioTimeouts: 0, prioOverruns: 0,
  };
}

/** Crawl factor while entering a signalised junction against a red light. */
const RED_CRAWL = 0.3;

/**
 * 1 when the route from `tile` to `next` may proceed, RED_CRAWL when it enters
 * a signalised node against its phase. `tick` is game seconds; each node runs
 * its own offset cycle (see signalPhaseAt). Allocation-free over cached nodes.
 */
export function redCrawl(w: World, t: TrafficState, tile: number, next: number, tick: number): number {
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
      const controller = t.adaptiveSignals.get(sn.id);
      const phase = controller?.stage === "green" ? controller.phase : -1;
      if (!controller ? (bd > 0.3 && (sn.arms[best].ns ? signalPhaseAt(sn.id, tick) !== 0 : signalPhaseAt(sn.id, tick) !== 1)) : (bd > 0.3 && phase !== (sn.arms[best].ns ? 0 : 1))) return RED_CRAWL;
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

/** Count waiting vehicles on each incoming signal arm without allocating in ticks. */
function updateAdaptiveSignals(w: World, t: TrafficState, h: number): void {
  for (const q of t.signalQueues.values()) q.fill(0);
  for (const v of t.vehicles) {
    if (v.tiles.length < 2 || v.v > IDM_V_STOP * 2) continue;
    const s = vehicleArc(v);
    const tile = routeTileAt(w, v, s);
    const candidates = t.sigByTile.get(tile);
    if (!candidates) continue;
    const p = pointAtRouteArc(v.pts, v.arcs!, s);
    const ni = routeArcIndex(v.arcs!, Math.min(v.arcs![v.arcs!.length - 1], s + 0.25));
    const hx = v.pts[Math.min(v.pts.length - 2, ni * 2 + 2)] - p.x;
    const hz = v.pts[Math.min(v.pts.length - 1, ni * 2 + 3)] - p.z;
    for (const sn of candidates) {
      let best = 0, bd = -Infinity;
      for (let i = 0; i < sn.arms.length; i++) {
        const d = -(sn.arms[i].dx * hx + sn.arms[i].dz * hz);
        if (d > bd) { bd = d; best = i; }
      }
      if (bd > 0.3) t.signalQueues.get(sn.id)![sn.arms[best].ns ? 0 : 1]++;
    }
  }
  for (const sn of t.sigNodes) {
    const controller = t.adaptiveSignals.get(sn.id);
    const queues = t.signalQueues.get(sn.id);
    if (controller && queues) stepAdaptiveSignalInPlace(controller, h, queues);
  }
}

// ------------------------------------------------------- IDM car following
//
// Portions adapted from Fable Cities (MIT, (c) 2026 raw,
// github.com/rawprogress/fable-cities @ aea8b10): TrafficSim.js#idmAccel and the
// brake/blink update in #_stepVehicle, LaneNetwork.js#makePoly (curvature speed
// limit plus the backward braking pass). Units converted per
// docs/process/10-fable-render-port.md section 1: vehicle-relative lengths
// ×0.0875 tile/m, accelerations ×0.405 tile/s² per m/s², headways ÷1.8.

/** IDM comfortable acceleration (2.85 m/s²). */
export const IDM_A = 1.15;
/** IDM comfortable braking (3.30 m/s²). */
export const IDM_B = 1.34;
/** IDM standstill gap, centre to centre minus half lengths (2.05 m). */
export const IDM_S0 = 0.18;
/** IDM desired time headway (1.05 s). */
export const IDM_T = 0.58;
/** IDM emergency deceleration (−7.6 m/s²). */
export const IDM_DEC = -3.08;
/** Cornering comfort limit for v = √(a/κ) (3.4 m/s²). */
export const IDM_LAT = 1.38;
/** Largest stable Euler step; tickTraffic sub-steps any dt above this. */
export const IDM_SUBSTEP = 0.1;
/** Half vehicle length, bumper to centre: car 0.20, truck 0.30 tile. */
export function halfLength(kind: 0 | 1): number {
  return kind === 1 ? 0.3 : 0.2;
}

/** Vehicles/second for one lane at free-flow speed under the pinned IDM gap. */
export function idmCapacityPerLane(speed: number, kind: 0 | 1 = 0): number {
  return speed / (IDM_S0 + speed * IDM_T + halfLength(kind) * 2);
}

/** Flow capacity of a road tile, used to translate demand into IDM units. */
export function idmRoadCapacity(type: number, kind: 0 | 1 = 0): number {
  return idmCapacityPerLane(ROAD_SPEED[type], kind) * profileOf(type as 1 | 2 | 3 | 4 | 5).lanes;
}

function demandCapacityFactor(w: World): number {
  let total = 0, physical = 0;
  for (let i = 0; i < w.road.length; i++) {
    const type = w.road[i];
    if (!type) continue;
    total += ROAD_CAPACITY[type];
    physical += idmRoadCapacity(type);
  }
  // Keep legacy demand stable on ordinary streets; only a materially
  // under-capacity network needs demand throttling.
  return total > 0 ? (physical / total < 0.5 ? Math.max(0.5, physical / total) : 1) : 1;
}

const IDM_GAP_FLOOR = 0.035;   // 0.4 m: keeps the gap term finite on contact
const IDM_VMIN_CURVE = 0.585;  // 2.6 m/s: slowest cornering limit
const IDM_B_ENTRY = 0.81;      // 2.0 m/s²: braking into a slower next tile
const IDM_B_BACK = 0.65;       // 1.6 m/s²: backward vmax pass
const IDM_STOP_LINE = 0.06;    // 0.7 m: stop line ahead of the junction tile
const IDM_STOP_ZERO = 0.031;   // 0.35 m: snap to a stop inside this of the line
const IDM_V_STOP = 0.135;      // 0.6 m/s: below this counts as stopped
const IDM_SPAWN_GAP = 0.31;    // 3.5 m: extra spawn clearance
const IDM_QUEUE_GAP = 0.79;    // 9 m: held brake lamps reach this far in a queue
const IDM_LOOKAHEAD = 4;       // route tiles scanned for leaders and red lights
const BRAKE_REF = 1.05;        // 2.6 m/s²: decel that reads as a full brake lamp
const BRAKE_SMOOTH = 9;        // lamp smoothing, 1/s
const BLINK_PERIOD = 0.94, BLINK_ON = 0.52; // indicator cycle, game seconds

/**
 * Intelligent Driver Model acceleration in tiles/s²: the free-road term plus
 * the interaction term for one leader (`gap` centre to centre minus half
 * lengths, `dv` closing speed). Pure and total: tiny or negative gaps clamp
 * instead of dividing by zero.
 */
export function idmAccel(v: number, v0: number, gap: number, dv: number, aMax = IDM_A): number {
  const free = 1 - Math.pow(Math.max(0, v) / Math.max(0.5, v0), 4);
  let inter = 0;
  if (gap < 1e8) {
    const sStar = IDM_S0 + Math.max(0, v * IDM_T + (v * dv) / (2 * Math.sqrt(aMax * IDM_B)));
    const g = Math.max(IDM_GAP_FLOOR, gap);
    inter = (sStar / g) * (sStar / g);
  }
  return aMax * (free - inter);
}

/**
 * Per-point cornering limit along a route in tiles/s: discrete curvature
 * κ = 2·sin(θ/2)/|seg| gives v = √(IDM_LAT/κ), then a backward pass brakes
 * before the apex instead of in it. Straight points stay Infinity; callers
 * take the min with free-flow speed.
 */
export function vmaxAt(pts: Float32Array): Float32Array {
  const n = pts.length / 2;
  const out = new Float32Array(n).fill(Infinity);
  for (let i = 1; i + 1 < n; i++) {
    const ax = pts[i * 2] - pts[i * 2 - 2], az = pts[i * 2 + 1] - pts[i * 2 - 1];
    const bx = pts[i * 2 + 2] - pts[i * 2], bz = pts[i * 2 + 3] - pts[i * 2 + 1];
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 1e-6 || lb < 1e-6) continue;
    const cos = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)));
    const kappa = (2 * Math.sqrt(Math.max(0, (1 - cos) / 2))) / Math.max(1e-6, (la + lb) / 2);
    if (kappa > 1e-4) out[i] = Math.max(IDM_VMIN_CURVE, Math.sqrt(IDM_LAT / kappa));
  }
  for (let i = n - 2; i >= 0; i--) {
    const d = Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]);
    out[i] = Math.min(out[i], Math.sqrt(out[i + 1] * out[i + 1] + 2 * IDM_B_BACK * d));
  }
  return out;
}

/** Cumulative route distance, in tiles; unlike legacy `progress`, this is geometry-aware. */
export function routeArcLengths(pts: Float32Array): Float32Array {
  const n = pts.length >> 1, out = new Float32Array(n);
  for (let i = 1; i < n; i++) out[i] = out[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  return out;
}

/** Locate an arc length on a route.  Equal-length samples resolve forward, deterministically. */
export function routeArcIndex(arcs: Float32Array, s: number): number {
  if (arcs.length < 2) return 0;
  const target = Math.max(0, Math.min(arcs[arcs.length - 1], s));
  let lo = 0, hi = arcs.length - 1;
  while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (arcs[m] <= target) lo = m; else hi = m; }
  return lo;
}

/** Interpolate a route at physical distance, for connector samples and legacy polylines alike. */
export interface RouteArcPose { x: number; z: number; index: number; t: number }
/** Allocation-free arc sampler for traffic's hot loop. */
export function pointAtRouteArcInto(pts: Float32Array, arcs: Float32Array, s: number, out: RouteArcPose): RouteArcPose {
  const i = routeArcIndex(arcs, s);
  const a = arcs[i] || 0, b = arcs[Math.min(i + 1, arcs.length - 1)] || a;
  const t = b > a ? Math.max(0, Math.min(1, (s - a) / (b - a))) : 0;
  out.x = pts[i * 2] + (pts[Math.min(i + 1, arcs.length - 1) * 2] - pts[i * 2]) * t;
  out.z = pts[i * 2 + 1] + (pts[Math.min(i + 1, arcs.length - 1) * 2 + 1] - pts[i * 2 + 1]) * t;
  out.index = i; out.t = t;
  return out;
}
/** Public convenience sampler; simulation code uses `pointAtRouteArcInto`. */
export function pointAtRouteArc(pts: Float32Array, arcs: Float32Array, s: number): RouteArcPose {
  return pointAtRouteArcInto(pts, arcs, s, { x: 0, z: 0, index: 0, t: 0 });
}

/** Tile below an arc position.  This deliberately keeps the existing tile buckets. */
function routeTileAt(w: World, v: Vehicle, s: number): number {
  const arcs = v.arcs ?? (v.arcs = routeArcLengths(v.pts));
  const p = pointAtRouteArcInto(v.pts, arcs, s, routeTilePose);
  const x = Math.max(0, Math.min(w.size - 1, Math.floor(p.x)));
  const z = Math.max(0, Math.min(w.size - 1, Math.floor(p.z)));
  const under = z * w.size + x;
  return w.road[under] ? under : v.tiles[Math.min(v.tiles.length - 1, p.index)] ?? under;
}
const routeTilePose: RouteArcPose = { x: 0, z: 0, index: 0, t: 0 };
const stepPose: RouteArcPose = { x: 0, z: 0, index: 0, t: 0 };
const leaderPose: RouteArcPose = { x: 0, z: 0, index: 0, t: 0 };

/** Keeps old transient hand-built test vehicles valid while making arc authoritative. */
function vehicleArc(v: Vehicle): number {
  const arcs = v.arcs ?? (v.arcs = routeArcLengths(v.pts));
  if (v.arc === undefined) {
    const i = Math.max(0, Math.min(arcs.length - 2, Math.floor(v.progress)));
    const f = Math.max(0, Math.min(1, v.progress - i));
    return arcs[i] + (arcs[i + 1] - arcs[i]) * f;
  }
  return v.arc;
}

/**
 * Turn sign at route index `at` from the cross product of the next two steps:
 * +1 left, −1 right, 0 straight or no turn ahead (x right, z down, so a left
 * turn reads negative). The indicator shows while the corner is within 2 tiles.
 */
export function turnSide(pts: Float32Array, at: number): number {
  const n = pts.length / 2;
  if (at < 0 || at + 2 >= n) return 0;
  const ax = pts[(at + 1) * 2] - pts[at * 2], az = pts[(at + 1) * 2 + 1] - pts[at * 2 + 1];
  const bx = pts[(at + 2) * 2] - pts[(at + 1) * 2], bz = pts[(at + 2) * 2 + 1] - pts[(at + 1) * 2 + 1];
  const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
  if (la < 1e-6 || lb < 1e-6) return 0;
  const s = (ax * bz - az * bx) / (la * lb);
  if (s < -0.25) return 1;
  if (s > 0.25) return -1;
  return 0;
}

/** Road height under route index `i`: deck profile on layer 1, terrain otherwise. */
function laneHeightAt(w: World, tiles: number[], layers: Uint8Array | undefined, pts: Float32Array, i: number): number {
  const t = tiles[i];
  const layer = layers ? layers[i] : isTunnelTile(w, t) ? 2 : w.roadDeck[t] && !w.roadSurface[t] ? 1 : 0;
  const dh = w.deckH[t];
  if (layer === 1 && !Number.isNaN(dh)) return dh;
  return heightAt(w, pts[i * 2], pts[i * 2 + 1]);
}

/**
 * True when route index `i` rides deck rail: layer 1 with a stamped deck, or a
 * ramp foot where the deck sits at ground height. Ground lanes under an
 * overpass stay ground (their deck is half a tile overhead).
 */
function onDeckRail(w: World, tiles: number[], layers: Uint8Array | undefined, pts: Float32Array, i: number): boolean {
  if (i < 0 || i >= tiles.length) return false;
  const t = tiles[i];
  const dh = w.deckH[t];
  if (Number.isNaN(dh)) return false;
  const layer = layers ? layers[i] : isTunnelTile(w, t) ? 2 : w.roadDeck[t] && !w.roadSurface[t] ? 1 : 0;
  if (layer === 1) return true;
  if (layer !== 0) return false;
  return Math.abs(dh - heightAt(w, pts[i * 2], pts[i * 2 + 1])) < 0.05;
}

const minmod = (a: number, b: number): number => (a * b <= 0 ? 0 : Math.abs(a) < Math.abs(b) ? a : b);

/**
 * Continuous road height along a route in tiles: deck heights interpolated
 * between route tiles so vehicles ride ramps smoothly instead of stepping per
 * tile, terrain elsewhere. Pure (reads world height fields only).
 */
export function routeHeightAt(w: World, tiles: number[], layers: Uint8Array | undefined, pts: Float32Array, progress: number): number {
  const len = tiles.length;
  if (!len) return 0;
  if (len < 2 || pts.length < 4) return laneHeightAt(w, tiles, layers, pts, 0);
  const p = Math.max(0, Math.min(len - 1, progress));
  const i = Math.min(len - 2, Math.floor(p));
  const f = p - i;
  const y0 = laneHeightAt(w, tiles, layers, pts, i);
  const y1 = laneHeightAt(w, tiles, layers, pts, i + 1);
  // Deck runs ride a smoothstep Hermite: deckH is sampled per tile but the
  // ribbon follows the smooth01 profile, whose peak slope is 1.5× the secant.
  // Limited tangents (1.5×minmod) reproduce ramp cubics almost exactly, stay
  // flat on decks, and never overshoot at joints the way Catmull-Rom does.
  if (onDeckRail(w, tiles, layers, pts, i) && onDeckRail(w, tiles, layers, pts, i + 1)) {
    const dm = i - 1 >= 0 ? laneHeightAt(w, tiles, layers, pts, i - 1) : y0;
    const dp = i + 2 < len ? laneHeightAt(w, tiles, layers, pts, i + 2) : y1;
    const m0 = 1.5 * minmod(y0 - dm, y1 - y0);
    const m1 = 1.5 * minmod(y1 - y0, dp - y1);
    const t2 = f * f, t3 = t2 * f;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + f) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
  }
  return y0 + (y1 - y0) * f;
}

/** Nose-up-positive pitch from front/rear heights, clamped to ±0.5 rad. */
export function pitchFromHeights(hF: number, hR: number, dist: number): number {
  const p = Math.atan2(hF - hR, Math.max(1e-6, dist));
  return Math.max(-0.5, Math.min(0.5, p));
}

/**
 * Vehicle pitch along a route: heights sampled ±0.4·length about the centre,
 * the Fable Renderer.js matrix pose (Euler YXZ there; Mayor's +X-forward
 * models take the same angle about Z after yaw). Zero on flat ground.
 */
export function routePitchAt(w: World, tiles: number[], layers: Uint8Array | undefined, pts: Float32Array, progress: number, halfLen: number): number {
  const len = tiles.length;
  if (len < 2 || pts.length < 4) return 0;
  const p = Math.max(0, Math.min(len - 1, progress));
  const i = Math.min(len - 2, Math.floor(p));
  const segLen = Math.max(1e-6, Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]));
  const off = (0.8 * halfLen) / segLen;
  return pitchFromHeights(
    routeHeightAt(w, tiles, layers, pts, p + off),
    routeHeightAt(w, tiles, layers, pts, p - off),
    1.6 * halfLen,
  );
}

/** Per-tile vehicle buckets, rebuilt every substep without allocation. */
const buckets = { tiles: 0, head: new Int32Array(0), next: new Int32Array(0) };
function ensureBuckets(tiles: number, vehicles: number): void {
  if (buckets.tiles !== tiles) {
    buckets.tiles = tiles;
    buckets.head = new Int32Array(tiles);
  }
  if (buckets.next.length < vehicles) buckets.next = new Int32Array(Math.max(16, vehicles * 2));
}

/**
 * Advance one vehicle by `h` game seconds: IDM against the nearest leader in
 * its corridor over the next few route tiles, a virtual stopped leader at red
 * stop lines, curvature and entry-speed limits, plus brake/blink render state.
 * Sequential over the (stable-order) vehicle array, so a fixed seed replays
 * exactly; neighbour speeds read the current substep in place.
 */
function stepVehicle(w: World, t: TrafficState, k: number, h: number, weather: number): void {
  const v = t.vehicles[k];
  const len = v.tiles.length;
  if (len < 2) return;
  const arcDriven = v.arc !== undefined;
  const arcs = v.arcs ?? (v.arcs = routeArcLengths(v.pts));
  const routeS = vehicleArc(v);
  const pose = pointAtRouteArcInto(v.pts, arcs, routeS, stepPose);
  const at = pose.index;
  if (at >= arcs.length - 1 || at < 0) return;
  const tile = routeTileAt(w, v, routeS);
  const cls = w.road[tile];
  if (!cls) return;
  const f = pose.t;
  const ax = v.pts[at * 2], az = v.pts[at * 2 + 1];
  const bx = v.pts[at * 2 + 2], bz = v.pts[at * 2 + 3];
  const segLen = Math.hypot(bx - ax, bz - az) || 1;
  const hx = (bx - ax) / segLen, hz = (bz - az) / segLen;
  const px = ax + (bx - ax) * f, pz = az + (bz - az) * f;
  const myHalf = halfLength(v.kind);
  const vv = v.v ?? 0;

  // Desired speed: free flow × driver × weather, capped by congestion (kept as
  // an upper bound so balance matches the old model) and by the corner limit.
  const vf = v.vf ?? 1;
  const free = ROAD_SPEED[cls] * vf * weather;
  const fCap = Math.max(MIN_SPEED_FACTOR, Math.min(1, ROAD_CAPACITY[cls] / Math.max(1, t.load[tile])));
  let v0 = Math.min(free * fCap, v.vmax ? v.vmax[at] : Infinity);
  const ncls = w.road[routeTileAt(w, v, Math.min(arcs[arcs.length - 1], routeS + Math.max(0.3, segLen)))];
  if (ncls) {
    const entry = ROAD_SPEED[ncls] * vf * weather;
    const remain = Math.max(0, arcs[Math.min(at + 1, arcs.length - 1)] - routeS);
    const ve = Math.sqrt(entry * entry + 2 * IDM_B_ENTRY * remain);
    if (ve < v0) v0 = ve;
  }

  // Leader: nearest vehicle ahead in our corridor on the next few route tiles.
  // Same-direction only (heading dot): cross traffic and oncoming lanes pass
  // through until the lane graph lands, as before.
  let leadGap = Infinity, leadV = 0;
  const { head, next } = buckets;
  const last = Math.min(arcs[arcs.length - 1], routeS + IDM_LOOKAHEAD);
  for (let scan = routeS; scan <= last + 1e-6; scan += 1) {
    const scanTile = routeTileAt(w, v, scan);
    for (let u = head[scanTile]; u >= 0; u = next[u]) {
      if (u === k) continue;
      const o = t.vehicles[u];
      const oarcs = o.arcs ?? (o.arcs = routeArcLengths(o.pts));
      const op = pointAtRouteArcInto(o.pts, oarcs, vehicleArc(o), leaderPose);
      const oat = Math.max(0, Math.min(oarcs.length - 2, op.index));
      const of = op.t;
      const oax = o.pts[oat * 2], oaz = o.pts[oat * 2 + 1];
      const obx = o.pts[oat * 2 + 2], obz = o.pts[oat * 2 + 3];
      const oseg = Math.hypot(obx - oax, obz - oaz) || 1;
      const ohx = (obx - oax) / oseg, ohz = (obz - oaz) / oseg;
      const rx = oax + (obx - oax) * of - px, rz = oaz + (obz - oaz) * of - pz;
      const long = rx * hx + rz * hz;
      // A vehicle behind us is never a leader.  The old -0.2 tolerance made
      // two close stopped cars brake one another forever.
      if (long <= 1e-6) continue;
      if (Math.abs(rx * hz - rz * hx) > 0.45) continue;
      if (hx * ohx + hz * ohz < 0.3) continue;
      const gap = long - myHalf - halfLength(o.kind);
      if (gap < leadGap) { leadGap = gap; leadV = o.v ?? 0; }
    }
  }

  // Red lights: a virtual stopped leader at the stop line of the first
  // controlled tile transition ahead (replaces the old RED_CRAWL factor, but
  // redCrawl itself still answers "may this transition proceed").
  let stopDist = Infinity;
  const onGround = !v.layers || v.layers[at] === 0;
  if (onGround && t.sigNodes.length) {
    // Use the coarse tile route to identify the stop line.  The fine route may
    // contain several connector samples in a single tile, while signal arms
    // are indexed by their approach tiles.
    for (let sk = 0; sk <= IDM_LOOKAHEAD && at + sk + 1 < v.tiles.length; sk++) {
      if (redCrawl(w, t, v.tiles[at + sk], v.tiles[at + sk + 1], t.time) !== RED_CRAWL) continue;
      // Stop-line ownership remains tied to the coarse approach tile.  The
      // vehicle state and leader gaps are arclength based; using this tile
      // boundary preserves the authored stop bar when connector samples add
      // extra polyline points at the node.
      const d = Math.max(0, at + sk + 1 - IDM_STOP_LINE - (v.progress + myHalf));
      stopDist = d;
      break;
    }
    if (stopDist === Infinity) {
    for (let scan = routeS; scan <= Math.min(arcs[arcs.length - 1] - 0.01, routeS + IDM_LOOKAHEAD); scan += 0.5) {
      const nextS = Math.min(arcs[arcs.length - 1], scan + 0.5);
      if (redCrawl(w, t, routeTileAt(w, v, scan), routeTileAt(w, v, nextS), t.time) !== RED_CRAWL) continue;
      const d = scan + 0.5 - IDM_STOP_LINE - (routeS + myHalf);
      if (d < -0.15) continue; // past the line: clear the junction
      stopDist = Math.max(0, d);
      break;
    }
    }
  }

  // Right of way at unsignalised junctions: the same virtual stopped leader.
  const ps = v.prioStop;
  if (ps !== undefined && ps < stopDist) stopDist = ps;

  const aFree = idmAccel(vv, v0, 1e9, 0);
  let a = aFree;
  if (leadGap < 1e8) a = Math.min(a, idmAccel(vv, v0, leadGap, vv - leadV));
  const stopping = stopDist < 1e8;
  if (stopping) a = Math.min(a, idmAccel(vv, v0, stopDist + IDM_S0, vv));
  const aInt = a;
  a = Math.max(IDM_DEC, Math.min(IDM_A, a));
  let nv = Math.max(0, vv + a * h);
  if (stopDist < IDM_STOP_ZERO && nv < IDM_V_STOP) nv = 0;
  // A deterministic backstop for numerical/contact pathologies: only a car
  // with no leader and no red stop may be nudged after 20 game seconds.
  if (leadGap === Infinity && stopDist === Infinity && nv < 1e-4) {
    v.stuckTime = (v.stuckTime ?? 0) + h;
    if (v.stuckTime >= 20) { nv = Math.min(v0, 0.3); v.stuckTime = 0; }
  } else v.stuckTime = 0;
  v.v = nv;
  if (arcDriven) {
    v.arc = Math.min(arcs[arcs.length - 1], routeS + nv * h);
    const pi = routeArcIndex(arcs, v.arc);
    const pa = arcs[pi], arcNext = arcs[Math.min(pi + 1, arcs.length - 1)];
    v.progress = pi + (arcNext > pa ? (v.arc - pa) / (arcNext - pa) : 0); // compatibility only
  } else v.progress += nv * h;

  let brakeT = Math.min(1, Math.max(0, -a / BRAKE_REF));
  if (nv < IDM_V_STOP && (stopping || leadGap < IDM_QUEUE_GAP)) brakeT = Math.max(brakeT, 0.9);
  const pb = v.brake ?? 0;
  v.brake = pb + (brakeT - pb) * Math.min(1, h * BRAKE_SMOOTH);

  const side = turnSide(v.pts, at);
  v.blink = side === 0 ? 0 : side * (((t.time + (v.seed ?? 0)) % BLINK_PERIOD) < BLINK_ON ? 1 : 0);
  v.speedFactor = Math.max(0, Math.min(1, Math.min(fCap, nv / Math.max(1e-6, free))));
  // Congestion means held up by traffic, not merely slow: free acceleration,
  // cornering, and weak far interactions match (or nearly match) the
  // interaction-free accel, so only a binding leader or signal — or a full
  // tile — counts. This keeps the old model's meaning (and the happiness
  // balance) while real queues now read as congestion too.
  v.stuck = fCap < 0.6 || (nv < 0.6 * free && aInt < 0.5 * aFree);
}

// ------------------------------------------------- unsignalised right of way
//
// Rules and claim ordering live in priority.ts.  This pass maps vehicles to
// movements (from the connectors routePath spliced), refreshes claims, grants
// them, and turns a refused claim into a stop-line distance for stepVehicle.

/** Register a claim this far before the connector: comfortable stop plus margin. */
const PRIO_REG_B = 1.5, PRIO_REG_MARGIN = 0.75;
/** A granted claim latches once stopping would need more than this decel (tiles/s²). */
const PRIO_COMMIT_B = 2.5, PRIO_COMMIT_MARGIN = 0.1;
/** Exit room needed beyond the connector end, besides the vehicle's own length. */
const PRIO_EXIT_ROOM = 0.3;
const exitPose: RouteArcPose = { x: 0, z: 0, index: 0, t: 0 };
const exitPose2: RouteArcPose = { x: 0, z: 0, index: 0, t: 0 };

/** Is the lane just past this connector exit held by a slow vehicle (do not block the box)? */
function exitBlocked(w: World, t: TrafficState, k: number, v: Vehicle, sExit: number): boolean {
  const arcs = v.arcs!;
  const total = arcs[arcs.length - 1];
  if (sExit >= total - 0.05) return false;
  const e = pointAtRouteArcInto(v.pts, arcs, sExit, exitPose);
  const ex = e.x, ez = e.z;
  const f = pointAtRouteArcInto(v.pts, arcs, Math.min(total, sExit + 0.25), exitPose2);
  let hx = f.x - ex, hz = f.z - ez;
  const hl = Math.hypot(hx, hz);
  if (hl < 1e-6) return false;
  hx /= hl; hz /= hl;
  const need = 2 * halfLength(v.kind) + PRIO_EXIT_ROOM;
  const { head, next } = buckets;
  let lastTile = -1;
  for (let scan = sExit; scan <= Math.min(total, sExit + need + 0.5) + 1e-6; scan += 0.5) {
    const tile = routeTileAt(w, v, scan);
    if (tile === lastTile) continue;
    lastTile = tile;
    for (let u = head[tile]; u >= 0; u = next[u]) {
      if (u === k) continue;
      const o = t.vehicles[u];
      if ((o.v ?? 0) > 0.5) continue;
      const oarcs = o.arcs ?? (o.arcs = routeArcLengths(o.pts));
      const op = pointAtRouteArcInto(o.pts, oarcs, vehicleArc(o), leaderPose);
      const rx = op.x - ex, rz = op.z - ez;
      const long = rx * hx + rz * hz - halfLength(o.kind);
      if (long < -0.1 || long > need) continue;
      if (Math.abs(rx * hz - rz * hx) > 0.2) continue;
      // Same direction only: oncoming cars waiting at their own line do not fill our exit.
      const oi = Math.max(0, Math.min(oarcs.length - 2, op.index));
      const odx = o.pts[oi * 2 + 2] - o.pts[oi * 2], odz = o.pts[oi * 2 + 3] - o.pts[oi * 2 + 1];
      if (odx * hx + odz * hz <= 0.3 * Math.hypot(odx, odz)) continue;
      return true;
    }
  }
  return false;
}

function updatePriority(w: World, t: TrafficState): void {
  if (!t.prioNodes.size) {
    if (t.prioStamp) { for (const v of t.vehicles) v.prioStop = Infinity; t.prioStamp = 0; }
    return;
  }
  const stamp = ++t.prioStamp;
  for (let k = 0; k < t.vehicles.length; k++) {
    const v = t.vehicles[k];
    v.prioStop = Infinity;
    if (v.tiles.length < 2) continue;
    let m = v.moves;
    if (m === undefined) m = v.moves = routeMovesOf(v.pts) ?? null;
    if (!m) continue;
    const arcs = v.arcs ?? (v.arcs = routeArcLengths(v.pts));
    const s = vehicleArc(v);
    const half = halfLength(v.kind);
    let j = v.moveAt ?? 0;
    while (j < m.n && s - half >= arcs[m.i1[j]]) j++;
    v.moveAt = j;
    if (j >= m.n || v.prioSkip === j) continue;
    const cs = t.prioNodes.get(m.node[j]);
    if (!cs || cs.layout !== m.layouts[j]) continue;
    const d = arcs[m.i0[j]] - (s + half);
    const vv = v.v ?? 0;
    if (d > (vv * vv) / (2 * PRIO_REG_B) + PRIO_REG_MARGIN) continue;
    const slot = upsertClaim(cs, v.id, m.conn[j], t.time, stamp);
    cs.vidx[slot] = k;
    cs.dist[slot] = d;
    if (cs.state[slot] === 0) {
      if (d <= 0) {
        if (!cs.go[slot]) t.prioOverruns++;
        cs.state[slot] = 1; cs.enterAt[slot] = t.time;
      } else if (cs.go[slot] && d < (vv * vv) / (2 * PRIO_COMMIT_B) + PRIO_COMMIT_MARGIN) {
        cs.state[slot] = 1; cs.enterAt[slot] = t.time;
      }
    }
    if (cs.state[slot] === 1) {
      cs.blocked[slot] = 0;
      if (t.time - cs.enterAt[slot] > PRIORITY_CLAIM_TIMEOUT) {
        removeClaim(cs, slot);
        v.prioSkip = j;
        t.prioTimeouts++;
      }
    } else cs.blocked[slot] = exitBlocked(w, t, k, v, arcs[m.i1[j]]) ? 1 : 0;
  }
  const IDM_LINE = IDM_STOP_LINE;
  for (const cs of t.prioNodes.values()) {
    if (!cs.n) continue;
    sweepClaims(cs, stamp);
    resolveClaims(cs);
    for (let q = 0; q < cs.n; q++) {
      if (cs.go[q]) continue;
      const veh = t.vehicles[cs.vidx[q]];
      veh.prioStop = Math.max(0, cs.dist[q] - IDM_LINE);
    }
  }
}

/** Rebuild the unsignalised junction set (graph edits only). */
function rebuildPriority(w: World, t: TrafficState): void {
  const prev = t.prioNodes;
  t.prioNodes = new Map();
  for (const l of junctionsOf(w).byNode.values()) {
    if (l.arms.length < 3 || !l.connectors.length) continue;
    if (hasSignal(w, l.nodeId) && !t.forcePriority?.has(l.nodeId)) continue;
    const old = prev.get(l.nodeId);
    t.prioNodes.set(l.nodeId, old && old.layout === l ? old : newClaimSet(priorityTableOf(l), l));
  }
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

/**
 * Vehicle route geometry.  Junction curvature is now owned by the derived
 * lane graph (`lanes.ts` / `JunctionLayout.connectors`); do not blur route
 * points here, because that cuts across the pad and defeats lane containment.
 * The tile route remains the coarse routing index until vehicle progress is
 * migrated from tile indices to lane arc length.
 */
export function routePath(w: World, tiles: number[]): Float32Array {
  const snapped = snapToCentrelines(w, tiles, smoothPath(w, tiles));
  const layouts = junctionsOf(w).byNode;
  if (!layouts.size || snapped.length < 6) return snapped;
  // A wide road can let the tile route cut a junction diagonally with no
  // sample near the node; add the closest point of such a step as a sample.
  const grown: number[] = [];
  for (let i = 0; i < snapped.length / 2; i++) {
    const x0 = snapped[i * 2], z0 = snapped[i * 2 + 1];
    grown.push(x0, z0);
    if (i + 1 >= snapped.length / 2) break;
    const x1 = snapped[i * 2 + 2], z1 = snapped[i * 2 + 3];
    const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
    if (l2 < 1e-6) continue;
    for (const l of layouts.values()) {
      if (!l.connectors.length) continue;
      const cx = l.centre.x, cz = l.centre.z;
      if ((x0 - cx) ** 2 + (z0 - cz) ** 2 <= 1.21 || (x1 - cx) ** 2 + (z1 - cz) ** 2 <= 1.21) continue;
      const u = ((cx - x0) * dx + (cz - z0) * dz) / l2;
      if (u <= 0 || u >= 1) continue;
      const px = x0 + dx * u, pz = z0 + dz * u;
      if ((px - cx) ** 2 + (pz - cz) ** 2 < 1.21) { grown.push(px, pz); break; }
    }
  }
  const base = grown.length === snapped.length ? snapped : new Float32Array(grown);
  const n = base.length / 2;
  // A route is still tile-indexed for A*, but its physical polyline owns node
  // traversal.  Each interior centre sample near a node proposes the legal
  // lane connector whose endpoints best match travel.  Consecutive samples
  // proposing the same node splice it once, at the best-scoring sample; the
  // others are kept only outside the connector's span.  (Splicing per sample
  // used to repeat a straight connector three times, sending cars backwards.)
  const bestL: (JunctionLayout | undefined)[] = new Array(n);
  const bestC = new Int32Array(n).fill(-1);
  const bestS = new Float64Array(n).fill(-Infinity);
  for (let i = 1; i + 1 < n; i++) {
    const x = base[i * 2], z = base[i * 2 + 1];
    const ax = x - base[i * 2 - 2], az = z - base[i * 2 - 1];
    const bx = base[i * 2 + 2] - x, bz = base[i * 2 + 3] - z;
    const al = Math.hypot(ax, az) || 1, bl = Math.hypot(bx, bz) || 1;
    for (const l of layouts.values()) {
      if ((l.centre.x - x) ** 2 + (l.centre.z - z) ** 2 > 1.1 * 1.1) continue;
      for (let ci = 0; ci < l.connectors.length; ci++) {
        const c = l.connectors[ci];
        const p0 = c.points[0], pn = c.points[c.points.length - 1];
        const cinx = c.points[Math.min(1, c.points.length - 1)].x - p0.x;
        const cinz = c.points[Math.min(1, c.points.length - 1)].z - p0.z;
        const coutx = pn.x - c.points[Math.max(0, c.points.length - 2)].x;
        const coutz = pn.z - c.points[Math.max(0, c.points.length - 2)].z;
        const il = Math.hypot(cinx, cinz) || 1, ol = Math.hypot(coutx, coutz) || 1;
        const score = (ax * cinx + az * cinz) / (al * il) + (bx * coutx + bz * coutz) / (bl * ol)
          - 0.08 * (Math.hypot(p0.x - x, p0.z - z) + Math.hypot(pn.x - x, pn.z - z));
        if (score > bestS[i]) { bestS[i] = score; bestL[i] = l; bestC[i] = ci; }
      }
    }
    if (bestS[i] <= 1.2) { bestL[i] = undefined; bestC[i] = -1; }
  }
  const out: number[] = [base[0], base[1]];
  const mNode: number[] = [], mConn: number[] = [], mI0: number[] = [], mI1: number[] = [];
  const mLayouts: JunctionLayout[] = [];
  const push = (px: number, pz: number): void => {
    const lx = out[out.length - 2], lz = out[out.length - 1];
    if ((px - lx) ** 2 + (pz - lz) ** 2 > 1e-5) out.push(px, pz);
  };
  let i = 1;
  while (i + 1 < n) {
    const l = bestL[i];
    if (!l) { push(base[i * 2], base[i * 2 + 1]); i++; continue; }
    let end = i;
    while (end + 2 < n && bestL[end + 1] === l) end++;
    // The run enters along (i-1 → i) and leaves along (end → end+1): pick the
    // connector matching both, nearest the route at its mouths.
    const ix = base[i * 2] - base[i * 2 - 2], iz = base[i * 2 + 1] - base[i * 2 - 1];
    const ox = base[end * 2 + 2] - base[end * 2], oz = base[end * 2 + 3] - base[end * 2 + 1];
    const il = Math.hypot(ix, iz) || 1, ol = Math.hypot(ox, oz) || 1;
    let ci = bestC[i], cs = -Infinity;
    for (let q = 0; q < l.connectors.length; q++) {
      const cq = l.connectors[q];
      const ia = l.arms[cq.inArm], oa = l.arms[cq.outArm];
      const a0 = cq.points[0], an = cq.points[cq.points.length - 1];
      const score = -(ix * ia.dx + iz * ia.dz) / il + (ox * oa.dx + oz * oa.dz) / ol
        - 0.08 * (Math.hypot(a0.x - base[i * 2], a0.z - base[i * 2 + 1]) + Math.hypot(an.x - base[end * 2], an.z - base[end * 2 + 1]));
      if (score > cs) { cs = score; ci = q; }
    }
    // Splice at the sample nearest the node centre.
    let pick = i;
    for (let r = i + 1; r <= end; r++) {
      if ((base[r * 2] - l.centre.x) ** 2 + (base[r * 2 + 1] - l.centre.z) ** 2 < (base[pick * 2] - l.centre.x) ** 2 + (base[pick * 2 + 1] - l.centre.z) ** 2) pick = r;
    }
    bestC[pick] = ci;
    const c = l.connectors[ci];
    const p0 = c.points[0], pn = c.points[c.points.length - 1];
    const inA = l.arms[c.inArm], outA = l.arms[c.outArm];
    for (let r = i; r < pick; r++) {
      // Before the mouth along the inbound travel direction (-arm).
      if ((base[r * 2] - p0.x) * -inA.dx + (base[r * 2 + 1] - p0.z) * -inA.dz < -0.05) push(base[r * 2], base[r * 2 + 1]);
    }
    push(p0.x, p0.z);
    const at0 = out.length / 2 - 1; // p0, or the coincident point it deduped onto
    for (let q = 1; q < c.points.length; q++) push(c.points[q].x, c.points[q].z);
    mNode.push(l.nodeId); mConn.push(bestC[pick]); mLayouts.push(l);
    mI0.push(at0); mI1.push(out.length / 2 - 1);
    for (let r = pick + 1; r <= end; r++) {
      if ((base[r * 2] - pn.x) * outA.dx + (base[r * 2 + 1] - pn.z) * outA.dz > 0.05) push(base[r * 2], base[r * 2 + 1]);
    }
    i = end + 1;
  }
  push(base[base.length - 2], base[base.length - 1]);
  const pts = new Float32Array(out);
  if (mNode.length) {
    movesByRoute.set(pts, {
      n: mNode.length, node: Int32Array.from(mNode), conn: Int32Array.from(mConn),
      i0: Int32Array.from(mI0), i1: Int32Array.from(mI1), layouts: mLayouts,
    });
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
  // Up to 3 placements per demand unit (Fable tries 6 lanes); a new car joins
  // at 55% of the lane limit, never at a standstill in moving traffic.
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = accessTile(w, origins[Math.floor(t.rng() * origins.length)], t.rng);
    const b = accessTile(w, dests[Math.floor(t.rng() * dests.length)], t.rng);
    if (a < 0 || b < 0) continue;
    const lp = findLayeredPath(w, t.load, a, b);
    if (!lp || lp.tiles.length < 2) continue;
    const pts = routePath(w, lp.tiles);
    const arcs = routeArcLengths(pts);
    const myHalf = halfLength(kind);
    let v0 = ROAD_SPEED[w.road[a]] * 0.55;
    if (t.prioNodes.size) {
      // Never start or end inside a right-of-way junction box (no claim covers
      // it), and start slow enough to stop for the first stop line.
      let inBox = false;
      const ex = pts[pts.length - 2], ez = pts[pts.length - 1];
      for (const cs of t.prioNodes.values()) {
        const c = cs.layout!.centre;
        if ((pts[0] - c.x) ** 2 + (pts[1] - c.z) ** 2 < 1.21 || (ex - c.x) ** 2 + (ez - c.z) ** 2 < 1.21) { inBox = true; break; }
      }
      if (inBox) continue;
      const mv = routeMovesOf(pts);
      if (mv && t.prioNodes.has(mv.node[0])) {
        const d0 = arcs[mv.i0[0]] - myHalf - IDM_STOP_LINE;
        if (d0 < 0.05) continue;
        v0 = Math.min(v0, Math.sqrt(2 * PRIO_COMMIT_B * Math.max(0, d0 - PRIO_COMMIT_MARGIN)));
      }
    }
    // Spawn clearance: the start point needs half + half + 0.31 tile of room
    // from vehicles on the access tile or about to enter it.  Tiles come from
    // the arc position: connector samples mean route points no longer index tiles.
    let blocked = false;
    for (const u of t.vehicles) {
      if (u.tiles.length < 2) continue;
      const us = vehicleArc(u);
      if (routeTileAt(w, u, us) !== a && routeTileAt(w, u, us + 1) !== a) continue;
      const up = pointAtRouteArcInto(u.pts, u.arcs!, us, leaderPose);
      if (Math.hypot(up.x - pts[0], up.z - pts[1]) - myHalf - halfLength(u.kind) < IDM_SPAWN_GAP) { blocked = true; break; }
    }
    if (blocked) continue;
    t.vehicles.push({
      id: t.nextId++, kind, tiles: lp.tiles, layers: lp.layers, pts,
      progress: 0, arc: 0, arcs, speedFactor: 1, v: v0, vf: 0.86 + t.rng() * 0.24,
      vmax: vmaxAt(pts), brake: 0, blink: 0, seed: t.rng() * BLINK_PERIOD, stuck: false,
    });
    return;
  }
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
  // Rebuilt even while paused (dt 0) so a fresh state is ready before the first step.
  if (t.sigRev !== (w.graphRevision ?? 0)) {
    t.sigRev = w.graphRevision ?? 0;
    t.sigNodes = t.forcePriority?.size ? signalNodes(w).filter((sn) => !t.forcePriority!.has(sn.id)) : signalNodes(w);
    t.sigByTile = indexSignals(w, t.sigNodes);
    t.adaptiveSignals.clear(); t.signalQueues.clear();
    for (const sn of t.sigNodes) {
      // Two opposition groups are the established signal contract. A node
      // with one effective pair retains its old fixed timing by omitting a controller.
      if (sn.arms.length > 2) t.adaptiveSignals.set(sn.id, newAdaptiveSignal(2, signalPhaseAt(sn.id, t.time)));
      t.signalQueues.set(sn.id, [0, 0]);
    }
    rebuildPriority(w, t);
  }
  if (dt <= 0) return;

  // Spawn: commuters scale with residents, trucks with industry.
  const demandFactor = demandCapacityFactor(w);
  t.spawnCarry += (s.population / 150) * demandFactor * (1 - 0.6 * s.transit.share) * dt;
  t.truckCarry += (s.capacity.ind / 120) * demandFactor * dt;
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

  // IDM substeps: explicit Euler is stable only for h well under the headway.
  const weather = s.raining ? RAIN_SPEED_FACTOR : 1;
  const steps = Math.max(1, Math.ceil(dt / IDM_SUBSTEP - 1e-9));
  const h = dt / steps;
  ensureBuckets(w.size * w.size, t.vehicles.length);
  for (let step = 0; step < steps; step++) {
    t.time += h;
    buckets.head.fill(-1);
    for (let k = 0; k < t.vehicles.length; k++) {
      const v = t.vehicles[k];
      if (v.tiles.length < 2) continue;
      const at = Math.max(0, Math.min(v.tiles.length - 1, Math.floor(v.progress)));
      buckets.next[k] = buckets.head[v.tiles[at]];
      buckets.head[v.tiles[at]] = k;
    }
    updateAdaptiveSignals(w, t, h);
    updatePriority(w, t);
    for (let k = 0; k < t.vehicles.length; k++) stepVehicle(w, t, k, h, weather);
  }

  let slow = 0;
  const alive: Vehicle[] = [];
  for (const v of t.vehicles) {
    const at = Math.max(0, Math.min(v.tiles.length - 1, Math.floor(v.progress)));
    const tile = v.tiles[at];
    if (!w.road[tile]) continue;
    if (v.progress >= v.tiles.length - 1) { t.completed++; continue; }
    if (v.stuck) slow++;
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
