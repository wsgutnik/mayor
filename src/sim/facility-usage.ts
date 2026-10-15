/**
 * Numbers of use for every service building (docs/process/24-service-usage.md).
 *
 * One pure function feeds both the build tooltip (no placement: estimates at full capacity/coverage from
 * FACILITY_INFO and the demand constants) and the inspector (a placed facility: live load, buildings and
 * residents it serves). Nothing here mutates the city.
 */
import { CAPACITY, CityState, UtilityKey } from "./sim";
import { demandOf, facilityLinks, FACILITY_LINK_RADIUS } from "./networks";
import { DAILY_CAPACITY } from "./transit";
import {
  FAC, FACILITY_INFO, FacilityKind, World, ZONE, facilityAnchorAt, facilityFootprint, facilityUtility, idx, inBounds,
} from "./world";

/**
 * How a facility works, which decides the numbers it can report:
 * - network: supplies power/water/sewage units into the road network (pooled city-wide).
 * - relay: extends a network without supply (substation).
 * - garbage: capacity-limited and radius-limited (landfill).
 * - coverage: civic radius service without a capacity limit.
 * - transit: radius catchment plus a stop that lines call at.
 * - citywide: effect on the whole city (city hall).
 */
export type UsageMode = "network" | "relay" | "garbage" | "coverage" | "transit" | "citywide";

/**
 * Share of the tiles inside a coverage radius that end up as buildings in a typical grid (roads, junction
 * corners and facilities take the rest). A documented planning constant for the "full coverage" estimate only.
 */
export const BUILDABLE_SHARE = 0.5;

export interface UsageEstimate {
  /** Tiles a radius service reaches (0 for networked and city-wide kinds). */
  tiles: number;
  /** Low-density (level 1) homes it can serve at full capacity or full coverage. */
  homes: number;
  /** Residents of those homes. */
  residents: number;
}

export interface UsageLive {
  /** Networked kinds: the facility reaches a road and feeds its network. Others: true. */
  linked: boolean;
  /** Units this facility carries now (its share of the pooled network demand); 0 for coverage kinds. */
  load: number;
  /** Load as a 0..1 share of capacity (0 when capacity is 0). */
  loadShare: number;
  /** City-wide supply and demand of its utility (zeros for coverage kinds). */
  netSupply: number;
  netDemand: number;
  /** Built lots it serves (networked: its capacity share of the lots the network serves). */
  buildings: number;
  /** Residents living in them. */
  residents: number;
  /** Jobs in them. */
  jobs: number;
  /** Transit only: the station stop, lines calling at it, their fleet, seats per day and riders per day. */
  stops?: number;
  lines?: number;
  vehicles?: number;
  dailyCapacity?: number;
  riders?: number;
}

export interface FacilityUsage {
  kind: FacilityKind;
  mode: UsageMode;
  utility: UtilityKey | null;
  footprint: 1 | 2;
  cost: number;
  upkeep: number;
  /** Radius in tiles; 0 for networked utilities (they follow the roads) and the city hall. */
  radius: number;
  /** Units supplied; 0 for kinds without a capacity limit. */
  capacity: number;
  estimate: UsageEstimate;
  /** Present when the usage was computed for a placed facility. */
  live?: UsageLive;
}

/**
 * Tiles inside a radius disc, counted exactly as updateCoverage stamps them. A 2x2 centre sits on a tile
 * corner, which offsets the disc by half a tile but keeps the same count.
 */
export function radiusTiles(radius: number): number {
  if (radius <= 0) return 0;
  let n = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius) n++;
  return n;
}

function modeOf(kind: FacilityKind): UsageMode {
  const info = FACILITY_INFO[kind];
  const u = facilityUtility(kind);
  if (u === "garbage") return "garbage";
  if (u) return info.capacity > 0 ? "network" : "relay";
  if (kind === FAC.METRO || kind === FAC.TRAIN_STATION) return "transit";
  if (info.radius <= 0) return "citywide";
  return "coverage";
}

function estimateOf(kind: FacilityKind, mode: UsageMode): UsageEstimate {
  const info = FACILITY_INFO[kind];
  const perHome = demandOf(ZONE.RES, 1);
  const residentsPerHome = CAPACITY.res[1];
  const byCapacity = Math.floor(info.capacity / perHome);
  if (mode === "network") return { tiles: 0, homes: byCapacity, residents: byCapacity * residentsPerHome };
  if (mode === "relay" || mode === "citywide") return { tiles: 0, homes: 0, residents: 0 };
  const tiles = radiusTiles(info.radius);
  const byRadius = Math.round(tiles * BUILDABLE_SHARE);
  const homes = mode === "garbage" ? Math.min(byRadius, byCapacity) : byRadius;
  return { tiles, homes, residents: homes * residentsPerHome };
}

/** Tile index of the facility's anchor (the tile its usage is attributed to). */
function anchorTile(w: World, tile: number): number {
  const a = facilityAnchorAt(w, tile);
  return a ? idx(w, a.x, a.y) : tile;
}

interface Tally { buildings: number; residents: number; jobs: number }

