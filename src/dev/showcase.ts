import type { CityRenderer } from "../render/scene";
import type { CityState } from "../sim/sim";
import { nodeLayout } from "../sim/roads";
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
  go: (name: ShowcaseCaseName | "overview", zoom?: ShowcaseZoom) => ShowcasePreset;
  /** All preset names, cases first, then overview. */
  list: () => string[];
  /** Switch light: day (low sun) or night. */
  setTod: (tod: ShowcaseTod) => number;
  /** Headless diagnostics + renderer counters for the shot log. */
  stats: () => ShowcaseStats;
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
  deps.useCity(state);
  deps.setTod(SHOWCASE_TOD.day);

  const presetFor = (name: ShowcaseCaseName | "overview", zoom: ShowcaseZoom): ShowcasePreset => {
    if (name === "overview") {
      return { name, title: "full grid", x: 49.5, z: 40.5, dist: 120, pitch: 1.3, yaw: 0 };
    }
    const f = focusOf[name];
    const frame = zoom === "game" ? GAME : CLOSE;
    return { name, title: SHOWCASE_TITLES[name], x: f.x, z: f.z, ...frame };
  };

  const diagnose = (): Omit<ShowcaseStats, "cases" | "drawCalls" | "triangles"> => {
    const w = state.world;
    let rings = 0, nonSimple = 0, minArea = Infinity, minAngle = Infinity;
    for (const node of w.nodes) {
      const l = nodeLayout(w, node.id);
      if (!l || l.arms.length < 2) continue;
      const d = junctionDebugGeometry(l);
      if (d.asphalt.length < 3) continue;
      rings++;
      if (ringSelfIntersects(d.asphalt)) nonSimple++;
      for (const t of fanTris(l.cx, l.cz, d.asphalt)) {
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
      if (name !== "overview" && !SHOWCASE_CASES.includes(name as ShowcaseCaseName)) {
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
    list: () => [...SHOWCASE_CASES, "overview"],
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
