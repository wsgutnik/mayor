import { makeRng } from "./rng";
import type { ConstructionState, OrientedLot, ZoneBlockSet, ZoningMode } from "./zonecells";
import type { RoadNode } from "./roads";
import { updateNetworkCoverage, facilityLinks } from "./networks";

export const ZONE = { NONE: 0, RES: 1, COM: 2, IND: 3 } as const;
export type ZoneType = (typeof ZONE)[keyof typeof ZONE];

/** Facility kinds stored per tile: utilities (1-4) and civic services (5-9). */
export const FAC = {
  NONE: 0, POWER: 1, WATER: 2, SEWAGE: 3, LANDFILL: 4,
  POLICE: 5, FIRE: 6, CLINIC: 7, SCHOOL: 8, PARK: 9, METRO: 10,
  HOSPITAL: 11, HIGHSCHOOL: 12, LIBRARY: 13, COMMUNITY: 14, MUSEUM: 15, CITYHALL: 16, SUBSTATION: 17,
} as const;
export type FacilityType = (typeof FAC)[keyof typeof FAC];
export type FacilityKind = Exclude<FacilityType, 0>;

/** Bits in World.cover. */
export const COVER = {
  POWER: 1, WATER: 2, SEWAGE: 4, GARBAGE: 8,
  POLICE: 16, FIRE: 32, HEALTH: 64, EDU: 128, PARK: 256, TRANSIT: 512, CULTURE: 2048,
} as const;

/** Pseudo-layer for the land value infoview (not a coverage bit). */
export const LAND_VALUE_LAYER = 4096;
/** Pseudo-layer colouring road tiles by how full they are. */
export const TRAFFIC_LAYER = 8192;
/** Pseudo-layer: the underground view with water, sewage and power networks laid under the roads. */
export const UNDERGROUND_LAYER = 16384;

interface FacilityInfo {
  name: string; cost: number; upkeep: number; radius: number;
  /** Tile footprint width/depth. Omitted means a 1x1 building. */
  footprint?: 1 | 2;
  /** Units supplied; 0 for civic services, which cover without a capacity limit. */
  capacity: number; bit: number; nearWater: boolean;
}

export const FACILITY_INFO: Record<FacilityKind, FacilityInfo> = {
  [FAC.POWER]: { name: "Power plant", cost: 800, upkeep: 60, radius: 14, footprint: 2, capacity: 120, bit: COVER.POWER, nearWater: false },
  [FAC.WATER]: { name: "Water pump", cost: 500, upkeep: 40, radius: 10, footprint: 2, capacity: 90, bit: COVER.WATER, nearWater: true },
  [FAC.SEWAGE]: { name: "Sewage outlet", cost: 400, upkeep: 40, radius: 10, capacity: 90, bit: COVER.SEWAGE, nearWater: true },
  [FAC.LANDFILL]: { name: "Landfill", cost: 300, upkeep: 30, radius: 12, capacity: 80, bit: COVER.GARBAGE, nearWater: false },
  [FAC.POLICE]: { name: "Police station", cost: 600, upkeep: 50, radius: 12, capacity: 0, bit: COVER.POLICE, nearWater: false },
  [FAC.FIRE]: { name: "Fire station", cost: 600, upkeep: 50, radius: 12, capacity: 0, bit: COVER.FIRE, nearWater: false },
  [FAC.CLINIC]: { name: "Clinic", cost: 700, upkeep: 60, radius: 12, capacity: 0, bit: COVER.HEALTH, nearWater: false },
  [FAC.SCHOOL]: { name: "School", cost: 900, upkeep: 70, radius: 14, capacity: 0, bit: COVER.EDU, nearWater: false },
  [FAC.PARK]: { name: "Park", cost: 150, upkeep: 10, radius: 8, capacity: 0, bit: COVER.PARK, nearWater: false },
  [FAC.METRO]: { name: "Metro station", cost: 1200, upkeep: 60, radius: 9, footprint: 2, capacity: 0, bit: COVER.TRANSIT, nearWater: false },
  [FAC.HOSPITAL]: { name: "General hospital", cost: 1800, upkeep: 130, radius: 18, footprint: 2, capacity: 0, bit: COVER.HEALTH, nearWater: false },
  [FAC.HIGHSCHOOL]: { name: "Secondary school", cost: 1400, upkeep: 100, radius: 20, footprint: 2, capacity: 0, bit: COVER.EDU, nearWater: false },
  [FAC.LIBRARY]: { name: "Public library", cost: 700, upkeep: 40, radius: 12, capacity: 0, bit: COVER.CULTURE, nearWater: false },
  [FAC.COMMUNITY]: { name: "Community centre", cost: 500, upkeep: 30, radius: 10, capacity: 0, bit: COVER.CULTURE, nearWater: false },
  [FAC.MUSEUM]: { name: "City museum", cost: 1500, upkeep: 90, radius: 16, capacity: 0, bit: COVER.CULTURE, nearWater: false },
  /** Effect is city-wide (happiness and tax), so its own radius is zero. */
  [FAC.CITYHALL]: { name: "City hall", cost: 2500, upkeep: 150, radius: 0, footprint: 2, capacity: 0, bit: 0, nearWater: false },
  /** Extends the power network without adding supply. */
  [FAC.SUBSTATION]: { name: "Substation", cost: 300, upkeep: 20, radius: 14, capacity: 0, bit: COVER.POWER, nearWater: false },
};

