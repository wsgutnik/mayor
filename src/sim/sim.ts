import { makeRng } from "./rng";
import { isRaining } from "./weather";
import { placeBusStop, registerMetroStation, removeStopAt, transitUpkeep, updateTransit } from "./transit";
import {
  ZONE, FAC, COVER, FACILITY_INFO, FacilityKind, World, Biome, WorldLot, ZoneType, generateWorld, idx, inBounds,
  isLand, nearWater, updateConnectivity, updateCoverage, updateLandValue, flattenTile, isEntryTile, blocksBuilding,
  ROAD_COST, ROAD_UPKEEP, ROAD_NAME, RoadType, Pt, isOneWayType, rasterizeRoad, rebuildRoadRaster, segmentLength, levelTiles,
  Elevation,
} from "./world";
import { BRIDGE_COST_MULT, TUNNEL_COST_MULT, detectSpan, splitPtsAt } from "./elevation";
import { Crossing, ELEVATED_JOIN_REASON, INTERCHANGE_REASON, classifyCrossings } from "./crossings";
import { addSegment, rebuildNodes, removeSegment, stampRoundabout, toggleOneWayAt } from "./roads";
import {
  BlockInfo, getBlocks, getFrontage, lotsReadyToBuild, planLots,
} from "./blocks";
export { ZONE_DEPTH } from "./blocks";

export type FacilityTool =
  | "power" | "water" | "sewage" | "landfill"
  | "police" | "fire" | "clinic" | "school" | "park" | "metro"
  | "hospital" | "highschool" | "library" | "community" | "museum" | "cityhall" | "substation";
export type ToolId = "pan" | "road" | "res" | "com" | "ind" | "bulldoze" | "busstop" | "busline" | "metroline" | "roundabout" | FacilityTool;

const FACILITY_OF_TOOL: Record<FacilityTool, FacilityKind> = {
  power: FAC.POWER, water: FAC.WATER, sewage: FAC.SEWAGE, landfill: FAC.LANDFILL,
  police: FAC.POLICE, fire: FAC.FIRE, clinic: FAC.CLINIC, school: FAC.SCHOOL, park: FAC.PARK, metro: FAC.METRO,
  hospital: FAC.HOSPITAL, highschool: FAC.HIGHSCHOOL, library: FAC.LIBRARY, community: FAC.COMMUNITY,
  museum: FAC.MUSEUM, cityhall: FAC.CITYHALL, substation: FAC.SUBSTATION,
};
export const isFacilityTool = (t: ToolId): t is FacilityTool => t in FACILITY_OF_TOOL;

export const COST: Record<Exclude<ToolId, "pan">, number> = {
  road: 20, res: 4, com: 4, ind: 4, bulldoze: 5,
  power: FACILITY_INFO[FAC.POWER].cost,
  water: FACILITY_INFO[FAC.WATER].cost,
  sewage: FACILITY_INFO[FAC.SEWAGE].cost,
  landfill: FACILITY_INFO[FAC.LANDFILL].cost,
  police: FACILITY_INFO[FAC.POLICE].cost,
  fire: FACILITY_INFO[FAC.FIRE].cost,
  clinic: FACILITY_INFO[FAC.CLINIC].cost,
  school: FACILITY_INFO[FAC.SCHOOL].cost,
  park: FACILITY_INFO[FAC.PARK].cost,
  metro: FACILITY_INFO[FAC.METRO].cost,
  hospital: FACILITY_INFO[FAC.HOSPITAL].cost,
  highschool: FACILITY_INFO[FAC.HIGHSCHOOL].cost,
  library: FACILITY_INFO[FAC.LIBRARY].cost,
  community: FACILITY_INFO[FAC.COMMUNITY].cost,
  museum: FACILITY_INFO[FAC.MUSEUM].cost,
  cityhall: FACILITY_INFO[FAC.CITYHALL].cost,
  substation: FACILITY_INFO[FAC.SUBSTATION].cost,
  busstop: 100,
  busline: 0,
  metroline: 0,
  roundabout: 150,
};

/** Residents, commercial jobs, industrial jobs per building level (index = level). */
export const CAPACITY = {
  res: [0, 8, 20, 40],
  com: [0, 4, 10, 20],
  ind: [0, 6, 14, 28],
} as const;

/** Utility units a building consumes per level (power, water, sewage, garbage all use this). */
export const USAGE = {
  res: [0, 2, 5, 10],
  com: [0, 2, 5, 10],
  ind: [0, 4, 9, 16],
} as const;

export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
/** Longest single road segment, in tiles, so a mis-tap cannot drain the treasury. */
const MAX_SEGMENT_TILES = 60;
/** Minimum zone demand for a building to level up. A balanced city settles near 0.2-0.3. */
const UPGRADE_DEMAND = 0.2;
/** Daily chance that a building outside fire-station cover burns down. */
const FIRE_CHANCE = 0.0002;

export interface Demand { r: number; c: number; i: number }
export interface MonthReport { income: number; expenses: number }
export interface UtilityStat { supply: number; demand: number }
export type UtilityKey = "power" | "water" | "sewage" | "garbage";
export type CivicKey = "police" | "fire" | "health" | "edu" | "park" | "transit" | "culture";

