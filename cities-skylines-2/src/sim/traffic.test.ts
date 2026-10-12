import { describe, expect, it } from "vitest";
import { applyTool, newCity, placeRoad, step, CityState } from "./sim";
import { findPath, newTraffic, tickTraffic, ROAD_CAPACITY, ROAD_SPEED } from "./traffic";
import { ROAD, cidx, idx, updateConnectivity } from "./world";

/** Dry, flat ground around the entry so layouts do not depend on the seed. */
function flat(s: CityState) {
  const ey = s.world.entry.y;
  for (let y = ey - 14; y <= ey + 14; y++)
    for (let x = 0; x <= 50; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  return ey;
}
const line = (s: CityState, type: 1 | 2 | 3, x0: number, y0: number, x1: number, y1: number) =>
  placeRoad(s, type, [{ x: x0 + 0.5, z: y0 + 0.5 }, { x: x1 + 0.5, z: y1 + 0.5 }]);

describe("findPath", () => {
  it("finds the straight route along a road and fails when disconnected", () => {
    const s = newCity(3);
    const ey = flat(s);
    line(s, ROAD.STREET, 3, ey, 20, ey);
    const t = newTraffic(s.world.size);
    const p = findPath(s.world, t.load, idx(s.world, 0, ey), idx(s.world, 20, ey));
    expect(p).not.toBeNull();
    expect(p!.length).toBe(21);
    line(s, ROAD.STREET, 3, ey + 8, 12, ey + 8); // island
    expect(findPath(s.world, t.load, idx(s.world, 0, ey), idx(s.world, 12, ey + 8))).toBeNull();
  });

  it("prefers the fast highway over a slow street even when slightly longer", () => {
    const s = newCity(3);
    const ey = flat(s);
    line(s, ROAD.STREET, 3, ey, 30, ey);          // direct street
    line(s, ROAD.STREET, 10, ey, 10, ey + 4);     // detour: down, along a highway, back up
    line(s, ROAD.HIGHWAY, 10, ey + 5, 25, ey + 5);
    line(s, ROAD.STREET, 25, ey + 4, 25, ey);
    s.world.road[idx(s.world, 10, ey + 5)] = ROAD.HIGHWAY;
    const t = newTraffic(s.world.size);
    const p = findPath(s.world, t.load, idx(s.world, 3, ey), idx(s.world, 30, ey))!;
    expect(p.length).toBeGreaterThan(28); // took the detour
  });

  it("routes around a congested street when an equal alternative exists", () => {
    const s = newCity(3);
    const ey = flat(s);
    line(s, ROAD.STREET, 3, ey, 6, ey);
    line(s, ROAD.STREET, 6, ey, 6, ey - 3);
    line(s, ROAD.STREET, 6, ey - 3, 14, ey - 3);
    line(s, ROAD.STREET, 14, ey - 3, 14, ey);
    line(s, ROAD.STREET, 6, ey, 14, ey);          // equal-length direct link
    line(s, ROAD.STREET, 14, ey, 20, ey);
    const t = newTraffic(s.world.size);
    const direct = findPath(s.world, t.load, idx(s.world, 3, ey), idx(s.world, 20, ey))!;
    expect(direct.includes(idx(s.world, 10, ey))).toBe(true);
    for (let x = 7; x <= 13; x++) t.load[idx(s.world, x, ey)] = 60; // jam the direct link
    const around = findPath(s.world, t.load, idx(s.world, 3, ey), idx(s.world, 20, ey))!;
    expect(around.includes(idx(s.world, 10, ey))).toBe(false);
    expect(around.includes(idx(s.world, 10, ey - 3))).toBe(true);
  });
});

/** A small town: an avenue with houses on one side and shops/factories on the other. */
function town(seed = 5) {
  const s = newCity(seed);
  const ey = flat(s);
  s.money = 1e7;
  line(s, ROAD.AVENUE, 3, ey, 28, ey);
  for (let x = 4; x < 28; x++) {
    applyTool(s, "res", x, ey - 1); // the avenue occupies rows ey..ey+1
    applyTool(s, x < 18 ? "com" : "ind", x, ey + 2);
  }
  for (let i = 0; i < s.world.zone.length; i++) if (s.world.zone[i]) s.world.level[i] = 2;
  s.population = 600;
  s.capacity = { res: 600, com: 120, ind: 120 };
  s.world.revision++;
  updateConnectivity(s.world);
  return { s, ey, t: newTraffic(s.world.size) };
}

describe("traffic simulation", () => {
  it("spawns commuters, moves them, and completes trips", () => {
    const { s, t } = town();
    for (let i = 0; i < 600; i++) tickTraffic(s, t, 0.1);
    expect(t.completed).toBeGreaterThan(5);
    expect(t.vehicles.length).toBeGreaterThan(0);
    expect(s.vehicles).toBe(t.vehicles.length);
  });

  it("makes no vehicles without both homes and jobs", () => {
    const s = newCity(5);
    const ey = flat(s);
    line(s, ROAD.STREET, 3, ey, 12, ey);
    s.population = 500;
    const t = newTraffic(s.world.size);
    for (let i = 0; i < 100; i++) tickTraffic(s, t, 0.1);
    expect(t.vehicles.length).toBe(0);
  });

  it("slows vehicles on overloaded tiles and reports congestion", () => {
    const { s, t } = town();
    s.population = 3000;
    for (let i = 0; i < 400; i++) tickTraffic(s, t, 0.1);
    const jam = t.vehicles[0].tiles[Math.floor(t.vehicles[0].progress)];
    const cap = ROAD_CAPACITY[s.world.road[jam]];
    expect(t.vehicles.length).toBeGreaterThan(cap);
    // Put every vehicle on the same tile, then take one tiny step.
    for (const v of t.vehicles) v.tiles[Math.floor(v.progress)] = jam;
    tickTraffic(s, t, 0.001);
    expect(t.load[jam]).toBeGreaterThan(cap);
    expect(Math.min(...t.vehicles.map((v) => v.speedFactor))).toBeLessThan(1);
    for (let i = 0; i < 100; i++) tickTraffic(s, t, 0.1);
    expect(s.congestion).toBeGreaterThanOrEqual(0);
  });

  it("congestion lowers happiness", () => {
    const { s } = town();
    step(s);
    const calm = s.happiness;
    s.congestion = 1;
    step(s);
    expect(s.happiness).toBeLessThan(calm);
  });

  it("removes vehicles when their road is bulldozed", () => {
    const { s, t, ey } = town();
    for (let i = 0; i < 200; i++) tickTraffic(s, t, 0.1);
    expect(t.vehicles.length).toBeGreaterThan(0);
    applyTool(s, "bulldoze", 15, ey);
    tickTraffic(s, t, 0.01);
    expect(t.vehicles.every((v) => v.tiles.every((x) => s.world.road[x] > 0))).toBe(true);
  });

  it("is deterministic for a seed", () => {
    const run = () => {
      const { s, t } = town(9);
      for (let i = 0; i < 400; i++) tickTraffic(s, t, 0.1);
      return [t.completed, t.vehicles.length, Math.round(s.congestion * 1000)];
    };
    expect(run()).toEqual(run());
  });

  it("stays fast with a full load of vehicles", () => {
    const { s, t } = town();
    s.population = 5000;
    s.capacity.ind = 3000;
    for (let i = 0; i < 400; i++) tickTraffic(s, t, 0.1); // warm up to the vehicle cap
    const start = performance.now();
    for (let i = 0; i < 200; i++) tickTraffic(s, t, 0.016);
    const perTick = (performance.now() - start) / 200;
    expect(t.vehicles.length).toBeGreaterThan(50);
    expect(perTick).toBeLessThan(5); // ms; leaves most of a 16 ms frame for rendering
    expect(ROAD_SPEED[ROAD.HIGHWAY]).toBeGreaterThan(ROAD_SPEED[ROAD.STREET]);
  });
});
