import { makeRng } from "./rng";
import {
  ZONE, World, generateWorld, idx, inBounds, isLand, isServed,
  updateConnectivity, flattenTile,
} from "./world";

export type ToolId = "pan" | "road" | "res" | "com" | "ind" | "bulldoze";

export const COST: Record<Exclude<ToolId, "pan">, number> = {
  road: 20, res: 4, com: 4, ind: 4, bulldoze: 5,
};

/** Residents, commercial jobs, industrial jobs per building level (index = level). */
export const CAPACITY = {
  res: [0, 8, 20, 40],
  com: [0, 4, 10, 20],
  ind: [0, 6, 14, 28],
} as const;

export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
const ROAD_UPKEEP_PER_MONTH = 3;

export interface Demand { r: number; c: number; i: number }

export interface MonthReport {
  income: number;
  expenses: number;
}

export interface CityState {
  world: World;
  day: number;
  money: number;
  taxRate: number;
  population: number;
  /** Fully-staffed capacity, before workers are matched. */
  capacity: { res: number; com: number; ind: number };
  employed: number;
  unemployed: number;
  demand: Demand;
  lastMonth: MonthReport;
  /** Money earned/spent so far in the current month. */
  monthIncome: number;
  monthExpenses: number;
  rngState: number;
}

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
    if (!w.road[i] && !w.zone[i]) return { ok: true };
    if (s.money < cost) return { ok: false, reason: "Not enough money" };
    s.money -= cost;
    s.monthExpenses += cost;
    if (w.road[i]) w.connectivityDirty = true;
    w.road[i] = 0;
    w.zone[i] = 0;
    w.level[i] = 0;
    w.revision++;
    return { ok: true };
  }

  if (!isLand(w, x, y)) return { ok: false, reason: "Cannot build on water" };
  if (s.money < cost) return { ok: false, reason: "Not enough money" };

  if (tool === "road") {
    if (w.road[i]) return { ok: true };
    flattenTile(w, x, y);
    w.road[i] = 1;
    w.zone[i] = 0;
    w.level[i] = 0;
    w.connectivityDirty = true;
  } else {
    const z = ZONE_OF_TOOL[tool];
    if (w.road[i]) return { ok: false, reason: "Tile is a road" };
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

/** Recompute capacities, population, jobs and RCI demand from the current buildings. */
function recount(s: CityState): void {
  const w = s.world;
  let res = 0, com = 0, ind = 0;
  for (let i = 0; i < w.zone.length; i++) {
    const l = w.level[i];
    if (!l) continue;
    if (w.zone[i] === ZONE.RES) res += CAPACITY.res[l];
    else if (w.zone[i] === ZONE.COM) com += CAPACITY.com[l];
    else if (w.zone[i] === ZONE.IND) ind += CAPACITY.ind[l];
  }
  s.capacity = { res, com, ind };
  // Residents move in/out gradually toward housing capacity.
  const gap = res - s.population;
  s.population = Math.max(0, s.population + (Math.abs(gap) < 1 ? gap : gap * 0.05));
  const workers = s.population * 0.65;
  const jobs = com + ind;
  s.employed = Math.min(workers, jobs);
  s.unemployed = Math.max(0, workers - jobs);

  const taxPenalty = (s.taxRate - 0.1) * 4;
  const norm = (v: number, a: number, b: number) => v / Math.max(30, a + b);
  s.demand = {
    r: clamp(0.25 + norm(jobs - workers, jobs, workers) - taxPenalty, -1, 1),
    c: clamp(0.2 + norm(s.population * 0.35 - com, s.population * 0.35, com) - taxPenalty, -1, 1),
    i: clamp(0.15 + norm(workers - jobs, workers, jobs) - taxPenalty, -1, 1),
  };
}

/** Advance the simulation by one day. */
export function step(s: CityState): void {
  const w = s.world;
  if (w.connectivityDirty) updateConnectivity(w);
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
      const served = isServed(w, x, y);
      if (lvl === 0) {
        if (served && d > 0 && rng() < 0.05 * d) { w.level[i] = 1; changed = true; }
      } else if (!served) {
        if (rng() < 0.05) { w.level[i] = 0; changed = true; }
      } else if (d > 0.35 && lvl < 3 && rng() < 0.004) {
        w.level[i] = lvl + 1; changed = true;
      } else if (d < -0.3 && rng() < 0.01) {
        w.level[i] = lvl - 1; changed = true;
      }
    }
  }
  if (changed) w.revision++;

  recount(s);

  const jobs = s.capacity.com + s.capacity.ind;
  const monthlyIncome = (s.population * 3 + Math.min(jobs, s.population * 0.65 + jobs * 0.2) * 4) * (s.taxRate / 0.1);
  const monthlyUpkeep = Math.max(0, countRoads(w) - 3) * ROAD_UPKEEP_PER_MONTH;
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