const CIVIC_BIT: Record<CivicKey, number> = {
  police: COVER.POLICE, fire: COVER.FIRE, health: COVER.HEALTH, edu: COVER.EDU, park: COVER.PARK, transit: COVER.TRANSIT, culture: COVER.CULTURE,
};
export const CIVIC_KEYS = Object.keys(CIVIC_BIT) as CivicKey[];

export interface CityState {
  world: World;
  day: number;
  money: number;
  taxRate: number;
  population: number;
  capacity: { res: number; com: number; ind: number };
  employed: number;
  unemployed: number;
  demand: Demand;
  utilities: Record<UtilityKey, UtilityStat>;
  /** 0..100; falls with missing services and shortages, rises with parks. */
  happiness: number;
  /** Fraction (0..1) of buildings reached by each civic service. */
  coverage: Record<CivicKey, number>;
  /** Average land value (0..100) over built tiles. */
  landValue: number;
  /** Buildings lost to fire since the game began. */
  fires: number;
  /** World revision the land values were last computed for (not saved). */
  lvSeenRevision: number;
  /** Rain slows road traffic; derived from the day and seed. */
  raining: boolean;
  /** Daily passengers, fare income and share of commuters on transit. */
  transit: { riders: number; income: number; share: number };
  /** Share of vehicles crawling (0..1), smoothed; written by tickTraffic. */
  congestion: number;
  /** Vehicles currently driving; written by tickTraffic. */
  vehicles: number;
  lastMonth: MonthReport;
  monthIncome: number;
  monthExpenses: number;
  rngState: number;
}

const emptyUtilities = (): Record<UtilityKey, UtilityStat> => ({
  power: { supply: 0, demand: 0 },
  water: { supply: 0, demand: 0 },
  sewage: { supply: 0, demand: 0 },
  garbage: { supply: 0, demand: 0 },
});

export function newCity(seed = 1337, size = 96, biome: Biome = "plains"): CityState {
  return {
    world: generateWorld(size, seed, biome),
    day: 0,
    money: 50000,
    taxRate: 0.1,
    population: 0,
    capacity: { res: 0, com: 0, ind: 0 },
    employed: 0,
    unemployed: 0,
    demand: { r: 0.5, c: 0.2, i: 0.2 },
    utilities: emptyUtilities(),
    happiness: 100,
    coverage: { police: 0, fire: 0, health: 0, edu: 0, park: 0, transit: 0, culture: 0 },
    landValue: 0,
    fires: 0,
    lvSeenRevision: -1,
    raining: false,
    transit: { riders: 0, income: 0, share: 0 },
    congestion: 0,
    vehicles: 0,
    lastMonth: { income: 0, expenses: 0 },
    monthIncome: 0,
    monthExpenses: 0,
    rngState: seed,
  };
}

export function dateOf(day: number) {
  const dim = DAYS_PER_MONTH;
  return {
    year: 2025 + Math.floor(day / (dim * MONTHS_PER_YEAR)),
    month: Math.floor(day / dim) % MONTHS_PER_YEAR,
    day: (day % dim) + 1,
  };
}

export type ToolResult = { ok: true } | { ok: false; reason: string };

const ZONE_OF_TOOL = { res: ZONE.RES, com: ZONE.COM, ind: ZONE.IND } as const;

export function countRoads(w: World): number {
  let n = 0;
  for (let i = 0; i < w.road.length; i++) if (w.road[i]) n++;
  return n;
}

/** Monthly upkeep for all road tiles by class, minus the free entry road. */
function roadUpkeep(w: World): number {
  let total = 0;
  for (let i = 0; i < w.road.length; i++) {
    const t = w.road[i];
    if (t) total += ROAD_UPKEEP[t as RoadType];
  }
  return Math.max(0, total - 3 * ROAD_UPKEEP[1]);
}

/** One graph piece of a planned road: ground approaches stay ground, the middle may be elevated. */
export interface RoadPiece {
  pts: Pt[];
  elevation: Elevation;
  tiles: number[];
}

export interface RoadPlan {
  ok: boolean;
  reason?: string;
  /** Tiles that would be occupied, and how many are new or upgraded. */
  tiles: number[];
  newTiles: number;
  cost: number;
  /** Set when the middle of the road crosses water/a valley (bridge) or a hill (tunnel). */
  span?: "bridge" | "tunnel";
  pieces?: RoadPiece[];
  /** Every meeting with an existing road, in order along the drawn road. */
  crossings?: Crossing[];
}

export type { Crossing, CrossingKind } from "./crossings";

/** Cost multiplier per tile for an elevated piece. */
const pieceMult = (e: Elevation): number => (e === "bridge" ? BRIDGE_COST_MULT : e === "tunnel" ? TUNNEL_COST_MULT : 1);

/** Road-tool level modifier (M24): Solo / Elevado / Subterrâneo. */
export type RoadLevel = "ground" | "elevated" | "tunnel";
export type RoadLevelInput = RoadLevel | "bridge" | "underground" | { level?: string; elevation?: string };
export function normalizeRoadLevel(input?: RoadLevelInput): RoadLevel {
  const v = typeof input === "string" ? input : input?.level ?? input?.elevation ?? "ground";
  if (v === "elevated" || v === "bridge") return "elevated";
  if (v === "tunnel" || v === "underground") return "tunnel";
  return "ground";
}
/** Ramp length at each end of an explicit overpass/underpass, in tiles. */
export const RAMP_TILES = 3;