/** `x/y/w/h` are the conservative tile mirror; pose is optional for old saves. */
export interface FacilityAnchor { x: number; y: number; kind: FacilityKind; w: number; h: number; cx?: number; cz?: number; yaw?: number }

export const facilityFootprint = (kind: FacilityKind): 1 | 2 => FACILITY_INFO[kind].footprint ?? 1;

export function facilityAnchorAt(w: World, tile: number): FacilityAnchor | undefined {
  const anchors = w.facilityAnchors;
  if (!anchors?.length) return undefined;
  const x = tile % w.size, y = (tile / w.size) | 0;
  return anchors.find((a) => {
    if (x < a.x || x >= a.x + a.w || y < a.y || y >= a.y + a.h) return false;
    // The conservative box contains a few empty corners for rotated footprints.
    if (a.cx === undefined || a.cz === undefined || a.yaw === undefined) return true;
    const dx = x + .5 - a.cx, dz = y + .5 - a.cz, c = Math.cos(a.yaw), s = Math.sin(a.yaw);
    return Math.abs(dx * c - dz * s) <= a.w / 2 + 1e-6 && Math.abs(dx * s + dz * c) <= a.h / 2 + 1e-6;
  });
}

/** Walking reach of a bus stop, in tiles. */
export const BUS_STOP_RADIUS = 6;

export type TransitKind = "bus" | "metro";
export interface Stop { id: number; kind: TransitKind; tile: number }
export interface TransitLine {
  id: number;
  kind: TransitKind;
  /** Stop ids in visiting order; the route loops. */
  stops: number[];
  vehicles: number;
  color: string;
  name: string;
}

/** Road classes. The grid stores the class per tile (0 = none). Types 4/5 are the one-way variants of street/avenue. */
export const ROAD = { NONE: 0, STREET: 1, AVENUE: 2, HIGHWAY: 3, ONEWAY_STREET: 4, ONEWAY_AVENUE: 5 } as const;
export type RoadType = 1 | 2 | 3 | 4 | 5;
/** Tiles of width a road occupies on the grid, and its drawn width in world units. */
export const ROAD_TILE_WIDTH: Record<RoadType, number> = { 1: 1, 2: 2, 3: 3, 4: 1, 5: 2 };
export const ROAD_DRAW_WIDTH: Record<RoadType, number> = { 1: 0.9, 2: 1.8, 3: 2.8, 4: 0.9, 5: 1.8 };
export const ROAD_COST: Record<RoadType, number> = { 1: 20, 2: 45, 3: 90, 4: 22, 5: 48 };
export const ROAD_UPKEEP: Record<RoadType, number> = { 1: 3, 2: 7, 3: 14, 4: 3, 5: 7 };
export const ROAD_NAME: Record<RoadType, string> = { 1: "Street", 2: "Avenue", 3: "Highway", 4: "One-way street", 5: "One-way avenue" };

/** True for the one-way road classes (4/5). */
export const isOneWayType = (t: RoadType): boolean => t === 4 || t === 5;
/** The two-way class a road type draws and behaves like (one-way variants map to their base class). */
export const baseRoadType = (t: RoadType): 1 | 2 | 3 => (t === 4 ? 1 : t === 5 ? 2 : t);

/** A point on the ground plane; tile (x, y) covers [x, x+1) × [y, y+1). */
export interface Pt { x: number; z: number }

/** Vertical placement of a road segment (M23). Absent in old saves; missing means ground. */
export type Elevation = "ground" | "bridge" | "tunnel";
export const segElevation = (seg: { elevation?: Elevation }): Elevation => seg.elevation ?? "ground";

export interface RoadSegment {
  id: number;
  type: RoadType;
  /** 2 points = straight, 3 points = quadratic Bézier with the middle one as control. */
  pts: Pt[];
  /** Tile indices this segment occupies. */
  tiles: number[];
  /** Graph endpoints: ids into World.nodes. Absent in old saves; rebuilt on load. */
  a: number;
  b: number;
  /** The pre-built entry road cannot be removed. */
  fixed?: boolean;
  elevation?: Elevation;
  /** One-way segment: traffic may only travel in the `dir` direction. Absent in old saves (two-way). */
  oneWay?: boolean;
  /** Travel direction for one-way segments: 1 = a→b, -1 = b→a. Defaults to 1 when `oneWay` is set. */
  dir?: 1 | -1;
  /** Part of a roundabout ring (one-way arc stamped by the roundabout tool). */
  roundabout?: boolean;
}

