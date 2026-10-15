import type { CityRenderer } from "../render/scene";
import { applyZoneBulk, findUpgradeTarget, newCity, placeRoad, syncLots, upgradeRoad, type CityState } from "../sim/sim";
import { blankShowcaseCity } from "../sim/showcase-cases";
import { diamondRamps } from "../sim/crossings";
import { addSegment } from "../sim/roads";
import { rebuildRoadRaster, type Pt } from "../sim/world";

/**
 * Dev-only operation scenarios (?scenario=upgrade[&built=1][&lockcam=1]): a deterministic city staged on an angled
 * street with zoning on both sides, a fixed camera and the simulation paused. Used to drive the touch UI on a
 * simulator without free camera gestures wandering the view (docs/process/18-touch-operation-notes.md).
 */
export interface ScenarioHost {
  useCity: (s: CityState) => void;
  renderer: CityRenderer;
  pause: () => void;
}

export function buildUpgradeScenario(built: boolean): { state: CityState; mid: { x: number; z: number } } {
  const s = newCity(1337);
  const w = s.world;
  s.money = 500_000;
  const ex = w.entry.x, ey = w.entry.y;
  placeRoad(s, 1, [{ x: ex + 8, z: ey + 0.5 }, { x: ex + 26, z: ey + 10 }]);
  const seg = w.segments[w.segments.length - 1];
  const mid = seg.pts[Math.floor(seg.pts.length / 2)];
  const tiles: { x: number; y: number }[] = [];
  const mx = Math.round(mid.x), mz = Math.round(mid.z);
  for (let x = mx - 7; x <= mx + 7; x++) for (let y = mz - 8; y <= mz + 8; y++) tiles.push({ x, y });
  applyZoneBulk(s, "res", tiles);
  syncLots(s);
  if (built) {
    for (const l of w.olots ?? []) l.level = 1;
    w.revision++;
    syncLots(s);
  }
  return { state: s, mid: { x: mid.x, z: mid.z } };
}

export type RoadShot =
  | "A" | "B" | "C" | "D" | "E" | "lane-reduction" | "four-way" | "parallel" | "bridge" | "tunnel" | "grade" | "upgrade";
export interface CameraPose { dist: number; pitch: number; yaw: number }
export interface CameraShot { x: number; z: number; game: CameraPose; close: CameraPose }

