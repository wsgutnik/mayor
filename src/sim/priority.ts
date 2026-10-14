/**
 * Right of way at unsignalised junctions.
 *
 * Pure and derived: tables come from a `JunctionLayout`'s arms and lane
 * connectors, claims are transient traffic state.  Nothing here is saved.
 *
 * Rules (TMPE `HasPriorityOnSameLevel` / `PriorityRoad`, MIT, as summarised in
 * docs/process/12-github-road-tools-research.md §3.4.5; claim lifecycle after
 * Fable Cities, MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @
 * aea8b10, TrafficSim.js#_intent and #_resolveClaims):
 *
 * 1. Two movements (lane connectors) conflict when they leave the same inbound
 *    lane: never; when they end in the same outbound lane: always (merge);
 *    otherwise when their polylines cross or pass within CONFLICT_TOL_FACTOR
 *    of a lane width.
 * 2. A movement yields to a conflicting one when its inbound arm ranks lower
 *    (road class, then asphalt half width: the main road wins).  Among equal
 *    arms, the far turn (the one across oncoming traffic) yields to oncoming
 *    straight and near turns, then a movement yields to traffic approaching
 *    from its priority side (the right under right-hand traffic).
 * 3. Claims: vehicles near the stop line register a claim.  Committed claims
 *    (inside the box, or granted and unable to stop comfortably) always keep
 *    going.  Waiting claims are ordered topologically by the yield relation;
 *    a cycle (the all-way tie of an equal 4-way) is broken by arrival time,
 *    then inbound arm index, then vehicle id, so one claim always heads the
 *    order and the node cannot deadlock.  Each claim, in order, is granted if
 *    it conflicts with no earlier committed, granted or waiting claim.
 *
 * Handedness is read from the connector geometry rather than assumed, so the
 * rules stay correct when the lane side convention changes (see `trafficHand`).
 */
import type { Pt, RoadType } from "./world";
import { baseRoadType } from "./world";
import { profileOf } from "./corridor";
import { classifyTurn, type TurnKind } from "./signals";
import type { LaneConnector } from "./lanes";
import type { JunctionLayout } from "./junction";

/** Claims inside the box are dropped after this many game seconds. */
export const PRIORITY_CLAIM_TIMEOUT = 12;
/** Two connectors closer than this fraction of the narrower lane width conflict. */
export const CONFLICT_TOL_FACTOR = 0.55;

export interface PriorityArm { dx: number; dz: number; type: RoadType }

export const TURN_CODE: Record<TurnKind, number> = { straight: 0, right: 1, left: 2, uturn: 3 };

export interface PriorityTable {
  nodeId: number;
  /** Connector count; movement index = index into the layout's connectors. */
  k: number;
  /** +1 right-hand traffic, -1 left-hand, from the inbound lane side. */
  hand: 1 | -1;
  /** Turn kind that crosses oncoming traffic ("left" under right-hand traffic). */
  farTurn: TurnKind;
  /** Side whose traffic has priority among equals ("right" under right-hand traffic). */
  prioritySide: TurnKind;
  inArm: Int16Array;
  outArm: Int16Array;
  inLane: Int16Array;
  outLane: Int16Array;
  turn: Uint8Array;
  /** Per arm: road class × 10 + asphalt half width. */
  rank: Float64Array;
  /** conflict[i·k + j] = 1 when movements i and j may not share the box. */
  conflict: Uint8Array;
  /** yields[i·k + j] = 1 when i must give way to j (only set for conflicting pairs). */
  yields: Uint8Array;
}

