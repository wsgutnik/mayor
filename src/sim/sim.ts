import { makeRng } from "./rng";
import { isRaining } from "./weather";
import { placeBusStop, registerMetroStation, removeStopAt, transitUpkeep, updateTransit } from "./transit";
import {
  ZONE, FAC, COVER, FACILITY_INFO, FacilityKind, World, Biome, WorldLot, ZoneType, generateWorld, idx, inBounds,
  isLand, nearWater, updateConnectivity, updateCoverage, updateLandValue, flattenTile, isEntryTile, blocksBuilding,
  ROAD_COST, ROAD_UPKEEP, ROAD_NAME, RoadType, RoadSegment, Pt, baseRoadType, curvePoints, isOneWayType, rasterizeRoad,
  rebuildRoadRaster, segElevation, segmentLength, levelTiles, facilityFootprint, facilityAnchorAt,
  Elevation,
} from "./world";
import { FACILITY_LINK_RADIUS } from "./networks";
import { BRIDGE_COST_MULT, TUNNEL_COST_MULT, detectSpan, splitPtsAt } from "./elevation";
import { Crossing, ELEVATED_JOIN_REASON, INTERCHANGE_REASON, classifyCrossings } from "./crossings";
import { addSegment, nearestOnSegment, nodeArms, nodeById, rebuildNodes, removeSegment, segById, stampRoundabout, toggleOneWayAt, SNAP_RADIUS } from "./roads";
import { profileOf } from "./corridor";
import { cornerRadiusFor } from "./junction";
import {
  BlockInfo, getBlocks, getFrontage, lotsReadyToBuild, planLots,
} from "./blocks";
import { rasterizeMirror } from "./mirror";
import { lotsReady, planOrientedLots } from "./orientedlots";
import { evolveOrientedLot } from "./lot-evolution";
import { buildZoneBlocks, cellIndex, cellPose, nearestCell, type ZoneBlockSet } from "./zoneblocks";
import { CELL_DEPTH } from "./zonecells";
import type { CellRef, ConstructionPhase, ConstructionState, OrientedLot, ZoneBlock } from "./zonecells";
import { applyLandmarkLandValue, LANDMARKS, landmarkCap, landmarkHappiness, landmarkJobs, landmarkRoll, LANDMARK_COOLDOWN } from "./landmarks";
import { cityEvents } from "../ui/events";
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
export const facilityToolFootprint = (t: FacilityTool): 1 | 2 => facilityFootprint(FACILITY_OF_TOOL[t]);

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
  res: [0, 8, 20, 40, 72, 112],
  com: [0, 4, 10, 20, 38, 60],
  ind: [0, 6, 14, 28, 50, 78],
} as const;

/** Utility units a building consumes per level (power, water, sewage, garbage all use this). */
export const USAGE = {
  res: [0, 2, 5, 10, 17, 26],
  com: [0, 2, 5, 10, 17, 26],
  ind: [0, 4, 9, 16, 25, 36],
} as const;

export const DAYS_PER_MONTH = 30;
/** Junction builder's smallest stable mouth separation. */
const MIN_JUNCTION_GAP = (5 * Math.PI) / 180;
const MIN_JUNCTION_GAP_REASON = "Road leaves this junction too close to another road";

export const TOO_CLOSE_TO_JUNCTION_REASON = "Too close to a junction";

/**
 * Smallest distance (tiles, along the road) between an existing junction and a
 * new T-junction on one of its roads, so the two junction keep-outs never
 * overlap: the incoming road's kerb edge, the widest arm already at the node and
 * the existing road's kerb return (docs/process/17-road-snapping.md). Dead ends
 * and bends with one arm only need the node merge radius.
 */
export function teeSpacing(w: World, nodeId: number, existing: RoadType, incoming: RoadType): number {
  const arms = nodeArms(w, nodeId);
  if (arms.length <= 1) return SNAP_RADIUS;
  let widest = 0;
  for (const a of arms) widest = Math.max(widest, profileOf(a.type).drawHalf);
  return profileOf(incoming).drawHalf + widest + cornerRadiusFor(existing);
}

/**
 * Where a road end would split an existing ground segment (a T), the distance
 * from the split to each end node of that segment must respect teeSpacing.
 * Ends that merge into a node (within SNAP_RADIUS of it, or with their foot
 * within SNAP_RADIUS of it) are joins, not new junctions, and pass.
 */
function teeTooClose(w: World, type: RoadType, pts: Pt[]): boolean {
  for (const p of [pts[0], pts[pts.length - 1]]) {
    if (w.nodes.some((n) => Math.hypot(n.x - p.x, n.z - p.z) <= SNAP_RADIUS)) continue;
    let best: { seg: RoadSegment; x: number; z: number; d: number } | null = null;
    for (const seg of w.segments) {
      if (segElevation(seg) !== "ground" || seg.pts.length < 2) continue;
      const pr = nearestOnSegment(seg, p);
      if (pr.d <= SNAP_RADIUS && (!best || pr.d < best.d)) best = { seg, x: pr.x, z: pr.z, d: pr.d };
    }
    if (!best) continue;
    for (const id of [best.seg.a, best.seg.b]) {
      const n = nodeById(w, id);
      if (!n) continue;
      const d = Math.hypot(n.x - best.x, n.z - best.z);
      if (d <= SNAP_RADIUS) continue; // joins that node
      if (d < teeSpacing(w, id, best.seg.type, type)) return true;
    }
  }
  return false;
}

/** Reject a new endpoint that would create a sub-5 degree mouth.  This is
 * deliberately in planning, so preview, paired roads and placement agree. */
