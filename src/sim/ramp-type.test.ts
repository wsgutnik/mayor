// src/sim/ramp-type.test.ts
import { describe, expect, it } from "vitest";
import { ROAD, ROAD_TYPES, cidx, baseRoadType, isMotorway, isOneWayType, ROAD_COST, ROAD_DRAW_WIDTH } from "./world";
import { derive, specOf, rankOf } from "./roadprofile";
import { profileOf } from "./corridor";
import { ROAD_CAPACITY } from "./traffic";
import { blankShowcaseCity } from "./showcase-cases";
import { applyZoneBulk, newCity, placeRoad, setZoningMode, syncLots } from "./sim";
import { serialize, deserialize } from "./save";

describe("ramp road type 6", () => {
  it("has the spec values", () => {
    const s = specOf(6), d = derive(6);
    expect(ROAD.RAMP).toBe(6);
    expect(ROAD_TYPES).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.lanesPerDir).toEqual([1, 0]);
    expect(s.laneWidth).toBe(0.45);
    expect(s.shoulder).toBe(0.2);
    expect(s.kerb + s.sidewalk).toBe(0);
    expect(2 * d.drawHalf).toBeCloseTo(0.85, 9);
    expect(ROAD_DRAW_WIDTH[6]).toBe(0.85);
    expect(ROAD_CAPACITY[6]).toBe(5);
    expect(ROAD_COST[6]).toBe(60);
    expect(rankOf(6)).toBe(5);
    expect(isOneWayType(6)).toBe(true);
    expect(baseRoadType(6)).toBe(6);
    expect(isMotorway(6) && isMotorway(3) && !isMotorway(2)).toBe(true);
    expect(profileOf(6).laneCentres).toEqual([0]);
  });

  it("a ramp between two streets saves and loads", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 6, [{ x: 20.5, z: 30.5 }, { x: 30.5, z: 30.5 }]).ok).toBe(true);
    const b = deserialize(serialize(s));
    expect(b.world.segments.find((g) => g.type === 6)).toBeTruthy();
  });

  it("ramps give no frontage: zoning along a ramp yields no lots, along a street it does", () => {
    const lotsAlong = (type: 1 | 6): number => {
      const s = newCity(7);
      setZoningMode(s, "oriented");
      const w = s.world;
      for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) w.heights[cidx(w, x, y)] = 0.35;
      s.money = 1e7;
      expect(placeRoad(s, type, [{ x: 39, z: 50.5 }, { x: 61, z: 50.5 }]).ok).toBe(true);
      const tiles: { x: number; y: number }[] = [];
      for (let x = 40; x <= 60; x++) for (let y = 46; y <= 55; y++) tiles.push({ x, y });
      applyZoneBulk(s, "res", tiles);
      syncLots(s);
      return (s.world.olots ?? []).length;
    };
    expect(lotsAlong(1)).toBeGreaterThan(0);
    expect(lotsAlong(6)).toBe(0);
  });
});
