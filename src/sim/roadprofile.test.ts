// src/sim/roadprofile.test.ts
import { describe, expect, it } from "vitest";
import { ROAD_SPECS, derive, rankOf, specOf } from "./roadprofile";
import type { RoadType } from "./world";

const TYPES: RoadType[] = [1, 2, 3, 4, 5, 6];

describe("road spec table", () => {
  it("derived drawn width equals the declared drawn width", () => {
    for (const t of TYPES) expect(2 * derive(t).drawHalf).toBeCloseTo(specOf(t).drawWidth, 6);
  });
  it("lanes plus median plus shoulders fill the asphalt exactly", () => {
    for (const t of TYPES) {
      const s = specOf(t), d = derive(t);
      const lanes = s.lanesPerDir[0] + s.lanesPerDir[1];
      expect(lanes * s.laneWidth + 2 * s.medianHalf + 2 * s.shoulder).toBeCloseTo(2 * d.asphaltHalf, 6);
      expect(d.totalLanes).toBe(lanes);
      expect(d.laneCentres).toHaveLength(lanes);
    }
  });
  it("lane centres are ascending, inside the asphalt, and clear of the median", () => {
    for (const t of TYPES) {
      const s = specOf(t), d = derive(t);
      for (let i = 1; i < d.laneCentres.length; i++) expect(d.laneCentres[i]).toBeGreaterThan(d.laneCentres[i - 1]);
      for (const c of d.laneCentres) {
        expect(Math.abs(c) + s.laneWidth / 2).toBeLessThanOrEqual(d.asphaltHalf - s.shoulder + 1e-9);
        if (s.medianHalf > 0) expect(Math.abs(c) - s.laneWidth / 2).toBeGreaterThanOrEqual(s.medianHalf - 1e-9);
      }
    }
  });
  it("one-way specs have no back lanes and no median", () => {
    for (const t of [4, 5] as RoadType[]) {
      expect(specOf(t).oneWay).toBe(true);
      expect(specOf(t).lanesPerDir[1]).toBe(0);
      expect(specOf(t).medianHalf).toBe(0);
    }
  });
  it("highway is 3+3 with a barrier and shoulders", () => {
    const h = specOf(3);
    expect(h.lanesPerDir).toEqual([3, 3]);
    expect(h.median).toBe("barrier");
    expect(h.shoulder).toBeCloseTo(0.1, 9);
    expect(h.junctionMarkings).toBe(false);
  });
  it("capacity is per-lane capacity times lanes", () => {
    expect(TYPES.map((t) => derive(t).capacity)).toEqual([4, 10, 30, 4, 10, 5]);
  });
  it("rank orders street < one-way street < avenue < one-way avenue < highway, 0 for none", () => {
    expect([1, 4, 2, 5, 6, 3].map(rankOf)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rankOf(0)).toBe(0);
  });
  it("every spec carries i18n keys and a thumbnail", () => {
    for (const t of TYPES) {
      const s = ROAD_SPECS[t];
      expect(s.nameKey.length).toBeGreaterThan(0);
      expect(s.descKey.length).toBeGreaterThan(0);
      expect(s.thumb).toMatch(/^\/ui\/thumbs\/.+\.jpg$/);
    }
  });
});
