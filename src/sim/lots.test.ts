import { describe, expect, it } from "vitest";
import { applyTool, newCity, placeRoad, step, syncLots, CityState } from "./sim";
import { deserialize, serialize, SaveError } from "./save";
import { pickLotEntry } from "./catalog";
import { ROAD, ZONE, cidx, idx } from "./world";

/** Small flat city with money; nothing poked, so tools drive every revision. */
function flatCity(seed = 11, size = 32) {
  const s = newCity(seed, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e6;
  return { s, ey: s.world.entry.y };
}

/** Utilities covering the whole strip (x 4..19), plus a fire station against test fires. */
function utilities(s: CityState) {
  const ey = s.world.entry.y;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) s.world.heights[cidx(s.world, 6 + dx, ey + 7 + dy)] = -1;
  expect(applyTool(s, "power", 5, ey + 2).ok).toBe(true);
  expect(applyTool(s, "water", 6, ey + 4).ok).toBe(true);
  expect(applyTool(s, "sewage", 5, ey + 4).ok).toBe(true);
  expect(applyTool(s, "landfill", 7, ey + 2).ok).toBe(true);
  expect(applyTool(s, "fire", 7, ey + 3).ok).toBe(true);
}

/** Street with two zoned rows on its north side; returns the strip bounds. */
function zonedStrip(s: CityState, x0 = 4, x1 = 19) {
  const ey = s.world.entry.y;
  expect(placeRoad(s, ROAD.STREET, [{ x: 2.5, z: ey + 0.5 }, { x: x1 + 1.5, z: ey + 0.5 }]).ok).toBe(true);
  for (let x = x0; x <= x1; x++) {
    expect(applyTool(s, "res", x, ey - 1).ok).toBe(true);
    expect(applyTool(s, "res", x, ey - 2).ok).toBe(true);
  }
  return { x0, x1, ey };
}

/** Commercial row south of the strip road, so housing demand never starves for jobs. */
function jobsRow(s: CityState, x0 = 4, x1 = 19) {
  const ey = s.world.entry.y;
  for (let x = x0; x <= x1; x++) expect(applyTool(s, "com", x, ey + 1).ok).toBe(true);
}

describe("lot planning", () => {
  it("detects an out-of-sync interior footprint tile", () => {
    const { s } = flatCity();
    zonedStrip(s);
    syncLots(s);
    const lot = s.world.lots.find((l) => l.w * l.h > 1)!;
    const x = lot.x + lot.w - 1, y = lot.y + lot.h - 1;
    const oldId = lot.id;
    s.world.zone[idx(s.world, x, y)] = ZONE.COM;
    syncLots(s);
    expect(s.world.lotAt[idx(s.world, x, y)]).not.toBe(oldId);
  });

  it("covers every zoned tile with exactly one street-facing lot", () => {
    const { s } = flatCity();
    const { x0, x1, ey } = zonedStrip(s);
    syncLots(s);
    const w = s.world;
    expect(w.lots.length).toBeGreaterThan(0);
    expect(w.lots.some((l) => l.w * l.h > 1)).toBe(true); // multi-tile lots form
    expect(w.lots.some((l) => l.w === 2)).toBe(true);
    const seen = new Set<number>();
    for (const lot of w.lots) {
      expect(lot.facing).toEqual({ dx: 0, dy: 1 }); // the road is south of the strip
      expect(lot.depthFromRoad).toBe(0);
      expect(lot.zone).toBe(ZONE.RES);
      for (let y = lot.y; y < lot.y + lot.h; y++) {
        for (let x = lot.x; x < lot.x + lot.w; x++) {
          const i = idx(w, x, y);
          expect(seen.has(i)).toBe(false);
          seen.add(i);
          expect(w.lotAt[i]).toBe(lot.id);
        }
      }
    }
    expect(seen.size).toBe((x1 - x0 + 1) * 2);
    expect(w.zone[idx(w, x0, ey - 1)]).toBe(ZONE.RES);
  });

  it("faces the avenue where a corner ties a street and an avenue", () => {
    const s = newCity(7, 24);
    const w = s.world;
    w.heights.fill(1);
    for (let x = 4; x <= 20; x++) w.road[idx(w, x, 12)] = w.roadSurface[idx(w, x, 12)] = ROAD.STREET;
    for (let y = 4; y <= 20; y++) w.road[idx(w, 8, y)] = w.roadSurface[idx(w, 8, y)] = ROAD.AVENUE;
    for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) w.zone[idx(w, x, y)] = ZONE.RES;
    syncLots(s);
    // (9,9) ties both roads at equal distance; the higher class owns it.
    const lot = w.lots.find((l) => l.id === w.lotAt[idx(w, 9, 9)])!;
    expect(lot.facing).toEqual({ dx: -1, dy: 0 });
  });

  it("refuses zones past kerb depth, the middle of a block, and beside highways alone", () => {
    const { s, ey } = flatCity();
    expect(applyTool(s, "res", 28, 5)).toEqual({ ok: false, reason: "Zones must be within 4 tiles of a road" });
    expect(applyTool(s, "res", 2, ey - 4).ok).toBe(true); // depth 4 from the entry street
    expect(applyTool(s, "res", 2, ey - 5).ok).toBe(false);
    // a ring road: the rim is zoneable, the middle of the block is not
    const ring = (x0: number, y0: number, x1: number, y1: number) =>
      placeRoad(s, ROAD.STREET, [{ x: x0 + 0.5, z: y0 + 0.5 }, { x: x1 + 0.5, z: y1 + 0.5 }]);
    expect(ring(8, 4, 19, 4).ok).toBe(true);
    expect(ring(8, 15, 19, 15).ok).toBe(true);
    expect(ring(8, 4, 8, 15).ok).toBe(true);
    expect(ring(19, 4, 19, 15).ok).toBe(true);
    expect(applyTool(s, "res", 9, 5).ok).toBe(true);
    expect(applyTool(s, "res", 13, 9).ok).toBe(false);
    // highways carry traffic but front no lots
    expect(placeRoad(s, ROAD.HIGHWAY, [{ x: 10.5, z: 24.5 }, { x: 25.5, z: 24.5 }]).ok).toBe(true);
    expect(applyTool(s, "res", 15, 27).ok).toBe(false);
  });
});