/** Does the middle of `pts` cross a road, water or terrain that needs elevation? */
function needsElevation(w: World, pts: Pt[], kind: "bridge" | "tunnel"): boolean {
  const { tiles } = rasterizeRoad(w, 1, pts);
  // Any existing road tile under the drawn path (excluding the very ends,
  // which join the graph at grade) counts as something to cross.
  for (let i = 1; i + 1 < tiles.length; i++) {
    if (w.road[tiles[i]]) return true;
  }
  // Terrain spans (water/valley for bridges, hills for tunnels) also count.
  const found = detectSpan(w, 1, pts);
  if (found.ok && found.span && found.span.kind === kind) return true;
  if (kind === "bridge") {
    for (const t of tiles) if (!isLand(w, t % w.size, (t / w.size) | 0)) return true;
  }
  return false;
}

/** Validate a road segment and price it without changing anything. */
export function planRoad(s: CityState, type: RoadType, pts: Pt[], levelInput: RoadLevelInput = "ground"): RoadPlan {
  const level = normalizeRoadLevel(levelInput);
  const w = s.world;
  const bad = (reason: string, tiles: number[] = [], crossings?: Crossing[]): RoadPlan =>
    ({ ok: false, reason, tiles, newTiles: 0, cost: 0, ...(crossings ? { crossings } : {}) });
  if (pts.length < 2 || pts.length > 3) return bad("A road needs a start and an end");
  if (segmentLength(pts) > MAX_SEGMENT_TILES) return bad("Road is too long");
  const { tiles, outOfBounds } = rasterizeRoad(w, type, pts);
  if (outOfBounds) return bad("Outside the map", tiles);
  const crossings = classifyCrossings(w, type, pts, level);
  const blocked = crossings.find((c) => c.kind === "blocked");
  if (blocked) {
    return bad(blocked.blockedReason === "elevated-join" ? ELEVATED_JOIN_REASON : INTERCHANGE_REASON, tiles, crossings);
  }
  // Explicit Elevado/Subterrâneo: deck/tunnel over everything crossed,
  // with 3-tile ground ramps at both ends (M24). Reuses splitPtsAt/pieces.
  if (level !== "ground") {
    const kind = level === "elevated" ? "bridge" as const : "tunnel" as const;
    const len = segmentLength(pts);
    if (kind === "tunnel" && len < 4) return bad("Tunnel too short", tiles, crossings);
    if (len < 2) return bad("Nothing to cross", tiles, crossings);
    // Rule 3: every crossing sits in a ramp zone -> fall back to a ground junction.
    const terrain = detectSpan(w, type, pts);
    const terrainNeeds = (terrain.ok && terrain.span?.kind === kind)
      || (kind === "bridge" && tiles.some((t) => !isLand(w, t % w.size, (t / w.size) | 0)));
    if (!terrainNeeds && crossings.length > 0 && crossings.every((c) => c.kind === "junction")) {
      return planWithSpan(s, type, pts, tiles, null, bad, crossings);
    }
    if (!needsElevation(w, pts, kind)) return bad("Nothing to cross", tiles, crossings);
    const ramp = Math.min(RAMP_TILES, Math.floor((len - 1) / 2));
    if (ramp < 1) return bad("Nothing to cross", tiles, crossings);
    const t0 = ramp / len, t1 = 1 - ramp / len;
    const [before, middle, after] = splitPtsAt(pts, t0, t1);
    const span = { kind, t0, t1, spanTiles: rasterizeRoad(w, type, middle).tiles.length, before, middle, after };
    return planWithSpan(s, type, pts, tiles, span, bad, crossings);
  }
  // Rule 1: a ground road meeting a highway is lifted over/under it automatically.
  const auto = crossings.filter((c) => c.autoElevate);
  if (auto.length) {
    const kind = auto.every((c) => c.kind === "underpass") ? "tunnel" as const : "bridge" as const;
    const len = segmentLength(pts);
    const ramp = Math.min(RAMP_TILES, Math.floor((len - 1) / 2));
    if (ramp < 1) return bad(INTERCHANGE_REASON, tiles, crossings);
    // Anything else met inside the lifted middle is crossed at that level too.
    const lifted = crossings.map((c) => (!c.atEnd && c.kind === "junction"
      && c.distFromStart >= ramp && c.distFromEnd >= ramp)
      ? { ...c, kind: kind === "bridge" ? "overpass" as const : "underpass" as const }
      : c);
    const [before, middle, after] = splitPtsAt(pts, ramp / len, 1 - ramp / len);
    const span = { kind, before, middle, after };
    return planWithSpan(s, type, pts, tiles, span, bad, lifted);
  }
  const found = detectSpan(w, type, pts);
  if (!found.ok) return bad(found.reason, tiles, crossings);
  return planWithSpan(s, type, pts, tiles, found.span, bad, crossings);
}