function leavesNodeTooClose(w: World, pts: Pt[]): boolean {
  // Repainting/upgrading an existing alignment is not a new mouth. This also
  // keeps the one-way direction toggle free as documented.
  const nearExisting = (p: Pt): boolean => w.segments.some(s =>
    curvePoints(s.pts, 0.2).some(q => Math.hypot(q.x - p.x, q.z - p.z) < 0.25));
  if (nearExisting(pts[0]) && nearExisting(pts[pts.length - 1])) return false;
  for (const atStart of [true, false]) {
    const tip = pts[atStart ? 0 : pts.length - 1];
    const next = pts[atStart ? 1 : pts.length - 2];
    const vx = next.x - tip.x, vz = next.z - tip.z;
    const len = Math.hypot(vx, vz);
    if (len < 1e-9) continue;
    const dx = vx / len, dz = vz / len;
    const n = w.nodes.find(n => Math.hypot(n.x - tip.x, n.z - tip.z) <= SNAP_RADIUS);
    if (!n) continue;
    for (const arm of nodeArms(w, n.id)) {
      const dot = Math.max(-1, Math.min(1, dx * arm.dx + dz * arm.dz));
      if (Math.acos(dot) < MIN_JUNCTION_GAP - 1e-9) return true;
    }
  }
  return false;
}
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
  ages: { children: number; working: number; seniors: number };
  labourForce: number;
  employmentRate: number;
  jobsAvailable: number;
  jobsFilled: number;
  dependencyRatio: number;
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
  /** Last appearance day; derived from persisted lots on load when absent. */
  landmarkCooldownUntil: number;
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
    ages: { children: 0, working: 0, seniors: 0 },
    labourForce: 0, employmentRate: 0, jobsAvailable: 0, jobsFilled: 0, dependencyRatio: 0,
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
    landmarkCooldownUntil: 0,
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
  if (leavesNodeTooClose(w, pts)) return bad(MIN_JUNCTION_GAP_REASON);
  if (teeTooClose(w, type, pts)) return bad(TOO_CLOSE_TO_JUNCTION_REASON);
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
  if (w.zoning === "tiles") {
    for (const i of clearTiles) {
      w.zone[i] = 0;
      w.level[i] = 0;
    }
  }
  // The graph snaps the ends to nearby nodes, splits T-junction sides and
  // crossings, and upgrades roads paved over along the same path. Shared piece
  // endpoints snap to the same node, so the elevated middle joins its approaches.
  for (const piece of pieces) addSegment(w, type, piece.pts, { elevation: piece.elevation });
  rebuildRoadRaster(w);
  if (w.zoning === "oriented") {
    w.obstacleRevision++;
    w.lotsDirty = true;
    refreshOrientedLots(s);
  }
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

// ------------------------------------------------------------ parallel roads (UI-2)

/** Combined validation of a road and its parallel twin, priced together. */
export interface RoadPairPlan {
  ok: boolean;
  reason?: string;
  /** Combined price of both roads (0 when either road is invalid on its own). */
  cost: number;
  /** Combined new tiles of both roads. */
  newTiles: number;
}

/**
 * Validate a road pair atomically: both legs must plan cleanly on their own,
 * and the treasury must cover the COMBINED price (each `planRoad` only checks
 * its own leg). The caller then places both inside one history entry, so one
 * undo reverts both; when this says no, nothing is placed and the reason names
 * the failing leg's problem.
 */
export function planRoadPair(
  s: CityState, type: RoadType, pts: Pt[], paraPts: Pt[], level: RoadLevelInput = "ground",
): RoadPairPlan {
  const a = planRoad(s, type, pts, level);
  if (!a.ok) return { ok: false, reason: a.reason, cost: 0, newTiles: 0 };
  const b = planRoad(s, type, paraPts, level);
  if (!b.ok) return { ok: false, reason: b.reason, cost: 0, newTiles: 0 };
  const cost = a.cost + b.cost;
  if (s.money < cost) return { ok: false, reason: "Not enough money", cost, newTiles: a.newTiles + b.newTiles };
  return { ok: true, cost, newTiles: a.newTiles + b.newTiles };
}

// ------------------------------------------------------------ road upgrade (UI-2)

/** Price and validity of replacing one segment's class in place. */
export interface RoadUpgradePlan {
  ok: boolean;
  reason?: string;
  /** Tiles the segment would occupy at the new class. */
  tiles: number[];
  /** Tiles whose class (and price) rises. */
  newTiles: number;
  /** Cost difference at the segment's elevation (0 for downgrades). */
  cost: number;
}

/**
 * Price changing segment `segmentId` to `newType` without touching anything.
 * Geometry, nodes and elevation never change; widening onto buildings, lots or
 * water is refused, as is stranding lots or side streets behind a new highway.
 */
