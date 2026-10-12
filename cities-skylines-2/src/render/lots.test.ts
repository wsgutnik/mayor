import { describe, expect, it } from "vitest";
import { depthShade, lotCentre, lotKerb, lotModelCells, lotYaw } from "./lots";

describe("lot layout", () => {
  it("yaws models to face the street", () => {
    expect(lotYaw({ facing: { dx: 0, dy: 1 } })).toBe(0);
    expect(lotYaw({ facing: { dx: 1, dy: 0 } })).toBeCloseTo(Math.PI / 2);
    expect(lotYaw({ facing: { dx: 0, dy: -1 } })).toBeCloseTo(Math.PI);
    expect(lotYaw({ facing: { dx: -1, dy: 0 } })).toBeCloseTo(-Math.PI / 2);
  });

  it("centres on the footprint", () => {
    expect(lotCentre({ x: 4, y: 8, w: 2, h: 1 })).toEqual({ x: 5, z: 8.5 });
  });

  it("composes one cell per tile up to 2x2, then a centred cluster", () => {
    expect(lotModelCells({ x: 4, y: 8, w: 1, h: 1 })).toEqual([{ x: 4.5, z: 8.5 }]);
    expect(lotModelCells({ x: 4, y: 8, w: 2, h: 1 })).toEqual([{ x: 4.5, z: 8.5 }, { x: 5.5, z: 8.5 }]);
    expect(lotModelCells({ x: 4, y: 8, w: 2, h: 2 })).toEqual([
      { x: 4.5, z: 8.5 }, { x: 5.5, z: 8.5 }, { x: 4.5, z: 9.5 }, { x: 5.5, z: 9.5 },
    ]);
    // a 4x4 mill holds four models around its centre, not sixteen
    expect(lotModelCells({ x: 4, y: 8, w: 4, h: 4 })).toEqual([
      { x: 5.5, z: 9.5 }, { x: 6.5, z: 9.5 }, { x: 5.5, z: 10.5 }, { x: 6.5, z: 10.5 },
    ]);
  });

  it("puts the kerb on the street edge, or nowhere without frontage", () => {
    expect(lotKerb({ x: 4, y: 8, w: 2, h: 1, facing: { dx: 0, dy: 1 }, depthFromRoad: 0 }))
      .toEqual({ x: 5, z: 9, w: 2, d: 0.12 });
    expect(lotKerb({ x: 4, y: 8, w: 1, h: 2, facing: { dx: -1, dy: 0 }, depthFromRoad: 0 }))
      .toEqual({ x: 4, z: 9, w: 0.12, d: 2 });
    expect(lotKerb({ x: 4, y: 8, w: 1, h: 1, facing: { dx: 0, dy: 1 }, depthFromRoad: -1 })).toBeNull();
  });

  it("shades pads darker toward the back of the block", () => {
    expect(depthShade(0)).toBe(1);
    expect(depthShade(1)).toBeLessThan(1);
    expect(depthShade(3)).toBeLessThan(depthShade(2));
    expect(depthShade(-1)).toBeLessThan(depthShade(3));
  });
});
