import { describe, expect, it } from "vitest";
import { applyZoneAt, applyZoneBulk, getZoneBlocks, newCity, placeRoad, syncLots, type CityState } from "./sim";
import { cidx } from "./world";
import { CELL_DEPTH } from "./zonecells";

function scene(): { s: CityState; ey: number } {
  const s = newCity(1337, 96);
  const w = s.world;
  w.zoning = "oriented";
  s.money = 1e8;
  const ey = w.entry.y;
  for (let y = ey - 12; y <= ey + 12; y++) for (let x = 0; x <= 60; x++) w.heights[cidx(w, x, y)] = 0.35;
  placeRoad(s, 1, [{ x: 8.5, z: ey + 0.5 }, { x: 40.5, z: ey - 8.5 }]);
  return { s, ey };
}

/** Number of zoned cells per depth over all blocks. */
function depthHistogram(s: CityState): number[] {
  const h = new Array(CELL_DEPTH).fill(0) as number[];
  for (const b of getZoneBlocks(s.world).blocks.values()) {
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) if (b.zone[r * CELL_DEPTH + c]) h[c]++;
  }
  return h;
}

describe("zones hang off the road (frontage fill)", () => {
  it("painting a deep cell with the brush also zones the cells between it and the road", () => {
    const { s, ey } = scene();
    // 2.7 tiles off the centreline of a ~17 degree road: depth 2 or 3, never depth 0.
    const x = 24, z = ey + 0.5 - (24 - 8.5) * (9 / 32) + 2.7;
    expect(applyZoneAt(s, 1, x, z, { radius: 0 }).ok).toBe(true);
    const h = depthHistogram(s);
    expect(h[0]).toBeGreaterThan(0);
    for (let c = 0; c < CELL_DEPTH; c++) if (h[c] > 0) for (let k = 0; k < c; k++) expect(h[k]).toBeGreaterThan(0);
  });

  it("a bulk rectangle that only touches deep cells still starts at the road", () => {
    const { s, ey } = scene();
    const tiles: { x: number; y: number }[] = [];
    for (let x = 18; x <= 30; x++) for (let y = ey + 1; y <= ey + 6; y++) tiles.push({ x, y });
    applyZoneBulk(s, "res", tiles);
    const h = depthHistogram(s);
    const total = h.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(h[0]).toBeGreaterThan(0);
    for (let c = 1; c < CELL_DEPTH; c++) expect(h[c]).toBeLessThanOrEqual(h[c - 1]);
    syncLots(s);
    expect((s.world.olots ?? []).length).toBeGreaterThan(0);
  });

  it("bulldozing a deep cell does not expand", () => {
    const { s, ey } = scene();
    const tiles: { x: number; y: number }[] = [];
    for (let x = 14; x <= 34; x++) for (let y = ey - 8; y <= ey + 8; y++) tiles.push({ x, y });
    applyZoneBulk(s, "res", tiles);
    const before = depthHistogram(s).reduce((a, b) => a + b, 0);
    applyZoneBulk(s, "bulldoze", [{ x: 24, y: ey + 3 }]);
    const after = depthHistogram(s).reduce((a, b) => a + b, 0);
    expect(after).toBeLessThanOrEqual(before);
  });
});
