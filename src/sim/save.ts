import {
  CityState, newCity, refreshDerived,
} from "./sim";
import { lotPose } from "./orientedlots";
import { zoneHooks } from "./zonehooks";
import { cellIndex, type MigrationReport, type ZoneBlockSet } from "./zoneblocks";
import { adoptNodes } from "./roads";
import type { OrientedLot, Side } from "./zonecells";
import { landmarkById, type LandmarkId } from "./landmarks";
import {
  BIOMES, FAC, Biome, FacilityAnchor, FacilityKind, facilityFootprint, generateWorld, idx, inBounds,
  rebuildRoadRaster, RoadSegment, Roundabout, Stop, TransitLine, World, WorldLot,
} from "./world";

export const SAVE_VERSION = 2;

interface SaveFileV1 {
  v: number;
  seed: number;
  /** Terrain preset; absent in older saves, which were all plains. */
  biome?: Biome;
  size: number;
  day: number;
  money: number;
  taxRate: number;
  population: number;
  happiness: number;
  fires: number;
  monthIncome: number;
  monthExpenses: number;
  lastMonth: { income: number; expenses: number };
  heights: string;
  zone: string;
  level: string;
  facility: string;
  facilityAnchors?: FacilityAnchor[];
  segments: RoadSegment[];
  /** Roundabout islands; absent in saves from before the roundabout tool. */
  roundabouts?: Roundabout[];
  stops: Stop[];
  lines: TransitLine[];
  nextSegmentId: number;
  nextTransitId: number;
  /** Absent in pre-lot saves, whose lots are rebuilt from zoning on load. */
  lots?: WorldLot[];
  nextLotId?: number;
  /** dx/dy absent in older saves: the entry was always on the left edge. */
  entry: { x: number; y: number; dx?: number; dy?: number };
  /** Optional rollback/migration hint used by the zoning feature flag. */
  zoning?: "tiles" | "oriented";
}

interface SaveCell {
  seg: number;
  side: Side;
  block: number;
  rows: number;
  zone: string;
  level: string;
}

interface SaveOLot {
  id: number;
  seg: number;
  side: Side;
  block: number;
  row: number;
  col: number;
  w: number;
  d: number;
  zone: 1 | 2 | 3;
  level: 0 | 1 | 2 | 3 | 4 | 5;
  build?: number;
  construction?: import("./zonecells").ConstructionState;
  landmark?: LandmarkId;
}

interface SaveFileV2 extends Omit<SaveFileV1, "v" | "lots" | "nextLotId"> {
  v: 2;
  zoning: "tiles" | "oriented";
  cells: SaveCell[];
  lots: SaveOLot[];
  nextOLotId: number;
}

type SaveFile = SaveFileV1 | SaveFileV2;

function toB64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  let s: string;
  try {
    s = atob(b64);
  } catch {
    throw new SaveError("The save file is damaged");
  }
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Serialise only what the player created; everything else is derived on load. */
export function serialize(s: CityState): string {
  const w = s.world;
  const base = {
    seed: s.rngState,
    biome: w.biome,
    size: w.size,
    day: s.day,
    money: s.money,
    taxRate: s.taxRate,
    population: s.population,
    happiness: s.happiness,
    fires: s.fires,
    monthIncome: s.monthIncome,
    monthExpenses: s.monthExpenses,
    lastMonth: s.lastMonth,
    heights: toB64(new Uint8Array(w.heights.buffer, w.heights.byteOffset, w.heights.byteLength)),
    zone: toB64(w.zone),
    level: toB64(w.level),
    facility: toB64(w.facility),
    ...(w.facilityAnchors?.length ? { facilityAnchors: w.facilityAnchors } : {}),
    segments: w.segments,
    roundabouts: w.roundabouts,
    stops: w.stops,
    lines: w.lines,
    nextSegmentId: w.nextSegmentId,
    nextTransitId: w.nextTransitId,
    entry: w.entry,
  };
  if (w.zoning === "oriented") {
    const set = w.cells as unknown as ZoneBlockSet | undefined ?? zoneHooks.buildZoneBlocks(w);
    const cells: SaveCell[] = [];
    for (const b of set.blocks.values()) {
      let used = false;
      for (let i = 0; i < b.zone.length; i++) if (b.zone[i] || b.level[i]) { used = true; break; }
      if (!used) continue;
      cells.push({ seg: b.seg, side: b.side, block: b.block, rows: b.rows, zone: toB64(b.zone), level: toB64(b.level) });
    }
    const file: SaveFileV2 = {
      v: SAVE_VERSION,
      ...base,
      zoning: "oriented",
      cells,
      lots: (w.olots ?? []).map((l) => ({
        id: l.id, seg: l.seg, side: l.side, block: l.block, row: l.row, col: l.col,
        w: l.w, d: l.d, zone: l.zone as 1 | 2 | 3, level: l.level as 0 | 1 | 2 | 3 | 4 | 5,
        ...(l.build === undefined ? {} : { build: l.build }),
        ...(l.construction === undefined ? {} : { construction: l.construction }),
        ...(l.landmark === undefined ? {} : { landmark: l.landmark }),
      })),
      nextOLotId: w.nextOLotId,
    };
    return JSON.stringify(file);
  }
  const file: SaveFileV1 = {
    v: 1,
    ...base,
    zoning: "tiles",
    lots: w.lots,
    nextLotId: w.nextLotId,
  };
  return JSON.stringify(file);
}

