import { describe, expect, it } from "vitest";
import { applyZoneBulk, newCity, placeRoad, planRoadUpgrade, syncLots, upgradeRoad, getZoneBlocks, setZoningMode } from "./sim";
import { checkZoneInvariant } from "./zoneinvariant";
import { cidx } from "./world";

/** Street -> avenue/highway on streets at many headings (sideways included): zoning must stay attached and clean. */
describe("road class upgrade at every heading", () => {
  const angles = [0, 10, 22.5, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 200, 270];
  for (const deg of angles) for (const to of [2, 5] as const) {
    it(`upgrades a ${deg} deg street to class ${to} keeping zones attached`, () => {
      const s = newCity(7);
      setZoningMode(s, "oriented");
      const w = s.world;
      for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) w.heights[cidx(w, x, y)] = 0.35;
      s.money = 1e7;
      const a = (deg * Math.PI) / 180, c = { x: 50, z: 50 }, L = 11;
      const p0 = { x: c.x - Math.cos(a) * L, z: c.z - Math.sin(a) * L };
      const p1 = { x: c.x + Math.cos(a) * L, z: c.z + Math.sin(a) * L };
      expect(placeRoad(s, 1, [p0, p1]).ok).toBe(true);
      const tiles: { x: number; y: number }[] = [];
      for (let x = 38; x <= 62; x++) for (let y = 38; y <= 62; y++) tiles.push({ x, y });
      applyZoneBulk(s, "res", tiles);
      syncLots(s);
      const seg = w.segments[w.segments.length - 1];
      const before = (w.olots ?? []).length;
      const plan = planRoadUpgrade(s, seg.id, to);
      expect(plan.ok, plan.reason).toBe(true);
      expect(upgradeRoad(s, seg.id, to)).toEqual({ ok: true });
      syncLots(s);
      const rep = checkZoneInvariant(w, getZoneBlocks(w));
      const bad = Object.entries(rep).filter(([, v]) => v);
      expect(bad, JSON.stringify(rep)).toEqual([]);
      // Zoning must survive on both sides: not wiped, not orphaned.
      expect((w.olots ?? []).length).toBeGreaterThan(0);
      expect(before).toBeGreaterThan(0);
      // Skew: every lot sits in the street frame (yaw is a multiple of 90 deg from the straight street's heading).
      for (const l of w.olots ?? []) {
        expect(Math.abs(Math.sin(2 * (l.yaw + a))), `lot ${l.id} yaw ${l.yaw} vs heading ${a}`).toBeLessThan(0.03);
      }
    });
  }
});

describe("highway upgrade keeps the refusal rule", () => {
  it("refuses a highway over zoned strips it would strand, leaving everything untouched", () => {
    const s = newCity(7);
    setZoningMode(s, "oriented");
    const w = s.world;
    for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) w.heights[cidx(w, x, y)] = 0.35;
    s.money = 1e7;
    placeRoad(s, 1, [{ x: 39, z: 50.5 }, { x: 61, z: 50.5 }]);
    const tiles: { x: number; y: number }[] = [];
    for (let x = 38; x <= 62; x++) for (let y = 38; y <= 62; y++) tiles.push({ x, y });
    applyZoneBulk(s, "res", tiles);
    syncLots(s);
    const seg = w.segments[w.segments.length - 1];
    const lots = (w.olots ?? []).length;
    const res = upgradeRoad(s, seg.id, 3);
    expect(res.ok).toBe(false);
    expect((w.olots ?? []).length).toBe(lots);
  });
});