describe("lot growth", () => {
  it("grows one building per ready lot and mirrors the level over the footprint", () => {
    const { s } = flatCity();
    utilities(s);
    zonedStrip(s);
    jobsRow(s);
    for (let d = 0; d < 120; d++) step(s);
    const w = s.world;
    const built = w.lots.filter((l) => l.level > 0);
    expect(built.length).toBeGreaterThan(2);
    expect(built.some((l) => l.w * l.h > 1)).toBe(true);
    for (const lot of w.lots) {
      for (let y = lot.y; y < lot.y + lot.h; y++) {
        for (let x = lot.x; x < lot.x + lot.w; x++) {
          const i = idx(w, x, y);
          expect(w.level[i]).toBe(lot.level);
          expect(w.zone[i]).toBe(lot.zone);
          expect(w.lotAt[i]).toBe(lot.id);
        }
      }
    }
  });

  it("abandons whole lots when their street is cut", () => {
    const { s } = flatCity();
    utilities(s);
    const { ey } = zonedStrip(s);
    for (let d = 0; d < 120; d++) step(s);
    expect(s.world.lots.some((l) => l.level > 0)).toBe(true);
    applyTool(s, "bulldoze", 4, ey); // removes the strip's road segment
    for (let d = 0; d < 300; d++) step(s);
    expect(s.world.level.every((l) => l === 0)).toBe(true);
    expect(s.world.lots.every((l) => l.level === 0)).toBe(true);
  });
});

describe("lot removal", () => {
  it("bulldozing a footprint removes the lot and clears the mirror", () => {
    const { s } = flatCity();
    utilities(s);
    zonedStrip(s);
    jobsRow(s);
    for (let d = 0; d < 120; d++) step(s);
    const w = s.world;
    const lot = w.lots.find((l) => l.level > 0 && l.w * l.h > 1) ?? w.lots.find((l) => l.level > 0)!;
    const cells: [number, number][] = [];
    for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) cells.push([x, y]);
    for (const [x, y] of cells) expect(applyTool(s, "bulldoze", x, y).ok).toBe(true);
    syncLots(s);
    // no lot covers the cleared cells anymore (ids are reassigned on rebuild)
    for (const [x, y] of cells) {
      expect(w.lotAt[idx(w, x, y)]).toBe(-1);
    }
    for (const [x, y] of cells) {
      const i = idx(w, x, y);
      expect(w.zone[i]).toBe(0);
      expect(w.level[i]).toBe(0);
      expect(w.lotAt[i]).toBe(-1);
    }
  });
});

describe("lot saves", () => {
  it("round-trips lots exactly and keeps simulating identically", () => {
    const { s } = flatCity(21);
    utilities(s);
    zonedStrip(s);
    jobsRow(s);
    for (let d = 0; d < 60; d++) step(s);
    const b = deserialize(serialize(s));
    expect(b.world.lots).toEqual(s.world.lots);
    expect(Array.from(b.world.lotAt)).toEqual(Array.from(s.world.lotAt));
    expect(b.world.nextLotId).toBe(s.world.nextLotId);
    for (let d = 0; d < 30; d++) { step(s); step(b); }
    expect(Array.from(b.world.level)).toEqual(Array.from(s.world.level));
    expect(b.world.lots).toEqual(s.world.lots);
  });

  it("rebuilds lots from zoning when an old save has none", () => {
    const { s } = flatCity(21);
    utilities(s);
    zonedStrip(s);
    jobsRow(s);
    for (let d = 0; d < 60; d++) step(s);
    const old = JSON.parse(serialize(s));
    delete old.lots;
    delete old.nextLotId;
    const c = deserialize(JSON.stringify(old));
    expect(c.world.lots.length).toBeGreaterThan(0);
    for (const lot of c.world.lots) {
      for (let y = lot.y; y < lot.y + lot.h; y++) {
        for (let x = lot.x; x < lot.x + lot.w; x++) {
          expect(c.world.level[idx(c.world, x, y)]).toBe(lot.level);
        }
      }
    }
  });

  it("rejects damaged lots with a clear error", () => {
    const { s } = flatCity();
    zonedStrip(s);
    syncLots(s);
    const bad = JSON.parse(serialize(s));
    bad.lots = [{ x: 0 }];
    expect(() => deserialize(JSON.stringify(bad))).toThrow(SaveError);
  });
});

describe("lot looks", () => {
  it("prefers higher-level entries for larger lots", () => {
    expect(pickLotEntry(ZONE.RES, 1, 1, 0.3).level).toBe(1);
    const big = pickLotEntry(ZONE.RES, 1, 4, 0.3);
    expect(big.level).toBe(2);
    expect(big.entry?.level).toBe(2);
    expect(pickLotEntry(ZONE.COM, 3, 4, 0.7).level).toBe(3); // level 3 stays 3
    expect(pickLotEntry(ZONE.IND, 2, 2, 0.5)).toEqual(pickLotEntry(ZONE.IND, 2, 2, 0.5));
  });
});