export class SaveError extends Error {}

/** Everything a hand-edited or truncated save could break must fail here as a SaveError. */
function validateCommon(f: SaveFile, n: number): void {
  const bad = () => { throw new SaveError("The save file is damaged"); };
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const tile = (t: unknown) => Number.isInteger(t) && (t as number) >= 0 && (t as number) < n * n;
  for (const k of ["day", "money", "taxRate", "population", "happiness", "fires", "monthIncome", "monthExpenses", "nextSegmentId", "nextTransitId"] as const) {
    if (!finite(f[k])) bad();
  }
  if (!f.entry || !finite(f.entry.x) || !finite(f.entry.y)) bad();
  if (!f.lastMonth || !finite(f.lastMonth.income) || !finite(f.lastMonth.expenses)) bad();
  if (!Array.isArray(f.segments) || !Array.isArray(f.stops) || !Array.isArray(f.lines)) bad();
  const segIds = new Set<number>();
  for (const seg of f.segments) {
    if (!seg || !Number.isInteger(seg.id) || seg.id < 1 || segIds.has(seg.id)) bad();
    segIds.add(seg.id);
    if (![1, 2, 3, 4, 5].includes(seg.type) || !Array.isArray(seg.tiles) || !Array.isArray(seg.pts)) bad();
    if (seg.elevation !== undefined && seg.elevation !== "ground" && seg.elevation !== "bridge" && seg.elevation !== "tunnel") bad();
    if (seg.pts.length < 2 || seg.pts.length > 3 || seg.tiles.length > n * n) bad();
    if (!seg.tiles.every(tile)) bad();
    if (!seg.pts.every((p) => p && finite(p.x) && finite(p.z))) bad();
    if (seg.oneWay !== undefined && typeof seg.oneWay !== "boolean") bad();
    if (seg.dir !== undefined && seg.dir !== 1 && seg.dir !== -1) bad();
  }
  if (f.roundabouts !== undefined) {
    if (!Array.isArray(f.roundabouts)) bad();
    for (const r of f.roundabouts) {
      if (!r || !finite(r.x) || !finite(r.z) || !finite(r.r) || r.r <= 0 || r.r > 8) bad();
    }
  }
  const stopIds = new Set<number>();
  for (const st of f.stops) {
    if (!st || !tile(st.tile) || (st.kind !== "bus" && st.kind !== "metro" && st.kind !== "train") || !finite(st.id)) bad();
    if (stopIds.has(st.id)) bad();
    stopIds.add(st.id);
  }
  const lineIds = new Set<number>();
  for (const l of f.lines) {
    if (!l || lineIds.has(l.id)) bad();
    lineIds.add(l.id);
  }
  for (const l of f.lines) {
    if (!l || !Array.isArray(l.stops) || !l.stops.every((id) => stopIds.has(id))) bad();
    if (!finite(l.vehicles) || l.vehicles < 0 || l.vehicles > 64) bad();
  }
}