function segDist2(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return x * x + z * z;
}
function orient(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

/** Minimum distance between two polylines, 0 when they cross. */
export function polylineDistance(a: readonly Pt[], b: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < a.length; i++) {
    const p = a[i], q = a[i + 1];
    for (let j = 0; j + 1 < b.length; j++) {
      const r = b[j], s = b[j + 1];
      const o1 = orient(p.x, p.z, q.x, q.z, r.x, r.z), o2 = orient(p.x, p.z, q.x, q.z, s.x, s.z);
      const o3 = orient(r.x, r.z, s.x, s.z, p.x, p.z), o4 = orient(r.x, r.z, s.x, s.z, q.x, q.z);
      if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return 0;
      const d = Math.min(
        segDist2(p.x, p.z, q.x, q.z, r.x, r.z), segDist2(p.x, p.z, q.x, q.z, s.x, s.z),
        segDist2(r.x, r.z, s.x, s.z, p.x, p.z), segDist2(r.x, r.z, s.x, s.z, q.x, q.z),
      );
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

/**
 * +1 when inbound lanes sit right of travel (right-hand traffic), -1 when
 * they sit left.  Right of travel (tx, tz) is (-tz, tx) in this x-right,
 * z-down frame, matching `classifyTurn` (north→east is "right").
 */
export function trafficHand(centre: Pt, arms: readonly PriorityArm[], connectors: readonly LaneConnector[]): 1 | -1 {
  let sum = 0;
  for (const c of connectors) {
    const a = arms[c.inArm];
    const tx = -a.dx, tz = -a.dz;
    const p = c.points[0];
    sum += (p.x - centre.x) * -tz + (p.z - centre.z) * tx > 0 ? 1 : -1;
  }
  return sum >= 0 ? 1 : -1;
}

export function armRank(type: RoadType): number {
  return baseRoadType(type) * 10 + profileOf(type).asphaltHalf;
}

/** Static yield relation for two conflicting movements (see rule 2). */
function yieldsTo(t: PriorityTable, arms: readonly PriorityArm[], i: number, j: number): boolean {
  const ai = t.inArm[i], aj = t.inArm[j];
  const ri = t.rank[ai], rj = t.rank[aj];
  if (ri < rj - 1e-9) return true;
  if (ri > rj + 1e-9) return false;
  if (ai === aj) return false;
  const far = TURN_CODE[t.farTurn];
  // Where the other movement comes from, seen from each driver.
  const jFromI = classifyTurn(-arms[ai].dx, -arms[ai].dz, arms[aj].dx, arms[aj].dz);
  const iFromJ = classifyTurn(-arms[aj].dx, -arms[aj].dz, arms[ai].dx, arms[ai].dz);
  const iFar = t.turn[i] === far, jFar = t.turn[j] === far;
  if (iFar && !jFar && jFromI === "straight") return true;
  if (jFar && !iFar && iFromJ === "straight") return false;
  return jFromI === t.prioritySide && iFromJ !== t.prioritySide;
}

/** Conflict and yield tables for one junction.  O(k² × samples²), run once per layout. */
export function buildPriorityTable(nodeId: number, centre: Pt, arms: readonly PriorityArm[], connectors: readonly LaneConnector[]): PriorityTable {
  const k = connectors.length;
  const hand = trafficHand(centre, arms, connectors);
  const t: PriorityTable = {
    nodeId, k, hand,
    farTurn: hand === 1 ? "left" : "right",
    prioritySide: hand === 1 ? "right" : "left",
    inArm: new Int16Array(k), outArm: new Int16Array(k), inLane: new Int16Array(k), outLane: new Int16Array(k),
    turn: new Uint8Array(k), rank: new Float64Array(arms.length),
    conflict: new Uint8Array(k * k), yields: new Uint8Array(k * k),
  };
  for (let a = 0; a < arms.length; a++) t.rank[a] = armRank(arms[a].type);
  connectors.forEach((c, i) => {
    t.inArm[i] = c.inArm; t.outArm[i] = c.outArm; t.inLane[i] = c.inLane; t.outLane[i] = c.outLane;
    t.turn[i] = TURN_CODE[c.turn];
  });
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const a = connectors[i], b = connectors[j];
      let hit: boolean;
      if (a.inArm === b.inArm && a.inLane === b.inLane) hit = false;
      else if (a.outArm === b.outArm && a.outLane === b.outLane) hit = true;
      else {
        const lw = Math.min(
          profileOf(arms[a.inArm].type).laneWidth, profileOf(arms[a.outArm].type).laneWidth,
          profileOf(arms[b.inArm].type).laneWidth, profileOf(arms[b.outArm].type).laneWidth,
        );
        hit = polylineDistance(a.points, b.points) < CONFLICT_TOL_FACTOR * lw;
      }
      if (hit) { t.conflict[i * k + j] = 1; t.conflict[j * k + i] = 1; }
    }
  }
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    if (i !== j && t.conflict[i * k + j] && yieldsTo(t, arms, i, j)) t.yields[i * k + j] = 1;
  }
  // A pair may not yield both ways; drop both and let the tie-break decide.
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
    if (t.yields[i * k + j] && t.yields[j * k + i]) { t.yields[i * k + j] = 0; t.yields[j * k + i] = 0; }
  }
  return t;
}