/** A roundabout island stamped on a junction; the ring segments live in `segments`. */
export interface Roundabout { x: number; z: number; r: number }

export type Biome = "plains" | "forest" | "river" | "coast" | "mountain" | "desert";
export const BIOMES: Biome[] = ["plains", "forest", "river", "coast", "mountain", "desert"];

/**
 * One city lot: a road-fronting rectangle of equally-zoned tiles that grows a
 * single building. `level` is mirrored onto every footprint tile in `level`,
 * so tile arrays stay usable for infoviews, traffic and saves.
 */
export interface WorldLot {
  id: number;
  /** Anchor (minimum) corner tile and footprint in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tile step from the lot toward its street; shared by every footprint tile's block. */
  facing: { dx: -1 | 0 | 1; dy: -1 | 0 | 1 };
  zone: ZoneType;
  /** Building level, 0 = empty lot, 1..3. */
  level: number;
  /** Kerb depth of the lot's front row (0), or -1 when no street fronts it. */
  depthFromRoad: number;
  construction?: ConstructionState;
}

export interface World {
  biome: Biome;
  size: number;
  /** (size+1)^2 corner heights; water level is 0. */
  heights: Float32Array;
  /** Road class per tile (ROAD.*), derived from `segments`. Bridges and tunnels stay connected here. */
  road: Uint8Array;
  /** Road class per tile from ground segments only; bridge decks and tunnels are excluded (frontage, lots, utilities). */
  roadSurface: Uint8Array;
  /** Road class per tile from bridge segments only (derived, not saved). */
  roadDeck: Uint8Array;
  /** Road class per tile from tunnel segments only (derived, not saved). */
  roadTunnel: Uint8Array;
  /** 1 where a tile hosts a shared node between ground and elevated segments (ramp link; layer switch allowed). */
  roadLink: Uint8Array;
  /** Deck height per tile for bridge tiles, NaN elsewhere. Vehicles and the road mesh read this. */
  deckH: Float32Array;
  segments: RoadSegment[];
  nextSegmentId: number;
  /** Junction graph: every segment end attaches to one of these. Rebuilt on load. */
  nodes: RoadNode[];
  nextNodeId: number;
  /** Bumped by every structural road-graph mutation; derived caches key off this. */
  graphRevision: number;
  /** Unit travel direction per tile for one-way roads (0,0 = two-way/none), derived in rebuildRoadRaster. */
  dirX: Float32Array;
  dirZ: Float32Array;
  /** Roundabout islands stamped by the roundabout tool. */
  roundabouts: Roundabout[];
  stops: Stop[];
  lines: TransitLine[];
  nextTransitId: number;
  zone: Uint8Array;
  /** Building level per tile, 0 = no building, 1..3. */
  level: Uint8Array;
  /** Persistent lots (M17); rebuilt from zoning when absent. Serialised. */
  lots: WorldLot[];
  nextLotId: number;
  /** Lot id per tile, -1 when the tile belongs to no lot. Derived, not saved. */
  lotAt: Int32Array;
  /** Bumped on road edits (frontage cache key). Derived, not saved. */
  roadRevision: number;
  /** Bumped on zone/facility edits (block cache key). Derived, not saved. */
  zoneRevision: number;
  /** Set by tools; the next sync rebuilds `lots` from the tile arrays. */
  lotsDirty: boolean;
  /** Oriented zoning (docs/process/05-oriented-lots.md): authoritative when "oriented"; the tile arrays stay a mirror. */
  zoning: ZoningMode;
  /** Derived cache of zone blocks, rebuilt from segments + saved cell state. */
  cells?: ZoneBlockSet;
  /** Authoritative lots in the oriented mode. */
  olots?: OrientedLot[];
  nextOLotId: number;
  /** Bumped by facility and bulldoze edits so cell validity can be recomputed. */
  obstacleRevision: number;
  /** Facility type per tile (FAC.*). */
  facility: Uint8Array;
  /** Top-left anchors for multi-tile facilities. 1x1 facilities remain tile-only. */
  facilityAnchors?: FacilityAnchor[];
  /** Bitmask of COVER.* services reaching each tile. */
  cover: Uint16Array;
  /** Bitmask of NET.* floods reaching each road tile (see networks.ts); 0 elsewhere. */
  nets: Uint8Array;
  /** 0..100 per tile, derived from services, parks and nearby industry. */
  landValue: Uint8Array;
  /** Bumped when any land value changes (overlay refresh). */
  lvRevision: number;
  coverageDirty: boolean;
  /** 1 where a road tile is connected to the map entry. */
  connected: Uint8Array;
  /** First of three pre-built road tiles on a map edge; (dx, dy) points inward. */
  entry: { x: number; y: number; dx: number; dy: number };
  /** Bumped on any change; renderers rebuild when it moves. */
  revision: number;
  connectivityDirty: boolean;
}