/** Count built lots, residents and jobs over a set of tiles (lots counted once, whatever their size). */
function tally(s: CityState, tiles: Iterable<number>): Tally {
  const w = s.world;
  const occupancy = s.capacity.res > 0 ? Math.min(1, s.population / s.capacity.res) : 0;
  const lots = new Set<number>();
  let residents = 0, jobs = 0;
  for (const t of tiles) {
    const lvl = w.level[t];
    const z = w.zone[t];
    if (!lvl || !z) continue;
    lots.add(w.lotAt[t] >= 0 ? w.lotAt[t] : -1 - t);
    if (z === ZONE.RES) residents += CAPACITY.res[lvl] * occupancy;
    else jobs += (z === ZONE.COM ? CAPACITY.com : CAPACITY.ind)[lvl];
  }
  return { buildings: lots.size, residents: Math.round(residents), jobs: Math.round(jobs) };
}

/** Tiles a radius facility covers, mirroring updateCoverage's disc around the anchor centre. */
function discTiles(w: World, kind: FacilityKind, tile: number): number[] {
  const r = FACILITY_INFO[kind].radius;
  const a = facilityAnchorAt(w, tile);
  const x = tile % w.size, y = (tile / w.size) | 0;
  const cx = a ? a.x + a.w / 2 : x, cy = a ? a.y + a.h / 2 : y;
  const out = new Set<number>();
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const nx = Math.floor(cx + dx), ny = Math.floor(cy + dy);
      if (inBounds(w, nx, ny)) out.add(idx(w, nx, ny));
    }
  }
  return [...out];
}

function liveOf(kind: FacilityKind, mode: UsageMode, s: CityState, tile: number): UsageLive {
  const w = s.world;
  const info = FACILITY_INFO[kind];
  const at = anchorTile(w, tile);
  const u = facilityUtility(kind);
  const net = u ? s.utilities[u] : { supply: 0, demand: 0 };
  const zero = { linked: true, load: 0, loadShare: 0, netSupply: net.supply, netDemand: net.demand, buildings: 0, residents: 0, jobs: 0 };

  if (mode === "network" || mode === "relay") {
    const bit = info.bit;
    const linked = facilityLinks(w).some((l) => l.facility === at);
    // Lots the whole network serves; this facility carries its capacity share of them.
    const served: number[] = [];
    for (let i = 0; i < w.zone.length; i++) if (w.level[i] && w.zone[i] && (w.cover[i] & bit)) served.push(i);
    const all = tally(s, served);
    if (mode === "relay") return { ...zero, linked, ...all };
    const share = linked && net.supply > 0 ? info.capacity / net.supply : 0;
    const load = Math.min(info.capacity, net.demand * share);
    return {
      ...zero, linked, load: Math.round(load), loadShare: info.capacity ? load / info.capacity : 0,
      buildings: Math.round(all.buildings * share), residents: Math.round(all.residents * share), jobs: Math.round(all.jobs * share),
    };
  }

  if (mode === "citywide") {
    const every: number[] = [];
    for (let i = 0; i < w.zone.length; i++) if (w.level[i]) every.push(i);
    return { ...zero, ...tally(s, every) };
  }

  const disc = discTiles(w, kind, tile);
  const t = tally(s, disc);
  if (mode === "garbage") {
    // Landfills pool their capacity like the networks; the radius still limits who they reach.
    const share = net.supply > 0 ? info.capacity / net.supply : 0;
    const load = Math.min(info.capacity, net.demand * share);
    return { ...zero, ...t, load: Math.round(load), loadShare: info.capacity ? load / info.capacity : 0 };
  }
  if (mode === "transit") {
    const a = facilityAnchorAt(w, tile);
    const inFootprint = (st: number) => {
      if (!a) return st === tile;
      const sx = st % w.size, sy = (st / w.size) | 0;
      return sx >= a.x && sx < a.x + a.w && sy >= a.y && sy < a.y + a.h;
    };
    const kindName = kind === FAC.METRO ? "metro" : "train";
    const stops = w.stops.filter((st) => st.kind === kindName && inFootprint(st.tile));
    const ids = new Set(stops.map((st) => st.id));
    const lines = w.lines.filter((l) => l.stops.some((id) => ids.has(id)));
    const vehicles = lines.reduce((n, l) => n + l.vehicles, 0);
    const dailyCapacity = lines.reduce((n, l) => n + l.vehicles * DAILY_CAPACITY[l.kind], 0);
    // Riders are tracked city-wide; attribute them by this station's share of the fleet.
    const fleet = w.lines.reduce((n, l) => n + l.vehicles, 0);
    const riders = fleet > 0 ? Math.round(s.transit.riders * vehicles / fleet) : 0;
    return { ...zero, ...t, stops: stops.length, lines: lines.length, vehicles, dailyCapacity, riders };
  }
  return { ...zero, ...t };
}

/**
 * Usage numbers of one facility kind. Without `at` it is the pre-placement estimate (build tooltip); with
 * `at` (a placed facility's tile, any tile of its footprint) it adds the live numbers (inspector).
 */
export function facilityUsage(kind: FacilityKind, at?: { state: CityState; tile: number }): FacilityUsage {
  const info = FACILITY_INFO[kind];
  const mode = modeOf(kind);
  const utility = facilityUtility(kind);
  const usage: FacilityUsage = {
    kind, mode, utility,
    footprint: facilityFootprint(kind),
    cost: info.cost,
    upkeep: info.upkeep,
    radius: mode === "network" || mode === "relay" || mode === "citywide" ? 0 : info.radius,
    capacity: info.capacity,
    estimate: estimateOf(kind, mode),
  };
  if (at) usage.live = liveOf(kind, mode, at.state, at.tile);
  return usage;
}

/** Road reach of a networked facility (it links through its nearest road within this many tiles). */
export const NETWORK_LINK_REACH = FACILITY_LINK_RADIUS;
