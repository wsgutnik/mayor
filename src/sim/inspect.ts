import { CityState, CAPACITY, lotDemographics, syncLots } from "./sim";
import { CATALOG, CatalogEntry, facilityEntry, pickLotEntry, thumbnailOf, tileHash } from "./catalog";
import { COVER, FAC, FACILITY_INFO, FacilityKind, ROAD_NAME, RoadType, ZONE, facilityFootprint, idx, inBounds } from "./world";

/** Utilities served through the road network have no radius to report. */
const NETWORKED = new Set<FacilityKind>([FAC.POWER, FAC.WATER, FAC.SEWAGE, FAC.SUBSTATION]);

/** What the inspector card shows about one tile. Plain data, so the UI needs no simulation knowledge. */
export interface TileInfo {
  kind: "building" | "facility" | "zone" | "road" | "empty";
  x: number;
  y: number;
  /** Portuguese and English names; the UI picks by language. */
  name: string;
  nameEn: string;
  /** Kit category such as R3, or "" when there is none. */
  category: string;
  use: string;
  useEn: string;
  /** Kit thumbnail URL, or null when the kit has no picture for this tile. */
  thumbnail: string | null;
  level: number;
  /** Residents for housing, jobs for work buildings, 0 otherwise. */
  people: number;
  peopleKind: "residents" | "jobs" | "none";
  landValue: number;
  /** Which services reach the tile. */
  services: { power: boolean; water: boolean; sewage: boolean; garbage: boolean; police: boolean; fire: boolean; health: boolean; education: boolean; culture: boolean; transit: boolean };
  /** Monthly upkeep for facilities. */
  upkeep: number;
  /** Radius in tiles for facilities, 0 otherwise. */
  radius: number;
  /** Facility footprint in tiles, formatted by the UI as NxN. */
  footprint: 1 | 2;
  construction?: { state: string; percent: number };
  demographics?: { children: number; working: number; seniors: number; workers: number };
}

const ROAD_PT: Record<number, string> = { 1: "Rua", 2: "Avenida", 3: "Autoestrada" };

/** Describe the tile at (x, y), or null when it is outside the map. */
export function describeTile(s: CityState, x: number, y: number): TileInfo | null {
  const w = s.world;
  if (!inBounds(w, x, y)) return null;
  const i = idx(w, x, y);
  const c = w.cover[i];
  const base: TileInfo = {
    kind: "empty", x, y, name: "Terreno livre", nameEn: "Open ground", category: "", use: "", useEn: "",
    thumbnail: null, level: 0, people: 0, peopleKind: "none", landValue: w.landValue[i],
    services: {
      power: !!(c & COVER.POWER), water: !!(c & COVER.WATER), sewage: !!(c & COVER.SEWAGE), garbage: !!(c & COVER.GARBAGE),
      police: !!(c & COVER.POLICE), fire: !!(c & COVER.FIRE), health: !!(c & COVER.HEALTH), education: !!(c & COVER.EDU),
      culture: !!(c & COVER.CULTURE), transit: !!(c & COVER.TRANSIT),
    },
    upkeep: 0, radius: 0,
    footprint: 1,
  };
  const fromEntry = (e: CatalogEntry): Partial<TileInfo> => ({
    name: e.name, nameEn: e.nameEn, category: e.category, use: e.use, useEn: e.useEn, thumbnail: thumbnailOf(e.n),
  });

  const fac = w.facility[i] as FacilityKind;
  if (fac) {
    const info = FACILITY_INFO[fac];
    const e = facilityEntry(fac);
    return {
      ...base, kind: "facility", ...(e ? fromEntry(e) : { name: info.name, nameEn: info.name }),
      upkeep: info.upkeep, radius: NETWORKED.has(fac) ? 0 : info.radius, footprint: facilityFootprint(fac),
    };
  }
  if (w.road[i]) {
    const t = w.road[i] as RoadType;
    return { ...base, kind: "road", name: ROAD_PT[t], nameEn: ROAD_NAME[t], category: `V${t}` };
  }
  const z = w.zone[i];
  if (z) {
    const lvl = w.level[i];
    const label = z === ZONE.RES ? ["Zona residencial", "Residential zone"] : z === ZONE.COM ? ["Zona comercial", "Commercial zone"] : ["Zona industrial", "Industrial zone"];
    if (!lvl) return { ...base, kind: "zone", name: label[0], nameEn: label[1] };
    // The look and headcount belong to the whole lot; fall back to the tile when it has none yet.
    syncLots(s);
    const lotId = w.lotAt[i];
    const lot = lotId >= 0 ? (w.zoning === "oriented" ? (w.olots ?? []).find((l) => l.id === lotId) : w.lots.find((l) => l.id === lotId)) : undefined;
    const area = lot ? ("tiles" in lot ? lot.w * lot.d : lot.w * lot.h) : 1;
    const anchorX = lot && "tiles" in lot ? lot.cx : lot ? lot.x : x;
    const anchorY = lot && "tiles" in lot ? lot.cz : lot ? lot.y : y;
    const entry = pickLotEntry(z, lvl, area, tileHash(Math.floor(anchorX) + 17, Math.floor(anchorY) + 29)).entry;
    const kind = z === ZONE.RES ? "res" : z === ZONE.COM ? "com" : "ind";
    const demo = lot ? lotDemographics(s, lot) : undefined;
    const cst = lot?.construction;
    return {
      ...base, kind: "building", ...(entry ? fromEntry(entry) : { name: label[0], nameEn: label[1] }),
      level: lvl, people: CAPACITY[kind][lvl] * area, peopleKind: z === ZONE.RES ? "residents" : "jobs",
      construction: { state: cst?.state ?? "complete", percent: Math.round((cst?.progress ?? 1) * 100) },
      demographics: demo ? { children: demo.residents.children, working: demo.residents.working, seniors: demo.residents.seniors, workers: demo.residents.working } : undefined,
    };
  }
  return base;
}

/** All 40 kit entries, for a catalogue screen. */
export const KIT_CATALOG = CATALOG;
