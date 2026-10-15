import { describe, expect, it } from "vitest";
import { CATALOG, entryByNumber, facilityEntry, zoneEntries } from "./catalog";
import { FAC, ZONE } from "./world";
import { legacyBuildingUrl } from "../render/visual-v2";

describe("catalog expansion 41-80", () => {
  it("adds 44 expansion buildings numbered 41 to 84, once each", () => {
    expect(CATALOG).toHaveLength(84);
    expect(CATALOG.map((c) => c.n)).toEqual(Array.from({ length: 84 }, (_, i) => i + 1));
    for (let n = 41; n <= 84; n++) {
      const e = entryByNumber(n)!;
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.nameEn.length).toBeGreaterThan(0);
    }
  });

  it("keeps every zone and level pool populated after the expansion", () => {
    for (const z of [ZONE.RES, ZONE.COM, ZONE.IND]) {
      for (const l of [1, 2, 3]) expect(zoneEntries(z, l).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("maps the train station entry to the rail facility", () => {
    expect(entryByNumber(61)?.facility).toBe(FAC.TRAIN_STATION);
    expect(facilityEntry(FAC.TRAIN_STATION)?.n).toBe(61);
  });

  it("allows legacy GLB urls for the whole expanded catalog", () => {
    expect(legacyBuildingUrl(41)).toBe("/models/41.glb");
    expect(legacyBuildingUrl(84)).toBe("/models/84.glb");
    expect(() => legacyBuildingUrl(85)).toThrow(RangeError);
  });
});
