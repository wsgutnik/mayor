import { describe, expect, it } from "vitest";
import { applyTool, newCity, placeRoad } from "./sim";
import { facilityEntry } from "./catalog";
import { FAC, FACILITY_INFO, ROAD, cidx, idx } from "./world";

describe("tiered services", () => {
  it("produces strictly more per tier: water, power and fire cover", () => {
    expect(FACILITY_INFO[FAC.WATER].capacity).toBeLessThan(FACILITY_INFO[FAC.WATER_TOWER].capacity);
    expect(FACILITY_INFO[FAC.WATER_TOWER].capacity).toBeLessThan(FACILITY_INFO[FAC.WATER_LARGE].capacity);
    expect(FACILITY_INFO[FAC.POWER].capacity).toBeLessThan(FACILITY_INFO[FAC.POWER_SOLAR].capacity);
    expect(FACILITY_INFO[FAC.POWER_SOLAR].capacity).toBeLessThan(FACILITY_INFO[FAC.POWER_LARGE].capacity);
    expect(FACILITY_INFO[FAC.FIRE_POST].radius).toBeLessThan(FACILITY_INFO[FAC.FIRE].radius);
    expect(FACILITY_INFO[FAC.FIRE].radius).toBeLessThan(FACILITY_INFO[FAC.FIRE_HQ].radius);
  });

  it("maps catalog entries to the new facility kinds", () => {
    expect(facilityEntry(FAC.POWER_SOLAR)?.n).toBe(73);
    expect(facilityEntry(FAC.WATER_TOWER)?.n).toBe(76);
    expect(facilityEntry(FAC.POWER_LARGE)?.n).toBe(81);
    expect(facilityEntry(FAC.WATER_LARGE)?.n).toBe(82);
    expect(facilityEntry(FAC.FIRE_HQ)?.n).toBe(83);
    expect(facilityEntry(FAC.FIRE_POST)?.n).toBe(84);
  });

  it("places a solar plant, a fire post and a fire headquarters", () => {
    const s = newCity(3);
    const ey = s.world.entry.y;
    for (let y = ey - 10; y <= ey + 10; y++) for (let x = 0; x <= 40; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
    s.money = 1e6;
    placeRoad(s, ROAD.STREET, [{ x: 3.5, z: ey + 0.5 }, { x: 30.5, z: ey + 0.5 }]);
    expect(applyTool(s, "solar", 6, ey + 2).ok).toBe(true);
    expect(s.world.facility[idx(s.world, 6, ey + 2)]).toBe(FAC.POWER_SOLAR);
    expect(applyTool(s, "firepost", 12, ey + 2).ok).toBe(true);
    expect(s.world.facility[idx(s.world, 12, ey + 2)]).toBe(FAC.FIRE_POST);
    expect(applyTool(s, "firehq", 18, ey + 2).ok).toBe(true);
    expect(s.world.facility[idx(s.world, 18, ey + 2)]).toBe(FAC.FIRE_HQ);
  });
});