function planWithSpan(
  s: CityState, type: RoadType, pts: Pt[], tiles: number[],
  span: { kind: "bridge" | "tunnel"; before: Pt[]; middle: Pt[]; after: Pt[] } | null,
  bad: (reason: string, tiles?: number[], crossings?: Crossing[]) => RoadPlan,
  crossings?: Crossing[],
): RoadPlan {
  const w = s.world;
  let pieces: RoadPiece[];
  if (!span) {
    pieces = [{ pts, elevation: "ground", tiles }];
  } else {
    // The middle piece is elevated; degenerate (zero-length) approaches are dropped.
    const parts: [Pt[], Elevation][] = [
      [span.before, "ground"], [span.middle, span.kind], [span.after, "ground"],
    ];
    pieces = [];
    for (const [part, elevation] of parts) {
      if (segmentLength(part) < 0.05) continue;
      pieces.push({ pts: part, elevation, tiles: rasterizeRoad(w, type, part).tiles });
    }
    if (!pieces.length) pieces = [{ pts, elevation: "ground", tiles }];
  }
  // A tile shared by two pieces (shore joints) is priced once, at the higher rate,
  // and counts as ground when any piece there is at grade.
  const rate = new Map<number, number>();
  const ground = new Set<number>();
  const order: number[] = [];
  for (const piece of pieces) {
    const mult = pieceMult(piece.elevation);
    for (const t of piece.tiles) {
      if (!rate.has(t)) order.push(t);
      rate.set(t, Math.max(rate.get(t) ?? 0, mult));
      if (piece.elevation === "ground") ground.add(t);
    }
  }
  // Wide roads stamp half a tile past each piece end: water the middle covers
  // is deck, even when a ground approach overshoots onto it.
  const middle = span ? pieces.find((p) => p.elevation !== "ground") : undefined;
  if (middle && span?.kind === "bridge") {
    const mset = new Set(middle.tiles);
    for (const t of [...ground]) {
      if (mset.has(t) && !isLand(w, t % w.size, (t / w.size) | 0)) ground.delete(t);
    }
  }
  let newTiles = 0, cost = 0;
  for (const t of order) {
    const x = t % w.size, y = (t / w.size) | 0;
    const elevated = !ground.has(t);
    const under = elevated && span?.kind === "tunnel";
    if (!under) {
      if (!elevated && !isLand(w, x, y)) return bad("Road would cross water", order, crossings);
      if (w.facility[t]) return bad("Road would cross a building", order, crossings);
    }
    const layerExisting = elevated
      ? (span?.kind === "tunnel" ? w.roadTunnel[t] : w.roadDeck[t])
      : w.road[t];
    if (layerExisting < type) {
      newTiles++;
      cost += rate.get(t)! * ROAD_COST[type];
    }
  }
  if (s.money < cost) return { ok: false, reason: "Not enough money", tiles: order, newTiles, cost, ...(crossings ? { crossings } : {}) };
  const builtSpan = middle ? span?.kind : undefined;
  return { ok: true, tiles: order, newTiles, cost, ...(builtSpan ? { span: builtSpan } : {}), pieces, ...(crossings ? { crossings } : {}) };
}

/** Build a road: flatten and clear the ground it covers, then charge for new tiles. */
export function placeRoad(s: CityState, type: RoadType, pts: Pt[], level: RoadLevelInput = "ground"): ToolResult {
  const plan = planRoad(s, type, pts, level);
  if (!plan.ok) return { ok: false, reason: plan.reason! };
  if (plan.newTiles === 0) {
    // Re-drawing a one-way road with the same tool flips its direction (free).
    if (isOneWayType(type) && toggleOneWayAt(s.world, pts)) {
      rebuildRoadRaster(s.world);
      s.world.revision++;
    }
    return { ok: true }; // already built at this class or better
  }
  const w = s.world;
  const pieces = plan.pieces ?? [{ pts, elevation: "ground" as Elevation, tiles: plan.tiles }];
  const groundTiles: number[] = [];
  const clearTiles: number[] = [];
  for (const piece of pieces) {
    if (piece.elevation === "ground") groundTiles.push(...piece.tiles);
    // Terrain is never levelled under a bridge or above a tunnel, and tunnel
    // ground (zones, buildings) is left untouched.
    if (piece.elevation !== "tunnel") clearTiles.push(...piece.tiles);
  }
  levelTiles(w, groundTiles);
  for (const i of clearTiles) {
    w.zone[i] = 0;
    w.level[i] = 0;
  }
  // The graph snaps the ends to nearby nodes, splits T-junction sides and
  // crossings, and upgrades roads paved over along the same path. Shared piece
  // endpoints snap to the same node, so the elevated middle joins its approaches.
  for (const piece of pieces) addSegment(w, type, piece.pts, { elevation: piece.elevation });
  rebuildRoadRaster(w);
  // Utility networks run under the roads, so new tarmac can light new buildings.
  w.coverageDirty = true;
  updateCoverage(w);
  s.money -= plan.cost;
  s.monthExpenses += plan.cost;
  dirtyRoads(w);
  w.revision++;
  return { ok: true };
}

export { ROAD_NAME };

// ------------------------------------------------------------ lots (M17)

/** Mark lots stale after a road edit (frontage and blocks both change). */
function dirtyRoads(w: World): void {
  w.roadRevision++;
  w.zoneRevision++;
  w.lotsDirty = true;
}

/** Mark lots stale after a zone or facility edit (grouping changes, frontage stands). */
function dirtyZones(w: World): void {
  w.zoneRevision++;
  w.lotsDirty = true;
}

