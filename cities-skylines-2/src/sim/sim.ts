import { makeRng } from "./rng";
import {
  ZONE, FAC, COVER, FACILITY_INFO, FacilityType, World, generateWorld, idx, inBounds,
  isLand, isServed, nearWater, updateConnectivity, updateCoverage, flattenTile,
} from "./world";

export type FacilityTool = "power" | "water" | "sewage" | "landfill";
export type ToolId = "pan" | "road" | "res" | "com" | "ind" | "bulldoze" | FacilityTool;

const FACILITY_OF_TOOL: Record<FacilityTool, Exclude<FacilityType, 0>> = {
  power: FAC.POWER, water: FAC.WATER, sewage: FAC.SEWAGE, landfill: FAC.LANDFILL,
};
export const isFacilityTool = (t: ToolId): t is FacilityTool => t in FACILITY_OF_TOOL;

export const COST: Record<Exclude<ToolId, "pan">, number> = {
  road: 20, res: 4, com: 4, ind: 4, bulldoze: 5,
  power: FACILITY_INFO[FAC.POWER].cost,
  water: FACILITY_INFO[FAC.WATER].cost,
  sewage: FACILITY_INFO[FAC.SEWAGE].cost,
  landfill: FACILITY_INFO[FAC.LANDFILL].cost,
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
const ROAD_UPKEEP_PER_MONTH = 3;

export interface Demand { r: number; c: number; i: number }
export interface MonthReport { income: number; expenses: number }
export interface UtilityStat { supply: number; demand: number }
export type UtilityKey = "power" | "water" | "sewage" | "garbage";

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
  /** 0..100; falls with missing sewage/garbage cover and utility shortages. */
  happiness: number;
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

export function newCity(seed = 1337, size = 96): CityState {
  return {
    world: generateWorld(size, seed),
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
  for (let i = 0; i < w.road.length; i++) n += w.road[i];
  return n;
}

function facilityUpkeep(w: World): number {
  let total = 0;
  for (let i = 0; i < w.facility.length; i++) {
    const f = w.facility[i];
    if (f) total += FACILITY_INFO[f as 1 | 2 | 3 | 4].upkeep;
  }
  return total;
}

/** Apply a tool to one tile. All world mutation from the player goes through here. */
export function applyTool(s: CityState, tool: ToolId, x: number, y: number): ToolResult {
  const w = s.world;
  if (tool === "pan") return { ok: true };
  if (!inBounds(w, x, y)) return { ok: false, reason: "Outside the map" };
  const i = idx(w, x, y);
  const cost = COST[tool];
  const isEntry = x <= 2 && y === w.entry.y;

  if (tool === "bulldoze") {
    if (isEntry) return { ok: false, reason: "Cannot remove the highway entry" };
    if (!w.road[i] && !w.zone[i] && !w.facility[i]) return { ok: true };
    if (s.money < cost) return { ok: false, reason: "Not enough money" };
    s.money -= cost;
    s.monthExpenses += cost;
    if (w.road[i]) w.connectivityDirty = true;
    if (w.facility[i]) w.coverageDirty = true;
    w.road[i] = 0;
    w.zone[i] = 0;
    w.level[i] = 0;
    w.facility[i] = 0;
    if (w.coverageDirty) updateCoverage(w);
    w.revision++;
    return { ok: true };
  }

  if (!isLand(w, x, y)) return { ok: false, reason: "Cannot build on water" };

  if (isFacilityTool(tool)) {
    const type = FACILITY_OF_TOOL[tool];
    const info = FACILITY_INFO[type];
    if (w.road[i]) return { ok: false, reason: "Tile is a road" };
    if (w.zone[i]) return { ok: false, reason: "Tile is zoned" };
    if (w.facility[i]) return { ok: false, reason: "Tile is occupied" };
    if (info.nearWater && !nearWater(w, x, y, 3)) {
      return { ok: false, reason: `${info.name} must be within 3 tiles of water` };
    }
    if (s.money < cost) return { ok: false, reason: "Not enough money" };
    flattenTile(w, x, y);
    w.facility[i] = type;
    w.coverageDirty = true;
    updateCoverage(w);
    s.money -= cost;
    s.monthExpenses += cost;
    w.revision++;
    return { ok: true };
  }

  if (s.money < cost) return { ok: false, reason: "Not enough money" };

  if (tool === "road") {
    if (w.facility[i]) return { ok: false, reason: "Tile is occupied" };
    if (w.road[i]) return { ok: true };
    flattenTile(w, x, y);
    w.road[i] = 1;
    w.zone[i] = 0;
    w.level[i] = 0;
    w.connectivityDirty = true;
  } else {
    const z = ZONE_OF_TOOL[tool];
    if (w.road[i]) return { ok: false, reason: "Tile is a road" };
    if (w.facility[i]) return { ok: false, reason: "Tile is occupied" };
    if (w.zone[i] === z) return { ok: true };
    flattenTile(w, x, y);
    w.zone[i] = z;
    w.level[i] = 0;
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
  let built = 0, noSewage = 0, noGarbage = 0;

  for (let i = 0; i < w.facility.length; i++) {
    const f = w.facility[i];
    if (!f) continue;
    const info = FACILITY_INFO[f as 1 | 2 | 3 | 4];
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
    if (c & COVER.POWER) util.power.demand += u;
    if (c & COVER.WATER) util.water.demand += u;
    if (c & COVER.SEWAGE) util.sewage.demand += u; else noSewage++;
    if (c & COVER.GARBAGE) util.garbage.demand += u; else noGarbage++;
  }
  s.capacity = { res, com, ind };
  s.utilities = util;

  // Shortage: demand beyond supply hurts happiness in proportion to the shortfall.
  const short = (k: UtilityKey) =>
    util[k].demand > 0 ? Math.max(0, 1 - util[k].supply / util[k].demand) : 0;
  const missingSewage = built ? noSewage / built : 0;
  const missingGarbage = built ? noGarbage / built : 0;
  s.happiness = clamp(
    100 - short("power") * 40 - short("water") * 40 - short("sewage") * 20 - short("garbage") * 15
      - missingSewage * 20 - missingGarbage * 15,
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

/** Advance the simulation by one day. */
export function step(s: CityState): void {
  const w = s.world;
  if (w.connectivityDirty) updateConnectivity(w);
  if (w.coverageDirty) updateCoverage(w);
  const rng = makeRng(s.rngState ^ (s.day * 2654435761));
  const demandOf = [0, s.demand.r, s.demand.c, s.demand.i];
  let changed = false;

  for (let y = 0; y < w.size; y++) {
    for (let x = 0; x < w.size; x++) {
      const i = idx(w, x, y);
      const z = w.zone[i];
      if (!z) continue;
      const d = demandOf[z];
      const lvl = w.level[i];
      const c = w.cover[i];
      const hasBasics = (c & COVER.POWER) !== 0 && (c & COVER.WATER) !== 0;
      const served = isServed(w, x, y) && hasBasics;
      if (lvl === 0) {
        if (served && d > 0 && rng() < 0.05 * d) { w.level[i] = 1; changed = true; }
      } else if (!served) {
        if (rng() < 0.05) { w.level[i] = 0; changed = true; }
      } else {
        // Level 2 needs sewage, level 3 needs garbage collection.
        const canUp = lvl === 1 ? (c & COVER.SEWAGE) !== 0 : (c & COVER.GARBAGE) !== 0;
        if (d > 0.35 && lvl < 3 && canUp && rng() < 0.004) { w.level[i] = lvl + 1; changed = true; }
        else if (d < -0.3 && rng() < 0.01) { w.level[i] = lvl - 1; changed = true; }
      }
    }
  }
  if (changed) w.revision++;

  recount(s);

  const jobs = s.capacity.com + s.capacity.ind;
  const monthlyIncome = (s.population * 3 + Math.min(jobs, s.population * 0.65 + jobs * 0.2) * 4) * (s.taxRate / 0.1);
  const monthlyUpkeep = Math.max(0, countRoads(w) - 3) * ROAD_UPKEEP_PER_MONTH + facilityUpkeep(w);
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
