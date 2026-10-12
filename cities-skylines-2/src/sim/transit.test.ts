import { describe, expect, it } from "vitest";
import { applyTool, newCity, placeRoad, step, CityState } from "./sim";
import { createLine, setLineVehicles, removeLine, stopAt, transitUpkeep, updateTransit, VEHICLE_COST } from "./transit";
import { newTraffic, tickTraffic } from "./traffic";
import { ROAD, FAC, cidx, idx, updateConnectivity, updateCoverage, COVER } from "./world";

function flat(s: CityState) {
  const ey = s.world.entry.y;
  for (let y = ey - 14; y <= ey + 14; y++)
    for (let x = 0; x <= 50; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  return ey;
}

/** An avenue with homes on one side, jobs on the other, and two bus stops at the ends. */
function town() {
  const s = newCity(5);
  const ey = flat(s);
  s.money = 1e6;
  placeRoad(s, ROAD.STREET, [{ x: 3.5, z: ey + 0.5 }, { x: 30.5, z: ey + 0.5 }]);
  for (let x = 4; x < 30; x++) {
    applyTool(s, "res", x, ey - 1);
    applyTool(s, x < 18 ? "com" : "ind", x, ey + 1);
  }
  for (let i = 0; i < s.world.zone.length; i++) if (s.world.zone[i]) s.world.level[i] = 2;
  s.capacity = { res: 520, com: 140, ind: 200 };
  s.population = 520;
  updateConnectivity(s.world);
  return { s, ey };
}

describe("bus stops and lines", () => {
  it("bus stops go on streets, once, and cost money", () => {
    const { s, ey } = town();
    const m = s.money;
    expect(applyTool(s, "busstop", 5, ey).ok).toBe(true);
    expect(m - s.money).toBe(100);
    expect(applyTool(s, "busstop", 5, ey).ok).toBe(false);
    expect(applyTool(s, "busstop", 5, ey - 5).ok).toBe(false); // not a road
  });

  it("refuses highways", () => {
    const { s, ey } = town();
    placeRoad(s, ROAD.HIGHWAY, [{ x: 3.5, z: ey + 6.5 }, { x: 14.5, z: ey + 6.5 }]);
    expect(applyTool(s, "busstop", 8, ey + 6).ok).toBe(false);
  });

  it("a line needs two reachable stops of one kind", () => {
    const { s, ey } = town();
    applyTool(s, "busstop", 6, ey);
    applyTool(s, "busstop", 24, ey);
    const a = stopAt(s.world, idx(s.world, 6, ey))!, b = stopAt(s.world, idx(s.world, 24, ey))!;
    expect(createLine(s, "bus", [a.id]).ok).toBe(false);
    expect(createLine(s, "metro", [a.id, b.id]).ok).toBe(false);
    expect(createLine(s, "bus", [a.id, b.id]).ok).toBe(true);
    expect(s.world.lines).toHaveLength(1);
    expect(s.world.lines[0].vehicles).toBe(1);
  });

  it("refuses a line whose stops no road connects", () => {
    const { s, ey } = town();
    placeRoad(s, ROAD.STREET, [{ x: 4.5, z: ey + 8.5 }, { x: 14.5, z: ey + 8.5 }]); // island
    applyTool(s, "busstop", 6, ey);
    applyTool(s, "busstop", 10, ey + 8);
    const ids = [idx(s.world, 6, ey), idx(s.world, 10, ey + 8)].map((t) => stopAt(s.world, t)!.id);
    expect(createLine(s, "bus", ids)).toEqual({ ok: false, reason: "No road connects these stops" });
  });

  it("bulldozing a stop removes it and a line left with one stop", () => {
    const { s, ey } = town();
    applyTool(s, "busstop", 6, ey);
    applyTool(s, "busstop", 24, ey);
    const ids = [6, 24].map((x) => stopAt(s.world, idx(s.world, x, ey))!.id);
    createLine(s, "bus", ids);
    applyTool(s, "bulldoze", 24, ey);
    expect(s.world.lines).toHaveLength(0);
    expect(s.world.road[idx(s.world, 24, ey)]).toBe(ROAD.STREET); // road survives, only the stop went
  });
});

describe("ridership and effects", () => {
  function withLine(kind: "bus" | "metro" = "bus") {
    const { s, ey } = town();
    if (kind === "bus") {
      applyTool(s, "busstop", 8, ey);
      applyTool(s, "busstop", 22, ey);
    } else {
      applyTool(s, "metro", 8, ey - 4);
      applyTool(s, "metro", 22, ey - 4);
    }
    const stops = s.world.stops.filter((x) => x.kind === kind).map((x) => x.id);
    expect(createLine(s, kind, stops).ok).toBe(true);
    return { s, ey };
  }

  it("carries riders, pays fares and takes cars off the road", () => {
    const { s } = withLine();
    const before = s.money;
    updateTransit(s);
    expect(s.transit.riders).toBeGreaterThan(0);
    expect(s.transit.share).toBeGreaterThan(0);
    expect(s.money).toBeGreaterThan(before);
  });

  it("is limited by vehicle capacity, which more vehicles raise", () => {
    const { s } = withLine();
    s.population = 5000; s.capacity.res = 5000;
    updateTransit(s);
    const one = s.transit.riders;
    setLineVehicles(s, s.world.lines[0].id, 4);
    updateTransit(s);
    expect(s.transit.riders).toBeGreaterThanOrEqual(one);
    expect(s.world.lines[0].vehicles).toBe(4);
  });

  it("buying vehicles costs money and upkeep scales with them", () => {
    const { s } = withLine();
    const m = s.money;
    const base = transitUpkeep(s.world);
    setLineVehicles(s, s.world.lines[0].id, 3);
    expect(m - s.money).toBe(2 * VEHICLE_COST.bus);
    expect(transitUpkeep(s.world)).toBe(base + 2 * 40);
  });

  it("bus stops raise coverage and happiness", () => {
    const { s, ey } = town();
    // Basic utilities everywhere, so the baseline happiness is well above zero.
    // Networks carry by capacity, so the town gets a plant, pump and outlet per
    // neighbourhood instead of the single set that radius coverage needed.
    for (const [x, f] of [
      [8, FAC.POWER], [16, FAC.POWER], [24, FAC.POWER],
      [9, FAC.WATER], [17, FAC.WATER], [25, FAC.WATER],
      [10, FAC.SEWAGE], [18, FAC.SEWAGE], [26, FAC.SEWAGE],
      [11, FAC.LANDFILL], [19, FAC.LANDFILL],
      [14, FAC.POLICE], [15, FAC.CLINIC],
    ] as const) {
      s.world.facility[idx(s.world, x, ey + 4)] = f;
    }
    updateCoverage(s.world);
    step(s);
    const base = s.happiness;
    applyTool(s, "busstop", 12, ey);
    applyTool(s, "busstop", 20, ey);
    updateCoverage(s.world);
    expect(s.world.cover[idx(s.world, 12, ey - 1)] & COVER.TRANSIT).toBeTruthy();
    step(s);
    expect(s.coverage.transit).toBeGreaterThan(0.3);
    expect(s.happiness).toBeGreaterThan(base);
  });

  it("transit share reduces how many cars are spawned", () => {
    const run = (share: number) => {
      const { s } = town();
      s.transit.share = share;
      const t = newTraffic(s.world.size);
      let spawned = 0;
      for (let i = 0; i < 300; i++) { s.transit.share = share; tickTraffic(s, t, 0.1); spawned = t.completed + t.vehicles.length; }
      return spawned;
    };
    expect(run(0.8)).toBeLessThan(run(0));
  });
});

describe("vehicles on lines", () => {
  it("buses loop between stops over the road network", () => {
    const { s, ey } = town();
    applyTool(s, "busstop", 8, ey);
    applyTool(s, "busstop", 22, ey);
    const ids = s.world.stops.map((x) => x.id);
    createLine(s, "bus", ids);
    setLineVehicles(s, s.world.lines[0].id, 2);
    const t = newTraffic(s.world.size);
    tickTraffic(s, t, 0.01);
    expect(t.transit).toHaveLength(2);
    const seen = new Set<number>();
    for (let i = 0; i < 1200; i++) { tickTraffic(s, t, 0.1); t.transit.forEach((v) => seen.add(v.stopIdx)); }
    expect(seen.size).toBe(2); // visited both stops
    expect(t.transit.every((v) => v.tiles.every((x) => s.world.road[x] > 0))).toBe(true);
  });

  it("metro stations create stops, and trains cross land without roads", () => {
    const { s, ey } = town();
    expect(applyTool(s, "metro", 8, ey - 6).ok).toBe(true);
    expect(applyTool(s, "metro", 22, ey - 9).ok).toBe(true);
    const ids = s.world.stops.filter((x) => x.kind === "metro").map((x) => x.id);
    expect(ids).toHaveLength(2);
    expect(createLine(s, "metro", ids).ok).toBe(true);
    const t = newTraffic(s.world.size);
    tickTraffic(s, t, 0.01);
    expect(t.transit).toHaveLength(1);
    for (let i = 0; i < 300; i++) tickTraffic(s, t, 0.1);
    expect(t.transit).toHaveLength(1);
    expect(t.transit[0].kind).toBe("metro");
  });

  it("vehicles vanish when their line is removed", () => {
    const { s, ey } = town();
    applyTool(s, "busstop", 8, ey);
    applyTool(s, "busstop", 22, ey);
    createLine(s, "bus", s.world.stops.map((x) => x.id));
    const t = newTraffic(s.world.size);
    tickTraffic(s, t, 0.01);
    expect(t.transit.length).toBeGreaterThan(0);
    removeLine(s, s.world.lines[0].id);
    tickTraffic(s, t, 0.01);
    expect(t.transit).toHaveLength(0);
  });
});

describe("review fixes", () => {
  it("bulldozing a road segment removes every bus stop that was on it", () => {
    const { s, ey } = town();
    applyTool(s, "busstop", 8, ey);
    applyTool(s, "busstop", 22, ey);
    expect(s.world.stops).toHaveLength(2);
    applyTool(s, "bulldoze", 15, ey); // a third tile of the same segment
    expect(s.world.stops).toHaveLength(0);
    expect(s.world.lines).toHaveLength(0);
  });

  it("a bus line whose road was cut stops earning", () => {
    const { s, ey } = town();
    // two roads joined by a link we can remove
    expect(placeRoad(s, ROAD.STREET, [{ x: 12.5, z: ey - 0.5 }, { x: 12.5, z: ey - 7.5 }]).ok).toBe(true);
    expect(placeRoad(s, ROAD.STREET, [{ x: 12.5, z: ey - 7.5 }, { x: 28.5, z: ey - 7.5 }]).ok).toBe(true);
    applyTool(s, "busstop", 8, ey);
    applyTool(s, "busstop", 24, ey - 8);
    const ids = s.world.stops.map((x) => x.id);
    expect(createLine(s, "bus", ids).ok).toBe(true);
    updateTransit(s);
    expect(s.transit.riders).toBeGreaterThan(0);
    applyTool(s, "bulldoze", 12, ey - 4); // cut the connector (a segment of its own)
    updateTransit(s);
    expect(s.transit.riders).toBe(0);
  });

  it("rejects a line made of one stop listed twice", () => {
    const { s, ey } = town();
    applyTool(s, "busstop", 8, ey);
    const id = s.world.stops[0].id;
    expect(createLine(s, "bus", [id, id]).ok).toBe(false);
  });
});
