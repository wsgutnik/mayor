import { describe, expect, it } from "vitest";
import { applyTool, newCity, step, countRoads } from "./sim";
import { ZONE, idx, isLand } from "./world";

/** Build a straight road east from the entry and zone both sides. */
function buildStrip(s: ReturnType<typeof newCity>, len = 8) {
  const ey = s.world.entry.y;
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
