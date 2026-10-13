import type { CityState, ToolResult } from "./sim";
import { ROAD, TransitKind, TransitLine, Stop, World, ZONE, idx, inBounds, BUS_STOP_RADIUS, FACILITY_INFO, FAC } from "./world";
import { findPath } from "./traffic";

export const BUS_STOP_COST = 100;
export const LINE_COST = 200;
export const MAX_LINE_VEHICLES = 8;
export const VEHICLE_COST: Record<TransitKind, number> = { bus: 400, metro: 1500 };
export const VEHICLE_UPKEEP: Record<TransitKind, number> = { bus: 40, metro: 120 };
export const BUS_STOP_UPKEEP = 5;
/** Passengers one vehicle moves per day (capacity × trips). */
export const DAILY_CAPACITY: Record<TransitKind, number> = { bus: 30 * 8, metro: 120 * 6 };
export const FARE: Record<TransitKind, number> = { bus: 1, metro: 1.5 };
export const LINE_COLORS = ["#e5584f", "#3d8bff", "#35b86b", "#f0a030", "#a064e0", "#20b8c8", "#e0508c", "#8a9a30"];

const RADIUS: Record<TransitKind, number> = { bus: BUS_STOP_RADIUS, metro: FACILITY_INFO[FAC.METRO].radius };
const NAME: Record<TransitKind, string> = { bus: "Bus", metro: "Metro" };

export const stopAt = (w: World, tile: number): Stop | undefined => w.stops.find((s) => s.tile === tile);

/** Monthly cost of stops and vehicles (metro stations are charged as facilities). */
export function transitUpkeep(w: World): number {
  let total = 0;
  for (const s of w.stops) if (s.kind === "bus") total += BUS_STOP_UPKEEP;
  for (const l of w.lines) total += l.vehicles * VEHICLE_UPKEEP[l.kind];
  return total;
}

/** Add a bus stop on a street or avenue tile. */
export function placeBusStop(s: CityState, x: number, y: number): ToolResult {
  const w = s.world;
  if (!inBounds(w, x, y)) return { ok: false, reason: "Outside the map" };
  const i = idx(w, x, y);
  if (!w.roadSurface[i]) return { ok: false, reason: "Bus stops go on a road" };
  if (w.roadSurface[i] === ROAD.HIGHWAY) return { ok: false, reason: "Not on a highway" };
  if (stopAt(w, i)) return { ok: false, reason: "There is already a stop here" };
  if (s.money < BUS_STOP_COST) return { ok: false, reason: "Not enough money" };
  s.money -= BUS_STOP_COST;
  s.monthExpenses += BUS_STOP_COST;
  w.stops.push({ id: w.nextTransitId++, kind: "bus", tile: i });
  w.coverageDirty = true;
  w.revision++;
  return { ok: true };
}

/** Register the stop that belongs to a freshly built metro station. */
export function registerMetroStation(w: World, tile: number): void {
  w.stops.push({ id: w.nextTransitId++, kind: "metro", tile });
}

/** Remove the stop at a tile, and any line left with fewer than two stops. */
export function removeStopAt(w: World, tile: number): boolean {
  const stop = stopAt(w, tile);
  if (!stop) return false;
  w.stops = w.stops.filter((x) => x.id !== stop.id);
  for (const l of w.lines) l.stops = l.stops.filter((id) => id !== stop.id);
  w.lines = w.lines.filter((l) => l.stops.length >= 2);
  w.coverageDirty = true;
  return true;
}

/** Straight 4-connected tile run a→b, used for metro tracks. */
export function straightTiles(w: World, a: number, b: number): number[] {
  const out = [a];
  let x = a % w.size, y = (a / w.size) | 0;
  const bx = b % w.size, by = (b / w.size) | 0;
  while (x !== bx || y !== by) {
    if (Math.abs(bx - x) >= Math.abs(by - y)) x += Math.sign(bx - x); else y += Math.sign(by - y);
    out.push(idx(w, x, y));
  }
  return out;
}

/** Can a vehicle of this line get from one stop to the next? Buses need a road route. */
function legReachable(s: CityState, kind: TransitKind, a: Stop, b: Stop): boolean {
  if (kind === "metro") return true;
  const w = s.world;
  return findPath(w, new Uint16Array(w.size * w.size), a.tile, b.tile) !== null;
}