/**
 * Rebuild persistent lots from the tile arrays: planned road-fronting lots
 * first, then 1x1 lots for every other zoned tile so no zone is ever lot-less.
 * Levels come from the tile mirror, so rebuilding never loses buildings.
 */
export function refreshLots(s: CityState): void {
  const w = s.world;
  // Tools bump the road/zone revisions on every structural edit, so the cached
  // blocks are fresh here (and zone/level pokes still land correct lots: the
  // planner reads the live tile arrays and the fallback covers every zone).
  const blocks = getBlocks(w);
  const planned = planLots(w, blocks, makeRng((s.rngState ^ 0x9e3779b9) >>> 0));
  const lots: WorldLot[] = [];
  w.lotAt.fill(-1);
  w.nextLotId = 1;
  for (const p of planned) {
    const id = w.nextLotId++;
    lots.push({
      id, x: p.x, y: p.y, w: p.w, h: p.h,
      facing: { dx: p.facing.dx, dy: p.facing.dy },
      zone: p.zone, level: w.level[idx(w, p.x, p.y)], depthFromRoad: 0,
    });
    for (let y = p.y; y < p.y + p.h; y++) {
      for (let x = p.x; x < p.x + p.w; x++) w.lotAt[idx(w, x, y)] = id;
    }
  }
  extendLots(w, blocks, lots);
  // Fallback: zoned tiles the planner left out (rear rows cut off by a
  // facility, plots past kerb depth, pre-lot saves) still get a 1x1 lot.
  for (let y = 0; y < w.size; y++) {
    for (let x = 0; x < w.size; x++) {
      const i = idx(w, x, y);
      if (!w.zone[i] || w.lotAt[i] >= 0 || blocksBuilding(w, i) || w.facility[i] || !isLand(w, x, y)) continue;
      const id = w.nextLotId++;
      const road = blocks.frontage.road[i];
      lots.push({
        id, x, y, w: 1, h: 1,
        facing: road >= 0
          ? { dx: blocks.frontage.dx[i] as -1 | 0 | 1, dy: blocks.frontage.dy[i] as -1 | 0 | 1 }
          : { dx: 0, dy: 1 },
        zone: w.zone[i] as ZoneType, level: w.level[i],
        depthFromRoad: road >= 0 ? blocks.frontage.distance[i] : -1,
      });
      w.lotAt[i] = id;
    }
  }
  w.lots = lots;
  w.lotsDirty = false;
}

/**
 * Grow planned lots backward over orphaned rear tiles. A front lot that took a
 * shallow shape would otherwise strand the depth rows behind it, and those
 * rows could never front the street. A row joins only when every tile matches
 * the lot's zone, level and block, so lots stay rectangular and face one way.
 */
function extendLots(w: World, blocks: BlockInfo, lots: WorldLot[]): void {
  for (const lot of lots) {
    const block = blocks.blockId[idx(w, lot.x, lot.y)];
    for (;;) {
      const { dx, dy } = lot.facing;
      // back-edge row, one step behind the lot (away from the street)
      const row: number[] = [];
      if (dy !== 0) {
        const y = dy > 0 ? lot.y - 1 : lot.y + lot.h;
        for (let x = lot.x; x < lot.x + lot.w; x++) row.push(y * w.size + x);
      } else {
        const x = dx > 0 ? lot.x - 1 : lot.x + lot.w;
        for (let y = lot.y; y < lot.y + lot.h; y++) row.push(y * w.size + x);
      }
      const ok = row.every((i) => {
        const x = i % w.size, y = (i / w.size) | 0;
        return (
          x >= 0 && y >= 0 && x < w.size && y < w.size && w.lotAt[i] < 0 && !blocksBuilding(w, i) && !w.facility[i] &&
          w.zone[i] === lot.zone && w.level[i] === lot.level && blocks.blockId[i] === block && isLand(w, x, y)
        );
      });
      if (!ok) break;
      for (const i of row) w.lotAt[i] = lot.id;
      if (dy !== 0) {
        if (dy > 0) lot.y -= 1;
        lot.h += 1;
      } else {
        if (dx > 0) lot.x -= 1;
        lot.w += 1;
      }
    }
  }
}

/** True when tiles were edited behind the lots' back (tests and old saves poke tiles directly). */
function lotsOutOfSync(w: World): boolean {
  for (const lot of w.lots) {
    for (let y = lot.y; y < lot.y + lot.h; y++) {
      let i = y * w.size + lot.x;
      const end = i + lot.w;
      for (; i < end; i++) {
        if (w.lotAt[i] !== lot.id || w.zone[i] !== lot.zone || w.level[i] !== lot.level) return true;
      }
    }
  }
  for (let i = 0; i < w.zone.length; i++) {
    if (!w.zone[i] || blocksBuilding(w, i) || w.facility[i] || w.lotAt[i] >= 0) continue;
    if (isLand(w, i % w.size, (i / w.size) | 0)) return true;
  }
  return false;
}

/** Rebuild lots when stale; cheap to call every frame and every step. */
export function syncLots(s: CityState): void {
  if (s.world.lotsDirty || lotsOutOfSync(s.world)) refreshLots(s);
}