export function planRoadUpgrade(s: CityState, segmentId: number, newType: RoadType): RoadUpgradePlan {
  const w = s.world;
  const bad = (reason: string): RoadUpgradePlan => ({ ok: false, reason, tiles: [], newTiles: 0, cost: 0 });
  const seg = segById(w, segmentId);
  if (!seg || ![1, 2, 3, 4, 5].includes(newType)) return bad("Unknown road");
  if (seg.type === newType) return { ok: true, tiles: [...seg.tiles], newTiles: 0, cost: 0 };
  if (seg.fixed) return bad("Cannot remove the highway entry");
  if (seg.roundabout) return bad("Cannot upgrade a roundabout");
  const elev = segElevation(seg);
  const { tiles, outOfBounds } = rasterizeRoad(w, newType, seg.pts);
  if (outOfBounds) return bad("Outside the map");
  const old = new Set(seg.tiles);
  const added = tiles.filter((t) => !old.has(t));
  if (elev !== "tunnel") {
    // Same ground rules as planWithSpan, except zones are refused instead of
    // cleared: an upgrade must never crush lots. Tunnels leave the surface alone.
    for (const t of added) {
      const x = t % w.size, y = (t / w.size) | 0;
      if (elev === "ground" && !isLand(w, x, y)) return bad("Road would cross water");
      if (w.facility[t]) return bad("Road would cross a building");
      if (w.zone[t] || w.level[t]) return bad("Road would crush lots");
    }
  }
  const newBase = baseRoadType(newType), oldBase = baseRoadType(seg.type);
  if (elev === "ground" && (newBase === 3) !== (oldBase === 3)) {
    // Highways meet only highways at grade (same rule classifyCrossings
    // enforces for new roads): with the new type in place, no endpoint node
    // may mix highway and street arms. Covers upgrades to highway and
    // downgrades that would leave a highway ending in a street.
    for (const nodeId of [seg.a, seg.b]) {
      const node = nodeById(w, nodeId);
      if (!node) continue;
      let hw = newBase === 3, other = newBase !== 3;
      for (const sid of node.segs) {
        if (sid === seg.id) continue;
        const o = segById(w, sid);
        if (!o || segElevation(o) !== "ground") continue;
        if (baseRoadType(o.type) === 3) hw = true; else other = true;
      }
      if (hw && other) return bad(INTERCHANGE_REASON);
    }
    if (newBase === 3) {
      // A highway serves no lots: any zoned or built tile touching the new
      // footprint would be stranded (every served strip starts at the kerb).
      const touch = new Set(tiles);
      for (const t of tiles) {
        const x = t % w.size, y = (t / w.size) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy;
          if (inBounds(w, nx, ny)) touch.add(idx(w, nx, ny));
        }
      }
      for (const t of touch) {
        if (w.zone[t] || w.level[t]) return bad("Highway would strand lots");
      }
    }
  }
  // Per-tile price step, like planWithSpan but as a difference: new asphalt at
  // full price, widened-over road at the class step, downgrades free.
  const mult = elev === "bridge" ? BRIDGE_COST_MULT : elev === "tunnel" ? TUNNEL_COST_MULT : 1;
  let cost = 0, newTiles = 0;
  for (const t of tiles) {
    const cur = elev === "bridge" ? w.roadDeck[t] : elev === "tunnel" ? w.roadTunnel[t] : w.road[t];
    const step = ROAD_COST[newType] - (cur ? ROAD_COST[cur as RoadType] : 0);
    if (step > 0) { cost += step * mult; newTiles++; }
  }
  if (s.money < cost) return { ok: false, reason: "Not enough money", tiles, newTiles, cost };
  return { ok: true, tiles, newTiles, cost };
}

/**
 * Replace a road's class in place: the centreline and node graph stay, the
 * type (and one-way flags) change. Refreshes raster, connectivity, coverage,
 * lots and revisions exactly like placeRoad, so saves and zoning stay valid.
 */
export function upgradeRoad(s: CityState, segmentId: number, newType: RoadType): ToolResult {
  const plan = planRoadUpgrade(s, segmentId, newType);
  if (!plan.ok) return { ok: false, reason: plan.reason! };
  const w = s.world;
  const seg = segById(w, segmentId)!;
  if (seg.type === newType) return { ok: true };
  const elev = segElevation(seg);
  const wasOneWayType = isOneWayType(seg.type);
  const oldTiles = new Set(seg.tiles);
  seg.type = newType;
  if (isOneWayType(newType)) {
    seg.oneWay = true;
    seg.dir = seg.dir ?? 1;
  } else if (wasOneWayType) {
    delete seg.oneWay;
    delete seg.dir;
  }
  seg.tiles = plan.tiles;
  // The class feeds the signal and zone-block caches, so the graph revision moves too.
  w.graphRevision = (w.graphRevision ?? 0) + 1;
  // Fresh asphalt is levelled, exactly like a new ground road; decks and tunnels never touch the terrain.
  if (elev === "ground") levelTiles(w, plan.tiles.filter((t) => !oldTiles.has(t)));
  rebuildRoadRaster(w);
  // Same result the lazy refresh in step() would compute, but immediate reads stay exact.
  updateConnectivity(w);
  if (elev === "ground" && baseRoadType(newType) === 3) {
    // Bus stops need a street or avenue: like bulldoze, drop the stops the
    // upgrade leaves on pure highway (junction tiles shared with a street keep theirs).
    const kept = new Set<number>();
    for (const o of w.segments) {
      if (o.id === seg.id || segElevation(o) !== "ground" || baseRoadType(o.type) === 3) continue;
      for (const t of o.tiles) kept.add(t);
    }
    const now = new Set(plan.tiles);
    for (const stop of [...w.stops]) {
      if (stop.kind === "bus" && now.has(stop.tile) && !kept.has(stop.tile)) removeStopAt(w, stop.tile);
    }
  }
  if (w.zoning === "oriented") {
    w.obstacleRevision++;
    w.lotsDirty = true;
    refreshOrientedLots(s);
  }
  w.coverageDirty = true;
  updateCoverage(w);
  s.money -= plan.cost;
  s.monthExpenses += plan.cost;
  dirtyRoads(w);
  w.revision++;
  return { ok: true };
}

/**
 * The segment under a ground point that a tap would offer to upgrade: the
 * nearest centreline covering the tile, when its class differs. Pure.
 */
export function findUpgradeTarget(w: World, x: number, z: number, newType: RoadType): RoadSegment | undefined {
  const tx = Math.floor(x), ty = Math.floor(z);
  if (!inBounds(w, tx, ty)) return undefined;
  const tile = idx(w, tx, ty);
  if (!w.road[tile]) return undefined;
  // The fixed entry road and elevated/tunnel segments are never upgrade targets.
  const cands = w.segments.filter((sg) => sg.type !== newType && !sg.fixed && segElevation(sg) === "ground" && sg.tiles.includes(tile));
  if (!cands.length) return undefined;
  let best = cands[0], bd = Infinity;
  for (const sg of cands) {
    let d = Infinity;
    for (const p of curvePoints(sg.pts, 0.25)) d = Math.min(d, (p.x - x) ** 2 + (p.z - z) ** 2);
    if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && sg.id < best.id)) { bd = d; best = sg; }
  }
  return best;
}

