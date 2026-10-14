import { describe, expect, it } from "vitest";
import { KIT_STOREY, bayLayout, checkFacade } from "./facade";
import { checkGeometry, geometryFor } from "./procgeo";
import { checkProceduralBuilding, HERO_HEIGHT_CAP, PROC_TRIANGLE_CAP, proceduralBuilding, STANDARD_HEIGHT_CAP } from "./procbuildings";

describe("procedural multi-cell buildings", () => {
  it("pins kit scale and preserves the Blender kit for 1x1 lots", () => {
    expect(KIT_STOREY).toBe(.25);
    expect(proceduralBuilding({ id: 1, w: 1, d: 1, zone: 1, level: 2 })).toBeNull();
  });
  it("is deterministic, bounded, and inside every supported multi-cell footprint", () => {
    for (const zone of [1,2,3]) for (const level of [1,2,3]) for (const [w,d] of [[2,2],[4,2],[3,3]] as const) {
      const lot={id:79,w,d,zone,level}; const a=proceduralBuilding(lot)!; const b=proceduralBuilding(lot)!;
      expect(a).toEqual(b); expect(checkProceduralBuilding(a,lot)).toBe(true); expect(a.triangles).toBeLessThanOrEqual(PROC_TRIANGLE_CAP);
      expect(a.height).toBeLessThanOrEqual(w*d >= 9 ? HERO_HEIGHT_CAP : STANDARD_HEIGHT_CAP);
    }
  });
  it("uses non-sliver closed roof geometry and valid facade bays", () => {
    for (const shape of ["box","gable","hip","wedge"] as const) expect(checkGeometry(geometryFor(shape).geometry)).toBe(true);
    expect(checkFacade(bayLayout(2))).toBe(true);
  });
});