/** Set a lot's level and mirror it onto every footprint tile. */
function setLotLevel(w: World, lot: WorldLot, level: number): void {
  lot.level = level;
  for (let y = lot.y; y < lot.y + lot.h; y++) {
    for (let x = lot.x; x < lot.x + lot.w; x++) w.level[idx(w, x, y)] = level;
  }
}

/** Stamp a roundabout on the junction nearest tile (x, y); charges the flat tool cost. */
export function placeRoundabout(s: CityState, x: number, y: number): ToolResult {
  const w = s.world;
  const cx = x + 0.5, cz = y + 0.5;
  let nodeId = -1, bd = 1.6;
  for (const n of w.nodes) {
    const d = Math.hypot(n.x - cx, n.z - cz);
    if (d < bd) { bd = d; nodeId = n.id; }
  }
  if (nodeId < 0) return { ok: false, reason: "Roundabouts need a junction with at least 3 arms" };
  const node = w.nodes.find((n) => n.id === nodeId)!;
  // The ring (radius 1.5) must sit on dry, unbuilt land around the junction.
  for (let ty = Math.floor(node.z - 2); ty <= Math.floor(node.z + 2); ty++) {
    for (let tx = Math.floor(node.x - 2); tx <= Math.floor(node.x + 2); tx++) {
      if (!inBounds(w, tx, ty)) return { ok: false, reason: "No room for a roundabout here" };
      if (Math.hypot(tx + 0.5 - node.x, ty + 0.5 - node.z) > 2.1) continue;
      if (!isLand(w, tx, ty) || w.facility[idx(w, tx, ty)]) return { ok: false, reason: "No room for a roundabout here" };
    }
  }
  if (s.money < COST.roundabout) return { ok: false, reason: "Not enough money" };
  if (!stampRoundabout(w, nodeId)) return { ok: false, reason: "Roundabouts need a junction with at least 3 arms" };
  rebuildRoadRaster(w);
  s.money -= COST.roundabout;
  s.monthExpenses += COST.roundabout;
  w.revision++;
  return { ok: true };
}

function facilityUpkeep(w: World): number {
  let total = 0;
  for (let i = 0; i < w.facility.length; i++) {
    const f = w.facility[i];
    if (f) total += FACILITY_INFO[f as FacilityKind].upkeep;
  }
  return total;
}