export const idx = (w: World, x: number, y: number) => y * w.size + x;
export const cidx = (w: World, x: number, y: number) => y * (w.size + 1) + x;
export const inBounds = (w: World, x: number, y: number) =>
  x >= 0 && y >= 0 && x < w.size && y < w.size;

function valueNoise(size: number, cell: number, rng: () => number) {
  const n = Math.ceil(size / cell) + 2;
  const lat = new Float32Array(n * n);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  return (x: number, y: number) => {
    const gx = x / cell, gy = y / cell;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = lat[y0 * n + x0], b = lat[y0 * n + x0 + 1];
    const c = lat[(y0 + 1) * n + x0], d = lat[(y0 + 1) * n + x0 + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

export function tileHeight(w: World, x: number, y: number): number {
  const s = w.size + 1;
  return (
    (w.heights[y * s + x] + w.heights[y * s + x + 1] +
      w.heights[(y + 1) * s + x] + w.heights[(y + 1) * s + x + 1]) / 4
  );
}

/** Land is buildable when no corner is under water. */
export function isLand(w: World, x: number, y: number): boolean {
  if (!inBounds(w, x, y)) return false;
  const s = w.size + 1;
  const h = w.heights;
  return (
    h[y * s + x] >= 0.05 && h[y * s + x + 1] >= 0.05 &&
    h[(y + 1) * s + x] >= 0.05 && h[(y + 1) * s + x + 1] >= 0.05
  );
}

/** Height range and shaping per terrain preset. `scale` multiplies the noise, `bias` sets the sea level. */
const BIOME_SHAPE: Record<Biome, { scale: number; bias: number }> = {
  plains: { scale: 7, bias: 0.4 },
  forest: { scale: 7, bias: 0.4 },
  river: { scale: 6, bias: 0.4 },
  coast: { scale: 7, bias: 0.4 },
  mountain: { scale: 14, bias: 0.44 },
  desert: { scale: 5, bias: 0.34 },
};

export function generateWorld(size: number, seed: number, biome: Biome = "plains"): World {
  const rng = makeRng(seed);
  const n1 = valueNoise(size + 1, 32, rng);
  const n2 = valueNoise(size + 1, 16, rng);
  const n3 = valueNoise(size + 1, 8, rng);
  const s = size + 1;
  const heights = new Float32Array(s * s);
  const { scale, bias } = BIOME_SHAPE[biome];
  const phase = (seed % 97) / 15;
  const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const n = n1(x, y) * 0.6 + n2(x, y) * 0.28 + n3(x, y) * 0.12;
      let h = (n - bias) * scale;
      if (biome === "river") {
        // a meandering river across the north side, clear of the entry strip
        const path = size * 0.27 + Math.sin(x * 0.085 + phase) * size * 0.08 + Math.sin(x * 0.21 + phase * 2) * 1.6;
        const d = Math.abs(y - path);
        h = Math.min(h, (d - 3.4) * 0.9 - 0.1);
      } else if (biome === "coast") {
        // open sea along the far (east) edge
        h -= smooth((x - size * 0.6) / (size * 0.22)) * 8;
      }
      heights[y * s + x] = h;
    }
  }
  const world: World = {
    biome,
    size,
    heights,
    road: new Uint8Array(size * size),
    roadSurface: new Uint8Array(size * size),
    roadDeck: new Uint8Array(size * size),
    roadTunnel: new Uint8Array(size * size),
    roadLink: new Uint8Array(size * size),
    deckH: new Float32Array(size * size).fill(NaN),
    segments: [],
    nextSegmentId: 1,
    nodes: [],
    nextNodeId: 1,
    graphRevision: 1,
    dirX: new Float32Array(size * size),
    dirZ: new Float32Array(size * size),
    roundabouts: [],
    stops: [],
    lines: [],
    nextTransitId: 1,
    zone: new Uint8Array(size * size),
    level: new Uint8Array(size * size),
    lots: [],
    nextLotId: 1,
    lotAt: new Int32Array(size * size).fill(-1),
    roadRevision: 1,
    zoneRevision: 1,
    lotsDirty: true,
    zoning: "tiles",
    nextOLotId: 1,
    obstacleRevision: 1,
    facility: new Uint8Array(size * size),
    facilityAnchors: [],
    cover: new Uint16Array(size * size),
    nets: new Uint8Array(size * size),
    landValue: new Uint8Array(size * size),
    lvRevision: 1,
    coverageDirty: true,
    connected: new Uint8Array(size * size),
    entry: { x: 0, y: Math.floor(size / 2), dx: 1, dy: 0 },
    revision: 1,
    connectivityDirty: true,
  };
  // Guaranteed dry, flat landing strip with a pre-built entry road.
  const ey = world.entry.y;
  for (let y = ey - 1; y <= ey + 2; y++) {
    for (let x = 0; x <= 5; x++) heights[y * s + x] = 0.35;
  }
  const entryTiles = entryRoadTiles(world);
  const na = world.nextNodeId++, nb = world.nextNodeId++;
  world.nodes.push(
    { id: na, x: 0.5, z: ey + 0.5, segs: [world.nextSegmentId] },
    { id: nb, x: 2.5, z: ey + 0.5, segs: [world.nextSegmentId] },
  );
  world.segments.push({
    id: world.nextSegmentId++, type: 1, fixed: true, tiles: entryTiles,
    pts: [{ x: 0.5, z: ey + 0.5 }, { x: 2.5, z: ey + 0.5 }],
    a: na, b: nb,
  });
  rebuildRoadRaster(world);
  return world;
}

/** The three road tiles of the entry, starting on the map edge. */
export function entryRoadTiles(w: World): number[] {
  const { x, y, dx, dy } = w.entry;
  return [0, 1, 2].map((k) => idx(w, x + dx * k, y + dy * k));
}

export function isEntryTile(w: World, x: number, y: number): boolean {
  const { x: ex, y: ey, dx, dy } = w.entry;
  for (let k = 0; k < 3; k++) if (x === ex + dx * k && y === ey + dy * k) return true;
  return false;
}

/** Layer of a tile: 0 ground, 1 bridge deck, 2 tunnel. */
export type RoadLayer = 0 | 1 | 2;
export const layerClass = (w: World, tile: number, layer: RoadLayer): number =>
  layer === 0 ? w.roadSurface[tile] : layer === 1 ? w.roadDeck[tile] : w.roadTunnel[tile];

/** Recompute which road tiles are reachable from the entry (layer-aware BFS). */
export function updateConnectivity(w: World): void {
  w.connected.fill(0);
  w.connectivityDirty = false;
  const start = idx(w, w.entry.x, w.entry.y);
  if (!w.road[start]) return;
  const n = w.size * w.size;
  const seen = new Uint8Array(n * 3);
  const queue: number[] = [];
  const push = (tile: number, layer: RoadLayer) => {
    const k = tile * 3 + layer;
    if (seen[k] || !layerClass(w, tile, layer)) return;
    seen[k] = 1;
    queue.push(k);
    w.connected[tile] = 1;
  };
  // Entry is a ground road.
  if (w.roadSurface[start]) push(start, 0);
  else if (w.roadDeck[start]) push(start, 1);
  else if (w.roadTunnel[start]) push(start, 2);
  while (queue.length) {
    const k = queue.pop()!;
    const tile = (k / 3) | 0, layer = (k % 3) as RoadLayer;
    const x = tile % w.size, y = (tile / w.size) | 0;
    if (w.roadLink[tile]) {
      for (const l of [0, 1, 2] as RoadLayer[]) if (l !== layer) push(tile, l);
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(w, nx, ny)) continue;
      push(idx(w, nx, ny), layer);
    }
  }
}