function validateV1Lots(f: SaveFileV1, n: number): void {
  const bad = () => { throw new SaveError("The save file is damaged"); };
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (f.lots !== undefined) {
    if (!Array.isArray(f.lots) || f.lots.length > n * n || !finite(f.nextLotId)) bad();
    const lotIds = new Set<number>();
    const taken = new Uint8Array(n * n);
    for (const l of f.lots) {
      if (!l || !Number.isInteger(l.id) || l.id < 1 || lotIds.has(l.id)) bad();
      lotIds.add(l.id);
      for (const k of ["x", "y", "w", "h"] as const) if (!Number.isInteger(l[k])) bad();
      if (l.x < 0 || l.y < 0 || l.w < 1 || l.h < 1 || l.w > 4 || l.h > 4 || l.x + l.w > n || l.y + l.h > n) bad();
      if (!l.facing || ![-1, 0, 1].includes(l.facing.dx) || ![-1, 0, 1].includes(l.facing.dy)) bad();
      if (![1, 2, 3].includes(l.zone) || ![0, 1, 2, 3, 4, 5].includes(l.level)) bad();
      if (l.construction !== undefined && (!l.construction || !["planned", "excavation", "structure", "finishing", "complete", "paused", "upgrading"].includes(l.construction.state) || !finite(l.construction.progress) || l.construction.progress < 0 || l.construction.progress > 1 || !finite(l.construction.duration) || l.construction.duration <= 0)) bad();
      if (l.depthFromRoad !== -1 && (l.depthFromRoad < 0 || l.depthFromRoad > 3)) bad();
      // footprints must not overlap
      for (let y = l.y; y < l.y + l.h; y++) for (let x = l.x; x < l.x + l.w; x++) {
        if (taken[y * n + x]) bad();
        taken[y * n + x] = 1;
      }
    }
  }
}

function validateV2Oriented(f: SaveFileV2): void {
  const bad = () => { throw new SaveError("The save file is damaged"); };
  if (!Array.isArray(f.cells) || !Array.isArray(f.lots) || !Number.isFinite(f.nextOLotId)) bad();
  const segIds = new Set(f.segments.map((s) => s.id));
  const cells = new Map<string, SaveCell>();
  for (const c of f.cells) {
    if (!c || !segIds.has(c.seg) || (c.side !== -1 && c.side !== 1) || !Number.isInteger(c.block) || c.block < 0) bad();
    if (!Number.isInteger(c.rows) || c.rows < 1 || c.rows > 8) bad();
    const key = `${c.seg}:${c.side}:${c.block}`;
    if (cells.has(key)) bad();
    cells.set(key, c);
    const zone = fromB64(c.zone), level = fromB64(c.level);
    if (zone.length !== c.rows * 4 || level.length !== c.rows * 4) bad();
    if (zone.some((v) => v > 3) || level.some((v) => v > 5)) bad();
  }
  const lotIds = new Set<number>();
  const taken = new Set<string>();
  for (const l of f.lots) {
    if (!l || !Number.isInteger(l.id) || l.id < 1 || lotIds.has(l.id)) bad();
    lotIds.add(l.id);
    if (l.side !== -1 && l.side !== 1) bad();
    const c = cells.get(`${l.seg}:${l.side}:${l.block}`);
    if (!c) bad();
    for (const k of ["row", "col", "w", "d"] as const) if (!Number.isInteger(l[k])) bad();
    if (l.row < 0 || l.col < 0 || l.w < 1 || l.d < 1 || l.w > 4 || l.d > 4 || l.row + l.w > c!.rows || l.col + l.d > 4) bad();
    if (![1, 2, 3].includes(l.zone) || ![0, 1, 2, 3, 4, 5].includes(l.level)) bad();
    if (l.build !== undefined && (!Number.isFinite(l.build) || l.build < 0 || l.build > 1)) bad();
      if (l.construction !== undefined && (!l.construction || !["planned", "excavation", "structure", "finishing", "complete", "paused", "upgrading"].includes(l.construction.state) || !Number.isFinite(l.construction.progress) || l.construction.progress < 0 || l.construction.progress > 1 || !Number.isFinite(l.construction.duration) || l.construction.duration <= 0)) bad();
      if (l.landmark !== undefined && typeof l.landmark !== "string") bad();
    for (let row = l.row; row < l.row + l.w; row++) for (let col = l.col; col < l.col + l.d; col++) {
      const key = `${l.seg}:${l.side}:${l.block}:${row}:${col}`;
      if (taken.has(key)) bad();
      taken.add(key);
    }
  }
}

/** Everything a hand-edited or truncated save could break must fail here as a SaveError. */
function validateStructure(f: SaveFile, n: number): void {
  validateCommon(f, n);
  if (f.v === 2) validateV2Oriented(f as SaveFileV2);
  else validateV1Lots(f as SaveFileV1, n);
}

