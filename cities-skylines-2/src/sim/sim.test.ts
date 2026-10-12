import { describe, expect, it } from "vitest";
import { applyTool, newCity, step, countRoads } from "./sim";
import { ZONE, COVER, idx, isLand, cidx, updateCoverage } from "./world";

type City = ReturnType<typeof newCity>;

/** Dig a one-tile pond at (x,y) so shoreline-only facilities can be placed near it. */
function carvePond(s: City, x: number, y: number) {
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]])
    s.world.heights[cidx(s.world, x + dx, y + dy)] = -1;
}

/** Power + water + sewage + landfill all covering the strip east of the entry. */
function addUtilities(s: City) {
  const ey = s.world.entry.y;
  // Make the neighbourhood dry and flat regardless of seed, then dig a pond south of it.
  for (let y = ey - 6; y <= ey + 5; y++)
    for (let x = 0; x <= 14; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  carvePond(s, 6, ey + 6);
  expect(applyTool(s, "power", 5, ey + 2).ok).toBe(true);
  expect(applyTool(s, "water", 6, ey + 4).ok).toBe(true);
  expect(applyTool(s, "sewage", 7, ey + 4).ok).toBe(true);
  expect(applyTool(s, "landfill", 8, ey + 2).ok).toBe(true);
}

/** Build a straight road east from the entry and zone both sides. */
function buildStrip(s: City, len = 8) {
  const ey = s.world.entry.y;
  addUtilities(s);
  for (let x = 3; x < 3 + len; x++) applyTool(s, "road", x, ey);
  for (let x = 3; x < 3 + len; x++) {
    applyTool(s, "res", x, ey - 1);
    applyTool(s, "com", x, ey + 1);
  }
}

describe("world", () => {
  it("has dry land at the entry and a pre-built road", () => {
    const s = newCity();
    const { x, y } = s.world.entry;
    expect(isLand(s.world, x, y)).toBe(true);
    expect(s.world.road[idx(s.world, x, y)]).toBe(1);
  });
});

describe("tools", () => {
  it("charges money and blocks when broke", () => {
    const s = newCity();
    const ey = s.world.entry.y;
    const before = s.money;
    expect(applyTool(s, "road", 3, ey).ok).toBe(true);
    expect(s.money).toBe(before - 20);
    s.money = 0;
    const r = applyTool(s, "road", 4, ey);
    expect(r).toEqual({ ok: false, reason: "Not enough money" });
  });

  it("refuses to build on water", () => {
    const s = newCity();
    let wx = -1, wy = -1;
    for (let y = 0; y < s.world.size && wx < 0; y++)
      for (let x = 0; x < s.world.size; x++)
        if (!isLand(s.world, x, y)) { wx = x; wy = y; break; }
    expect(wx).toBeGreaterThanOrEqual(0);
    const r = applyTool(s, "road", wx, wy);
    expect(r.ok).toBe(false);
  });

  it("will not bulldoze the entry", () => {
    const s = newCity();
    expect(applyTool(s, "bulldoze", 0, s.world.entry.y).ok).toBe(false);
  });

  it("zone replaces nothing on a road", () => {
    const s = newCity();
    const ey = s.world.entry.y;
    expect(applyTool(s, "res", 1, ey).ok).toBe(false);
  });
});

describe("growth", () => {
  it("develops served zones and grows population", () => {
    const s = newCity(7);
    buildStrip(s);
    for (let d = 0; d < 400; d++) step(s);
    const built = s.world.level.reduce((n, l) => n + (l > 0 ? 1 : 0), 0);
    expect(built).toBeGreaterThan(4);
    expect(s.population).toBeGreaterThan(0);
  });

  it("does not develop zones with no road connection", () => {
    const s = newCity(7);
    const ey = s.world.entry.y;
    // Isolated zone far from any road.
    applyTool(s, "res", 20, ey);
    for (let d = 0; d < 200; d++) step(s);
    expect(s.world.level[idx(s.world, 20, ey)]).toBe(0);
  });

  it("abandons buildings when their road is removed", () => {
    const s = newCity(7);
    buildStrip(s);
    for (let d = 0; d < 300; d++) step(s);
    const ey = s.world.entry.y;
    applyTool(s, "bulldoze", 3, ey); // cut the strip off from the entry
    for (let d = 0; d < 300; d++) step(s);
    const stillBuilt = s.world.level.reduce((n, l) => n + (l > 0 ? 1 : 0), 0);
    expect(stillBuilt).toBe(0);
  });

  it("does not develop without power and water", () => {
    const s = newCity(7);
    const ey = s.world.entry.y;
    for (let x = 3; x < 11; x++) applyTool(s, "road", x, ey);
    for (let x = 3; x < 11; x++) applyTool(s, "res", x, ey - 1);
    for (let d = 0; d < 300; d++) step(s);
    expect(s.world.level.reduce((n, l) => n + l, 0)).toBe(0);
  });

  it("is deterministic for a given seed", () => {
    const a = newCity(99), b = newCity(99);
    buildStrip(a); buildStrip(b);
    for (let d = 0; d < 200; d++) { step(a); step(b); }
    expect(Array.from(a.world.level)).toEqual(Array.from(b.world.level));
    expect(a.money).toBeCloseTo(b.money);
  });
});

describe("economy", () => {
  it("pays road upkeep and reports a monthly summary", () => {
    const s = newCity();
    const ey = s.world.entry.y;
    for (let x = 3; x < 23; x++) applyTool(s, "road", x, ey);
    expect(countRoads(s.world)).toBe(23);
    s.monthExpenses = 0;
    for (let d = 0; d < 30; d++) step(s);
    expect(s.lastMonth.expenses).toBeCloseTo(20 * 3);
    expect(ZONE.RES).toBe(1);
  });

  it("lowers demand when taxes are high", () => {
    const lo = newCity(), hi = newCity();
    lo.taxRate = 0.05; hi.taxRate = 0.2;
    step(lo); step(hi);
    expect(hi.demand.r).toBeLessThan(lo.demand.r);
  });
});

describe("utilities", () => {
  it("water pump and sewage outlet need nearby water", () => {
    const s = newCity();
    const ey = s.world.entry.y;
    const r = applyTool(s, "water", 5, ey + 2);
    expect(r.ok).toBe(false);
    carvePond(s, 5, ey + 5);
    expect(applyTool(s, "water", 5, ey + 3).ok).toBe(true);
  });

  it("refuses facilities on roads, zones and other facilities", () => {
    const s = newCity();
    const ey = s.world.entry.y;
    applyTool(s, "road", 4, ey);
    applyTool(s, "res", 4, ey - 1);
    expect(applyTool(s, "power", 4, ey).ok).toBe(false);
    expect(applyTool(s, "power", 4, ey - 1).ok).toBe(false);
    expect(applyTool(s, "power", 4, ey + 2).ok).toBe(true);
    expect(applyTool(s, "landfill", 4, ey + 2).ok).toBe(false);
  });

  it("covers tiles within the radius and not beyond", () => {
    const s = newCity();
    const ey = s.world.entry.y;
    applyTool(s, "power", 5, ey + 2);
    updateCoverage(s.world);
    expect(s.world.cover[idx(s.world, 5, ey - 5)] & COVER.POWER).toBeTruthy();
    expect(s.world.cover[idx(s.world, 5 + 15, ey + 2)] & COVER.POWER).toBeFalsy();
  });

  it("bulldozing a facility removes its coverage", () => {
    const s = newCity();
    const ey = s.world.entry.y;
    applyTool(s, "power", 5, ey + 2);
    updateCoverage(s.world);
    expect(s.world.cover[idx(s.world, 5, ey)] & COVER.POWER).toBeTruthy();
    applyTool(s, "bulldoze", 5, ey + 2);
    step(s);
    expect(s.world.cover[idx(s.world, 5, ey)] & COVER.POWER).toBeFalsy();
  });

  it("reports shortage and lowers happiness when demand exceeds supply", () => {
    const s = newCity(7);
    buildStrip(s, 8);
    // Heavy industrial zone around the strip overwhelms one 120-unit plant.
    const ey = s.world.entry.y;
    for (let x = 3; x < 11; x++) for (const dy of [-2, -3, -4]) applyTool(s, "ind", x, ey + dy);
    for (let x = 3; x < 11; x++) applyTool(s, "road", x, ey - 2 + 0 * x);
    s.world.level.fill(3);
    for (let i = 0; i < s.world.zone.length; i++) if (!s.world.zone[i]) s.world.level[i] = 0;
    step(s);
    expect(s.utilities.power.demand).toBeGreaterThan(s.utilities.power.supply);
    expect(s.happiness).toBeLessThan(100);
  });

  it("charges facility upkeep monthly", () => {
    const s = newCity();
    const ey = s.world.entry.y;
    applyTool(s, "power", 5, ey + 2);
    s.monthExpenses = 0;
    for (let d = 0; d < 30; d++) step(s);
    expect(s.lastMonth.expenses).toBeCloseTo(60);
  });
});
