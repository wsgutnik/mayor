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

describe("civic services", () => {
  /** Level-3 buildings along a strip, with all utilities, so only civic cover varies. */
  function builtStrip(seed = 11) {
    const s = newCity(seed);
    buildStrip(s, 8);
    s.world.level.fill(0);
    for (let i = 0; i < s.world.zone.length; i++) if (s.world.zone[i]) s.world.level[i] = 3;
    return s;
  }

  it("places civic buildings anywhere on land, one per tile", () => {
    const s = newCity();
    const ey = s.world.entry.y;
    for (const t of ["police", "fire", "clinic", "school", "park"] as const) {
      expect(applyTool(s, t, 4 + ["police", "fire", "clinic", "school", "park"].indexOf(t), ey + 3).ok).toBe(true);
    }
    expect(applyTool(s, "park", 4, ey + 3).ok).toBe(false);
  });

  it("burns down uncovered buildings over time, and a fire station prevents it", () => {
    const bare = builtStrip();
    for (let d = 0; d < 4000; d++) { step(bare); }
    expect(bare.fires).toBeGreaterThan(0);

    const guarded = builtStrip();
    const ey = guarded.world.entry.y;
    expect(applyTool(guarded, "fire", 10, ey + 3).ok).toBe(true);
    for (let d = 0; d < 4000; d++) { step(guarded); }
    expect(guarded.fires).toBe(0);
  }, 60_000);

  it("missing police and health lower happiness; parks raise it", () => {
    const s = builtStrip();
    step(s);
    const base = s.happiness;
    const ey = s.world.entry.y;
    expect(applyTool(s, "police", 10, ey + 3).ok).toBe(true);
    expect(applyTool(s, "clinic", 11, ey + 3).ok).toBe(true);
    step(s);
    expect(s.happiness).toBeGreaterThan(base);
    expect(s.coverage.police).toBeGreaterThan(0.9);
    expect(s.coverage.health).toBeGreaterThan(0.9);
  });

  it("parks and services raise land value; industry lowers it", () => {
    const s = builtStrip();
    step(s);
    const ey = s.world.entry.y;
    const probe = idx(s.world, 5, ey - 1);
    const before = s.world.landValue[probe];
    expect(applyTool(s, "park", 10, ey + 3).ok).toBe(true);
    s.day = 5; // land value refreshes every 5 days
    step(s);
    expect(s.world.landValue[probe]).toBeGreaterThan(before);

    const t = newCity(11);
    buildStrip(t, 8);
    applyTool(t, "ind", 5, ey - 3);
    t.world.level[idx(t.world, 5, ey - 3)] = 1;
    step(t);
    const clean = newCity(11);
    buildStrip(clean, 8);
    step(clean);
    expect(t.world.landValue[probe]).toBeLessThan(clean.world.landValue[probe]);
  });

  it("level 3 needs a school", () => {
    const s = newCity(5);
    buildStrip(s, 6);
    const ey = s.world.entry.y;
    for (let d = 0; d < 2500; d++) step(s);
    const maxNoSchool = Math.max(...Array.from(s.world.level));
    expect(maxNoSchool).toBeLessThan(3);
    expect(applyTool(s, "school", 10, ey + 3).ok).toBe(true);
    expect(applyTool(s, "fire", 11, ey + 3).ok).toBe(true);
    s.taxRate = 0.03; // cheap taxes keep demand high enough to level up
    for (let d = 0; d < 6000; d++) step(s);
    expect(Math.max(...Array.from(s.world.level))).toBe(3);
  }, 60_000);
});

import { placeRoad, planRoad, ROAD_NAME } from "./sim";
import { ROAD, ROAD_COST, rasterizeRoad } from "./world";

