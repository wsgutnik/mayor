import { describe, expect, it } from "vitest";
import { applyTool, applyZoneBulk, isFillOpenTile, newCity, previewZoneBulk } from "./sim";
import { getFrontage } from "./blocks";
import { ZONE, blocksBuilding, idx, isLand } from "./world";
import { floodFill, rectangleTiles } from "../ui/zone-tools";

type City = ReturnType<typeof newCity>;

/** Straight road east from the entry; returns the road row. */
function roadRow(s: City, len = 10): number {
  const ey = s.world.entry.y;
  for (let x = 3; x < 3 + len; x++) expect(applyTool(s, "road", x, ey).ok).toBe(true);
  return ey;
}

describe("zone bulk (marquee/fill back end)", () => {
  it("zones a classic rectangle and charges per changed tile", () => {
    const s = newCity();
    const ey = roadRow(s);
    const before = s.money;
    const tiles = rectangleTiles({ x: 3, y: ey - 2 }, { x: 6, y: ey - 1 });
    expect(previewZoneBulk(s, "res", tiles)).toEqual({ count: 8, cost: 32 });
    expect(applyZoneBulk(s, "res", tiles)).toEqual({ ok: true });
    expect(s.money).toBe(before - 32);
    for (const t of tiles) expect(s.world.zone[idx(s.world, t.x, t.y)]).toBe(ZONE.RES);
  });

  it("skips same-zone tiles for free and overwrites other zones", () => {
    const s = newCity();
    const ey = roadRow(s);
    const tiles = rectangleTiles({ x: 3, y: ey - 2 }, { x: 6, y: ey - 1 });
    expect(applyZoneBulk(s, "res", tiles).ok).toBe(true);
    const before = s.money;
    expect(previewZoneBulk(s, "res", tiles)).toEqual({ count: 0, cost: 0 });
    expect(applyZoneBulk(s, "res", tiles)).toEqual({ ok: true });
    expect(s.money).toBe(before);
    expect(applyZoneBulk(s, "com", tiles).ok).toBe(true);
    expect(s.money).toBe(before - 32);
    for (const t of tiles) expect(s.world.zone[idx(s.world, t.x, t.y)]).toBe(ZONE.COM);
  });

  it("refuses when broke and changes nothing", () => {
    const s = newCity();
    const ey = roadRow(s);
    const tiles = rectangleTiles({ x: 3, y: ey - 2 }, { x: 6, y: ey - 1 });
    s.money = 10;
    expect(previewZoneBulk(s, "res", tiles)).toEqual({ count: 8, cost: 32, reason: "Not enough money" });
    expect(applyZoneBulk(s, "res", tiles)).toEqual({ ok: false, reason: "Not enough money" });
    expect(s.money).toBe(10);
    for (const t of tiles) expect(s.world.zone[idx(s.world, t.x, t.y)]).toBe(0);
  });

  it("reports the brush reason when no tile is valid", () => {
    const s = newCity();
    roadRow(s);
    // Dry land far from every road.
    let fx = -1, fy = -1;
    const f = getFrontage(s.world);
    for (let y = 40; y < 90 && fx < 0; y++) {
      for (let x = 40; x < 90; x++) {
        if (isLand(s.world, x, y) && f.road[idx(s.world, x, y)] < 0) { fx = x; fy = y; break; }
      }
    }
    expect(fx).toBeGreaterThanOrEqual(0);
    const tiles = rectangleTiles({ x: fx, y: fy }, { x: fx + 1, y: fy + 1 });
    expect(applyZoneBulk(s, "res", tiles)).toEqual({ ok: false, reason: "Zones must be within 4 tiles of a road" });
  });

  it("bulldoze clears zones only, leaving roads and empty tiles alone", () => {
    const s = newCity();
    const ey = roadRow(s);
    const zoned = rectangleTiles({ x: 3, y: ey - 2 }, { x: 6, y: ey - 1 });
    expect(applyZoneBulk(s, "res", zoned).ok).toBe(true);
    const before = s.money;
    // Wider rectangle: road row, empty land and the zoned strip.
    const tiles = rectangleTiles({ x: 2, y: ey - 2 }, { x: 7, y: ey + 1 });
    expect(previewZoneBulk(s, "bulldoze", tiles)).toEqual({ count: 8, cost: 40 });
    expect(applyZoneBulk(s, "bulldoze", tiles).ok).toBe(true);
    expect(s.money).toBe(before - 40);
    for (const t of zoned) expect(s.world.zone[idx(s.world, t.x, t.y)]).toBe(0);
    expect(s.world.road[idx(s.world, 4, ey)]).toBeTruthy();
  });

  it("fill spreads over unzoned and same-zone tiles, bounded by roads and other zones", () => {
    const s = newCity();
    const ey = roadRow(s);
    const w = s.world;
    expect(applyTool(s, "com", 5, ey - 1).ok).toBe(true);
    const region = floodFill({ x: 3, y: ey - 1 }, (t) => isFillOpenTile(w, "res", t.x, t.y));
    expect(region.length).toBeGreaterThan(1);
    expect(region.some((t) => t.x === 5 && t.y === ey - 1)).toBe(false);
    for (const t of region) expect(blocksBuilding(w, idx(w, t.x, t.y))).toBe(false);
    for (const t of region) {
      expect(isLand(w, t.x, t.y)).toBe(true);
      expect(getFrontage(w).road[idx(w, t.x, t.y)]).toBeGreaterThanOrEqual(0);
    }
    const before = s.money;
    expect(applyZoneBulk(s, "res", region).ok).toBe(true);
    expect(s.money).toBe(before - region.length * 4);
    expect(w.zone[idx(w, 5, ey - 1)]).toBe(ZONE.COM);
  });

  it("fill starts closed on roads, water and occupied tiles", () => {
    const s = newCity();
    const ey = roadRow(s);
    const w = s.world;
    expect(isFillOpenTile(w, "res", 4, ey)).toBe(false);
    let wx = -1, wy = -1;
    for (let y = 0; y < w.size && wx < 0; y++) {
      for (let x = 0; x < w.size; x++) {
        if (!isLand(w, x, y)) { wx = x; wy = y; break; }
      }
    }
    expect(wx).toBeGreaterThanOrEqual(0);
    expect(isFillOpenTile(w, "res", wx, wy)).toBe(false);
    expect(floodFill({ x: 4, y: ey }, (t) => isFillOpenTile(w, "res", t.x, t.y))).toEqual([]);
  });

  it("zones through oriented cells with one charge, and bulldoze clears them", () => {
    const s = newCity();
    const ey = roadRow(s);
    s.world.zoning = "oriented";
    const tiles = rectangleTiles({ x: 3, y: ey - 2 }, { x: 6, y: ey - 1 });
    const preview = previewZoneBulk(s, "res", tiles);
    expect(preview.count).toBeGreaterThan(0);
    expect(preview.cost).toBe(preview.count * 4);
    const before = s.money;
    expect(applyZoneBulk(s, "res", tiles)).toEqual({ ok: true });
    expect(s.money).toBe(before - preview.cost);
    const w = s.world;
    let res = 0;
    for (const t of tiles) {
      const z = w.zone[idx(w, t.x, t.y)];
      expect(z === 0 || z === ZONE.RES).toBe(true);
      if (z === ZONE.RES) res++;
    }
    expect(res).toBeGreaterThan(0);
    const clearing = previewZoneBulk(s, "bulldoze", tiles);
    expect(clearing.count).toBe(preview.count);
    expect(applyZoneBulk(s, "bulldoze", tiles).ok).toBe(true);
    expect(s.money).toBe(before - preview.cost - clearing.count * 5);
    for (const t of tiles) expect(w.zone[idx(w, t.x, t.y)]).toBe(0);
  });

  it("reports the brush reason in oriented mode when no cell is near", () => {
    const s = newCity();
    roadRow(s);
    s.world.zoning = "oriented";
    const tiles = rectangleTiles({ x: 80, y: 80 }, { x: 81, y: 81 });
    expect(applyZoneBulk(s, "res", tiles)).toEqual({ ok: false, reason: "Zones must be within 4 tiles of a road" });
  });
});
