import { describe, expect, it } from "vitest";
import { StreetLightFx, assignFxSlots } from "./street-light";
import { highwayLampPositions } from "./roads";
import { blankShowcaseCity } from "../sim/showcase-cases";
import { placeRoad } from "../sim/sim";

describe("StreetLightFx budget", () => {
  it("keeps the first 700 adds, silently drops the rest", () => {
    const fx = new StreetLightFx();
    fx.begin();
    for (let i = 0; i < 750; i++) fx.add(i, 0, 0);
    fx.end();
    expect(fx.pools.count).toBe(700);
    expect(fx.halos.count).toBe(700);
  });

  it("highway lamps claim fx slots before street lamps", () => {
    const street = Array.from({ length: 750 }, (_, i) => ({ x: i, y: 0, z: 0 }));
    const highway = Array.from({ length: 50 }, (_, i) => ({ x: -i - 1, y: 0, z: 0 }));
    const kept = assignFxSlots(street, highway);
    expect(kept.length).toBe(700);
    expect(kept.slice(0, 50)).toEqual(highway);
    expect(kept.slice(50)).toEqual(street.slice(0, 650));
  });

  it("city with >700 street lamps still gets highway night pools", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 3, [{ x: 10.5, z: 40.5 }, { x: 70.5, z: 40.5 }]).ok).toBe(true);
    expect(placeRoad(s, 6, [{ x: 30.5, z: 40.5 }, { x: 36, z: 41.6 }, { x: 40.5, z: 44.5 }]).ok).toBe(true);
    const highway = highwayLampPositions(s.world).map((l) => ({ x: l.x, y: l.y, z: l.z }));
    expect(highway.length).toBeGreaterThan(0);
    // More street lamps than the 700 fx slots (a big city grid).
    const street = Array.from({ length: 750 }, (_, i) => ({ x: i, y: 0, z: 100 + i }));
    const fx = new StreetLightFx();
    fx.begin();
    for (const p of assignFxSlots(street, highway)) fx.add(p.x, p.y, p.z);
    fx.end();
    expect(fx.pools.count).toBe(700);
    // Every highway lamp kept a pool: street lamps filled only the remainder.
    const kept = assignFxSlots(street, highway);
    for (const h of highway) expect(kept).toContainEqual(h);
  });

  it("street-only cities keep the old first-come order", () => {
    const street = Array.from({ length: 750 }, (_, i) => ({ x: i, y: 0, z: 0 }));
    expect(assignFxSlots(street, [])).toEqual(street.slice(0, 700));
  });
});
