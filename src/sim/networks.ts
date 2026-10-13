import { COVER, FAC, FACILITY_INFO, FacilityKind, RoadLayer, World, idx, inBounds, layerClass } from "./world";
import { findFrontage } from "./blocks";

/** Bits in World.nets: which utility floods reached each road tile. */
export const NET = { WATER: 1, SEWAGE: 2, POWER: 4 } as const;

/**
 * A building's frontage road tile must be within this many network hops of a
 * live pipe. Live tiles are exactly the flooded ones, so in practice this
 * means the frontage itself is flooded; the ring is kept literal for
 * frontier-limited powering.
 */
export const NETWORK_REACH = 3;
/** A facility joins the road network through its nearest road tile within this Chebyshev distance. */
export const FACILITY_LINK_RADIUS = 5;

export type NetKind = "power" | "water" | "sewage";

interface NetDef {
  kind: NetKind;
  coverBit: number;
  netBit: number;
  /** Facilities feeding this net; zero-capacity ones (substation) only add entries. */
  sources: FacilityKind[];
}

/**
 * Built per call, not at module load: this module cycles back into world.ts,
 * whose COVER/FAC bindings are still initialising when we first evaluate.
 */
function netDefs(): NetDef[] {
  return [
    { kind: "power", coverBit: COVER.POWER, netBit: NET.POWER, sources: [FAC.POWER, FAC.SUBSTATION] },
    { kind: "water", coverBit: COVER.WATER, netBit: NET.WATER, sources: [FAC.WATER] },
    { kind: "sewage", coverBit: COVER.SEWAGE, netBit: NET.SEWAGE, sources: [FAC.SEWAGE] },
  ];
}

/**
 * Demand units of one building. Mirrors USAGE in sim.ts, kept local because
 * sim.ts cannot be imported here (world -> networks -> sim would cycle back
 * into world at module-evaluation time). networks.test.ts asserts parity.
 */
const DEMAND = {
  res: [0, 2, 5, 10],
  com: [0, 2, 5, 10],
  ind: [0, 4, 9, 16],
} as const;

export function demandOf(zone: number, level: number): number {
  const table = zone === 3 ? DEMAND.ind : zone === 2 ? DEMAND.com : DEMAND.res;
  return table[Math.max(0, Math.min(3, level))];
}

/** Nearest road tile to (fx, fy) within FACILITY_LINK_RADIUS, or -1. Ties go to the lowest index. */
export function nearestRoadTile(w: World, fx: number, fy: number): number {
  const r = FACILITY_LINK_RADIUS;
  let best = -1, bd = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = fx + dx, ny = fy + dy;
      if (!inBounds(w, nx, ny)) continue;
      const t = idx(w, nx, ny);
      if (!w.roadSurface[t]) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      if (d < bd || (d === bd && t < best)) { bd = d; best = t; }
    }
  }
  return best;
}

export interface FacilityLink {
  facility: number;
  entry: number;
  net: NetKind;
}

/** Every utility facility standing close enough to a road, with its network entry tile. */
export function facilityLinks(w: World): FacilityLink[] {
  const out: FacilityLink[] = [];
  const defs = netDefs();
  for (let y = 0; y < w.size; y++) {
    for (let x = 0; x < w.size; x++) {
      const i = idx(w, x, y);
      const f = w.facility[i] as FacilityKind;
      if (!f) continue;
      for (const def of defs) {
        if (!def.sources.includes(f)) continue;
        const entry = nearestRoadTile(w, x, y);
        if (entry >= 0) out.push({ facility: i, entry, net: def.kind });
      }
    }
  }
  return out;
}

/**
 * Multi-source BFS over the road network (4-neighbourhood), layer aware like traffic: ground, bridge deck and tunnel
 * are separate layers that meet only on `roadLink` ramp tiles, so power, water and sewage run over a bridge or through
 * a tunnel to the ground road on the far side without leaking onto the road crossed underneath. The result is the
 * distance on the GROUND layer per tile (-1 = not reached): buildings are served from ground frontage tiles only.
 */