const tableCache = new WeakMap<JunctionLayout, PriorityTable>();
/** Cached per layout object; `junctionsOf` replaces a layout when its node changes. */
export function priorityTableOf(l: JunctionLayout): PriorityTable {
  let t = tableCache.get(l);
  if (!t) { t = buildPriorityTable(l.nodeId, l.centre, l.arms, l.connectors); tableCache.set(l, t); }
  return t;
}

// ------------------------------------------------------------------ claims

/** Transient per-node claims.  Fixed-capacity typed arrays; grows rarely, never per vehicle. */
export interface ClaimSet {
  table: PriorityTable;
  layout: JunctionLayout | null;
  n: number;
  veh: Int32Array;
  /** Vehicle index in TrafficState.vehicles for the current substep. */
  vidx: Int32Array;
  conn: Int32Array;
  arrive: Float64Array;
  enterAt: Float64Array;
  /** Front bumper to connector start, tiles (negative once inside). */
  dist: Float64Array;
  /** 0 waiting, 1 committed (inside, or granted past the comfortable stop). */
  state: Uint8Array;
  go: Uint8Array;
  /** Exit lane has no room: wait without holding up cross traffic. */
  blocked: Uint8Array;
  seen: Uint32Array;
  order: Int32Array;
  picked: Uint8Array;
  taking: Uint8Array;
}

export function newClaimSet(table: PriorityTable, layout: JunctionLayout | null, cap = 16): ClaimSet {
  return {
    table, layout, n: 0,
    veh: new Int32Array(cap), vidx: new Int32Array(cap), conn: new Int32Array(cap),
    arrive: new Float64Array(cap), enterAt: new Float64Array(cap), dist: new Float64Array(cap),
    state: new Uint8Array(cap), go: new Uint8Array(cap), blocked: new Uint8Array(cap), seen: new Uint32Array(cap),
    order: new Int32Array(cap), picked: new Uint8Array(cap), taking: new Uint8Array(cap),
  };
}

function grow(cs: ClaimSet): void {
  const cap = cs.veh.length * 2;
  const g = <T extends Int32Array | Float64Array | Uint8Array | Uint32Array>(a: T): T => {
    const b = new (a.constructor as new (n: number) => T)(cap); b.set(a); return b;
  };
  cs.veh = g(cs.veh); cs.vidx = g(cs.vidx); cs.conn = g(cs.conn); cs.arrive = g(cs.arrive);
  cs.enterAt = g(cs.enterAt); cs.dist = g(cs.dist); cs.state = g(cs.state); cs.go = g(cs.go);
  cs.blocked = g(cs.blocked); cs.seen = g(cs.seen); cs.order = g(cs.order); cs.picked = g(cs.picked); cs.taking = g(cs.taking);
}

