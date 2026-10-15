/**
 * Benchmark / differential fixtures for the zone pipeline (zone-perf.bench.test.ts, zone-perf.diff.test.ts).
 * Test-only helpers: deterministic cities in oriented zoning, fully zoned.
 */
import { applyZoneBulk, newCity, placeRoad, planRoad, planRoadUpgrade, type CityState } from "./sim";
import { makeRng } from "./rng";
import { ROAD, cidx, segElevation, type Pt, type RoadType } from "./world";

export interface Fixture { name: string; city: () => CityState }

function flat(size: number, seed = 1337): CityState {
  const s = newCity(seed, size);
  const w = s.world;
  w.zoning = "oriented";
  s.money = 1e12;
  for (let y = 0; y <= w.size; y++) for (let x = 0; x <= w.size; x++) w.heights[cidx(w, x, y)] = 0.35;
  return s;
}

function road(s: CityState, type: RoadType, pts: Pt[]): boolean {
  return placeRoad(s, type, pts).ok;
}

/**
 * Axis-aligned line through `stops` (the planner refuses segments over 60 tiles, so long lines are laid in pieces
 * whose ends sit between the crossing lines). Throws when a piece is refused: fixtures must be exact.
 */
function line(s: CityState, type: RoadType, horizontal: boolean, at: number, stops: number[]): void {
  for (let k = 1; k < stops.length; k++) {
    const p = horizontal ? { x: stops[k - 1], z: at } : { x: at, z: stops[k - 1] };
    const q = horizontal ? { x: stops[k], z: at } : { x: at, z: stops[k] };
    const r = placeRoad(s, type, [p, q]);
    if (!r.ok) throw new Error(`fixture road refused: ${r.reason} ${JSON.stringify([p, q])}`);
  }
}

export function paintAll(s: CityState, x0 = 0, y0 = 0, x1 = s.world.size - 1, y1 = s.world.size - 1): void {
  const zones = ["res", "com", "ind"] as const;
  // Bands of the three zones so lots of every kind exist.
  const band = Math.max(1, Math.ceil((y1 - y0 + 1) / 3));
  for (let k = 0; k < 3; k++) {
    const t: { x: number; y: number }[] = [];
    for (let y = y0 + k * band; y <= Math.min(y1, y0 + (k + 1) * band - 1); y++) for (let x = x0; x <= x1; x++) t.push({ x, y });
    if (t.length) applyZoneBulk(s, zones[k], t);
  }
}

/** 96x96 grid: 7 avenues x 11 streets (~170 segments). */
export function gridCity(): CityState {
  const s = flat(96);
  for (let k = 0; k < 7; k++) line(s, ROAD.AVENUE as RoadType, true, 6.5 + 13 * k, [4.5, 42.5, 74.5, 90.5]);
  for (let k = 0; k < 11; k++) line(s, ROAD.STREET as RoadType, false, 6.5 + 8 * k, [4.5, 38.5, 77.5, 90.5]);
  paintAll(s);
  return s;
}

/** 96x96 organic network: seeded curves and diagonals (~300 segments). */
export function curvyCity(target = 300): CityState {
  const s = flat(96, 4242);
  const rnd = makeRng(4242);
  const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const clampP = (v: number) => Math.max(3.5, Math.min(92.5, v));
  for (let tries = 0; tries < 4000 && s.world.segments.length < target; tries++) {
    const a = { x: ri(4, 91) + 0.5, z: ri(4, 91) + 0.5 };
    const len = ri(8, 26), ang = rnd() * Math.PI * 2, bend = (rnd() - 0.5) * 12;
    const b = { x: clampP(Math.round(a.x + Math.cos(ang) * len) + 0.5), z: clampP(Math.round(a.z + Math.sin(ang) * len) + 0.5) };
    const c = { x: clampP(Math.round((a.x + b.x) / 2 - Math.sin(ang) * bend) + 0.5), z: clampP(Math.round((a.z + b.z) / 2 + Math.cos(ang) * bend) + 0.5) };
    const type = (rnd() < 0.2 ? ROAD.AVENUE : ROAD.STREET) as RoadType;
    road(s, type, rnd() < 0.7 ? [a, c, b] : [a, b]);
  }
  paintAll(s);
  return s;
}

