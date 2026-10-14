import type { CityRenderer } from "../render/scene";
import type { CityState } from "../sim/sim";
import { buildJunction } from "../sim/junction";
import { junctionDebugGeometry } from "../render/roads";
import {
  SHOWCASE_CASES, SHOWCASE_TITLES, ShowcaseCaseName, buildShowcaseWorld,
  fanTris, minTriAngleDeg, ringSelfIntersects, triArea2,
} from "../sim/showcase-cases";

/**
 * Dev-only junction showcase (?showcase=1): one deterministic world staging
 * the 12 hard cases on a fixed grid, each with a named camera preset.
 * Adopted from fable-cities' `?showcase=roads` idea (docs/process/08
 * section 4, G1): fixed coordinates and fixed cameras remove "which angle?"
 * from every visual report. Never loaded in normal play (main.ts imports
 * this module only when the query flag is present).
 */

export type ShowcaseZoom = "close" | "game";
export type ShowcaseTod = "day" | "night";
export type BuildingShowcaseCase = "building-house-2x2" | "building-shop-4x2" | "building-office-3x3";
const BUILDING_CASES: BuildingShowcaseCase[] = ["building-house-2x2", "building-shop-4x2", "building-office-3x3"];

/** Fable hours mapped to Mayor tod (0..1): low sun 16.2h, night 21h. */
export const SHOWCASE_TOD: Record<ShowcaseTod, number> = {
  day: 16.2 / 24,
  night: 21 / 24,
};

export interface ShowcasePreset {
  name: string;
  title: string;
  x: number;
  z: number;
  dist: number;
  pitch: number;
  yaw: number;
}

export interface ShowcaseStats {
  cases: number;
  segments: number;
  nodes: number;
  rings: number;
  nonSimpleRings: number;
  minFanArea: number;
  minFanAngleDeg: number;
  drawCalls: number;
  triangles: number;
}

export interface ShowcaseApi {
  /** Jump the camera to a case preset (default zoom: close). */
  go: (name: ShowcaseCaseName | BuildingShowcaseCase | "overview", zoom?: ShowcaseZoom) => ShowcasePreset;
  /** All preset names, cases first, then overview. */
  list: () => string[];
  /** Switch light: day (low sun) or night. */
  setTod: (tod: ShowcaseTod) => number;
  /** Headless diagnostics + renderer counters for the shot log. */
  stats: () => ShowcaseStats;
}

/** A real oriented-zoning fixture, rather than renderer-only placeholder lots.
 * It mirrors every parcel into World.zone/level/lotAt, so the showcase uses
 * exactly the same built-lot branch as a grown city. */
function stageBuildingLots(state: CityState): void {
  const specs = [
    { id: 9001, cx: 15, cz: 82, w: 2, d: 2, zone: 1 as const, level: 2 },
    { id: 9002, cx: 45, cz: 82, w: 4, d: 2, zone: 2 as const, level: 2 },
    { id: 9003, cx: 75, cz: 82, w: 3, d: 3, zone: 2 as const, level: 3 },
  ];
  const w = state.world;
  w.zoning = "oriented";
  w.olots = specs.map((s) => {
    const tiles: number[] = [];
    const x0 = Math.floor(s.cx - s.w / 2), z0 = Math.floor(s.cz - s.d / 2);
    for (let z = z0; z < z0 + s.d; z++) for (let x = x0; x < x0 + s.w; x++) {
      const i = z * w.size + x;
      tiles.push(i); w.zone[i] = s.zone; w.level[i] = s.level; w.lotAt[i] = s.id;
    }
    return { ...s, seg: 0, side: 1 as const, block: 0, row: 0, col: 0, build: 1, yaw: 0, tiles };
  });
  w.nextOLotId = 9004;
  w.zoneRevision++;
}

interface Deps {
  useCity: (next: CityState) => void;
  renderer: CityRenderer;
  setTod: (v: number) => void;
}

const CLOSE = { dist: 15, pitch: 0.85, yaw: 0.65 };
const GAME = { dist: 38, pitch: 0.9, yaw: 0.65 };