export function createLine(s: CityState, kind: TransitKind, stopIds: number[]): ToolResult {
  const w = s.world;
  if (new Set(stopIds).size < 2) return { ok: false, reason: "A line needs at least two stops" };
  const stops = stopIds.map((id) => w.stops.find((x) => x.id === id));
  if (stops.some((x) => !x)) return { ok: false, reason: "Unknown stop" };
  if (stops.some((x) => x!.kind !== kind)) return { ok: false, reason: `Use only ${NAME[kind].toLowerCase()} stops` };
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i]!, b = stops[(i + 1) % stops.length]!;
    if (a.id === b.id) continue;
    if (!legReachable(s, kind, a, b)) return { ok: false, reason: "No road connects these stops" };
  }
  const cost = LINE_COST + VEHICLE_COST[kind];
  if (s.money < cost) return { ok: false, reason: "Not enough money" };
  s.money -= cost;
  s.monthExpenses += cost;
  const n = w.lines.filter((l) => l.kind === kind).length + 1;
  const id = w.nextTransitId++;
  w.lines.push({ id, kind, stops: [...stopIds], vehicles: 1, color: LINE_COLORS[(id - 1) % LINE_COLORS.length], name: `${NAME[kind]} ${n}` });
  w.revision++;
  return { ok: true };
}

export function setLineVehicles(s: CityState, lineId: number, count: number): ToolResult {
  const line = s.world.lines.find((l) => l.id === lineId);
  if (!line) return { ok: false, reason: "Unknown line" };
  const n = Math.max(1, Math.min(MAX_LINE_VEHICLES, Math.round(count)));
  const add = n - line.vehicles;
  if (add > 0) {
    const cost = add * VEHICLE_COST[line.kind];
    if (s.money < cost) return { ok: false, reason: "Not enough money" };
    s.money -= cost;
    s.monthExpenses += cost;
  }
  line.vehicles = n;
  s.world.revision++;
  return { ok: true };
}

export function removeLine(s: CityState, lineId: number): void {
  s.world.lines = s.world.lines.filter((l) => l.id !== lineId);
  s.world.revision++;
}

/** Tiles of built zones within the reach of any of a line's stops. */
function catchment(w: World, line: TransitLine) {
  const seen = new Set<number>();
  let homes = 0, jobs = 0;
  const r = RADIUS[line.kind];
  for (const id of line.stops) {
    const stop = w.stops.find((x) => x.id === id);
    if (!stop) continue;
    const sx = stop.tile % w.size, sy = (stop.tile / w.size) | 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const nx = sx + dx, ny = sy + dy;
        if (!inBounds(w, nx, ny)) continue;
        const i = idx(w, nx, ny);
        if (seen.has(i) || !w.level[i]) continue;
        seen.add(i);
        const z = w.zone[i];
        const l = w.level[i];
        if (z === ZONE.RES) homes += [0, 8, 20, 40][l];
        else if (z === ZONE.COM) jobs += [0, 4, 10, 20][l];
        else if (z === ZONE.IND) jobs += [0, 6, 14, 28][l];
      }
    }
  }
  return { homes, jobs };
}

/**
 * Daily ridership: people need a stop near both home and work on the same line.
 * Riders are limited by vehicle capacity, pay a fare, and take cars off the road.
 */
const reachCache = new WeakMap<TransitLine, { revision: number; ok: boolean }>();

/** Whether every leg of a bus line still has a road route; re-checked only when the world changes. */
function lineIsServiceable(s: CityState, line: TransitLine): boolean {
  if (line.kind === "metro") return true;
  const hit = reachCache.get(line);
  if (hit && hit.revision === s.world.revision) return hit.ok;
  const stops = line.stops.map((id) => s.world.stops.find((x) => x.id === id));
  let ok = stops.every(Boolean);
  for (let i = 0; ok && i < stops.length; i++) {
    const a = stops[i]!, b = stops[(i + 1) % stops.length]!;
    if (a.id !== b.id && !legReachable(s, "bus", a, b)) ok = false;
  }
  reachCache.set(line, { revision: s.world.revision, ok });
  return ok;
}

export function updateTransit(s: CityState): void {
  const w = s.world;
  let riders = 0, income = 0;
  for (const line of w.lines) {
    if (!lineIsServiceable(s, line)) continue;
    const { homes, jobs } = catchment(w, line);
    const residentShare = s.capacity.res > 0 ? s.population / s.capacity.res : 0;
    const commuters = Math.min(homes * residentShare * 0.65, jobs);
    const potential = commuters * 0.45;
    const capacity = line.vehicles * DAILY_CAPACITY[line.kind];
    const r = Math.min(potential, capacity);
    riders += r;
    income += r * FARE[line.kind];
  }
  const workers = s.population * 0.65;
  s.transit = {
    riders,
    income,
    share: workers > 0 ? Math.min(0.8, riders / workers) : 0,
  };
  s.money += income;
  s.monthIncome += income;
}