/** 128x128 dense grid of streets every 5 tiles (~1000+ segments). */
export function denseCity(lines = 21, step = 6): CityState {
  const s = flat(128);
  // Lines at 4.5 + 6k; piece ends at 7.5 + 6k (between crossings), every 7 lines.
  const stops = [2.5, 7.5 + 6 * 6, 7.5 + 6 * 13, 4.5 + 6 * (lines - 1) + 2];
  // Every 5th line is an avenue (so an in-place downgrade exists).
  const type = (k: number) => (k % 5 === 2 ? ROAD.AVENUE : ROAD.STREET) as RoadType;
  for (let k = 0; k < lines; k++) line(s, type(k), true, 4.5 + step * k, stops);
  for (let k = 0; k < lines; k++) line(s, type(k), false, 4.5 + step * k, stops);
  paintAll(s);
  return s;
}

export const FIXTURES: Fixture[] = [
  { name: "grid96", city: gridCity },
  { name: "curvy96", city: () => curvyCity() },
  { name: "dense128", city: () => denseCity() },
];

/** A short dead-end street (T junction) off the middle of an existing street, into zoned land (deterministic). */
export function newRoadFor(s: CityState): Pt[] | null {
  const w = s.world;
  const segs = w.segments.filter((g) => !g.fixed && segElevation(g) === "ground" && g.pts.length === 2).sort((a, b) => a.id - b.id);
  const mid = Math.floor(segs.length / 2);
  for (const g of [...segs.slice(mid), ...segs.slice(0, mid)]) {
    const [a, b] = g.pts;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 4) continue;
    const m = { x: Math.floor((a.x + b.x) / 2) + 0.5, z: Math.floor((a.z + b.z) / 2) + 0.5 };
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
    for (const sgn of [1, -1]) {
      const pts = [m, { x: Math.round(m.x + sgn * nx * 4 - 0.5) + 0.5, z: Math.round(m.z + sgn * nz * 4 - 0.5) + 0.5 }];
      if (planRoad(s, ROAD.STREET as RoadType, pts).ok) return pts;
    }
  }
  return null;
}

/** A ground road tile in the middle of a non-fixed street segment. */
export function roadTileFor(s: CityState): { x: number; y: number } | null {
  const segs = s.world.segments.filter((g) => !g.fixed && segElevation(g) === "ground" && g.tiles.length >= 5).sort((a, b) => a.id - b.id);
  const g = segs[Math.floor(segs.length / 2)];
  if (!g) return null;
  const t = g.tiles[Math.floor(g.tiles.length / 2)];
  return { x: t % s.world.size, y: (t / s.world.size) | 0 };
}

/** A segment whose class can change in place (upgrade street -> avenue if allowed, else avenue -> street). */
export function upgradeFor(s: CityState): { id: number; type: RoadType } | null {
  const segs = s.world.segments.filter((g) => !g.fixed && segElevation(g) === "ground").sort((a, b) => a.id - b.id);
  const mid = Math.floor(segs.length / 2);
  const order = [...segs.slice(mid), ...segs.slice(0, mid)];
  for (const g of order) {
    if (g.type === ROAD.STREET && planRoadUpgrade(s, g.id, ROAD.AVENUE as RoadType).ok) return { id: g.id, type: ROAD.AVENUE as RoadType };
  }
  for (const g of order) {
    if (g.type === ROAD.AVENUE && planRoadUpgrade(s, g.id, ROAD.STREET as RoadType).ok) return { id: g.id, type: ROAD.STREET as RoadType };
  }
  return null;
}

/** 2000 tiles (50 x 40) to repaint commercial. */
export function paintRect(s: CityState): { x: number; y: number }[] {
  const w = s.world;
  const x0 = Math.floor(w.size / 2) - 25, y0 = Math.floor(w.size / 2) - 20;
  const t: { x: number; y: number }[] = [];
  for (let y = y0; y < y0 + 40; y++) for (let x = x0; x < x0 + 50; x++) t.push({ x, y });
  return t;
}
