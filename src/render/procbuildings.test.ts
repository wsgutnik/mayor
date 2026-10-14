import { describe, expect, it } from "vitest";
import { KIT_STOREY, bayLayout, checkFacade } from "./facade";
import { checkGeometry, geometryFor } from "./procgeo";
import { checkConstructionParts, checkProceduralBuilding, constructionParts, FLOOR_RANGES, PROC_TRIANGLE_CAP, proceduralBuilding } from "./procbuildings";

describe("procedural multi-cell buildings", () => {
  it("pins kit scale and preserves the Blender kit for 1x1 lots", () => {
    expect(KIT_STOREY).toBe(.25);
    expect(proceduralBuilding({ id: 1, w: 1, d: 1, zone: 1, level: 2 })).toBeNull();
  });
  it("is deterministic, bounded, and inside every supported multi-cell footprint", () => {
    for (const zone of [1,2,3]) for (const level of [1,2,3]) for (const [w,d] of [[1,4],[2,2],[2,3],[4,2],[3,3]] as const) {
      const lot={id:79,w,d,zone,level}; const a=proceduralBuilding(lot)!; const b=proceduralBuilding(lot)!;
      expect(a).toEqual(b); expect(checkProceduralBuilding(a,lot)).toBe(true); expect(a.triangles).toBeLessThanOrEqual(PROC_TRIANGLE_CAP);
      expect(a.height).toBeLessThanOrEqual(a.cap);
    }
  });
  it("pins level-to-floor ranges at Blender-kit scale, including the office ceiling", () => {
    for (const zone of [1, 2]) for (const level of [1, 2, 3]) {
      for (let id = 1; id < 30; id++) {
        const b = proceduralBuilding({ id, w: 3, d: 3, zone, level })!;
        const [lo, hi] = FLOOR_RANGES[b.kind][level - 1];
        expect(b.floors).toBeGreaterThanOrEqual(lo);
        expect(b.floors).toBeLessThanOrEqual(hi);
        if (b.kind === "office" || b.kind === "mixed") expect(b.height).toBeLessThanOrEqual(2.5);
      }
    }
    for (const level of [1, 2, 3]) {
      const b = proceduralBuilding({ id: level, w: 2, d: 2, zone: 1, level })!;
      if (b.kind === "house") expect(b.floors).toBeLessThanOrEqual(2);
    }
  });
  it("gives every raised visual part a touching support, never a cantilever plate", () => {
    for (const lot of [{ id: 2, w: 1, d: 4, zone: 2, level: 3 }, { id: 3, w: 2, d: 3, zone: 2, level: 3 }]) {
      const b = proceduralBuilding(lot)!;
      for (const p of b.parts) {
        if (p.y <= 1e-3) continue;
        expect(b.parts.some((q) => q !== p && q.y < p.y && q.y + q.h >= p.y - 1e-3 && Math.abs(p.x - q.x) < (p.w + q.w) / 2 - 1e-3 && Math.abs(p.z - q.z) < (p.d + q.d) / 2 - 1e-3)).toBe(true);
      }
    }
  });
  it("uses non-sliver closed roof geometry and valid facade bays", () => {
    for (const shape of ["box","gable","hip","wedge"] as const) expect(checkGeometry(geometryFor(shape).geometry)).toBe(true);
    expect(checkFacade(bayLayout(2))).toBe(true);
  });
  it("keeps staged construction inside its site envelope (crane included)", () => {
    const lot = { id: 7, w: 3, d: 3, zone: 2, level: 3 };
    const b = proceduralBuilding(lot)!;
    for (const p of [0, .25, .75, 1]) expect(checkConstructionParts(constructionParts(b, lot, p), lot)).toBe(true);
  });
});