// ------------------------------------------------------------ lots (M17)

/** Mark lots stale after a road edit (frontage and blocks both change). */
function dirtyRoads(w: World): void {
  w.roadRevision++;
  w.zoneRevision++;
  w.obstacleRevision++;
  w.lotsDirty = true;
}

/** Mark lots stale after a zone or facility edit (grouping changes, frontage stands). */
function dirtyZones(w: World): void {
  w.zoneRevision++;
  w.lotsDirty = true;
}

function dirtyObstacles(w: World): void {
  w.obstacleRevision++;
  dirtyZones(w);
}

function blockKey(ref: Pick<CellRef, "seg" | "side" | "block">): string {
  return `${ref.seg}:${ref.side}:${ref.block}`;
}

export function getZoneBlocks(w: World): ZoneBlockSet {
  const prev = w.cells as unknown as ZoneBlockSet | undefined;
  if (prev && prev.graphRevision === w.graphRevision && (prev as { obstacleRevision?: number }).obstacleRevision === w.obstacleRevision) return prev;
  const next = buildZoneBlocks(w, prev);
  (next as { obstacleRevision?: number }).obstacleRevision = w.obstacleRevision;
  w.cells = next as unknown as World["cells"];
  return next;
}

/**
 * Rebuild persistent lots from the tile arrays: planned road-fronting lots
 * first, then 1x1 lots for every other zoned tile so no zone is ever lot-less.
 * Levels come from the tile mirror, so rebuilding never loses buildings.
 */
export function refreshLots(s: CityState): void {
  const w = s.world;
  const old = new Map(w.lots.map((l) => [`${l.x}:${l.y}:${l.w}:${l.h}:${l.zone}`, l.construction]));
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
      construction: old.get(`${p.x}:${p.y}:${p.w}:${p.h}:${p.zone}`),
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
        construction: old.get(`${x}:${y}:1:1:${w.zone[i]}`),
      });
      w.lotAt[i] = id;
    }
  }
  w.lots = lots;
  w.lotsDirty = false;
}

export function setOLotLevel(w: World, lot: OrientedLot, level: number): void {
  if (level > lot.level) lot.build = 0;
  else if (level === 0) lot.build = 1;
  lot.level = level;
  const set = getZoneBlocks(w);
  const b = set.blocks.get(blockKey(lot));
  if (!b) return;
  for (let row = lot.row; row < lot.row + lot.w; row++) for (let col = lot.col; col < lot.col + lot.d; col++) {
    const i = cellIndex(row, col);
    b.level[i] = level;
  }
  rasterizeMirror(w, set, w.olots ?? []);
}

export function refreshOrientedLots(s: CityState): void {
  const w = s.world;
  const set = getZoneBlocks(w);
  const keep = w.olots ?? [];
  const lots = planOrientedLots(set.blocks, { rng: makeRng((s.rngState ^ 0x85ebca6b) >>> 0), keep, seed: s.rngState });
  const keptIds = new Set(keep.map((lot) => lot.id));
  for (const lot of lots) if (!keptIds.has(lot.id) && lot.id < w.nextOLotId) {
    const oldId = lot.id;
    lot.id = w.nextOLotId++;
    const b = set.blocks.get(blockKey(lot));
    if (b) for (let i = 0; i < b.lot.length; i++) if (b.lot[i] === oldId) b.lot[i] = lot.id;
  }
  for (const lot of lots) w.nextOLotId = Math.max(w.nextOLotId, lot.id + 1);
  w.olots = lots;
  rasterizeMirror(w, set, lots);
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
  if (s.world.zoning === "oriented") {
    if (s.world.lotsDirty || !s.world.olots) refreshOrientedLots(s);
    return;
  }
  if (s.world.lotsDirty || lotsOutOfSync(s.world)) refreshLots(s);
}

export interface ZoneBrush { radius: 0 | 1 | 2 }

function refsAround(set: ZoneBlockSet, ref: CellRef, radius: number): CellRef[] {
  const b = set.blocks.get(blockKey(ref));
  if (!b) return [];
  const p0 = cellPose(b, ref.row, ref.col);
  const maxD2 = (radius + 0.5) ** 2;
  const out: CellRef[] = [];
  for (const block of set.blocks.values()) for (let row = 0; row < block.rows; row++) for (let col = 0; col < 4; col++) {
    const i = cellIndex(row, col);
    if (!block.valid[i]) continue;
    const p = cellPose(block, row, col);
    if ((p.x - p0.x) ** 2 + (p.z - p0.z) ** 2 <= maxD2) out.push({ seg: block.seg, side: block.side, block: block.block, row, col });
  }
  return out;
}

export function applyZoneAt(s: CityState, zone: ZoneType | 0, x: number, z: number, brush: ZoneBrush = { radius: 0 }): ToolResult {
  const w = s.world;
  const set = getZoneBlocks(w);
  const picked = nearestCell(set, x, z, 0.75);
  if (!picked) return { ok: false, reason: "Zones must be within 4 tiles of a road" };
  const refs = refsAround(set, picked, brush.radius);
  const pending = refs.filter((ref) => {
    const b = set.blocks.get(blockKey(ref));
    return !!b && b.valid[cellIndex(ref.row, ref.col)] && b.zone[cellIndex(ref.row, ref.col)] !== zone;
  });
  const cost = zone ? COST.res * pending.length : 0;
  if (cost && s.money < cost) return { ok: false, reason: "Not enough money" };
  let changed = 0;
  for (const ref of pending) {
    const b = set.blocks.get(blockKey(ref));
    if (!b) continue;
    const i = cellIndex(ref.row, ref.col);
    b.zone[i] = zone;
    b.level[i] = 0;
    changed++;
    const p = cellPose(b, ref.row, ref.col);
    levelTiles(w, [idx(w, Math.floor(p.x), Math.floor(p.z))]);
  }
  if (!changed) return { ok: true };
  if (zone) { s.money -= cost; s.monthExpenses += cost; }
  w.zoneRevision++;
  w.lotsDirty = true;
  w.coverageDirty = true;
  w.revision++;
  refreshOrientedLots(s);
  return { ok: true };
}

