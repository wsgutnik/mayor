// src/sim/roadprofile-consumers.test.ts
import { describe, expect, it } from "vitest";
import { ROAD_SPECS, derive, specOf } from "./roadprofile";
import { ROAD_COST, ROAD_DRAW_WIDTH, ROAD_NAME, ROAD_TILE_WIDTH, ROAD_UPKEEP, rebuildRoadRaster, type RoadType } from "./world";
import { profileOf } from "./corridor";
import { ROAD_CAPACITY, ROAD_SPEED } from "./traffic";
import { clearanceFor, cornerRadiusFor } from "./junction";
import { roadFacts } from "../ui/road-facts";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad, planRoad } from "./sim";

const TYPES: RoadType[] = [1, 2, 3, 4, 5, 6];

describe("every road table is a view of ROAD_SPECS", () => {
  it("world, corridor, traffic, junction and UI agree with the spec", () => {
    for (const t of TYPES) {
      const s = specOf(t), d = derive(t), p = profileOf(t);
      expect(ROAD_COST[t]).toBe(s.cost);
      expect(ROAD_UPKEEP[t]).toBe(s.upkeep);
      expect(ROAD_NAME[t]).toBe(s.nameKey);
      expect(ROAD_TILE_WIDTH[t]).toBe(s.tileWidth);
      expect(ROAD_DRAW_WIDTH[t]).toBe(s.drawWidth);
      expect(ROAD_SPEED[t]).toBe(s.speed);
      expect(ROAD_CAPACITY[t]).toBe(d.capacity);
      expect(cornerRadiusFor(t)).toBe(s.cornerRadius);
      expect(clearanceFor(t)).toBe(s.clearance);
      expect(p.asphaltHalf).toBeCloseTo(d.asphaltHalf, 9);
      expect(p.laneCentres).toEqual(d.laneCentres);
      expect(p.lanes).toBe(d.totalLanes);
      expect(p.medianHalf).toBe(s.medianHalf);
      expect(p.shoulder).toBe(s.shoulder);
      const f = roadFacts(t);
      expect(f.lanes).toBe(d.totalLanes);
      expect(f.lanesPerDir).toEqual(s.lanesPerDir);
      expect(f.descKey).toBe(s.descKey);
    }
    expect(Object.keys(ROAD_SPECS)).toHaveLength(6);
  });

  it("pins the spec literals the consumers expose (not derived from the table)", () => {
    expect([1, 2, 3, 4, 5, 6].map((t) => ROAD_CAPACITY[t])).toEqual([4, 10, 30, 4, 10, 5]);
    expect([1, 2, 3, 4, 5].map((t) => ROAD_SPEED[t])).toEqual([3, 4.5, 7, 3, 4.5]);
    expect(TYPES.map((t) => cornerRadiusFor(t))).toEqual([0.45, 0.6, 1.2, 0.25, 0.35, 0.45]);
    expect(TYPES.map((t) => clearanceFor(t))).toEqual([0.1, 0.1, 0.25, 0.1, 0.1, 0.25]);
    expect(TYPES.map((t) => ROAD_DRAW_WIDTH[t])).toEqual([0.9, 1.8, 2.8, 0.9, 1.8, 0.85]);
    expect(profileOf(3).laneCentres).toEqual([-1.1, -0.7, -0.3, 0.3, 0.7, 1.1]);
    expect(profileOf(5).laneCentres).toEqual([-0.6075, -0.2025, 0.2025, 0.6075]);
    expect(profileOf(4).laneCentres).toEqual([-0.19, 0.19]);
    expect(roadFacts(4).lanesPerDir).toEqual([2, 0]);
  });

  it("a one-way street crossing an avenue is not charged for the avenue tiles", () => {
    const s = blankShowcaseCity();
    const w = s.world;
    placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
    const plan = planRoad(s, 4, [{ x: 30.5, z: 22.5 }, { x: 30.5, z: 38.5 }]);
    expect(plan.ok).toBe(true);
    const shared = plan.tiles.filter((t) => w.road[t] > 0).length;
    expect(shared).toBeGreaterThan(0);
    expect(plan.newTiles).toBe(plan.tiles.length - shared);
  });

  it("a one-way street joining an avenue leaves the shared tiles avenue class", () => {
    const s = blankShowcaseCity();
    const w = s.world;
    placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
    placeRoad(s, 4, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }]);
    rebuildRoadRaster(w);
    const shared = 30 * w.size + 30;
    expect(w.road[shared]).toBe(2);
  });
});