export function floodRoads(w: World, entries: readonly number[]): Int32Array {
  const n = w.size * w.size;
  const state = new Int32Array(n * 3).fill(-1);          // distance per (tile, layer)
  const queue: number[] = [];
  const push = (tile: number, layer: RoadLayer, d: number): void => {
    const k = tile * 3 + layer;
    if (state[k] >= 0 || !layerClass(w, tile, layer)) return;
    state[k] = d;
    queue.push(k);
  };
  for (const e of entries) if (w.roadSurface[e]) push(e, 0, 0);
  let head = 0;
  while (head < queue.length) {
    const k = queue[head++];
    const tile = (k / 3) | 0, layer = (k % 3) as RoadLayer;
    const d = state[k];
    const x = tile % w.size, y = (tile / w.size) | 0;
    if (w.roadLink[tile]) {
      for (const l of [0, 1, 2] as RoadLayer[]) if (l !== layer) push(tile, l, d);
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(w, nx, ny)) continue;
      push(idx(w, nx, ny), layer, d + 1);
    }
  }
  const dist = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) dist[t] = state[t * 3];
  return dist;
}

/** True when a live pipe is within NETWORK_REACH network hops of the frontage road tile. */
export function withinReach(w: World, dist: Int32Array, front: number): boolean {
  if (front < 0 || !w.roadSurface[front]) return false;
  if (dist[front] >= 0) return true;
  let frontier = [front];
  const seen = new Set([front]);
  for (let d = 0; d < NETWORK_REACH; d++) {
    const next: number[] = [];
    for (const t of frontier) {
      const x = t % w.size, y = (t / w.size) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(w, nx, ny)) continue;
        const n = idx(w, nx, ny);
        if (!w.roadSurface[n] || seen.has(n)) continue;
        if (dist[n] >= 0) return true;
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return false;
}

/**
 * Replace radius coverage for POWER, WATER and SEWAGE with road-network
 * floods: each connected facility seeds its entries, the flood runs over
 * road tiles (marked in World.nets, so the underground view knows where the
 * pipes are), and buildings whose frontage is within reach are served
 * nearest-first while the connected supply lasts. Empty zoned tiles reserve
 * level-1 demand so growth and capacity see the same picture.
 */
export function updateNetworkCoverage(w: World): void {
  // Fast path: no networked facilities, nothing to flood.
  let any = false;
  for (let i = 0; i < w.facility.length; i++) {
    const f = w.facility[i];
    if (f === FAC.POWER || f === FAC.WATER || f === FAC.SEWAGE || f === FAC.SUBSTATION) {
      any = true;
      break;
    }
  }
  if (!any) return;
  const frontage = findFrontage(w);
  const links = facilityLinks(w);
  for (const def of netDefs()) {
    const mine = links.filter((l) => l.net === def.kind);
    let supply = 0;
    for (const l of mine) supply += FACILITY_INFO[w.facility[l.facility] as FacilityKind].capacity;
    if (supply <= 0 || mine.length === 0) continue;
    const entries = [...new Set(mine.map((l) => l.entry))];
    const dist = floodRoads(w, entries);
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] >= 0) {
        w.nets[i] |= def.netBit;
        w.cover[i] |= def.coverBit;
      }
    }
    const cand: number[] = [];
    for (let i = 0; i < w.zone.length; i++) {
      if (w.zone[i] && withinReach(w, dist, frontage.road[i])) cand.push(i);
    }
    cand.sort((a, b) => {
      const da = dist[frontage.road[a]], db = dist[frontage.road[b]];
      return (da < 0 ? Infinity : da) - (db < 0 ? Infinity : db) || a - b;
    });
    let used = 0;
    for (const t of cand) {
      const d = demandOf(w.zone[t], Math.max(1, w.level[t]));
      if (used + d <= supply) {
        used += d;
        w.cover[t] |= def.coverBit;
      }
    }
    for (const l of mine) w.cover[l.facility] |= def.coverBit;
  }
}