export function bulldozeAt(s: CityState, x: number, z: number): ToolResult {
  const w = s.world;
  const tx = Math.floor(x), ty = Math.floor(z);
  if (!inBounds(w, tx, ty)) return { ok: false, reason: "Outside the map" };
  const tile = idx(w, tx, ty);
  if (w.road[tile] || w.facility[tile]) {
    const mode = w.zoning;
    w.zoning = "tiles";
    const result = applyTool(s, "bulldoze", tx, ty);
    w.zoning = mode;
    if (result.ok) {
      w.obstacleRevision++;
      w.lotsDirty = true;
      refreshOrientedLots(s);
    }
    return result;
  }
  const set = getZoneBlocks(w);
  const ref = nearestCell(set, x, z, 0.75);
  if (!ref) return { ok: true };
  const b = set.blocks.get(blockKey(ref));
  if (!b) return { ok: true };
  const i = cellIndex(ref.row, ref.col);
  if (!b.zone[i] && b.lot[i] < 0) return { ok: true };
  if (s.money < COST.bulldoze) return { ok: false, reason: "Not enough money" };
  const lotId = b.lot[i];
  const lot = lotId >= 0 ? (w.olots ?? []).find((l) => l.id === lotId) : undefined;
  if (lot) setOLotLevel(w, lot, 0);
  b.zone[i] = 0;
  b.level[i] = 0;
  s.money -= COST.bulldoze;
  s.monthExpenses += COST.bulldoze;
  w.zoneRevision++;
  w.lotsDirty = true;
  w.coverageDirty = true;
  w.revision++;
  refreshOrientedLots(s);
  return { ok: true };
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
    const a = f ? facilityAnchorAt(w, i) : undefined;
    if (a && idx(w, a.x, a.y) !== i) continue;
    if (f) total += FACILITY_INFO[f as FacilityKind].upkeep;
  }
  return total;
}

function footprintTiles(w: World, x: number, y: number, size: 1 | 2): number[] {
  const out: number[] = [];
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) out.push(idx(w, x + dx, y + dy));
  return out;
}

function footprintTouchesLinkedRoad(w: World, x: number, y: number, size: 1 | 2): boolean {
  if (w.connectivityDirty) updateConnectivity(w);
  for (let fy = y; fy < y + size; fy++) for (let fx = x; fx < x + size; fx++) {
    for (let dy = -FACILITY_LINK_RADIUS; dy <= FACILITY_LINK_RADIUS; dy++) for (let dx = -FACILITY_LINK_RADIUS; dx <= FACILITY_LINK_RADIUS; dx++) {
      const rx = fx + dx, ry = fy + dy;
      if (!inBounds(w, rx, ry)) continue;
      const r = idx(w, rx, ry);
      if (w.connected[r] && w.roadSurface[r] && Math.max(Math.abs(dx), Math.abs(dy)) <= FACILITY_LINK_RADIUS) return true;
    }
  }
  return false;
}