/** Find or create the claim of `vehId`; a new or re-routed claim starts waiting at `time`. */
export function upsertClaim(cs: ClaimSet, vehId: number, conn: number, time: number, stamp: number): number {
  for (let s = 0; s < cs.n; s++) {
    if (cs.veh[s] !== vehId) continue;
    if (cs.conn[s] !== conn) { cs.conn[s] = conn; cs.state[s] = 0; cs.go[s] = 0; cs.arrive[s] = time; }
    cs.seen[s] = stamp;
    return s;
  }
  if (cs.n === cs.veh.length) grow(cs);
  const s = cs.n++;
  cs.veh[s] = vehId; cs.conn[s] = conn; cs.arrive[s] = time; cs.enterAt[s] = time;
  cs.dist[s] = 0; cs.state[s] = 0; cs.go[s] = 0; cs.blocked[s] = 0; cs.seen[s] = stamp; cs.vidx[s] = -1;
  return s;
}

export function removeClaim(cs: ClaimSet, s: number): void {
  const last = --cs.n;
  if (s === last) return;
  cs.veh[s] = cs.veh[last]; cs.vidx[s] = cs.vidx[last]; cs.conn[s] = cs.conn[last];
  cs.arrive[s] = cs.arrive[last]; cs.enterAt[s] = cs.enterAt[last]; cs.dist[s] = cs.dist[last];
  cs.state[s] = cs.state[last]; cs.go[s] = cs.go[last]; cs.blocked[s] = cs.blocked[last]; cs.seen[s] = cs.seen[last];
}

/** Drop claims not refreshed in this substep (vehicle gone, rerouted or past the exit). */
export function sweepClaims(cs: ClaimSet, stamp: number): void {
  for (let s = cs.n - 1; s >= 0; s--) if (cs.seen[s] !== stamp) removeClaim(cs, s);
}

/** Strict FIFO total order: arrival time, then inbound arm index, then vehicle id. */
function before(cs: ClaimSet, a: number, b: number): boolean {
  if (cs.arrive[a] !== cs.arrive[b]) return cs.arrive[a] < cs.arrive[b];
  const ia = cs.table.inArm[cs.conn[a]], ib = cs.table.inArm[cs.conn[b]];
  if (ia !== ib) return ia < ib;
  return cs.veh[a] < cs.veh[b];
}

/** Grant claims for one substep (see rule 3 in the module comment).  Allocation-free. */
export function resolveClaims(cs: ClaimSet): void {
  const { table, n, order, picked, taking, state, conn } = cs;
  const k = table.k;
  let m = 0;
  // Committed claims first, by entry time then id: they never stop.
  for (let s = 0; s < n; s++) {
    picked[s] = 0;
    if (state[s] !== 1) continue;
    let p = m++;
    while (p > 0) {
      const o = order[p - 1];
      if (cs.enterAt[o] < cs.enterAt[s] || (cs.enterAt[o] === cs.enterAt[s] && cs.veh[o] < cs.veh[s])) break;
      order[p] = o; p--;
    }
    order[p] = s; picked[s] = 1;
  }
  // Waiting claims: topological order over "must yield to", FIFO among free ones.
  for (;;) {
    let best = -1, bestFree = false;
    for (let s = 0; s < n; s++) {
      if (picked[s]) continue;
      let free = true;
      const row = conn[s] * k;
      for (let u = 0; u < n && free; u++) {
        if (u === s || picked[u]) continue;
        if (table.yields[row + conn[u]]) free = false;
      }
      if (best < 0 || (free && !bestFree) || (free === bestFree && before(cs, s, best))) { best = s; bestFree = free; }
    }
    if (best < 0) break;
    order[m++] = best; picked[best] = 1;
  }
  for (let i = 0; i < m; i++) {
    const s = order[i];
    if (state[s] === 1) { cs.go[s] = 1; taking[s] = 1; continue; }
    let ok = !cs.blocked[s];
    if (ok) {
      const row = conn[s] * k;
      for (let j = 0; j < i; j++) {
        const o = order[j];
        if (taking[o] && table.conflict[row + conn[o]]) { ok = false; break; }
      }
    }
    cs.go[s] = ok ? 1 : 0;
    taking[s] = ok || !cs.blocked[s] ? 1 : 0;
  }
}