/** Is the tile touching a connected street or avenue? Highways carry traffic but serve no lots. */
export function isServed(w: World, x: number, y: number): boolean {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(w, nx, ny)) continue;
    const j = idx(w, nx, ny);
    if (w.connected[j] && w.road[j] !== ROAD.HIGHWAY) return true;
  }
  return false;
}

/** Level the four corners of a tile to its mean height (simple terraforming). */
export function flattenTile(w: World, x: number, y: number): void {
  const s = w.size + 1;
  const h = tileHeight(w, x, y);
  w.heights[y * s + x] = h;
  w.heights[y * s + x + 1] = h;
  w.heights[(y + 1) * s + x] = h;
  w.heights[(y + 1) * s + x + 1] = h;
}

/** True if any tile within `r` (Chebyshev) of x,y is not land. */
export function nearWater(w: World, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(w, nx, ny) && !isLand(w, nx, ny)) return true;
    }
  }
  return false;
}

/** Recompute which services reach each tile (networks for power/water/sewage, radius for the rest). */
export function updateCoverage(w: World): void {
  w.cover.fill(0);
  w.nets.fill(0);
  w.coverageDirty = false;
  if (w.connectivityDirty) updateConnectivity(w);
  for (const stop of w.stops) {
    if (stop.kind !== "bus") continue;
    const sx = stop.tile % w.size, sy = (stop.tile / w.size) | 0;
    const r = BUS_STOP_RADIUS;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const nx = sx + dx, ny = sy + dy;
        if (inBounds(w, nx, ny)) w.cover[idx(w, nx, ny)] |= COVER.TRANSIT;
      }
    }
  }
  updateNetworkCoverage(w);
  const linkedUtilityTiles = new Set(facilityLinks(w).map((l) => l.facility));
  for (let y = 0; y < w.size; y++) {
    for (let x = 0; x < w.size; x++) {
      const i = idx(w, x, y);
      const f = w.facility[i] as FacilityType;
      if (!f) continue;
      // Power, water and sewage cover through the road network, not by radius.
      if (f === FAC.POWER || f === FAC.WATER || f === FAC.SEWAGE || f === FAC.SUBSTATION) continue;
      const anchor = facilityAnchorAt(w, i);
      if (anchor && (anchor.x !== x || anchor.y !== y)) continue;
      const info = FACILITY_INFO[f as FacilityKind];
      const r = info.radius;
      const cx = anchor ? anchor.x + anchor.w / 2 : x;
      const cy = anchor ? anchor.y + anchor.h / 2 : y;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const nx = Math.floor(cx + dx), ny = Math.floor(cy + dy);
          if (inBounds(w, nx, ny)) w.cover[idx(w, nx, ny)] |= info.bit;
        }
      }
      if (anchor) for (let ay = anchor.y; ay < anchor.y + anchor.h; ay++) for (let ax = anchor.x; ax < anchor.x + anchor.w; ax++) w.cover[idx(w, ax, ay)] |= info.bit;
    }
  }
  for (const i of linkedUtilityTiles) {
    const a = facilityAnchorAt(w, i);
    if (a) for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) w.cover[idx(w, x, y)] |= w.cover[i];
  }
}

