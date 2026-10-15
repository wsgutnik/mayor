import { describe, expect, it } from "vitest";
import { applyTool, newCity, placeRoad, step, CityState } from "./sim";
import { createLine, setLineVehicles } from "./transit";
import { deserialize, serialize, SaveError, SAVE_VERSION, migrateV1Cells } from "./save";
import { isRaining, RAIN_SPEED_FACTOR } from "./weather";
import { newTraffic, tickTraffic } from "./traffic";
import { FAC, ROAD, cidx, idx } from "./world";
import type { ZoneBlockSet } from "./zoneblocks";

function builtCity(): CityState {
  const s = newCity(21);
  const ey = s.world.entry.y;
  for (let y = ey - 10; y <= ey + 10; y++) for (let x = 0; x <= 40; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e6;
  placeRoad(s, ROAD.AVENUE, [{ x: 3.5, z: ey + 0.5 }, { x: 30.5, z: ey + 0.5 }]);
  placeRoad(s, ROAD.STREET, [{ x: 10.5, z: ey - 1 }, { x: 14, z: ey - 8 }, { x: 26.5, z: ey - 8.5 }]);
  // zinv: row ey - 1 lies 0.4 under the avenue's drawn asphalt (centreline ey + 0.5); ey - 2 is the first free row.
  for (let x = 4; x < 30; x++) { applyTool(s, "res", x, ey - 2); applyTool(s, "com", x, ey + 2); }
  applyTool(s, "power", 5, ey + 5);
  applyTool(s, "busstop", 8, ey);
  applyTool(s, "busstop", 22, ey);
  createLine(s, "bus", s.world.stops.map((x) => x.id));
  setLineVehicles(s, s.world.lines[0].id, 3);
  for (let d = 0; d < 120; d++) step(s);
  return s;
}

function orientedCity(): CityState {
  const s = newCity(44);
  s.world.zoning = "oriented";
  const ey = s.world.entry.y;
  s.money = 1e6;
  placeRoad(s, ROAD.STREET, [{ x: 4.5, z: ey + 0.5 }, { x: 28.5, z: ey + 0.5 }]);
  for (let x = 5; x < 18; x++) applyTool(s, "res", x, ey - 1);
  for (let d = 0; d < 80; d++) step(s);
  return s;
}

function cellState(s: CityState): unknown[] {
  const set = s.world.cells as unknown as ZoneBlockSet;
  return [...set.blocks.values()].map((b) => ({
    key: b.key,
    rows: b.rows,
    zone: [...b.zone],
    level: [...b.level],
    lot: [...b.lot],
  }));
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

  it("serializes facility anchors and loads old saves without them", () => {
    const s = newCity(31);
    const w = s.world;
    const ey = w.entry.y;
    for (let y = ey - 4; y <= ey + 4; y++) for (let x = 0; x <= 20; x++) w.heights[cidx(w, x, y)] = 0.35;
    s.money = 1e6;
    for (let x = 3; x <= 16; x++) applyTool(s, "road", x, ey);
    expect(applyTool(s, "hospital", 12, ey + 2).ok).toBe(true);
    const json = serialize(s);
    const raw = JSON.parse(json);
    const anchor = raw.facilityAnchors.find((a: { kind: number }) => a.kind === FAC.HOSPITAL);
    expect(anchor).toMatchObject({ kind: FAC.HOSPITAL });
    expect(anchor.cx).toBeTypeOf("number");
    expect(anchor.cz).toBeTypeOf("number");
    expect(anchor.yaw).toBeTypeOf("number");
    const back = deserialize(json);
    expect(back.world.facilityAnchors).toEqual(s.world.facilityAnchors);
    delete raw.facilityAnchors;
    const old = deserialize(JSON.stringify(raw));
    expect(old.world.facility[idx(old.world, 12, ey + 2)]).toBe(FAC.HOSPITAL);
    expect(old.world.facilityAnchors).toEqual([]);
  });

  it("rejects damaged facility anchors", () => {
    const s = newCity(32);
    const w = s.world;
    const ey = w.entry.y;
    for (let y = ey - 4; y <= ey + 4; y++) for (let x = 0; x <= 20; x++) w.heights[cidx(w, x, y)] = 0.35;
    s.money = 1e6;
    for (let x = 3; x <= 16; x++) applyTool(s, "road", x, ey);
    expect(applyTool(s, "hospital", 12, ey + 2).ok).toBe(true);
    const raw = JSON.parse(serialize(s));
    const broken = { ...raw, facilityAnchors: [{ x: 12, y: ey + 2, kind: FAC.HOSPITAL, w: 2, h: 2 }, { x: 13, y: ey + 2, kind: FAC.HOSPITAL, w: 2, h: 2 }] };
    expect(() => deserialize(JSON.stringify(broken))).toThrow(SaveError);
    raw.facilityAnchors[0].kind = FAC.CITYHALL;
    expect(() => deserialize(JSON.stringify(raw))).toThrow(SaveError);
  });

  it("rejects duplicate segment ids, bad base64 and non-finite heights, and keeps id counters above stored ids", () => {
    const s = builtCity();
    const json = serialize(s);
    const f = JSON.parse(json);
    const dup = JSON.parse(json);
    dup.segments.push({ ...dup.segments[0] });
    expect(() => deserialize(JSON.stringify(dup))).toThrow(SaveError);
    const b64 = JSON.parse(json);
    b64.zone = "%%%not-base64%%%";
    expect(() => deserialize(JSON.stringify(b64))).toThrow(SaveError);
    const nan = JSON.parse(json);
    const raw = Uint8Array.from(atob(nan.heights), (c) => c.charCodeAt(0));
    new DataView(raw.buffer).setFloat32(0, NaN, true);
    nan.heights = btoa(String.fromCharCode(...raw));
    expect(() => deserialize(JSON.stringify(nan))).toThrow(SaveError);
    // a counter that lags behind stored ids is lifted above them
    f.nextSegmentId = 1;
    const back = deserialize(JSON.stringify(f));
    const maxId = Math.max(...back.world.segments.map((g) => g.id));
    expect(back.world.nextSegmentId).toBeGreaterThan(maxId);
  });

  it("stays small enough for localStorage", () => {
    expect(serialize(builtCity()).length).toBeLessThan(400_000);
  });

  it("writes v2 oriented saves and round-trips cells, lots, ids, mirror and simulation", () => {
    const a = orientedCity();
    const file = JSON.parse(serialize(a));
    expect(file.v).toBe(SAVE_VERSION);
    expect(file.zoning).toBe("oriented");
    const b = deserialize(JSON.stringify(file));
    expect(b.world.zoning).toBe("oriented");
    expect(cellState(b)).toEqual(cellState(a));
    expect(b.world.olots).toEqual(a.world.olots);
    expect(b.world.nextOLotId).toBe(a.world.nextOLotId);
    expect(Array.from(b.world.zone)).toEqual(Array.from(a.world.zone));
    expect(Array.from(b.world.level)).toEqual(Array.from(a.world.level));
    for (let d = 0; d < 60; d++) { step(a); step(b); }
    expect(Array.from(b.world.level)).toEqual(Array.from(a.world.level));
    expect(b.population).toBeCloseTo(a.population, 3);
    expect(serialize(a).length).toBeLessThan(400_000);
  });

  it("round-trips known landmark ids and harmlessly drops unknown future ids", () => {
    const a = orientedCity();
    const lot = a.world.olots?.find((l) => l.w * l.d >= 1);
    expect(lot).toBeTruthy();
    lot!.landmark = "opera";
    const file = JSON.parse(serialize(a));
    expect(file.lots.some((l: { landmark?: string }) => l.landmark === "opera")).toBe(true);
    expect(deserialize(JSON.stringify(file)).world.olots?.some((l) => l.landmark === "opera")).toBe(true);
    file.lots[0].landmark = "removed_from_catalog";
    expect(deserialize(JSON.stringify(file)).world.olots?.find((l) => l.id === file.lots[0].id)?.landmark).toBeUndefined();
  });

  it("migrates a v1 tile save into oriented cells without dropping axis-aligned zoning", () => {
    const s = newCity(77);
    s.money = 1e6;
    const ey = s.world.entry.y;
    placeRoad(s, ROAD.STREET, [{ x: 4.5, z: ey + 0.5 }, { x: 20.5, z: ey + 0.5 }]);
    for (let x = 5; x < 18; x++) applyTool(s, "res", x, ey - 1);
    const f = JSON.parse(serialize(s));
    const tileLoaded = deserialize(JSON.stringify(f));
    const migrated = migrateV1Cells(tileLoaded.world);
    expect(migrated.dropped.length).toBe(0);
    f.zoning = "oriented";
    const b = deserialize(JSON.stringify(f));
    expect(b.world.zoning).toBe("oriented");
    expect(Array.from(b.world.zone).filter(Boolean).length).toBe(Array.from(s.world.zone).filter(Boolean).length);
  });

  it("opens a v2 save with the flag off from the saved mirror", () => {
    const f = JSON.parse(serialize(orientedCity()));
    f.zoning = "tiles";
    const b = deserialize(JSON.stringify(f));
    expect(b.world.zoning).toBe("tiles");
    expect(Array.from(b.world.zone)).toEqual(Array.from(Uint8Array.from(atob(f.zone), (c) => c.charCodeAt(0))));
    expect(b.world.lots.length).toBeGreaterThan(0);
  });

  it("rejects damaged oriented cells and lots", () => {
    const good = JSON.parse(serialize(orientedCity()));
    const badSide = structuredClone(good);
    badSide.cells[0].side = 0;
    expect(() => deserialize(JSON.stringify(badSide))).toThrow(SaveError);
    const badRows = structuredClone(good);
    badRows.cells[0].rows += 1;
    expect(() => deserialize(JSON.stringify(badRows))).toThrow(SaveError);
    const overlap = structuredClone(good);
    overlap.lots.push({ ...overlap.lots[0], id: overlap.lots[0].id + 1000 });
    expect(() => deserialize(JSON.stringify(overlap))).toThrow(SaveError);
  });

  it("keeps oriented lot counters above stored ids", () => {
    const f = JSON.parse(serialize(orientedCity()));
    f.nextOLotId = 1;
    const b = deserialize(JSON.stringify(f));
    const maxId = Math.max(...(b.world.olots ?? []).map((l) => l.id));
    expect(b.world.nextOLotId).toBeGreaterThan(maxId);
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
      // Mean progress per vehicle-tick: total distance is set by the spawn
      // rate (slower cars just stay on the road longer), the mean is not.
      let travelled = 0, vehicleTicks = 0;
      for (let i = 0; i < 200; i++) {
        s.raining = raining;
        const before = new Map(t.vehicles.map((v) => [v.id, v.progress]));
        tickTraffic(s, t, 0.1);
        vehicleTicks += t.vehicles.length;
        for (const v of t.vehicles) travelled += v.progress - (before.get(v.id) ?? 0);
      }
      return travelled / Math.max(1, vehicleTicks);
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
