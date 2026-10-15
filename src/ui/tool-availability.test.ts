import { describe, expect, it } from "vitest";
import { hasTranslation } from "../i18n";
import { COST, newCity } from "../sim/sim";
import { FAC } from "../sim/world";
import { toolAvailability } from "./tool-availability";

describe("tool availability", () => {
  it("greys out what the balance cannot pay and names the reason", () => {
    const s = newCity(7);
    s.money = COST.school - 1;
    expect(toolAvailability("school", s)).toBe("Not enough money");
    expect(toolAvailability("park", s)).toBeNull();
    s.money = COST.school;
    expect(toolAvailability("school", s)).toBeNull();
    expect(toolAvailability("pan", { money: -1, world: s.world })).toBeNull();
    expect(toolAvailability("road", { money: -1, world: s.world })).toBeNull();
  });

  it("allows one city hall per city", () => {
    const s = newCity(7);
    s.money = 1e6;
    expect(toolAvailability("cityhall", s)).toBeNull();
    s.world.facility[0] = FAC.CITYHALL;
    expect(toolAvailability("cityhall", s)).toBe("There is already a city hall");
    for (const r of ["Not enough money", "There is already a city hall"]) expect(hasTranslation(r), r).toBe(true);
  });
});
