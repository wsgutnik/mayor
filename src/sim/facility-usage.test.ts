import { describe, expect, it } from "vitest";
import { BUILDABLE_SHARE, facilityUsage, radiusTiles } from "./facility-usage";
import { networkSources } from "./networks";
import { CAPACITY, CityState, USAGE, applyTool, newCity, placeRoad, refreshDerived } from "./sim";
import { COVER, FAC, FACILITY_INFO, FacilityKind, ROAD, ZONE, cidx, facilityFootprint, idx, updateCoverage } from "./world";

const KINDS = Object.keys(FACILITY_INFO).map(Number) as FacilityKind[];

/** A flat strip along the entry road with a street, so facilities can be stamped beside it. */
function flatCity(): CityState {
  const s = newCity(3);
  const w = s.world;
  const ey = w.entry.y;
  for (let y = ey - 14; y <= ey + 14; y++) for (let x = 0; x <= 60; x++) w.heights[cidx(w, x, y)] = 0.35;
  s.money = 1e7;
  placeRoad(s, ROAD.STREET, [{ x: 3.5, z: ey + 0.5 }, { x: 55.5, z: ey + 0.5 }]);
  return s;
}

/** Stamp a facility straight into the world (bypasses placement rules such as "near water"). */
function stamp(s: CityState, kind: FacilityKind, x: number, y: number): number {
  const w = s.world;
  const f = facilityFootprint(kind);
  for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) w.facility[idx(w, x + dx, y + dy)] = kind;
  (w.facilityAnchors ??= []).push({ x, y, kind, w: f, h: f });
  return idx(w, x, y);
}

/** Level-1 homes on a row of tiles below the road. */
function homes(s: CityState, x0: number, x1: number, y: number, level = 1): void {
  const w = s.world;
  for (let x = x0; x <= x1; x++) { w.zone[idx(w, x, y)] = ZONE.RES; w.level[idx(w, x, y)] = level; }
}

describe("facilityUsage: pre-placement estimates", () => {
  it("returns a full, non-empty usage for every facility kind", () => {
    for (const kind of KINDS) {
      const u = facilityUsage(kind);
      const info = FACILITY_INFO[kind];
      expect(u, `kind ${kind}`).toBeDefined();
      expect(u.mode, `kind ${kind}`).toBeTruthy();
      expect(u.kind).toBe(kind);
      expect(u.upkeep, `kind ${kind}`).toBe(info.upkeep);
      expect(u.upkeep, `kind ${kind}`).toBeGreaterThan(0);
      expect(u.cost, `kind ${kind}`).toBeGreaterThan(0);
      expect(u.footprint).toBe(facilityFootprint(kind));
      expect(u.estimate, `kind ${kind}`).toBeDefined();
      for (const v of [u.estimate.tiles, u.estimate.homes, u.estimate.residents, u.capacity, u.radius]) expect(Number.isFinite(v)).toBe(true);
      // Every kind reports something to act on: capacity, a radius or its whole-city/relay role.
      if (u.mode === "network") { expect(u.capacity).toBeGreaterThan(0); expect(u.estimate.homes).toBeGreaterThan(0); }
      if (u.mode === "coverage" || u.mode === "transit" || u.mode === "garbage") {
        expect(u.radius, `kind ${kind}`).toBeGreaterThan(0);
        expect(u.estimate.homes, `kind ${kind}`).toBeGreaterThan(0);
      }
      if (u.mode === "relay" || u.mode === "citywide") expect(u.estimate.homes).toBe(0);
    }
  });

  it("classifies the new tiers like their families", () => {
    expect(facilityUsage(FAC.POWER_SOLAR).mode).toBe("network");
    expect(facilityUsage(FAC.POWER_LARGE).mode).toBe("network");
    expect(facilityUsage(FAC.WATER_TOWER).mode).toBe("network");
    expect(facilityUsage(FAC.WATER_LARGE).mode).toBe("network");
    expect(facilityUsage(FAC.FIRE_POST).mode).toBe("coverage");
    expect(facilityUsage(FAC.FIRE_HQ).mode).toBe("coverage");
    expect(facilityUsage(FAC.TRAIN_STATION).mode).toBe("transit");
    expect(facilityUsage(FAC.SUBSTATION).mode).toBe("relay");
    expect(facilityUsage(FAC.LANDFILL).mode).toBe("garbage");
    expect(facilityUsage(FAC.CITYHALL).mode).toBe("citywide");
  });

  it("estimates networked homes from capacity and the level-1 demand constant", () => {
    const u = facilityUsage(FAC.POWER);
    expect(u.estimate.homes).toBe(Math.floor(FACILITY_INFO[FAC.POWER].capacity / USAGE.res[1]));
    expect(u.estimate.residents).toBe(u.estimate.homes * CAPACITY.res[1]);
    expect(u.radius).toBe(0);
  });

  it("estimates radius homes from the coverage disc", () => {
    const u = facilityUsage(FAC.FIRE_HQ);
    expect(u.estimate.tiles).toBe(radiusTiles(FACILITY_INFO[FAC.FIRE_HQ].radius));
    expect(u.estimate.homes).toBe(Math.round(u.estimate.tiles * BUILDABLE_SHARE));
    expect(radiusTiles(1)).toBe(5);
    expect(radiusTiles(0)).toBe(0);
  });

  it("keeps tier capacities and radii ordered within each family", () => {
    const cap = (k: FacilityKind) => facilityUsage(k).capacity;
    const rad = (k: FacilityKind) => facilityUsage(k).radius;
    expect(cap(FAC.POWER_SOLAR)).toBeLessThan(cap(FAC.POWER));
    expect(cap(FAC.POWER)).toBeLessThan(cap(FAC.POWER_LARGE));
    expect(cap(FAC.WATER_TOWER)).toBeLessThan(cap(FAC.WATER));
    expect(cap(FAC.WATER)).toBeLessThan(cap(FAC.WATER_LARGE));
    expect(rad(FAC.FIRE_POST)).toBeLessThan(rad(FAC.FIRE));
    expect(rad(FAC.FIRE)).toBeLessThan(rad(FAC.FIRE_HQ));
    expect(facilityUsage(FAC.FIRE_POST).upkeep).toBeLessThan(facilityUsage(FAC.FIRE).upkeep);
    expect(facilityUsage(FAC.FIRE).upkeep).toBeLessThan(facilityUsage(FAC.FIRE_HQ).upkeep);
  });

  it("feeds every utility tier into its road network", () => {
    expect(networkSources("power")).toEqual(expect.arrayContaining([FAC.POWER, FAC.POWER_SOLAR, FAC.POWER_LARGE, FAC.SUBSTATION]));
    expect(networkSources("water")).toEqual(expect.arrayContaining([FAC.WATER, FAC.WATER_TOWER, FAC.WATER_LARGE]));
    expect(networkSources("sewage")).toEqual([FAC.SEWAGE]);
  });
});

