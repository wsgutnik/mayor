import { describe, expect, it } from "vitest";
import { hasTranslation } from "../i18n";
import { newCity } from "../sim/sim";
import { COVER, FAC, LAND_VALUE_LAYER, TRAFFIC_LAYER, UNDERGROUND_LAYER, idx } from "../sim/world";
import { legendFor, legendSig } from "./legend";

describe("legendFor", () => {
  it("returns null off-layer and for the underground view", () => {
    const s = newCity(7, 16);
    expect(legendFor(0, s)).toBeNull();
    expect(legendFor(UNDERGROUND_LAYER, s)).toBeNull();
    expect(legendFor(999999, s)).toBeNull();
  });

  it("reads civic coverage from the live state", () => {
    const s = newCity(7, 16);
    s.coverage.police = 0.75;
    const m = legendFor(COVER.POLICE, s)!;
    expect(m).not.toBeNull();
    expect(m.avg).toBe(0.75);
    expect(m.stops).toHaveLength(3);
    expect(m.rows).toContainEqual({ k: "Facilities", v: "0", cls: "bad" });
    s.world.facility[idx(s.world, 4, 4)] = FAC.POLICE;
    expect(legendFor(COVER.POLICE, s)!.rows).toContainEqual({ k: "Facilities", v: "1", cls: "" });
  });

  it("reads utility capacity and demand with a supply row", () => {
    const s = newCity(7, 16);
    s.utilities.power = { supply: 120, demand: 60 };
    const m = legendFor(COVER.POWER, s)!;
    expect(m.avg).toBe(1);
    expect(m.rows).toContainEqual({ k: "Capacity", v: "120", cls: "" });
    expect(m.rows).toContainEqual({ k: "Demand", v: "60", cls: "" });
    expect(m.rows).toContainEqual({ k: "Supply", v: "100%", cls: "good" });
    s.utilities.power = { supply: 0, demand: 0 };
    const idle = legendFor(COVER.POWER, s)!;
    expect(idle.avg).toBeNull();
    expect(idle.rows.some((r) => r.k === "Supply")).toBe(false);
  });

  it("marks traffic inverted: high congestion reads bad", () => {
    const s = newCity(7, 16);
    s.congestion = 0.8;
    s.vehicles = 42;
    const m = legendFor(TRAFFIC_LAYER, s)!;
    expect(m.avg).toBe(0.8);
    expect(m.invert).toBe(true);
    expect(m.rows).toContainEqual({ k: "Vehicles", v: "42", cls: "" });
    expect(m.rows).toContainEqual({ k: "Congestion", v: "80%", cls: "bad" });
  });

  it("reads land value with a happiness row", () => {
    const s = newCity(7, 16);
    s.landValue = 55;
    s.happiness = 80;
    const m = legendFor(LAND_VALUE_LAYER, s)!;
    expect(m.avg).toBeCloseTo(0.55, 5);
    expect(m.rows).toContainEqual({ k: "Happiness", v: "80%", cls: "good" });
  });

  it("keys every row and label through i18n (pt-BR and en)", () => {
    const s = newCity(7, 16);
    s.coverage.transit = 0.5;
    s.utilities.water = { supply: 90, demand: 30 };
    const layers = [...Object.values(COVER), TRAFFIC_LAYER, LAND_VALUE_LAYER];
    for (const layer of layers) {
      const m = legendFor(layer, s)!;
      expect(m, `layer ${layer}`).not.toBeNull();
      for (const key of [m.titleKey, m.descKey, m.lowKey, m.highKey, ...m.rows.map((r) => r.k)]) {
        expect(hasTranslation(key), key).toBe(true);
      }
    }
  });

  it("signatures change only when the rendered numbers do", () => {
    const s = newCity(7, 16);
    const a = legendFor(COVER.FIRE, s)!;
    const b = legendFor(COVER.FIRE, s)!;
    expect(legendSig(a)).toBe(legendSig(b));
    s.coverage.fire = 0.9;
    expect(legendSig(legendFor(COVER.FIRE, s)!)).not.toBe(legendSig(a));
  });
});