function clearFacilityAt(w: World, tile: number): void {
  const a = facilityAnchorAt(w, tile);
  if (a) {
    if (a.kind === FAC.METRO) for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) removeStopAt(w, idx(w, x, y));
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) w.facility[idx(w, x, y)] = 0;
    w.facilityAnchors = (w.facilityAnchors ?? []).filter((b) => b !== a);
  } else {
    if (w.facility[tile] === FAC.METRO) removeStopAt(w, tile);
    w.facility[tile] = 0;
  }
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
    if (w.zoning === "oriented" && !w.road[i] && !w.facility[i]) return bulldozeAt(s, x + 0.5, y + 0.5);
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
    const hadFacility = !!w.facility[i];
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
      if (hadFacility) clearFacilityAt(w, i);
    }
    if (w.coverageDirty) updateCoverage(w);
    w.revision++;
    return { ok: true };
  }

  if (!isLand(w, x, y)) return { ok: false, reason: "Cannot build on water" };

  if (isFacilityTool(tool)) {
    const type = FACILITY_OF_TOOL[tool];
    const info = FACILITY_INFO[type];
    const fp = facilityFootprint(type);
    if (x + fp > w.size || y + fp > w.size) return { ok: false, reason: "Facility footprint is outside the map" };
    const tiles = footprintTiles(w, x, y, fp);
    for (const t of tiles) {
      const tx = t % w.size, ty = (t / w.size) | 0;
      if (!isLand(w, tx, ty)) return { ok: false, reason: "Cannot build on water" };
      if (blocksBuilding(w, t)) return { ok: false, reason: "Tile is a road" };
      if (w.zone[t]) return { ok: false, reason: "Tile is zoned" };
      if (w.facility[t]) return { ok: false, reason: "Tile is occupied" };
    }
    if (type === FAC.CITYHALL && w.facility.includes(FAC.CITYHALL)) return { ok: false, reason: "There is already a city hall" };
    if (info.nearWater && !tiles.some((t) => nearWater(w, t % w.size, (t / w.size) | 0, 3))) {
      return { ok: false, reason: `${info.name} must be within 3 tiles of water` };
    }
    if (!footprintTouchesLinkedRoad(w, x, y, fp)) return { ok: false, reason: "Facility must be within 5 tiles of a connected road" };
    if (s.money < cost) return { ok: false, reason: "Not enough money" };
    for (const t of tiles) {
      const tx = t % w.size, ty = (t / w.size) | 0;
      flattenTile(w, tx, ty);
      w.facility[t] = type;
    }
    if (fp > 1) (w.facilityAnchors ??= []).push({ x, y, kind: type, w: fp, h: fp });
    if (type === FAC.METRO) registerMetroStation(w, i);
    w.coverageDirty = true;
    dirtyObstacles(w);
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
    if (w.zoning === "oriented") return applyZoneAt(s, ZONE_OF_TOOL[tool], x + 0.5, y + 0.5, { radius: 0 });
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

export type ZoneBulkTool = "res" | "com" | "ind" | "bulldoze";

export interface ZoneBulkPreview { count: number; cost: number; reason?: string }

interface BulkCell { b: ZoneBlock; i: number }

/**
 * Tiles the Fill tool may spread over. Same validity the brush uses: dry land,
 * no road or facility, within 4 lots of a road, and unzoned or already the
 * target zone (a different zone bounds the region). Bulldoze spreads over
 * zoned tiles only. Works in both modes: the tile mirror reflects oriented cells.
 */
export function isFillOpenTile(w: World, tool: ZoneBulkTool, x: number, y: number): boolean {
  if (!inBounds(w, x, y)) return false;
  const i = idx(w, x, y);
  if (!isLand(w, x, y) || blocksBuilding(w, i) || w.facility[i]) return false;
  if (tool === "bulldoze") return w.zone[i] !== 0;
  if (w.zone[i] !== 0 && w.zone[i] !== ZONE_OF_TOOL[tool]) return false;
  return getFrontage(w).road[i] >= 0;
}

function collectZoneBulk(w: World, tool: ZoneBulkTool, tiles: readonly { x: number; y: number }[]): {
  tiles: number[]; cells: BulkCell[]; hardReason?: string;
} {
  const out = { tiles: [] as number[], cells: [] as BulkCell[], hardReason: undefined as string | undefined };
  const fail = (reason: string): void => { out.hardReason ??= reason; };
  if (w.zoning === "oriented") {
    const wanted = new Set<number>();
    for (const t of tiles) {
      if (!inBounds(w, t.x, t.y)) { fail("Outside the map"); continue; }
      wanted.add(idx(w, t.x, t.y));
    }
    // One pass over the cells: nearestCell per tile would be quadratic on big maps.
    let mapped = 0;
    for (const b of getZoneBlocks(w).blocks.values()) {
      for (let row = 0; row < b.rows; row++) for (let col = 0; col < CELL_DEPTH; col++) {
        const i = cellIndex(row, col);
        if (!b.valid[i]) continue;
        const p = cellPose(b, row, col);
        const tx = Math.floor(p.x), ty = Math.floor(p.z);
        if (!inBounds(w, tx, ty) || !wanted.has(idx(w, tx, ty))) continue;
        mapped++;
        if (tool === "bulldoze") {
          if (b.zone[i] || b.lot[i] >= 0) out.cells.push({ b, i });
        } else if (b.zone[i] !== ZONE_OF_TOOL[tool]) {
          out.cells.push({ b, i });
        }
      }
    }
    if (!mapped) fail("Zones must be within 4 tiles of a road");
    return out;
  }
  const frontage = tool === "bulldoze" ? null : getFrontage(w);
  let already = 0;
  for (const t of tiles) {
    if (!inBounds(w, t.x, t.y)) { fail("Outside the map"); continue; }
    const i = idx(w, t.x, t.y);
    if (tool === "bulldoze") {
      // Zone-only: roads and facilities survive a bulk clear.
      if (w.zone[i]) out.tiles.push(i);
      continue;
    }
    if (!isLand(w, t.x, t.y)) { fail("Cannot build on water"); continue; }
    if (blocksBuilding(w, i)) { fail("Tile is a road"); continue; }
    if (w.facility[i]) { fail("Tile is occupied"); continue; }
    if (w.zone[i] === ZONE_OF_TOOL[tool]) { already++; continue; }
    if (frontage!.road[i] < 0) { fail("Zones must be within 4 tiles of a road"); continue; }
    out.tiles.push(i);
  }
  // Part of the rectangle is already this zone: nothing to do is not an error worth a "Tile is a road" toast.
  if (!out.tiles.length && already > 0) out.hardReason = undefined;
  return out;
}

/** Count and price a bulk zone operation without changing anything. */
export function previewZoneBulk(s: CityState, tool: ZoneBulkTool, tiles: readonly { x: number; y: number }[]): ZoneBulkPreview {
  const c = collectZoneBulk(s.world, tool, tiles);
  const n = s.world.zoning === "oriented" ? c.cells.length : c.tiles.length;
  if (n === 0) return { count: 0, cost: 0, reason: c.hardReason };
  const cost = n * (tool === "bulldoze" ? COST.bulldoze : COST[tool]);
  if (s.money < cost) return { count: n, cost, reason: "Not enough money" };
  return { count: n, cost };
}

/**
 * Zone (or zone-clear) many tiles at once: the Marquee and Fill tools.
 * Same rules as the brush (applyZoneAt/bulldozeAt in oriented mode, the
 * applyTool zone branch in classic mode) but one money check and one lot
 * refresh for the whole set, so the caller wraps it in a single undo entry.
 */
export function applyZoneBulk(s: CityState, tool: ZoneBulkTool, tiles: readonly { x: number; y: number }[]): ToolResult {
  const w = s.world;
  const c = collectZoneBulk(w, tool, tiles);
  const oriented = w.zoning === "oriented";
  const n = oriented ? c.cells.length : c.tiles.length;
  if (n === 0) return c.hardReason ? { ok: false, reason: c.hardReason } : { ok: true };
  const unit = tool === "bulldoze" ? COST.bulldoze : COST[tool];
  const cost = n * unit;
  if (s.money < cost) return { ok: false, reason: "Not enough money" };
  if (!oriented) {
    if (tool === "bulldoze") {
      for (const i of c.tiles) { w.zone[i] = 0; w.level[i] = 0; }
    } else {
      const z = ZONE_OF_TOOL[tool];
      for (const i of c.tiles) {
        flattenTile(w, i % w.size, (i / w.size) | 0);
        w.zone[i] = z;
        w.level[i] = 0;
      }
    }
    dirtyZones(w);
    w.coverageDirty = true;
    if (tool === "bulldoze") updateCoverage(w);
  } else if (tool === "bulldoze") {
    const zeroed = new Set<number>();
    for (const { b, i } of c.cells) {
      const lotId = b.lot[i];
      if (lotId >= 0 && !zeroed.has(lotId)) {
        zeroed.add(lotId);
        const lot = (w.olots ?? []).find((l) => l.id === lotId);
        if (lot) setOLotLevel(w, lot, 0);
      }
      b.zone[i] = 0;
      b.level[i] = 0;
    }
    w.zoneRevision++;
    w.lotsDirty = true;
    w.coverageDirty = true;
  } else {
    const z = ZONE_OF_TOOL[tool];
    for (const { b, i } of c.cells) {
      b.zone[i] = z;
      b.level[i] = 0;
      const p = cellPose(b, (i / CELL_DEPTH) | 0, i % CELL_DEPTH);
      levelTiles(w, [idx(w, Math.floor(p.x), Math.floor(p.z))]);
    }
    w.zoneRevision++;
    w.lotsDirty = true;
    w.coverageDirty = true;
  }
  s.money -= cost;
  s.monthExpenses += cost;
  w.revision++;
  if (oriented) refreshOrientedLots(s);
  return { ok: true };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Days are deliberately small enough that the five visible phases read at game speed. */
export function constructionDuration(lot: WorldLot | OrientedLot, level = lot.level): number {
  const area = "tiles" in lot ? lot.tiles.length : lot.w * lot.h;
  return 12 + area * 4 + level * 6;
}

export function constructionPhase(progress: number, upgrading = false): ConstructionPhase {
  if (progress >= 1) return "complete";
  if (upgrading) return "upgrading";
  if (progress < .12) return "planned";
  if (progress < .32) return "excavation";
  if (progress < .78) return "structure";
  return "finishing";
}

export function lotDemographics(s: CityState, lot: WorldLot | OrientedLot): { residents: { children: number; working: number; seniors: number }; workers: { basic: number; secondary: number; higher: number } } {
  const area = "tiles" in lot ? lot.tiles.length : lot.w * lot.h;
  if (lot.zone !== ZONE.RES || !lot.level || !s.capacity.res) return { residents: { children: 0, working: 0, seniors: 0 }, workers: { basic: 0, secondary: 0, higher: 0 } };
  const residents = Math.round(CAPACITY.res[lot.level] * area * s.population / s.capacity.res);
  const children = Math.round(residents * .20), working = Math.round(residents * .65);
  const seniors = Math.max(0, residents - children - working);
  const higher = Math.round(working * (.12 + lot.level * .08));
  const secondary = Math.round(working * .48);
  return { residents: { children, working, seniors }, workers: { basic: Math.max(0, working - higher - secondary), secondary, higher } };
}

function beginConstruction(lot: WorldLot | OrientedLot, upgrading = false): void {
  const c: ConstructionState = { state: upgrading ? "upgrading" : "planned", progress: 0, duration: constructionDuration(lot), ...(upgrading ? { upgrading: true } : {}) };
  lot.construction = c;
  if ("build" in lot) lot.build = 0;
}

function advanceConstruction(s: CityState, lot: WorldLot | OrientedLot, served: boolean): boolean {
  const c = lot.construction;
  if (!c || c.state === "complete") return false;
  if (!served || s.money < 0) { c.state = "paused"; return false; }
  c.progress = Math.min(1, c.progress + 1 / Math.max(1, c.duration));
  c.state = constructionPhase(c.progress, c.upgrading);
  if ("build" in lot) lot.build = c.progress;
  return true;
}

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
    const a = facilityAnchorAt(w, i);
    if (a && idx(w, a.x, a.y) !== i) continue;
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
      - missingPower * 25 - missingWater * 25 - missingSewage * 20 - missingGarbage * 15 - civicPenalty - s.congestion * 8 + s.coverage.park * 10 + s.coverage.transit * 5 + s.coverage.culture * 8
      + (hasCityHall ? 6 : 0) + landmarkHappiness(w.olots ?? []),
    0, 100,
  );

  // Residents move in/out gradually toward housing capacity; unhappy cities fill slower.
  const target = res * (0.5 + 0.5 * (s.happiness / 100));
  const gap = target - s.population;
  s.population = Math.max(0, s.population + (Math.abs(gap) < 1 ? gap : gap * 0.05));
  // Deterministic city composition. The working share intentionally remains 65%,
  // preserving the previous economy's balance while exposing the other cohorts.
  const children = Math.round(s.population * .20);
  const working = Math.round(s.population * .65);
  const seniors = Math.max(0, Math.round(s.population) - children - working);
  s.ages = { children, working, seniors };
  const workers = working;
  const jobs = com + ind + landmarkJobs(w.olots ?? []);
  s.employed = Math.min(workers, jobs);
  s.unemployed = Math.max(0, workers - jobs);
  s.labourForce = workers;
  s.jobsAvailable = jobs;
  s.jobsFilled = s.employed;
  s.employmentRate = workers ? s.employed / workers : 0;
  s.dependencyRatio = workers ? (children + seniors) / workers : 0;

  const taxPenalty = (s.taxRate - 0.1) * 4;
  const mood = (s.happiness - 70) / 150;
  const norm = (v: number, a: number, b: number) => v / Math.max(30, a + b);
  s.demand = {
    r: clamp(0.25 + norm(jobs - workers, jobs, workers) - taxPenalty + mood, -1, 1),
    c: clamp(0.2 + norm(s.population * 0.35 - com, s.population * 0.35, com) - taxPenalty, -1, 1),
    i: clamp(0.15 + norm(workers - jobs, workers, jobs) - taxPenalty, -1, 1),
  };
}