describe("facilityUsage: placed facilities", () => {
  it("returns live numbers for every facility kind", () => {
    for (const kind of KINDS) {
      const s = flatCity();
      const ey = s.world.entry.y;
      const tile = stamp(s, kind, 20, ey + 2);
      homes(s, 10, 40, ey - 1);
      updateCoverage(s.world);
      refreshDerived(s);
      const u = facilityUsage(kind, { state: s, tile });
      expect(u.live, `kind ${kind}`).toBeDefined();
      const l = u.live!;
      for (const v of [l.load, l.loadShare, l.netSupply, l.netDemand, l.buildings, l.residents, l.jobs]) expect(Number.isFinite(v), `kind ${kind}`).toBe(true);
      if (u.mode === "network") {
        expect(l.linked, `kind ${kind}`).toBe(true);
        expect(l.netSupply, `kind ${kind}`).toBe(FACILITY_INFO[kind].capacity);
        expect(l.load, `kind ${kind}`).toBeGreaterThan(0);
        expect(l.load).toBeLessThanOrEqual(u.capacity);
      }
      if (u.mode === "coverage" || u.mode === "transit" || u.mode === "citywide") expect(l.buildings, `kind ${kind}`).toBeGreaterThan(0);
      // Any footprint tile gives the same answer as the anchor.
      const f = facilityFootprint(kind);
      if (f === 2) expect(facilityUsage(kind, { state: s, tile: tile + s.world.size + 1 }).live).toEqual(l);
    }
  });

  it("splits network load across sources by capacity", () => {
    const s = flatCity();
    const ey = s.world.entry.y;
    const plant = stamp(s, FAC.POWER, 10, ey + 2);
    const solar = stamp(s, FAC.POWER_SOLAR, 30, ey + 2);
    homes(s, 5, 50, ey - 1, 3);
    updateCoverage(s.world);
    refreshDerived(s);
    const a = facilityUsage(FAC.POWER, { state: s, tile: plant }).live!;
    const b = facilityUsage(FAC.POWER_SOLAR, { state: s, tile: solar }).live!;
    expect(a.netSupply).toBe(FACILITY_INFO[FAC.POWER].capacity + FACILITY_INFO[FAC.POWER_SOLAR].capacity);
    expect(a.loadShare).toBeCloseTo(b.loadShare, 6);
    expect(a.load + b.load).toBeLessThanOrEqual(a.netSupply);
  });

  it("counts transit lines and riders at a train station", () => {
    const s = flatCity();
    const ey = s.world.entry.y;
    expect(applyTool(s, "trainstation", 12, ey + 2).ok).toBe(true);
    const t = s.world.stops.find((st) => st.kind === "train")!.tile;
    const u = facilityUsage(FAC.TRAIN_STATION, { state: s, tile: t });
    expect(u.live!.stops).toBe(1);
    expect(u.live!.lines).toBe(0);
    expect(u.live!.riders).toBe(0);
  });
});

describe("tier utilities reach the city (regression)", () => {
  it("a solar plant alone floods the power network and counts as supply", () => {
    const s = flatCity();
    const ey = s.world.entry.y;
    expect(applyTool(s, "solar", 8, ey + 2).ok).toBe(true);
    const w = s.world;
    expect(w.cover[idx(w, 30, ey)] & COVER.POWER).toBeTruthy();
    refreshDerived(s);
    expect(s.utilities.power.supply).toBe(FACILITY_INFO[FAC.POWER_SOLAR].capacity);
  });

  it("a water tower alone floods the water network and counts as supply", () => {
    const s = flatCity();
    const ey = s.world.entry.y;
    expect(applyTool(s, "watertower", 8, ey + 2).ok).toBe(true);
    const w = s.world;
    expect(w.cover[idx(w, 30, ey)] & COVER.WATER).toBeTruthy();
    refreshDerived(s);
    expect(s.utilities.water.supply).toBe(FACILITY_INFO[FAC.WATER_TOWER].capacity);
  });
});