describe("free-form roads", () => {
  const flat = (s: City) => {
    const ey = s.world.entry.y;
    for (let y = ey - 12; y <= ey + 12; y++)
      for (let x = 0; x <= 40; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
    return ey;
  };
  const connected4 = (w: City["world"], tiles: number[]) => {
    const set = new Set(tiles);
    const start = tiles[0];
    const seen = new Set([start]);
    const q = [start];
    while (q.length) {
      const i = q.pop()!;
      const x = i % w.size, y = (i / w.size) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (y + dy) * w.size + x + dx;
        if (set.has(j) && !seen.has(j)) { seen.add(j); q.push(j); }
      }
    }
    return seen.size === set.size;
  };

  it("a straight segment charges per tile and connects to the entry", () => {
    const s = newCity(3);
    const ey = flat(s);
    const before = s.money;
    const r = placeRoad(s, ROAD.STREET, [{ x: 2.5, z: ey + 0.5 }, { x: 12.5, z: ey + 0.5 }]);
    expect(r.ok).toBe(true);
    // tiles 3..12 are new (0..2 belong to the entry road)
    expect(before - s.money).toBe(10 * ROAD_COST[1]);
    step(s);
    expect(s.world.connected[idx(s.world, 12, ey)]).toBe(1);
  });

  it("a curve stays 4-connected for every curvature", () => {
    const s = newCity(3);
    const ey = flat(s);
    for (const ctrl of [{ x: 12, z: ey - 8 }, { x: 20, z: ey + 6.3 }, { x: 8.2, z: ey + 11 }]) {
      const { tiles, outOfBounds } = rasterizeRoad(s.world, ROAD.STREET, [{ x: 5.5, z: ey + 0.5 }, ctrl, { x: 24.5, z: ey + 3.5 }]);
      expect(outOfBounds).toBe(false);
      expect(tiles.length).toBeGreaterThan(10);
      expect(connected4(s.world, tiles)).toBe(true);
    }
  });

  it("avenues are two tiles wide and highways three", () => {
    const s = newCity(3);
    const ey = flat(s);
    const a = rasterizeRoad(s.world, ROAD.AVENUE, [{ x: 4.5, z: ey + 5 }, { x: 14.5, z: ey + 5 }]);
    const h = rasterizeRoad(s.world, ROAD.HIGHWAY, [{ x: 4.5, z: ey + 5.5 }, { x: 14.5, z: ey + 5.5 }]);
    const rows = (tiles: number[]) => new Set(tiles.map((i) => (i / s.world.size) | 0)).size;
    expect(rows(a.tiles)).toBe(2);
    expect(rows(h.tiles)).toBe(3);
  });

  it("refuses roads across water, off the map, or too long", () => {
    const s = newCity(3);
    const ey = flat(s);
    carvePond(s, 10, ey + 4);
    expect(planRoad(s, ROAD.STREET, [{ x: 10.5, z: ey + 2 }, { x: 10.5, z: ey + 8 }]).reason).toBe("Road would cross water");
    expect(planRoad(s, ROAD.STREET, [{ x: 2, z: ey }, { x: -4, z: ey }]).reason).toBe("Outside the map");
    expect(planRoad(s, ROAD.STREET, [{ x: 2, z: ey }, { x: 80, z: ey }]).reason).toBe("Road is too long");
  });

  it("highways connect but do not serve adjacent lots", () => {
    const s = newCity(3);
    const ey = flat(s);
    addUtilities(s);
    placeRoad(s, ROAD.HIGHWAY, [{ x: 3.5, z: ey + 0.5 }, { x: 12.5, z: ey + 0.5 }]);
    for (let x = 4; x < 12; x++) applyTool(s, "res", x, ey - 2);
    for (let d = 0; d < 300; d++) step(s);
    expect(s.world.level.reduce((n, l) => n + l, 0)).toBe(0);
    // an avenue in the same place serves them
    const t = newCity(3);
    flat(t);
    addUtilities(t);
    placeRoad(t, ROAD.AVENUE, [{ x: 3.5, z: ey + 0.5 }, { x: 12.5, z: ey + 0.5 }]);
    for (let x = 4; x < 12; x++) applyTool(t, "res", x, ey - 1); // avenue covers rows ey..ey+1
    for (let d = 0; d < 300; d++) step(t);
    expect(t.world.level.reduce((n, l) => n + l, 0)).toBeGreaterThan(0);
  });

  it("bulldozing one tile removes the whole segment but not the entry", () => {
    const s = newCity(3);
    const ey = flat(s);
    placeRoad(s, ROAD.STREET, [{ x: 3.5, z: ey + 0.5 }, { x: 14.5, z: ey + 0.5 }]);
    expect(s.world.road[idx(s.world, 14, ey)]).toBe(1);
    applyTool(s, "bulldoze", 8, ey);
    expect(s.world.road[idx(s.world, 14, ey)]).toBe(0);
    expect(s.world.road[idx(s.world, 3, ey)]).toBe(0);
    expect(s.world.road[idx(s.world, 1, ey)]).toBe(1);
  });

  it("charges only for new tiles when upgrading and pays class-based upkeep", () => {
    const s = newCity(3);
    const ey = flat(s);
    placeRoad(s, ROAD.STREET, [{ x: 3.5, z: ey + 0.5 }, { x: 9.5, z: ey + 0.5 }]);
    const m = s.money;
    placeRoad(s, ROAD.STREET, [{ x: 3.5, z: ey + 0.5 }, { x: 9.5, z: ey + 0.5 }]); // same again
    expect(s.money).toBe(m);
    expect(ROAD_NAME[2]).toBe("Avenue");
    s.monthExpenses = 0;
    for (let d = 0; d < 30; d++) step(s);
    expect(s.lastMonth.expenses).toBeCloseTo(7 * 3); // 7 street tiles beyond the entry
  });
});

import { generateWorld, BIOMES, tileHeight as tileH } from "./world";

describe("terrain presets", () => {
  const stats = (b: (typeof BIOMES)[number]) => {
    const w = generateWorld(96, 1337, b);
    let water = 0, max = -1e9;
    for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++) {
      if (!isLand(w, x, y)) water++;
      max = Math.max(max, tileH(w, x, y));
    }
    return { w, water: water / (w.size * w.size), max };
  };

  it("every preset keeps a dry flat landing strip at the entry", () => {
    for (const b of BIOMES) {
      const { w } = stats(b);
      for (let x = 0; x <= 4; x++) expect(isLand(w, x, w.entry.y)).toBe(true);
      expect(w.road[idx(w, 0, w.entry.y)]).toBeGreaterThan(0);
    }
  });

  it("presets differ the way their names say", () => {
    const plains = stats("plains"), river = stats("river"), coast = stats("coast");
    const mountain = stats("mountain"), desert = stats("desert");
    expect(mountain.max).toBeGreaterThan(plains.max * 1.5);
    expect(coast.water).toBeGreaterThan(plains.water);
    expect(desert.water).toBeLessThan(plains.water);
    // the river is a band across the north: lots of water in the top third, little in the bottom
    let top = 0, bottom = 0;
    for (let x = 0; x < river.w.size; x++) {
      for (let y = 0; y < 32; y++) if (!isLand(river.w, x, y)) top++;
      for (let y = 64; y < 96; y++) if (!isLand(river.w, x, y)) bottom++;
    }
    expect(top).toBeGreaterThan(bottom);
  });

  it("is deterministic and stored in saves", () => {
    const a = generateWorld(96, 7, "mountain"), b = generateWorld(96, 7, "mountain");
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(a.biome).toBe("mountain");
  });
});