/** Apply a tool to one tile. All world mutation from the player goes through here. */
export function applyTool(s: CityState, tool: ToolId, x: number, y: number, roadType: RoadType = 1): ToolResult {
  const w = s.world;
  if (tool === "pan" || tool === "busline" || tool === "metroline") return { ok: true };
  if (!inBounds(w, x, y)) return { ok: false, reason: "Outside the map" };
  const i = idx(w, x, y);
  if (tool === "busstop") return placeBusStop(s, x, y);
  if (tool === "roundabout") return placeRoundabout(s, x, y);
  const cost = COST[tool];
  const isEntry = isEntryTile(w, x, y);

  if (tool === "bulldoze") {
    if (isEntry) return { ok: false, reason: "Cannot remove the highway entry" };
    if (!w.road[i] && !w.zone[i] && !w.facility[i]) return { ok: true };
    if (s.money < cost) return { ok: false, reason: "Not enough money" };
    s.money -= cost;
    s.monthExpenses += cost;
    // A bus stop sits on its road: remove only the stop first, the road on the next click.
    if (w.road[i] && !w.facility[i] && removeStopAt(w, i)) {
      updateCoverage(w);
      w.revision++;
      return { ok: true };
    }
    if (w.facility[i] === FAC.METRO) removeStopAt(w, i);
    // Remember it: the raster rebuild below clears the tile, and lots/frontage must still be invalidated.
    const hadRoad = !!w.road[i];
    let removedElevated = false;
    if (w.road[i]) {
      // Grade separation (M24): an elevated piece is removed whole and
      // leaves ground roads intact; ground roads go only when no elevated
      // piece covers the tile (so the road under a deck survives a deck
      // bulldoze, and the deck survives a ground-road bulldoze elsewhere).
      const covering = w.segments.filter((seg) => !seg.fixed && seg.tiles.includes(i));
      const elevatedSegs = covering.filter((seg) => (seg.elevation ?? "ground") !== "ground");
      const targets = elevatedSegs.length ? elevatedSegs : covering;
      removedElevated = elevatedSegs.length > 0;
      for (const seg of targets) removeSegment(w, seg.id);
      rebuildRoadRaster(w);
      // Every bus stop that lost its road goes with it, not only the one under the cursor.
      for (const stop of [...w.stops]) {
        if (stop.kind === "bus" && !w.roadSurface[stop.tile]) removeStopAt(w, stop.tile);
      }
      w.coverageDirty = true;
    }
    if (w.facility[i]) w.coverageDirty = true;
    if (hadRoad) dirtyRoads(w);
    else if (w.zone[i] || w.facility[i]) dirtyZones(w);
    // When only an elevated piece was removed, the ground at this tile
    // (road below a deck, zone/facility above a tunnel) stays untouched.
    if (!removedElevated) {
      w.zone[i] = 0;
      w.level[i] = 0;
      w.facility[i] = 0;
    }
    if (w.coverageDirty) updateCoverage(w);
    w.revision++;
    return { ok: true };
  }

  if (!isLand(w, x, y)) return { ok: false, reason: "Cannot build on water" };

  if (isFacilityTool(tool)) {
    const type = FACILITY_OF_TOOL[tool];
    const info = FACILITY_INFO[type];
    if (blocksBuilding(w, i)) return { ok: false, reason: "Tile is a road" };
    if (w.zone[i]) return { ok: false, reason: "Tile is zoned" };
    if (w.facility[i]) return { ok: false, reason: "Tile is occupied" };
    if (type === FAC.CITYHALL && w.facility.includes(FAC.CITYHALL)) return { ok: false, reason: "There is already a city hall" };
    if (info.nearWater && !nearWater(w, x, y, 3)) {
      return { ok: false, reason: `${info.name} must be within 3 tiles of water` };
    }
    if (s.money < cost) return { ok: false, reason: "Not enough money" };
    flattenTile(w, x, y);
    w.facility[i] = type;
    if (type === FAC.METRO) registerMetroStation(w, i);
    w.coverageDirty = true;
    dirtyZones(w);
    updateCoverage(w);
    s.money -= cost;
    s.monthExpenses += cost;
    w.revision++;
    return { ok: true };
  }

  if (s.money < cost) return { ok: false, reason: "Not enough money" };

  if (tool === "road") {
    // Painting lays a one-tile segment of the chosen class.
    return placeRoad(s, roadType, [{ x: x + 0.5, z: y + 0.5 }, { x: x + 0.5, z: y + 0.5 }]);
  } else {
    const z = ZONE_OF_TOOL[tool];
    if (blocksBuilding(w, i)) return { ok: false, reason: "Tile is a road" };
    if (w.facility[i]) return { ok: false, reason: "Tile is occupied" };
    if (w.zone[i] === z) return { ok: true };
    // Zoning hugs the street grid: a tile needs street frontage within ZONE_DEPTH, like blocks in Cities: Skylines.
    if (getFrontage(w).road[i] < 0) return { ok: false, reason: "Zones must be within 4 tiles of a road" };
    flattenTile(w, x, y);
    w.zone[i] = z;
    w.level[i] = 0;
    dirtyZones(w);
    // A new lot reserves network capacity, which can unserve farther lots.
    w.coverageDirty = true;
  }
  s.money -= cost;
  s.monthExpenses += cost;
  w.revision++;
  return { ok: true };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Recompute capacities, utilities, happiness, population, jobs and RCI demand. */
function recount(s: CityState): void {
  const w = s.world;
  let res = 0, com = 0, ind = 0;
  const util = emptyUtilities();
  let built = 0, noSewage = 0, noGarbage = 0, noPower = 0, noWater = 0;
  const hasCityHall = w.facility.includes(FAC.CITYHALL);
  const civicCovered: Record<CivicKey, number> = { police: 0, fire: 0, health: 0, edu: 0, park: 0, transit: 0, culture: 0 };
  let lvSum = 0;

  for (let i = 0; i < w.facility.length; i++) {
    const f = w.facility[i];
    if (!f || f > FAC.LANDFILL) continue;
    const info = FACILITY_INFO[f as FacilityKind];
    const key: UtilityKey = f === FAC.POWER ? "power" : f === FAC.WATER ? "water" : f === FAC.SEWAGE ? "sewage" : "garbage";
    util[key].supply += info.capacity;
  }

  for (let i = 0; i < w.zone.length; i++) {
    const l = w.level[i];
    if (!l) continue;
    const z = w.zone[i];
    const kind = z === ZONE.RES ? "res" : z === ZONE.COM ? "com" : "ind";
    if (kind === "res") res += CAPACITY.res[l];
    else if (kind === "com") com += CAPACITY.com[l];
    else ind += CAPACITY.ind[l];
    const u = USAGE[kind][l];
    const c = w.cover[i];
    built++;
    util.power.demand += u;
    util.water.demand += u;
    if (!(c & COVER.POWER)) noPower++;
    if (!(c & COVER.WATER)) noWater++;
    if (c & COVER.SEWAGE) util.sewage.demand += u; else noSewage++;
    if (c & COVER.GARBAGE) util.garbage.demand += u; else noGarbage++;
    for (const k of CIVIC_KEYS) if (c & CIVIC_BIT[k]) civicCovered[k]++;
    lvSum += w.landValue[i];
  }
  for (const k of CIVIC_KEYS) s.coverage[k] = built ? civicCovered[k] / built : 0;
  s.landValue = built ? lvSum / built : 0;
  s.capacity = { res, com, ind };
  s.utilities = util;

  // Shortage: demand beyond supply hurts happiness in proportion to the shortfall.
  const short = (k: UtilityKey) =>
    util[k].demand > 0 ? Math.max(0, 1 - util[k].supply / util[k].demand) : 0;
  const missingPower = built ? noPower / built : 0;
  const missingWater = built ? noWater / built : 0;
  const missingSewage = built ? noSewage / built : 0;
  const missingGarbage = built ? noGarbage / built : 0;
  const hasBuildings = built > 0;
  const civicPenalty = hasBuildings
    ? (1 - s.coverage.police) * 10 + (1 - s.coverage.health) * 10
    : 0;
  s.happiness = clamp(
    100 - short("power") * 40 - short("water") * 40 - short("sewage") * 20 - short("garbage") * 15
      - missingPower * 25 - missingWater * 25 - missingSewage * 20 - missingGarbage * 15 - civicPenalty - s.congestion * 15 + s.coverage.park * 10 + s.coverage.transit * 5 + s.coverage.culture * 8
      + (hasCityHall ? 6 : 0),
    0, 100,
  );

  // Residents move in/out gradually toward housing capacity; unhappy cities fill slower.
  const target = res * (0.5 + 0.5 * (s.happiness / 100));
  const gap = target - s.population;
  s.population = Math.max(0, s.population + (Math.abs(gap) < 1 ? gap : gap * 0.05));
  const workers = s.population * 0.65;
  const jobs = com + ind;
  s.employed = Math.min(workers, jobs);
  s.unemployed = Math.max(0, workers - jobs);

  const taxPenalty = (s.taxRate - 0.1) * 4;
  const mood = (s.happiness - 70) / 150;
  const norm = (v: number, a: number, b: number) => v / Math.max(30, a + b);
  s.demand = {
    r: clamp(0.25 + norm(jobs - workers, jobs, workers) - taxPenalty + mood, -1, 1),
    c: clamp(0.2 + norm(s.population * 0.35 - com, s.population * 0.35, com) - taxPenalty, -1, 1),
    i: clamp(0.15 + norm(workers - jobs, workers, jobs) - taxPenalty, -1, 1),
  };
}

/** Rebuild everything derived from the player's world (after loading a save). */
export function refreshDerived(s: CityState): void {
  const w = s.world;
  rebuildNodes(w);
  rebuildRoadRaster(w);
  updateConnectivity(w);
  updateCoverage(w);
  syncLots(s);
  updateLandValue(w);
  recount(s);
  w.revision++;
}

/** Advance the simulation by one day. */
export function step(s: CityState): void {
  const w = s.world;
  if (w.connectivityDirty) updateConnectivity(w);
  if (w.coverageDirty) updateCoverage(w);
  s.raining = isRaining(s.day, s.rngState);
  if (s.day % 5 === 0 || s.lvSeenRevision !== w.revision) { updateLandValue(w); s.lvSeenRevision = w.revision; }
  const rng = makeRng(s.rngState ^ (s.day * 2654435761));
  const demandOf = [0, s.demand.r, s.demand.c, s.demand.i];
  let changed = false;

  // Growth decides once per ready lot; the level is mirrored onto the whole footprint.
  syncLots(s);
  const ready = new Set(lotsReadyToBuild(w, getBlocks(w), w.lots));
  for (const lot of w.lots) {
    const d = demandOf[lot.zone];
    const lvl = lot.level;
    // A building needs its services on every tile of its footprint.
    let power = true, water = true, sewage = true, garbage = true, edu = true, fire = true;
    for (let y = lot.y; y < lot.y + lot.h; y++) {
      for (let x = lot.x; x < lot.x + lot.w; x++) {
        const c = w.cover[idx(w, x, y)];
        power &&= (c & COVER.POWER) !== 0;
        water &&= (c & COVER.WATER) !== 0;
        sewage &&= (c & COVER.SEWAGE) !== 0;
        garbage &&= (c & COVER.GARBAGE) !== 0;
        edu &&= (c & COVER.EDU) !== 0;
        fire &&= (c & COVER.FIRE) !== 0;
      }
    }
    const served = ready.has(lot) && power && water;
    if (lvl === 0) {
      if (served && d > 0 && rng() < 0.05 * d) { setLotLevel(w, lot, 1); changed = true; }
    } else if (!served) {
      if (rng() < 0.05) { setLotLevel(w, lot, 0); changed = true; }
    } else if (!fire && rng() < FIRE_CHANCE) {
      setLotLevel(w, lot, 0); s.fires++; changed = true;
    } else {
      // Level 2 needs sewage; level 3 needs garbage collection and schools.
      const canUp = lvl === 1 ? sewage : garbage && edu;
      if (d > UPGRADE_DEMAND && lvl < 3 && canUp && rng() < 0.004) { setLotLevel(w, lot, lvl + 1); changed = true; }
      else if (d < -0.3 && rng() < 0.01) { setLotLevel(w, lot, lvl - 1); changed = true; }
    }
  }
  if (changed) {
    // Levels set demand, so regrow the networks before the recount reads them.
    updateCoverage(w);
    w.revision++;
  }

  recount(s);

  const jobs = s.capacity.com + s.capacity.ind;
  const monthlyIncome = (s.population * 3 + Math.min(jobs, s.population * 0.65 + jobs * 0.2) * 4) * (s.taxRate / 0.1) * (0.6 + 0.8 * (s.landValue / 100)) * (w.facility.includes(FAC.CITYHALL) ? 1.05 : 1);
  updateTransit(s);
  const monthlyUpkeep = roadUpkeep(w) + facilityUpkeep(w) + transitUpkeep(w);
  const inc = monthlyIncome / DAYS_PER_MONTH;
  const exp = monthlyUpkeep / DAYS_PER_MONTH;
  s.money += inc - exp;
  s.monthIncome += inc;
  s.monthExpenses += exp;

  s.day++;
  if (s.day % DAYS_PER_MONTH === 0) {
    s.lastMonth = { income: s.monthIncome, expenses: s.monthExpenses };
    s.monthIncome = 0;
    s.monthExpenses = 0;
  }
}