function validateFacilityAnchors(w: World): void {
  const bad = () => { throw new SaveError("The save file is damaged"); };
  const anchors = w.facilityAnchors ?? [];
  if (!Array.isArray(anchors)) bad();
  const taken = new Uint8Array(w.size * w.size);
  const anchorKeys = new Set<string>();
  for (const a of anchors) {
    if (!a || !Number.isInteger(a.x) || !Number.isInteger(a.y) || !Number.isInteger(a.w) || !Number.isInteger(a.h)) bad();
    if (!Number.isInteger(a.kind) || a.kind <= FAC.NONE || a.kind > FAC.FIRE_HQ) bad();
    const fp = facilityFootprint(a.kind as FacilityKind);
    if (a.w !== fp || a.h !== fp || fp === 1) bad();
    if (!inBounds(w, a.x, a.y) || a.x + a.w > w.size || a.y + a.h > w.size) bad();
    const key = `${a.x}:${a.y}`;
    if (anchorKeys.has(key)) bad();
    anchorKeys.add(key);
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = idx(w, x, y);
      if (taken[i] || w.facility[i] !== a.kind) bad();
      taken[i] = 1;
    }
  }
}

function copySavedCells(f: SaveFileV2, set: ZoneBlockSet): void {
  for (const c of f.cells) {
    const b = set.blocks.get(`${c.seg}:${c.side}:${c.block}`);
    if (!b || b.rows !== c.rows) throw new SaveError("The save file is damaged");
    b.zone.set(fromB64(c.zone));
    b.level.set(fromB64(c.level));
  }
}

function hydrateSavedLots(f: SaveFileV2, set: ZoneBlockSet): OrientedLot[] {
  const lots: OrientedLot[] = [];
  for (const l of f.lots) {
    const b = set.blocks.get(`${l.seg}:${l.side}:${l.block}`);
    if (!b) throw new SaveError("The save file is damaged");
    const lot = { ...l, ...(landmarkById(l.landmark) ? {} : { landmark: undefined }), build: l.build ?? l.construction?.progress ?? 1, ...lotPose(b, l), tiles: [] };
    let invalidUnderCurrentRules = false;
    for (let row = lot.row; row < lot.row + lot.w; row++) for (let col = lot.col; col < lot.col + lot.d; col++) {
      const i = cellIndex(row, col);
      if (!b.valid[i]) { invalidUnderCurrentRules = true; continue; }
      if (b.zone[i] !== lot.zone || b.level[i] !== lot.level || b.lot[i] !== -1) {
        throw new SaveError("The save file is damaged");
      }
    }
    // Rule changes may invalidate a formerly legal cell.  This is a normal
    // migration condition, not corruption: discard the entire lot and clear
    // its persisted cells so replanning can fill the remaining legal space.
    if (invalidUnderCurrentRules) {
      for (let row = lot.row; row < lot.row + lot.w; row++) for (let col = lot.col; col < lot.col + lot.d; col++) {
        const i = cellIndex(row, col);
        b.zone[i] = 0;
        b.level[i] = 0;
        b.lot[i] = -1;
      }
      continue;
    }
    for (let row = lot.row; row < lot.row + lot.w; row++) for (let col = lot.col; col < lot.col + lot.d; col++) {
      const i = cellIndex(row, col);
      b.lot[i] = lot.id;
    }
    lots.push(lot);
  }
  return lots;
}

export function migrateV1Cells(w: import("./world").World): MigrationReport {
  const oldZone = new Uint8Array(w.zone);
  const oldLevel = new Uint8Array(w.level);
  adoptNodes(w);
  rebuildRoadRaster(w);
  const set = zoneHooks.buildZoneBlocks(w);
  const report: MigrationReport = { moved: 0, dropped: [], lotsBroken: [] };
  for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++) {
    const tile = y * w.size + x;
    if (!oldZone[tile]) continue;
    const ref = zoneHooks.nearestCell(set, x + 0.5, y + 0.5, 0.75);
    if (!ref) { report.dropped.push({ seg: -1, side: 1, block: -1, row: y, col: x }); continue; }
    const b = set.blocks.get(`${ref.seg}:${ref.side}:${ref.block}`)!;
    const i = cellIndex(ref.row, ref.col);
    if (b.zone[i]) { report.dropped.push(ref); continue; }
    b.zone[i] = oldZone[tile];
    b.level[i] = oldLevel[tile];
    report.moved++;
  }
  w.zoning = "oriented";
  w.cells = set as unknown as import("./world").World["cells"];
  return report;
}