/**
 * Land value per tile. Services and parks raise it, nearby industry lowers it.
 * Returns true when any value changed.
 */
export function updateLandValue(w: World): boolean {
  const BONUS: [number, number][] = [
    [COVER.PARK, 18], [COVER.CULTURE, 10], [COVER.TRANSIT, 8], [COVER.HEALTH, 8], [COVER.EDU, 8], [COVER.POLICE, 6], [COVER.FIRE, 6],
    [COVER.SEWAGE, 5], [COVER.GARBAGE, 4], [COVER.POWER, 4], [COVER.WATER, 4],
  ];
  let changed = false;
  for (let y = 0; y < w.size; y++) {
    for (let x = 0; x < w.size; x++) {
      const i = idx(w, x, y);
      let v = 25;
      const c = w.cover[i];
      for (const [bit, add] of BONUS) if (c & bit) v += add;
      if (isServed(w, x, y)) v += 6;
      if (w.zone[i] !== ZONE.IND) {
        let ind = 0;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const nx = x + dx, ny = y + dy;
            if (!inBounds(w, nx, ny)) continue;
            const j = idx(w, nx, ny);
            if (w.zone[j] === ZONE.IND && w.level[j] > 0) ind++;
          }
        }
        v -= Math.min(30, ind * 5);
      }
      v = Math.max(0, Math.min(100, v));
      if (w.landValue[i] !== v) { w.landValue[i] = v; changed = true; }
    }
  }
  if (changed) w.lvRevision++;
  return changed;
}

/** Points along a segment's centreline, about `step` apart, endpoints included. */
export function curvePoints(pts: Pt[], step = 0.25): Pt[] {
  const [a, b, c] = pts.length === 3 ? [pts[0], pts[1], pts[2]] : [pts[0], null, pts[1]];
  const len = b
    ? Math.hypot(b.x - a.x, b.z - a.z) + Math.hypot(c.x - b.x, c.z - b.z)
    : Math.hypot(c.x - a.x, c.z - a.z);
  const n = Math.max(1, Math.ceil(len / step));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(b
      ? { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, z: u * u * a.z + 2 * u * t * b.z + t * t * c.z }
      : { x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t });
  }
  return out;
}

/** Approximate centreline length in tiles. */
export function segmentLength(pts: Pt[]): number {
  const p = curvePoints(pts, 0.5);
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
  return l;
}

/**
 * Grid tiles a road of `type` along `pts` occupies. Width-1 roads are kept
 * 4-connected so they stay connected under 4-neighbour rules.
 */
export function rasterizeRoad(w: World, type: RoadType, pts: Pt[]): { tiles: number[]; outOfBounds: boolean } {
  const width = ROAD_TILE_WIDTH[type];
  const seen = new Set<number>();
  const tiles: number[] = [];
  let oob = false;
  const add = (x: number, y: number) => {
    if (!inBounds(w, x, y)) { oob = true; return; }
    const i = idx(w, x, y);
    if (!seen.has(i)) { seen.add(i); tiles.push(i); }
  };
  let prev: { x: number; y: number } | null = null;
  for (const p of curvePoints(pts)) {
    if (width === 1) {
      const x = Math.floor(p.x), y = Math.floor(p.z);
      if (prev && prev.x !== x && prev.y !== y) add(x, prev.y);
      add(x, y);
      prev = { x, y };
    } else {
      const x0 = Math.floor(p.x - width / 2 + 0.5), y0 = Math.floor(p.z - width / 2 + 0.5);
      for (let dy = 0; dy < width; dy++) for (let dx = 0; dx < width; dx++) add(x0 + dx, y0 + dy);
    }
  }
  return { tiles, outOfBounds: oob };
}