export function initShowcase(deps: Deps): ShowcaseApi {
  const { state, focusOf } = buildShowcaseWorld();
  stageBuildingLots(state);
  deps.useCity(state);
  deps.setTod(SHOWCASE_TOD.day);

  const presetFor = (name: ShowcaseCaseName | BuildingShowcaseCase | "overview", zoom: ShowcaseZoom): ShowcasePreset => {
    if (name === "overview") {
      return { name, title: "full grid", x: 49.5, z: 40.5, dist: 120, pitch: 1.3, yaw: 0 };
    }
    const staged: Record<BuildingShowcaseCase, { x: number; z: number; title: string }> = {
      "building-house-2x2": { x: 15, z: 82, title: "2×2 house" }, "building-shop-4x2": { x: 45, z: 82, title: "4×2 shop / industrial" }, "building-office-3x3": { x: 75, z: 82, title: "3×3 office / mixed" },
    };
    if (name in staged) { const f = staged[name as BuildingShowcaseCase]; const frame = zoom === "game" ? GAME : CLOSE; return { name, title: f.title, x: f.x, z: f.z, ...frame }; }
    const f = focusOf[name as ShowcaseCaseName];
    const frame = zoom === "game" ? GAME : CLOSE;
    return { name, title: SHOWCASE_TITLES[name as ShowcaseCaseName], x: f.x, z: f.z, ...frame };
  };

  const diagnose = (): Omit<ShowcaseStats, "cases" | "drawCalls" | "triangles"> => {
    const w = state.world;
    let rings = 0, nonSimple = 0, minArea = Infinity, minAngle = Infinity;
    for (const node of w.nodes) {
      const l = buildJunction(w, node.id);
      if (!l || l.arms.length < 2) continue;
      const d = junctionDebugGeometry(l);
      if (d.asphalt.length < 3) continue;
      rings++;
      if (ringSelfIntersects(d.asphalt)) nonSimple++;
      for (const t of fanTris(l.centre.x, l.centre.z, d.asphalt)) {
        minArea = Math.min(minArea, triArea2(t) / 2);
        minAngle = Math.min(minAngle, minTriAngleDeg(t));
      }
    }
    return {
      segments: w.segments.length, nodes: w.nodes.length, rings,
      nonSimpleRings: nonSimple, minFanArea: minArea, minFanAngleDeg: minAngle,
    };
  };

  const stats = (): ShowcaseStats => {
    const gl = (deps.renderer as unknown as {
      renderer?: { info: { render: { calls: number; triangles: number } } };
    }).renderer;
    const info = gl?.info.render;
    const out: ShowcaseStats = {
      cases: SHOWCASE_CASES.length, ...diagnose(),
      drawCalls: info?.calls ?? -1, triangles: info?.triangles ?? -1,
    };
    // G3 live count for the critic (docs/process/08 section 4). Guarded: the
    // test harness has no __city.
    const city = (globalThis as unknown as { __city?: { junctionDiagnostics?: unknown } }).__city;
    if (city) {
      city.junctionDiagnostics = {
        rings: out.rings, nonSimpleRings: out.nonSimpleRings,
        minFanArea: out.minFanArea, minFanAngleDeg: out.minFanAngleDeg,
      };
    }
    return out;
  };

  const api: ShowcaseApi = {
    go: (name, zoom = "close") => {
      if (name !== "overview" && !SHOWCASE_CASES.includes(name as ShowcaseCaseName) && !BUILDING_CASES.includes(name as BuildingShowcaseCase)) {
        throw new Error(`unknown showcase preset "${name}"; see __showcase.list()`);
      }
      const p = presetFor(name, zoom);
      const rig = deps.renderer.rig;
      rig.target.set(p.x, 0, p.z);
      rig.dist = p.dist;
      rig.pitch = p.pitch;
      rig.yaw = p.yaw;
      rig.apply();
      return p;
    },
    list: () => [...SHOWCASE_CASES, ...BUILDING_CASES, "overview"],
    setTod: (tod) => {
      const v = SHOWCASE_TOD[tod];
      if (v === undefined) throw new Error(`setTod wants "day" or "night", got "${tod}"`);
      deps.setTod(v);
      return v;
    },
    stats,
  };
  (globalThis as unknown as { __showcase: ShowcaseApi }).__showcase = api;
  stats();
  api.go("cross-street");
  return api;
}