const ROAD_CASES: [RoadShot, (s: CityState, cx: number, cz: number) => void][] = [
  ["A", (s, cx, cz) => { placeRoad(s, 2, [P(cx - 8, cz), P(cx, cz)]); placeRoad(s, 4, [P(cx, cz), P(cx + 8, cz)]); }],
  ["B", (s, cx, cz) => { placeRoad(s, 2, [P(cx - 8, cz), P(cx + 8, cz)]); placeRoad(s, 4, [P(cx, cz - 8), P(cx, cz)]); }],
  ["C", (s, cx, cz) => { placeRoad(s, 3, [P(cx - 10, cz), P(cx + 10, cz)]); }],
  ["D", (s, cx, cz) => { placeRoad(s, 2, [P(cx - 8, cz), P(cx + 8, cz)]); placeRoad(s, 1, [P(cx - 6, cz - 6), P(cx + 6, cz + 6)]); }],
  ["E", (s, cx, cz) => {
    // Today's interchange (main.ts adds four type-4 ramps with addSegment); replaced in 1B.
    placeRoad(s, 3, [P(cx - 10, cz), P(cx + 10, cz)]); placeRoad(s, 2, [P(cx, cz - 8), P(cx, cz + 8)]);
    for (const r of diamondRamps(cx, cz, { dx: 1, dz: 0 }, { dx: 0, dz: 1 })) addSegment(s.world, 4, r);
    rebuildRoadRaster(s.world);
  }],
  ["lane-reduction", (s, cx, cz) => { placeRoad(s, 5, [P(cx - 8, cz), P(cx, cz)]); placeRoad(s, 4, [P(cx, cz), P(cx + 8, cz)]); }],
  ["four-way", (s, cx, cz) => { placeRoad(s, 2, [P(cx - 8, cz), P(cx + 8, cz)]); placeRoad(s, 2, [P(cx, cz - 8), P(cx, cz + 8)]); }],
  ["parallel", (s, cx, cz) => { placeRoad(s, 4, [P(cx - 8, cz - 0.9), P(cx + 8, cz - 0.9)]); placeRoad(s, 4, [P(cx + 8, cz + 0.9), P(cx - 8, cz + 0.9)]); }],
  ["bridge", (s, cx, cz) => { placeRoad(s, 1, [P(cx - 8, cz), P(cx + 8, cz)]); placeRoad(s, 2, [P(cx, cz - 9), P(cx, cz + 9)], "elevated"); }],
  ["tunnel", (s, cx, cz) => { placeRoad(s, 1, [P(cx - 8, cz), P(cx + 8, cz)]); placeRoad(s, 2, [P(cx, cz - 9), P(cx, cz + 9)], "tunnel"); }],
  ["grade", (s, cx, cz) => { placeRoad(s, 3, [P(cx - 10, cz), P(cx + 10, cz)]); placeRoad(s, 1, [P(cx, cz - 8), P(cx, cz + 8)]); }],
  ["upgrade", (s, cx, cz) => {
    placeRoad(s, 1, [P(cx - 8, cz), P(cx + 8, cz)]); placeRoad(s, 1, [P(cx, cz - 8), P(cx, cz)]);
    const seg = findUpgradeTarget(s.world, cx - 4, cz, 2);
    if (seg) upgradeRoad(s, seg.id, 2);
  }],
];
function P(x: number, z: number): Pt { return { x, z }; }

/**
 * Roads cycle 1 regression scene (?scenario=roads, docs/process/26-roads-cycle1.md section 8): every hard road case on
 * its own 22-tile cell of a flat 96x96 map, with a fixed "game" and "close" camera per case so before/after captures
 * use the same view.
 */
export function buildRoadsScenario(): { state: CityState; shots: Record<RoadShot, CameraShot> } {
  const s = blankShowcaseCity();
  s.money = 1e9;
  const shots = {} as Record<RoadShot, CameraShot>;
  ROAD_CASES.forEach(([name, build], k) => {
    const cx = 13 + 22 * (k % 3) + 0.5, cz = 13 + 22 * Math.floor(k / 3) + 0.5;
    build(s, cx, cz);
    shots[name] = { x: cx, z: cz, game: { dist: 22, pitch: 0.95, yaw: 0.5 }, close: { dist: 9, pitch: 1.0, yaw: 0.5 } };
  });
  return { state: s, shots };
}

export function initScenario(host: ScenarioHost, params: URLSearchParams): void {
  if (params.get("scenario") === "roads") {
    const { state, shots } = buildRoadsScenario();
    host.useCity(state);
    const rig = host.renderer.rig;
    const shot = (name: RoadShot, kind: "game" | "close" = "game"): void => {
      const c = shots[name];
      rig.target.set(c.x, 0, c.z);
      Object.assign(rig, c[kind]);
      rig.apply();
    };
    (window as unknown as { __scenario: unknown }).__scenario = { shots, shot };
    shot("A");
    host.pause();
    return;
  }
  if (params.get("scenario") !== "upgrade") return;
  const { state, mid } = buildUpgradeScenario(params.get("built") === "1");
  host.useCity(state);
  const rig = host.renderer.rig;
  rig.target.set(mid.x, 0, mid.z);
  rig.dist = 24;
  rig.pitch = 0.95;
  rig.yaw = Math.PI * 0.25;
  rig.apply();
  if (params.get("lockcam") === "1") rig.locked = true;
  host.pause();
}