/** Rebuild the per-tile road class from the segment list. */
export function rebuildRoadRaster(w: World): void {
  w.road.fill(0);
  w.roadSurface.fill(0);
  w.roadDeck.fill(0);
  w.roadTunnel.fill(0);
  w.roadLink.fill(0);
  w.deckH.fill(NaN);
  for (const seg of w.segments) {
    const elev = segElevation(seg);
    for (const t of seg.tiles) {
      if (w.road[t] < seg.type) w.road[t] = seg.type;
      if (elev === "ground" && w.roadSurface[t] < seg.type) w.roadSurface[t] = seg.type;
      else if (elev === "bridge" && w.roadDeck[t] < seg.type) w.roadDeck[t] = seg.type;
      else if (elev === "tunnel" && w.roadTunnel[t] < seg.type) w.roadTunnel[t] = seg.type;
    }
  }
  // Ramp links: nodes shared by ground and elevated segments allow layer switches.
  {
    const elevOf = new Map<number, Elevation>();
    for (const seg of w.segments) elevOf.set(seg.id, segElevation(seg));
    for (const node of w.nodes) {
      let hasGround = false, hasElev = false;
      for (const sid of node.segs) {
        const e = elevOf.get(sid);
        if (e === "ground") hasGround = true;
        else if (e) hasElev = true;
      }
      if (hasGround && hasElev) {
        const tx = Math.floor(node.x), ty = Math.floor(node.z);
        if (inBounds(w, tx, ty)) w.roadLink[idx(w, tx, ty)] = 1;
      }
    }
  }
  for (const seg of w.segments) {
    if (segElevation(seg) === "bridge") stampDeck(w, seg);
  }
  // One-way travel direction per tile, sampled along each one-way segment's
  // centreline in its travel direction (a→b, flipped when dir is -1).
  w.dirX.fill(0);
  w.dirZ.fill(0);
  for (const seg of w.segments) {
    if (!seg.oneWay) continue;
    const sign = seg.dir === -1 ? -1 : 1;
    const width = ROAD_TILE_WIDTH[seg.type];
    const pts = curvePoints(seg.pts, 0.25);
    for (let i = 1; i < pts.length; i++) {
      const vx = (pts[i].x - pts[i - 1].x) * sign, vz = (pts[i].z - pts[i - 1].z) * sign;
      const l = Math.hypot(vx, vz);
      if (l < 1e-9) continue;
      // Paint the direction over the segment's full raster width, not just
      // the centreline row, or wide one-way avenues leak along their far lane.
      for (const p of [pts[i - 1], pts[i]]) {
        if (width === 1) {
          const tx = Math.floor(p.x), ty = Math.floor(p.z);
          if (!inBounds(w, tx, ty)) continue;
          const t = ty * w.size + tx;
          w.dirX[t] = vx / l;
          w.dirZ[t] = vz / l;
        } else {
          const x0 = Math.floor(p.x - width / 2 + 0.5), y0 = Math.floor(p.z - width / 2 + 0.5);
          for (let dy = 0; dy < width; dy++) for (let dx = 0; dx < width; dx++) {
            const tx = x0 + dx, ty = y0 + dy;
            if (!inBounds(w, tx, ty)) continue;
            const t = ty * w.size + tx;
            w.dirX[t] = vx / l;
            w.dirZ[t] = vz / l;
          }
        }
      }
    }
  }
  w.connectivityDirty = true;
}

/** A surface (ground-level) road tile: the only kind that serves lots and carries pipes. */
export const isSurfaceRoad = (w: World, i: number): boolean => w.roadSurface[i] !== 0;
/** True when a bridge deck occupies the tile (it may share the tile with a ground road). */
export const hasDeck = (w: World, i: number): boolean => w.roadDeck[i] !== 0;
/** True when a tunnel occupies the tile (it may share the tile with a ground road). */
export const hasTunnel = (w: World, i: number): boolean => w.roadTunnel[i] !== 0;
/** A bridge-deck tile: connected for traffic, but not a surface road. */
export const isBridgeTile = (w: World, i: number): boolean =>
  w.roadDeck[i] !== 0 && w.roadSurface[i] === 0;
/** A tunnel tile: connected for traffic, with buildable ground above. */
export const isTunnelTile = (w: World, i: number): boolean =>
  w.roadTunnel[i] !== 0 && w.roadSurface[i] === 0;
/** Tiles a building cannot share: surface roads and bridge decks (tunnels run underneath). */
export const blocksBuilding = (w: World, i: number): boolean =>
  w.road[i] !== 0 && !isTunnelTile(w, i);

// ------------------------------------------------------------ bridge deck profile

/** Deck clearance above the higher shore. */
export const BRIDGE_DECK_LIFT = 0.5;
/** Ramp length at each end of the deck, in tiles (extended when the slope would be steep). */
export const BRIDGE_RAMP_TILES = 2;
/** Gentlest cap on the ramp gradient (rise per tile). */
export const BRIDGE_MAX_SLOPE = 0.3;

