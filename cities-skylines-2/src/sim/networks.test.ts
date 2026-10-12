import { describe, expect, it } from "vitest";
import { applyTool, newCity, USAGE, CityState } from "./sim";
import { COVER, FAC, cidx, idx, updateCoverage } from "./world";
import {
  NET, demandOf, facilityLinks, floodRoads, nearestRoadTile, withinReach,
} from "./networks";

/** Flat land around the entry and a full wallet, so layouts never depend on the seed. */
function flatCity() {
  const s = newCity(11);
  const ey = s.world.entry.y;
  for (let y = ey - 14; y <= ey + 14; y++)
    for (let x = 0; x <= 50; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e6;
  return { s, ey };
}

/** A street row with unbuilt homes on one side and shops on the other. */
function street(s: CityState, ey: number, x0 = 3, x1 = 12, y = ey) {
  for (let x = x0; x <= x1; x++) applyTool(s, "road", x, y);
  for (let x = x0; x <= x1; x++) {
    applyTool(s, "res", x, y - 1);
    applyTool(s, "com", x, y + 1);
  }
}

const chebyshev = (ax: number, ay: number, b: number, size: number) =>
  Math.max(Math.abs(ax - (b % size)), Math.abs(ay - ((b / size) | 0)));

describe("demand", () => {
  it("matches the simulation usage table for every zone and level", () => {
    const kinds = [[1, "res"], [2, "com"], [3, "ind"]] as const;
    for (const [z, k] of kinds) for (let l = 0; l <= 3; l++) expect(demandOf(z, l)).toBe(USAGE[k][l]);
  });
});

describe("facility links", () => {
  it("joins a facility to its nearest road tile, and ignores ones too far away", () => {
    const { s, ey } = flatCity();
    street(s, ey);
    s.world.facility[idx(s.world, 5, ey + 2)] = FAC.POWER;
    s.world.facility[idx(s.world, 30, ey + 10)] = FAC.POWER; // no road within 5
    const links = facilityLinks(s.world).filter((l) => l.net === "power");
    expect(links).toHaveLength(1);
    expect(links[0].facility).toBe(idx(s.world, 5, ey + 2));
    expect(s.world.road[links[0].entry]).toBeGreaterThan(0);
    expect(chebyshev(5, ey + 2, links[0].entry, s.world.size)).toBeLessThanOrEqual(2);
    // Deterministic: ties always resolve to the same tile.
    expect(nearestRoadTile(s.world, 5, ey + 2)).toBe(links[0].entry);
  });

  it("links pumps and outlets to the water and sewage nets", () => {
    const { s, ey } = flatCity();
    street(s, ey);
    s.world.facility[idx(s.world, 5, ey + 2)] = FAC.WATER;
    s.world.facility[idx(s.world, 6, ey + 2)] = FAC.SEWAGE;
    const nets = facilityLinks(s.world).map((l) => l.net).sort();
    expect(nets).toEqual(["sewage", "water"]);
  });
});

describe("flood fill", () => {
  it("measures network distance along roads and stops at gaps", () => {
    const { s, ey } = flatCity();
    street(s, ey);
    const w = s.world;
    const dist = floodRoads(w, [idx(w, 3, ey)]);
    expect(dist[idx(w, 3, ey)]).toBe(0);
    expect(dist[idx(w, 10, ey)]).toBe(7);
    w.road[idx(w, 10, ey + 8)] = 1; // an unconnected island tile
    expect(floodRoads(w, [idx(w, 3, ey)])[idx(w, 10, ey + 8)]).toBe(-1);
  });

  it("serves buildings along the connected road and lays pipes under it", () => {
    const { s, ey } = flatCity();
    street(s, ey);
    const w = s.world;
    w.facility[idx(w, 4, ey + 2)] = FAC.POWER;
    w.facility[idx(w, 5, ey + 2)] = FAC.WATER;
    w.facility[idx(w, 6, ey + 2)] = FAC.SEWAGE;
    updateCoverage(w);
    // Unbuilt lots are covered too, so they can grow.
    expect(w.cover[idx(w, 10, ey - 1)] & (COVER.POWER | COVER.WATER | COVER.SEWAGE))
      .toBe(COVER.POWER | COVER.WATER | COVER.SEWAGE);
    expect(w.nets[idx(w, 10, ey)]).toBe(NET.POWER | NET.WATER | NET.SEWAGE);
    // The connected facilities read as covered on their own net.
    expect(w.cover[idx(w, 4, ey + 2)] & COVER.POWER).toBeTruthy();
    // Empty land far from the network stays dark.
    expect(w.cover[idx(w, 40, ey)]).toBe(0);
    expect(w.nets[idx(w, 40, ey)]).toBe(0);
  });

  it("cuts service past a broken road, and dry tiles carry no pipe", () => {
    const { s, ey } = flatCity();
    street(s, ey, 3, 20);
    const w = s.world;
    w.facility[idx(w, 4, ey + 2)] = FAC.POWER;
    w.facility[idx(w, 5, ey + 2)] = FAC.WATER;
    updateCoverage(w);
    expect(w.cover[idx(w, 18, ey - 1)] & COVER.POWER).toBeTruthy();
    w.road[idx(w, 12, ey)] = 0; // the break
    updateCoverage(w);
    expect(w.cover[idx(w, 8, ey - 1)] & COVER.POWER).toBeTruthy();
    expect(w.cover[idx(w, 18, ey - 1)] & COVER.POWER).toBeFalsy();
    expect(w.cover[idx(w, 18, ey - 1)] & COVER.WATER).toBeFalsy();
    expect(w.nets[idx(w, 15, ey)]).toBe(0);
    expect(w.nets[idx(w, 8, ey)] & NET.POWER).toBeTruthy();
  });

  it("gives each net its own pipes: a pump waters but does not power", () => {
    const { s, ey } = flatCity();
    street(s, ey);
    const w = s.world;
    w.facility[idx(w, 5, ey + 2)] = FAC.WATER;
    updateCoverage(w);
    const b = idx(w, 8, ey - 1);
    expect(w.cover[b] & COVER.WATER).toBeTruthy();
    expect(w.cover[b] & (COVER.POWER | COVER.SEWAGE)).toBe(0);
    expect(w.nets[idx(w, 8, ey)]).toBe(NET.WATER);
  });

  it("runs power under highways but fronts no lots from them", () => {
    const { s, ey } = flatCity();
    const w = s.world;
    for (let x = 3; x <= 12; x++) w.road[idx(w, x, ey)] = 3;
    w.facility[idx(w, 5, ey + 2)] = FAC.POWER;
    w.zone[idx(w, 8, ey - 1)] = 1;
    updateCoverage(w);
    expect(w.nets[idx(w, 8, ey)] & NET.POWER).toBeTruthy();
    expect(w.cover[idx(w, 8, ey - 1)] & COVER.POWER).toBeFalsy();
  });
});

describe("capacity", () => {
  it("serves the nearest buildings first while the supply lasts", () => {
    const { s, ey } = flatCity();
    street(s, ey, 3, 30);
    const w = s.world;
    for (let x = 3; x <= 30; x++) {
      w.zone[idx(w, x, ey - 1)] = 1;
      w.zone[idx(w, x, ey + 1)] = 1;
      w.level[idx(w, x, ey - 1)] = 3;
      w.level[idx(w, x, ey + 1)] = 3;
    }
    w.facility[idx(w, 3, ey + 2)] = FAC.POWER; // 120 units, 10 per home
    w.facility[idx(w, 4, ey + 2)] = FAC.WATER; // 90 units
    updateCoverage(w);
    let powered = 0, watered = 0;
    for (let x = 3; x <= 30; x++) {
      for (const y of [ey - 1, ey + 1]) {
        if (w.cover[idx(w, x, y)] & COVER.POWER) powered++;
        if (w.cover[idx(w, x, y)] & COVER.WATER) watered++;
      }
    }
    expect(powered).toBe(12);
    expect(watered).toBe(9);
    expect(w.cover[idx(w, 3, ey - 1)] & COVER.POWER).toBeTruthy();
    expect(w.cover[idx(w, 30, ey - 1)] & COVER.POWER).toBeFalsy();
  });

  it("keeps unbuilt lots reserving level-1 demand, so near lots grow first", () => {
    const { s, ey } = flatCity();
    street(s, ey, 3, 30);
    const w = s.world;
    w.facility[idx(w, 3, ey + 2)] = FAC.POWER;
    w.facility[idx(w, 3, ey + 3)] = FAC.WATER;
    updateCoverage(w);
    // 56 lots × 2 units oversubscribes the 90-unit pump: the far end stays dry.
    expect(w.cover[idx(w, 3, ey - 1)] & COVER.WATER).toBeTruthy();
    expect(w.cover[idx(w, 30, ey - 1)] & COVER.WATER).toBeFalsy();
  });
});

describe("substations", () => {
  it("extend the power network onto disconnected roads, sharing the plants' supply", () => {
    const { s, ey } = flatCity();
    street(s, ey, 3, 12);
    street(s, ey, 3, 12, ey + 8); // island, no road to the entry
    const w = s.world;
    w.facility[idx(w, 4, ey + 2)] = FAC.POWER;
    w.facility[idx(w, 4, ey + 10)] = FAC.SUBSTATION;
    updateCoverage(w);
    expect(w.cover[idx(w, 8, ey + 7)] & COVER.POWER).toBeTruthy();
    expect(w.nets[idx(w, 8, ey + 8)] & NET.POWER).toBeTruthy();
  });

  it("carry nothing without a plant behind them", () => {
    const { s, ey } = flatCity();
    street(s, ey);
    const w = s.world;
    w.facility[idx(w, 5, ey + 2)] = FAC.SUBSTATION;
    updateCoverage(w);
    expect(w.cover[idx(w, 8, ey - 1)] & COVER.POWER).toBeFalsy();
    expect(w.nets[idx(w, 8, ey)]).toBe(0);
  });
});

describe("frontage reach", () => {
  it("needs a flooded road tile at the lot's frontage", () => {
    const { s, ey } = flatCity();
    street(s, ey);
    const w = s.world;
    const dist = floodRoads(w, [idx(w, 3, ey)]);
    expect(withinReach(w, dist, idx(w, 10, ey))).toBe(true);
    expect(withinReach(w, dist, -1)).toBe(false);
    expect(withinReach(w, dist, idx(w, 10, ey - 1))).toBe(false); // not a road
    const dry = floodRoads(w, []);
    expect(withinReach(w, dry, idx(w, 10, ey))).toBe(false);
  });
});
