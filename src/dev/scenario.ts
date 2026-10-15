import type { CityRenderer } from "../render/scene";
import { applyZoneBulk, newCity, placeRoad, syncLots, type CityState } from "../sim/sim";

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

export function initScenario(host: ScenarioHost, params: URLSearchParams): void {
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