function lotFootprint(w: World, lot: WorldLot | OrientedLot): number[] {
  if ("tiles" in lot) return lot.tiles;
  const tiles: number[] = [];
  for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) tiles.push(idx(w, x, y));
  return tiles;
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
  applyLandmarkLandValue(w, w.olots ?? []);
  recount(s);
  w.revision++;
}

/** Advance the simulation by one day. */
export function step(s: CityState): void {
  const w = s.world;
  if (w.connectivityDirty) updateConnectivity(w);
  if (w.coverageDirty) updateCoverage(w);
  s.raining = isRaining(s.day, s.rngState);
  if (s.day % 5 === 0 || s.lvSeenRevision !== w.revision) { updateLandValue(w); applyLandmarkLandValue(w, w.olots ?? []); s.lvSeenRevision = w.revision; }
  const rng = makeRng(s.rngState ^ (s.day * 2654435761));
  const demandOf = [0, s.demand.r, s.demand.c, s.demand.i];
  let changed = false;

  // Growth decides once per ready lot; the level is mirrored onto the whole footprint.
  syncLots(s);
  const oriented = w.zoning === "oriented";
  const readyIds: Set<number> = oriented
    ? lotsReady(w, getZoneBlocks(w).blocks, w.olots ?? [])
    : new Set((lotsReadyToBuild(w, getBlocks(w), w.lots) as WorldLot[]).map((l) => l.id));
  const lots = oriented ? (w.olots ?? []) : w.lots;
  for (const lot of lots) {
    const d = demandOf[lot.zone];
    const lvl = lot.level;
    // A building needs its services on every tile of its footprint.
    let power = true, water = true, sewage = true, garbage = true, edu = true, fire = true;
    for (const tile of lotFootprint(w, lot)) {
      const c = w.cover[tile];
      power &&= (c & COVER.POWER) !== 0;
      water &&= (c & COVER.WATER) !== 0;
      sewage &&= (c & COVER.SEWAGE) !== 0;
      garbage &&= (c & COVER.GARBAGE) !== 0;
      edu &&= (c & COVER.EDU) !== 0;
      fire &&= (c & COVER.FIRE) !== 0;
    }
    const served = readyIds.has(lot.id) && power && water;
    if (advanceConstruction(s, lot, served)) changed = true;
    // Landmarks are player-bulldozable, but never decline, burn or evolve.
    if (oriented && (lot as OrientedLot).landmark) continue;
    if (lvl === 0) {
      if (served && d > 0 && rng() < 0.05 * d) {
        oriented ? setOLotLevel(w, lot as OrientedLot, 1) : setLotLevel(w, lot as WorldLot, 1);
        beginConstruction(lot); changed = true;
      }
    } else if (!served) {
      if (rng() < 0.05) { oriented ? setOLotLevel(w, lot as OrientedLot, 0) : setLotLevel(w, lot as WorldLot, 0); changed = true; }
    } else if (!fire && rng() < FIRE_CHANCE) {
      oriented ? setOLotLevel(w, lot as OrientedLot, 0) : setLotLevel(w, lot as WorldLot, 0); s.fires++; changed = true;
    } else {
      // Level 2 needs sewage; level 3 needs garbage collection and schools.
      const canUp = lvl === 1 ? sewage : garbage && edu;
      if (d > UPGRADE_DEMAND && lvl < (oriented ? 5 : 3) && canUp && rng() < 0.004) {
        if (oriented) {
          // Evolution is atomic: the existing anchor ID survives and all
          // absorbed neighbours disappear before the mirror is rebuilt.
          const evolved = evolveOrientedLot(w, getZoneBlocks(w), w.olots ?? [], lot as OrientedLot, lvl + 1);
          if (evolved) { rasterizeMirror(w, getZoneBlocks(w), w.olots ?? []); beginConstruction(lot, true); changed = true; }
        } else { setLotLevel(w, lot as WorldLot, lvl + 1); changed = true; }
      }
      else if (d < -0.3 && rng() < 0.01) { oriented ? setOLotLevel(w, lot as OrientedLot, lvl - 1) : setLotLevel(w, lot as WorldLot, lvl - 1); changed = true; }
    }
  }
  // One deterministic rare roll per day. It reads only seed/day/lot, so save/load
  // and replay select precisely the same landmark and location.
  if (oriented && s.day >= s.landmarkCooldownUntil) {
    const existing = (w.olots ?? []).filter((l) => l.landmark).length;
    const candidates = (w.olots ?? []).filter((l) => !l.landmark && l.level > 0 && l.w * l.d >= 4 && l.build !== undefined && l.build >= 1 && l.construction?.state !== "paused" && l.construction?.state !== "planned");
    for (const lot of candidates) {
      if (existing >= landmarkCap(s.population)) break;
      const eligible = LANDMARKS.filter((m) => m.zones.includes(lot.zone) && lot.w >= m.footprint && lot.d >= m.footprint);
      const roll = landmarkRoll(s.rngState, s.day, lot);
      if (!eligible.length || roll % 4096 !== 0) continue;
      const mark = eligible[Math.floor(roll / 4096) % eligible.length];
      lot.landmark = mark.id; lot.level = Math.max(lot.level, 3); beginConstruction(lot);
      setOLotLevel(w, lot, lot.level); s.landmarkCooldownUntil = s.day + LANDMARK_COOLDOWN; changed = true;
      cityEvents.emit("landmark:appeared", { id: mark.id, name: mark.name, nameEn: mark.nameEn, x: lot.cx, z: lot.cz });
      break;
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
