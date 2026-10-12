import { describe, expect, it } from "vitest";
import { applyTool, newCity, placeRoad, step, CityState } from "./sim";
import { createLine, setLineVehicles } from "./transit";
import { deserialize, serialize, SaveError } from "./save";
import { isRaining, RAIN_SPEED_FACTOR } from "./weather";
import { newTraffic, tickTraffic } from "./traffic";
import { FAC, ROAD, cidx } from "./world";

function builtCity(): CityState {
  const s = newCity(21);
  const ey = s.world.entry.y;
  for (let y = ey - 10; y <= ey + 10; y++) for (let x = 0; x <= 40; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e6;
  placeRoad(s, ROAD.AVENUE, [{ x: 3.5, z: ey + 0.5 }, { x: 30.5, z: ey + 0.5 }]);
  placeRoad(s, ROAD.STREET, [{ x: 10.5, z: ey - 1 }, { x: 14, z: ey - 8 }, { x: 26.5, z: ey - 8.5 }]);
  for (let x = 4; x < 30; x++) { applyTool(s, "res", x, ey - 1); applyTool(s, "com", x, ey + 2); }
  applyTool(s, "power", 5, ey + 5);
  applyTool(s, "busstop", 8, ey);
  applyTool(s, "busstop", 22, ey);
  createLine(s, "bus", s.world.stops.map((x) => x.id));
  setLineVehicles(s, s.world.lines[0].id, 3);
  for (let d = 0; d < 120; d++) step(s);
  return s;
}

describe("save and load", () => {
  it("round-trips the player's city exactly", () => {
    const a = builtCity();
    const b = deserialize(serialize(a));
    expect(b.day).toBe(a.day);
    expect(b.money).toBeCloseTo(a.money);
    expect(Array.from(b.world.heights)).toEqual(Array.from(a.world.heights));
    expect(Array.from(b.world.zone)).toEqual(Array.from(a.world.zone));
    expect(Array.from(b.world.level)).toEqual(Array.from(a.world.level));
    expect(Array.from(b.world.facility)).toEqual(Array.from(a.world.facility));
    expect(Array.from(b.world.road)).toEqual(Array.from(a.world.road));
    expect(b.world.segments).toEqual(a.world.segments);
    expect(b.world.stops).toEqual(a.world.stops);
    expect(b.world.lines).toEqual(a.world.lines);
  });

  it("recomputes derived state so a loaded city keeps simulating identically", () => {
    const a = builtCity();
    const b = deserialize(serialize(a));
    expect(Array.from(b.world.cover)).toEqual(Array.from(a.world.cover));
    expect(Array.from(b.world.connected)).toEqual(Array.from(a.world.connected));
    for (let d = 0; d < 60; d++) { step(a); step(b); }
    expect(Array.from(b.world.level)).toEqual(Array.from(a.world.level));
    expect(b.money).toBeCloseTo(a.money, 3);
    expect(b.population).toBeCloseTo(a.population, 3);
  });

  it("rejects damaged, foreign and truncated saves with a clear error", () => {
    const good = JSON.parse(serialize(builtCity()));
    expect(() => deserialize("not json")).toThrow(SaveError);
    expect(() => deserialize(JSON.stringify({ ...good, v: 99 }))).toThrow(/different version/);
    expect(() => deserialize(JSON.stringify({ ...good, zone: "AAAA" }))).toThrow(/damaged/);
    expect(() => deserialize(JSON.stringify({ ...good, size: 1 }))).toThrow(/damaged/);
  });

  it("keeps the terrain preset, and old saves without one load as plains", () => {
    const s = newCity(5, 96, "mountain");
    expect(deserialize(serialize(s)).world.biome).toBe("mountain");
    const old = JSON.parse(serialize(newCity(5)));
    delete old.biome;
    expect(deserialize(JSON.stringify(old)).world.biome).toBe("plains");
  });

  it("loads every facility kind, including the late ones (hospital, city hall, substation)", () => {
    const s = builtCity();
    const w = s.world;
    const ey = w.entry.y;
    for (const [k, kind] of [[2, FAC.HOSPITAL], [4, FAC.MUSEUM], [6, FAC.CITYHALL], [8, FAC.SUBSTATION]] as const) {
      w.facility[cidx(w, 10 + k, ey - 6)] = kind;
    }
    const back = deserialize(serialize(s));
    expect(back.world.facility[cidx(back.world, 16, ey - 6)]).toBe(FAC.CITYHALL);
    expect(back.world.facility[cidx(back.world, 18, ey - 6)]).toBe(FAC.SUBSTATION);
  });

  it("stays small enough for localStorage", () => {
    expect(serialize(builtCity()).length).toBeLessThan(400_000);
  });
});

describe("weather", () => {
  it("is deterministic and rains about a quarter of the time", () => {
    let rainy = 0;
    for (let d = 0; d < 3000; d++) {
      expect(isRaining(d, 5)).toBe(isRaining(d, 5));
      if (isRaining(d, 5)) rainy++;
    }
    expect(rainy / 3000).toBeGreaterThan(0.12);
    expect(rainy / 3000).toBeLessThan(0.4);
  });

  it("changes in multi-day fronts, not every day", () => {
    let flips = 0;
    for (let d = 1; d < 600; d++) if (isRaining(d, 9) !== isRaining(d - 1, 9)) flips++;
    expect(flips).toBeLessThan(600 / 5);
  });

  it("rain slows traffic", () => {
    const run = (raining: boolean) => {
      const s = builtCity();
      for (let i = 0; i < s.world.zone.length; i++) if (s.world.zone[i]) s.world.level[i] = 2;
      s.world.revision++;
      s.population = 600;
      s.capacity = { res: 600, com: 200, ind: 0 };
      const t = newTraffic(s.world.size);
      let travelled = 0;
      for (let i = 0; i < 200; i++) {
        s.raining = raining;
        const before = new Map(t.vehicles.map((v) => [v.id, v.progress]));
        tickTraffic(s, t, 0.1);
        for (const v of t.vehicles) travelled += v.progress - (before.get(v.id) ?? 0);
      }
      return travelled;
    };
    expect(run(true)).toBeLessThan(run(false));
    expect(RAIN_SPEED_FACTOR).toBeLessThan(1);
  });
});

describe("save validation (review fixes)", () => {
  const good = () => JSON.parse(serialize(builtCity()));
  it("turns structural damage into a SaveError, never a raw TypeError", () => {
    expect(() => deserialize(JSON.stringify({ ...good(), segments: null }))).toThrow(SaveError);
    expect(() => deserialize(JSON.stringify({ ...good(), stops: [{ id: 1, kind: "bus", tile: 99999999 }] }))).toThrow(SaveError);
    expect(() => deserialize(JSON.stringify({ ...good(), lines: [{ stops: [42], vehicles: 1 }] }))).toThrow(SaveError);
    expect(() => deserialize(JSON.stringify({ ...good(), money: "lots" }))).toThrow(SaveError);
    expect(() => deserialize(JSON.stringify({ ...good(), entry: null }))).toThrow(SaveError);
  });

  it("rejects out-of-range facility and level values", () => {
    const f = good();
    const raw = atob(f.facility).split("").map((c) => c.charCodeAt(0));
    raw[0] = 200;
    f.facility = btoa(String.fromCharCode(...raw));
    expect(() => deserialize(JSON.stringify(f))).toThrow(SaveError);
  });
});
