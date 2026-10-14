import { afterEach, describe, expect, it } from "vitest";
import type { CityRenderer } from "../render/scene";
import type { CityState } from "../sim/sim";
import { SHOWCASE_CASES, SHOWCASE_GRID, SHOWCASE_TITLES, caseFocus } from "../sim/showcase-cases";
import { SHOWCASE_TOD, initShowcase, ShowcaseApi } from "./showcase";

function mockDeps() {
  const rig = {
    target: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    dist: 38, pitch: 0.9, yaw: 0.65,
    apply() { /* mock */ },
  };
  const seen: { city?: CityState; tod?: number } = {};
  return {
    rig,
    seen,
    deps: {
      useCity: (next: CityState) => { seen.city = next; },
      renderer: { rig } as unknown as CityRenderer,
      setTod: (v: number) => { seen.tod = v; },
    },
  };
}

afterEach(() => {
  delete (globalThis as unknown as { __showcase?: ShowcaseApi }).__showcase;
});

describe("dev showcase", () => {
  it("installs window.__showcase and stages all 12 cases", () => {
    const { seen, deps } = mockDeps();
    const api = initShowcase(deps);
    expect((globalThis as unknown as { __showcase?: ShowcaseApi }).__showcase).toBe(api);
    expect(seen.city).toBeDefined();
    expect(seen.city!.world.roundabouts.length).toBe(1);
    const lots = seen.city!.world.olots!;
    expect(lots.map((l) => [l.w, l.d, l.level])).toEqual([[2, 2, 2], [4, 2, 2], [3, 3, 3]]);
    // Building presets are genuine zoned/levelled oriented lots, not empty
    // renderer dummies: their mirror owns every footprint tile.
    for (const lot of lots) for (const i of lot.tiles) {
      expect(seen.city!.world.zone[i]).toBe(lot.zone);
      expect(seen.city!.world.level[i]).toBe(lot.level);
      expect(seen.city!.world.lotAt[i]).toBe(lot.id);
    }
    // Default light is the low day sun, and the camera starts on the first case.
    expect(seen.tod).toBe(SHOWCASE_TOD.day);
    expect(api.list()).toEqual([...SHOWCASE_CASES, "building-house-2x2", "building-shop-4x2", "building-office-3x3", "overview"]);
  });

  it("exposes one fixed preset per case plus overview", () => {
    const { rig, deps } = mockDeps();
    const api = initShowcase(deps);
    for (const name of SHOWCASE_CASES) {
      const g = SHOWCASE_GRID[name];
      const f = caseFocus(name, g.ox, g.oz);
      const p = api.go(name);
      expect(p.name).toBe(name);
      expect(p.title).toBe(SHOWCASE_TITLES[name]);
      expect(p.x).toBe(f.x);
      expect(p.z).toBe(f.z);
      expect(rig.target.x).toBe(f.x);
      expect(rig.target.z).toBe(f.z);
      expect(Number.isFinite(p.dist) && Number.isFinite(p.pitch) && Number.isFinite(p.yaw)).toBe(true);
    }
    const game = api.go("tee", "game");
    const close = api.go("tee", "close");
    expect(game.dist).toBeGreaterThan(close.dist);
    expect(game.x).toBe(close.x);
    expect(game.z).toBe(close.z);
    const over = api.go("overview");
    expect(over.dist).toBeGreaterThan(game.dist);
    expect(() => api.go("nope" as never)).toThrowError(/unknown showcase preset/);
  });

  it("switches day/night tod", () => {
    const { seen, deps } = mockDeps();
    const api = initShowcase(deps);
    expect(api.setTod("day")).toBe(16.2 / 24);
    expect(seen.tod).toBe(16.2 / 24);
    expect(api.setTod("night")).toBe(21 / 24);
    expect(seen.tod).toBe(21 / 24);
    expect(() => api.setTod("dusk" as never)).toThrowError(/day.*night/);
  });

  it("stats() matches the headless gate pins summed over cases", () => {
    const { deps } = mockDeps();
    const api = initShowcase(deps);
    const st = api.stats();
    expect(st.cases).toBe(12);
    expect(st.segments).toBeGreaterThan(12);
    // Middle nodes have no patch; the layout builder emits 13 visible rings.
    expect(st.rings).toBe(13);
    expect(st.nonSimpleRings).toBe(0);
    expect(st.minFanArea).toBeGreaterThan(1e-9);
    // No WebGL in the harness: counters report unknown, not zero.
    expect(st.drawCalls).toBe(-1);
    expect(st.triangles).toBe(-1);
  });

  it("is deterministic: two inits stage identical presets", () => {
    const a = initShowcase(mockDeps().deps);
    const b = initShowcase(mockDeps().deps);
    for (const name of a.list()) {
      expect(b.go(name as never)).toEqual(a.go(name as never));
    }
  });
});