export function deserialize(json: string): CityState {
  let f: SaveFile;
  try {
    f = JSON.parse(json) as SaveFile;
  } catch {
    throw new SaveError("The save file is damaged");
  }
  if (!f || typeof f !== "object" || (f.v !== 1 && f.v !== 2)) throw new SaveError("This save is from a different version");
  const n = f.size;
  if (!Number.isInteger(n) || n < 8 || n > 512) throw new SaveError("The save file is damaged");
  validateStructure(f, n);
  const biome: Biome = f.biome && BIOMES.includes(f.biome) ? f.biome : "plains";
  const s = newCity(f.seed, n, biome);
  const w = s.world;
  const heights = fromB64(f.heights);
  const bytes = (b64: string, len: number) => {
    const a = fromB64(b64);
    if (a.length !== len) throw new SaveError("The save file is damaged");
    return a;
  };
  if (heights.length !== (n + 1) * (n + 1) * 4) throw new SaveError("The save file is damaged");
  const hf = new Float32Array(heights.buffer, heights.byteOffset, heights.byteLength / 4);
  for (let i = 0; i < hf.length; i++) if (!Number.isFinite(hf[i])) throw new SaveError("The save file is damaged");
  w.heights.set(hf);
  w.zone.set(bytes(f.zone, n * n));
  w.level.set(bytes(f.level, n * n));
  w.facility.set(bytes(f.facility, n * n));
  if (w.zone.some((v) => v > 3) || w.level.some((v) => v > 5) || w.facility.some((v) => v > FAC.FIRE_HQ)) {
    throw new SaveError("The save file is damaged");
  }
  if (f.facilityAnchors !== undefined && !Array.isArray(f.facilityAnchors)) throw new SaveError("The save file is damaged");
  w.facilityAnchors = (f.facilityAnchors ?? []).map((a) => ({ x: a.x, y: a.y, kind: a.kind, w: a.w, h: a.h }));
  validateFacilityAnchors(w);
  w.segments = f.segments;
  w.roundabouts = f.roundabouts ?? [];
  w.stops = f.stops;
  w.lines = f.lines;
  // Counters must stay above every stored id, or the next road/line would reuse one.
  w.nextSegmentId = Math.max(f.nextSegmentId, ...f.segments.map((g) => g.id + 1), 1);
  w.nextTransitId = Math.max(f.nextTransitId, ...f.stops.map((g) => g.id + 1), ...f.lines.map((g) => g.id + 1), 1);
  if (f.lots !== undefined) {
    if (f.v === 2) {
      const f2 = f as SaveFileV2;
      if (f2.zoning === "oriented") {
        w.zoning = "oriented";
        // Validity reads the junction layouts, so the saved graph must be in place before the blocks are built:
        // the nodes left over from newCity() gave wrong junctions and the lot check then cleared valid zoned cells.
        adoptNodes(w);
        rebuildRoadRaster(w);
        const set = zoneHooks.buildZoneBlocks(w);
        copySavedCells(f2, set);
        w.cells = set as unknown as typeof w.cells;
        w.olots = hydrateSavedLots(f2, set);
        w.nextOLotId = Math.max(f2.nextOLotId, ...w.olots.map((l) => l.id + 1), 1);
        zoneHooks.rasterizeMirror(w, set, w.olots);
        // refreshDerived reconciles (05 §1.8): saved zone bytes on cells that are invalid under the current rules
        // are cleared, and kept lots whose footprint now touches a road are replanned. Valid lots keep their ids.
        w.lotsDirty = true;
      } else {
        w.lotsDirty = true;
      }
    } else {
    // Lots ride along with the save; the tile mirror still self-heals them in refreshDerived.
      const f1 = f as SaveFileV1;
      w.lots = f1.lots!;
      w.nextLotId = Math.max(f1.nextLotId!, ...f1.lots!.map((l) => l.id + 1), 1);
      w.lotAt.fill(-1);
      for (const l of w.lots) {
        for (let y = l.y; y < l.y + l.h; y++) {
          for (let x = l.x; x < l.x + l.w; x++) w.lotAt[y * n + x] = l.id;
        }
      }
      w.lotsDirty = false;
    }
  }
  if (f.v === 1 && f.zoning === "oriented") {
    migrateV1Cells(w);
    w.olots = [];
    w.lotsDirty = true;
  }
  w.entry = { x: f.entry.x, y: f.entry.y, dx: f.entry.dx ?? 1, dy: f.entry.dy ?? 0 };
  s.day = f.day;
  s.money = f.money;
  s.taxRate = f.taxRate;
  s.population = f.population;
  s.happiness = f.happiness;
  s.fires = f.fires;
  s.monthIncome = f.monthIncome;
  s.monthExpenses = f.monthExpenses;
  s.lastMonth = f.lastMonth;
  refreshDerived(s);
  return s;
}

/** One-line description for a save slot list. */
export function describe(s: CityState): { pop: number; money: number; day: number } {
  return { pop: Math.round(s.population), money: Math.round(s.money), day: s.day };
}

export { generateWorld };