export interface DeckProfile {
  length: number;
  y0: number;
  y1: number;
  deck: number;
  ramp0: number;
  ramp1: number;
}

/** Level deck at max(shore heights) + lift, with smooth ramps up from each shore. */
export function bridgeProfile(length: number, y0: number, y1: number): DeckProfile {
  const deck = Math.max(y0, y1) + BRIDGE_DECK_LIFT;
  const half = Math.max(0, length / 2);
  // Each ramp is at least 2 tiles, extended so the gradient stays gentle.
  const ramp0 = Math.min(half, Math.max(BRIDGE_RAMP_TILES, (deck - y0) / BRIDGE_MAX_SLOPE));
  const ramp1 = Math.min(half, Math.max(BRIDGE_RAMP_TILES, (deck - y1) / BRIDGE_MAX_SLOPE));
  return { length, y0, y1, deck, ramp0, ramp1 };
}

const smooth01 = (u: number): number => {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
};

/** Deck height at arclength s from the start of the span. */
export function deckYAt(p: DeckProfile, s: number): number {
  const c = Math.max(0, Math.min(p.length, s));
  const up = p.y0 + (p.deck - p.y0) * (p.ramp0 <= 0 ? 1 : smooth01(c / p.ramp0));
  const dn = p.y1 + (p.deck - p.y1) * (p.ramp1 <= 0 ? 1 : smooth01((p.length - c) / p.ramp1));
  return Math.min(up, dn);
}

export interface DeckSampler {
  length: number;
  yAt(s: number): number;
  /** Arclength of the centreline point nearest (x, z). Linear scan: rebuild-time use only. */
  sAt(x: number, z: number): number;
  pos(s: number): Pt;
}

/** Deck heights along one bridge centreline, sampled from the terrain at its ends. */
export function makeDeckSampler(w: World, pts: Pt[]): DeckSampler {
  const raw = curvePoints(pts, 0.25);
  const cum: number[] = [0];
  for (let i = 1; i < raw.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z));
  }
  const length = cum[cum.length - 1];
  const prof = bridgeProfile(length, heightAt(w, pts[0].x, pts[0].z), heightAt(w, pts[pts.length - 1].x, pts[pts.length - 1].z));
  const at = (s: number): { i: number; u: number } => {
    const c = Math.max(0, Math.min(length, s));
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < c) i++;
    const span = Math.max(1e-9, cum[i + 1] - cum[i]);
    return { i, u: (c - cum[i]) / span };
  };
  return {
    length,
    yAt: (s: number) => deckYAt(prof, s),
    sAt: (x: number, z: number) => {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < raw.length; i++) {
        const d = (raw[i].x - x) * (raw[i].x - x) + (raw[i].z - z) * (raw[i].z - z);
        if (d < bd) { bd = d; bi = i; }
      }
      return cum[bi];
    },
    pos: (s: number) => {
      const { i, u } = at(s);
      const a = raw[i], b = raw[Math.min(raw.length - 1, i + 1)];
      return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
    },
  };
}

/** Write the deck height into every raster tile of one bridge segment. */
function stampDeck(w: World, seg: RoadSegment): void {
  const sampler = makeDeckSampler(w, seg.pts);
  for (const t of seg.tiles) {
    const y = sampler.yAt(sampler.sAt((t % w.size) + 0.5, ((t / w.size) | 0) + 0.5));
    if (Number.isNaN(w.deckH[t]) || y > w.deckH[t]) w.deckH[t] = y;
  }
}

/** Terrain surface height at a ground point (bilinear over the corner grid). */
export function heightAt(w: World, x: number, z: number): number {
  const s = w.size + 1;
  const fx = Math.min(w.size - 1e-6, Math.max(0, x)), fz = Math.min(w.size - 1e-6, Math.max(0, z));
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = fx - x0, tz = fz - z0;
  const h = w.heights;
  const a = h[z0 * s + x0], b = h[z0 * s + x0 + 1], c = h[(z0 + 1) * s + x0], d = h[(z0 + 1) * s + x0 + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

/**
 * Level the ground under a set of tiles: every corner takes the average of the
 * tile means around it, so neighbouring road tiles meet without steps.
 */
export function levelTiles(w: World, tiles: number[]): void {
  const s = w.size + 1;
  const sum = new Map<number, number>();
  const cnt = new Map<number, number>();
  for (const t of tiles) {
    const x = t % w.size, y = (t / w.size) | 0;
    const m = tileHeight(w, x, y);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const c = (y + dy) * s + x + dx;
      sum.set(c, (sum.get(c) ?? 0) + m);
      cnt.set(c, (cnt.get(c) ?? 0) + 1);
    }
  }
  for (const [c, v] of sum) w.heights[c] = v / cnt.get(c)!;
}
