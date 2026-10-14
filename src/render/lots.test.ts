import { describe, expect, it } from "vitest";
import {
  SITE_MID_DROP, SITE_PLINTH_EXTRA, SITE_PLINTH_GAP, SITE_PLINTH_SHRINK, SITE_SPREAD_FLAT, SITE_WATER_CLEAR,
  cellBaseY, depthShade, lotCentre, lotFrontPoint, lotFrontSample, lotFrontTile, lotInstances, lotKerb,
  lotModelCells, lotYaw, orientedKerb, orientedModelCells, orientedPad, padBaseY, siteCorners, siteLevel,
} from "./lots";

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
    // a lot two tiles back from the road has no kerb of its own
    expect(lotKerb({ x: 4, y: 8, w: 1, h: 1, facing: { dx: 0, dy: 1 }, depthFromRoad: 2 })).toBeNull();
  });

  it("shades pads darker toward the back of the block", () => {
    expect(depthShade(0)).toBe(1);
    expect(depthShade(1)).toBeLessThan(1);
    expect(depthShade(3)).toBeLessThan(depthShade(2));
    expect(depthShade(-1)).toBeLessThan(depthShade(3));
  });

  it("finds the tile in front of a lot's front edge", () => {
    expect(lotFrontTile({ x: 4, y: 8, w: 3, h: 2, facing: { dx: 0, dy: 1 } })).toEqual({ x: 5, y: 10 });
    expect(lotFrontTile({ x: 4, y: 8, w: 3, h: 2, facing: { dx: 0, dy: -1 } })).toEqual({ x: 5, y: 7 });
    expect(lotFrontTile({ x: 4, y: 8, w: 3, h: 2, facing: { dx: 1, dy: 0 } })).toEqual({ x: 7, y: 9 });
    expect(lotFrontTile({ x: 4, y: 8, w: 3, h: 2, facing: { dx: -1, dy: 0 } })).toEqual({ x: 3, y: 9 });
    expect(lotFrontTile({ x: 4, y: 8, w: 1, h: 1, facing: { dx: 0, dy: 0 } })).toBeNull();
  });

  it("rotates composed model cells for oriented lots", () => {
    const cells = orientedModelCells({ cx: 10, cz: 20, yaw: Math.PI / 2, w: 2, d: 2 });
    expect(cells).toHaveLength(4);
    expect(cells[0].x).toBeCloseTo(9.5);
    expect(cells[0].z).toBeCloseTo(20.5);
    expect(cells[3].x).toBeCloseTo(10.5);
    expect(cells[3].z).toBeCloseTo(19.5);
  });

  it("returns oriented kerb and pad transforms", () => {
    expect(orientedKerb({ cx: 10, cz: 20, yaw: 0, w: 3, d: 2 })).toEqual({ x: 10, z: 20.93, len: 3, yaw: 0 });
    expect(orientedPad({ cx: 10, cz: 20, yaw: 0.5, w: 3, d: 2 })).toEqual({ x: 10, z: 20, sx: 3, sz: 2, yaw: 0.5 });
  });

  it("plans oriented render instances with rotated pads, kerbs, plots and models", () => {
    const empty = lotInstances({
      id: 1, seg: 1, side: -1, block: 0, row: 0, col: 1, w: 2, d: 2,
      zone: 1, level: 0, cx: 10, cz: 20, yaw: Math.PI / 2, tiles: [],
    });
    expect(empty.pad).toHaveLength(4);
    expect(empty.kerb).toHaveLength(0);
    expect(empty.models).toHaveLength(0);
    expect(empty.pad[0].yaw).toBeCloseTo(Math.PI / 2);
    expect(empty.pad[0].shade).toBe(depthShade(1));
    expect(empty.pad[2].shade).toBe(depthShade(2));

    const built = lotInstances({
      id: 2, seg: 1, side: -1, block: 0, row: 0, col: 0, w: 4, d: 4,
      zone: 2, level: 2, cx: 12, cz: 20, yaw: Math.PI / 4, tiles: [],
    });
    expect(built.pad).toHaveLength(1);
    expect(built.pad[0].plot).toBe(true);
    expect(built.kerb).toHaveLength(1);
    expect(built.kerb[0].yaw).toBeCloseTo(Math.PI / 4);
    expect(built.models).toHaveLength(4);
    expect(built.models.every((m) => m.yaw === Math.PI / 4)).toBe(true);
  });

  it("finds site corners and the front edge of a lot frame", () => {
    const f = { cx: 10, cz: 20, yaw: 0, w: 4, d: 2 };
    expect(siteCorners(f)).toEqual([
      { x: 8, z: 19 }, { x: 12, z: 19 }, { x: 12, z: 21 }, { x: 8, z: 21 },
    ]);
    expect(lotFrontPoint(f)).toEqual({ x: 10, z: 21 });
    expect(lotFrontSample(f)).toEqual({ x: 10, z: 21.15 });
    const r = siteCorners({ ...f, yaw: Math.PI / 2 });
    expect(r[0].x).toBeCloseTo(9);
    expect(r[0].z).toBeCloseTo(22);
    expect(lotFrontPoint({ ...f, yaw: Math.PI / 2 }).x).toBeCloseTo(11);
  });

  it("pins the site-grading conversions (fable metres ÷ 8)", () => {
    expect(SITE_SPREAD_FLAT).toBe(0.14 / 8);
    expect(SITE_MID_DROP).toBe(0.2 / 8);
    expect(SITE_WATER_CLEAR).toBe(0.7 / 8);
    expect(SITE_PLINTH_GAP).toBe(0.9 / 8);
    expect(SITE_PLINTH_EXTRA).toBe(0.6 / 8);
    expect(SITE_PLINTH_SHRINK).toBe(0.5 / 8);
  });

  it("levels flat ground with no plinth", () => {
    const f = { cx: 10, cz: 20, yaw: 0.3, w: 2, d: 2 };
    const site = siteLevel(f, () => 1.5, 1.5);
    expect(site).toEqual({ y: 1.5, minY: 1.5, maxY: 1.5, spread: 0, plinthDepth: 0 });
    expect(cellBaseY(site, 1.5)).toBe(1.5);
    expect(padBaseY(site, 1.5, 0.025)).toBeCloseTo(1.525);
  });

  it("pins the platform formula y = max(frontY, mid − 0.025, water + 0.0875)", () => {
    const f = { cx: 0, cz: 0, yaw: 0, w: 2, d: 2 };
    // front term wins
    expect(siteLevel(f, () => 0, 0.5, -10).y).toBe(0.5);
    // mid term wins (corners ±: mid 0.5, drop 0.025)
    const slope = siteLevel(f, (x) => x + 1, -10, -10);
    expect(slope.minY).toBe(0);
    expect(slope.maxY).toBe(2);
    expect(slope.y).toBeCloseTo(0.975);
    // water term wins on drowned land
    expect(siteLevel(f, () => -1, -1, 0).y).toBeCloseTo(0.0875);
  });

  it("plinths exactly when the platform-to-ground gap exceeds 0.1125", () => {
    const f = { cx: 0, cz: 0, yaw: 0, w: 2, d: 2 };
    // slope lot below a levelled road: platform at road height, plinth to the low corner
    const s = siteLevel(f, (_x, z) => 1 - (z + 1) * 0.2, 1.2, 0);
    expect(s.plinthDepth).toBeGreaterThan(0);
    expect(s.plinthDepth).toBeCloseTo(s.y - s.minY + SITE_PLINTH_EXTRA, 12);
    // the plinth foundation is buried below the low corner
    expect(s.y - s.plinthDepth).toBeCloseTo(s.minY - SITE_PLINTH_EXTRA, 12);
    // no plinth within the gap, even on a spread slope
    const flat = siteLevel(f, (_x, z) => (z + 1) * 0.02, 0.05, -10);
    expect(flat.y - flat.minY).toBeLessThanOrEqual(SITE_PLINTH_GAP);
    expect(flat.plinthDepth).toBe(0);
  });

  it("keeps the base above every corner when the road is level with the high side", () => {
    const f = { cx: 5, cz: 5, yaw: Math.PI / 6, w: 3, d: 2 };
    const h = (x: number, z: number) => 2 - (x - 5) * 0.15 - (z - 5) * 0.1;
    const corners = siteCorners(f).map((p) => h(p.x, p.z));
    const site = siteLevel(f, h, Math.max(...corners));
    for (const c of corners) expect(site.y).toBeGreaterThanOrEqual(c);
    // every model cell grounds at or above its own terrain (never buried)
    for (const cell of [{ x: 5, z: 5 }, ...siteCorners(f)]) {
      expect(cellBaseY(site, h(cell.x, cell.z))).toBeGreaterThanOrEqual(h(cell.x, cell.z));
    }
  });

  it("hugs the terrain with pads on plinthed lots and never floats them", () => {
    const f = { cx: 0, cz: 0, yaw: 0, w: 2, d: 2 };
    const slope = siteLevel(f, (_x, z) => 1 - (z + 1) * 0.2, 1.2, 0);
    expect(slope.plinthDepth).toBeGreaterThan(0);
    expect(padBaseY(slope, 0.8, 0.025)).toBeCloseTo(0.825);
    const flat = siteLevel(f, () => 1, 1);
    expect(padBaseY(flat, 1, 0.025)).toBeCloseTo(1.025);
    // a road slightly above the lot never lifts the pad off it (min), nor buries the model (max)
    const high = siteLevel(f, () => 1, 1.05);
    expect(high.plinthDepth).toBe(0);
    expect(padBaseY(high, 1, 0.025)).toBeCloseTo(1.025);
    expect(cellBaseY(high, 1)).toBe(1.05);
  });

  it("keeps observable instance counts equal for axis-aligned tile and oriented lots", () => {
    const classicLots = Array.from({ length: 500 }, (_, id) => ({
      id: id + 1, x: (id % 25) * 2, y: Math.floor(id / 25) * 2, w: 2, h: 2,
      facing: { dx: 0 as const, dy: 1 as const }, zone: 1 as const, level: id % 2, depthFromRoad: 0,
    }));
    const orientedLots = classicLots.map((lot) => ({
      id: lot.id, seg: 1, side: -1 as const, block: 0, row: lot.x, col: 0, w: lot.w, d: lot.h,
      zone: lot.zone, level: lot.level, cx: lot.x + lot.w / 2, cz: lot.y + lot.h / 2, yaw: 0, tiles: [],
    }));
    const count = (lots: typeof classicLots | typeof orientedLots) => lots.reduce((sum, lot) => {
      const plan = lotInstances(lot);
      return {
        zones: sum.zones + plan.pad.length,
        kerbs: sum.kerbs + plan.kerb.length,
        buildings: sum.buildings + plan.models.length,
      };
    }, { zones: 0, kerbs: 0, buildings: 0 });
    expect(count(orientedLots)).toEqual(count(classicLots));
  });
});
