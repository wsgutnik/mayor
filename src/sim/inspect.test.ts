import { describe, expect, it } from "vitest";
import { describeTile } from "./inspect";
import { applyTool, newCity, placeRoad } from "./sim";
import { CATALOG, entryByNumber, zoneEntries, pickZoneEntry } from "./catalog";
import { FAC, ZONE, cidx, idx } from "./world";

const city = () => {
  const s = newCity(3);
  const ey = s.world.entry.y;
  for (let y = ey - 8; y <= ey + 8; y++) for (let x = 0; x <= 30; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e6;
  return { s, ey };
};

describe("catalog", () => {
  it("lists the 84 kit buildings once each, numbered 1 to 84", () => {
    expect(CATALOG).toHaveLength(84);
    expect(CATALOG.map((c) => c.n)).toEqual(Array.from({ length: 84 }, (_, i) => i + 1));
    expect(entryByNumber(24)?.name).toBe("Delegacia");
  });

  it("gives every zone and level at least one look, and picks deterministically", () => {
    for (const z of [ZONE.RES, ZONE.COM, ZONE.IND]) for (const l of [1, 2, 3]) expect(zoneEntries(z, l).length).toBeGreaterThan(0);
    expect(pickZoneEntry(ZONE.RES, 3, 0.99)).toEqual(pickZoneEntry(ZONE.RES, 3, 0.99));
    expect(pickZoneEntry(ZONE.RES, 3, 0)).not.toEqual(pickZoneEntry(ZONE.RES, 3, 0.99));
  });
});

describe("describeTile", () => {
  it("names facilities from the kit and reports upkeep and radius", () => {
    const { s, ey } = city();
    applyTool(s, "police", 6, ey + 3);
    const info = describeTile(s, 6, ey + 3)!;
    expect(info.kind).toBe("facility");
    expect(info.name).toBe("Delegacia");
    expect(info.category).toBe("S3");
    expect(info.thumbnail).toBe("/ui/buildings/24.jpg");
    expect(info.radius).toBeGreaterThan(0);
    expect(info.upkeep).toBeGreaterThan(0);
  });

  it("describes buildings with residents or jobs, and empty zones as zones", () => {
    const { s, ey } = city();
    placeRoad(s, 1, [{ x: 3.5, z: ey + 0.5 }, { x: 12.5, z: ey + 0.5 }]);
    applyTool(s, "res", 6, ey - 1);
    applyTool(s, "com", 7, ey - 1);
    expect(describeTile(s, 6, ey - 1)!.kind).toBe("zone");
    s.world.level[idx(s.world, 6, ey - 1)] = 3;
    s.world.level[idx(s.world, 7, ey - 1)] = 2;
    const home = describeTile(s, 6, ey - 1)!;
    expect(home.kind).toBe("building");
    expect(home.peopleKind).toBe("residents");
    expect(home.people).toBeGreaterThan(0);
    expect(home.category).toMatch(/^R/);
    expect(describeTile(s, 7, ey - 1)!.peopleKind).toBe("jobs");
  });

  it("handles roads, open ground and out-of-range tiles", () => {
    const { s, ey } = city();
    expect(describeTile(s, 1, ey)!.kind).toBe("road");
    expect(describeTile(s, 20, ey + 6)!.kind).toBe("empty");
    expect(describeTile(s, -1, 0)).toBeNull();
    expect(FAC.CITYHALL).toBe(16);
  });
});
