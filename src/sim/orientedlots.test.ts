import { describe, expect, it } from "vitest";
import { ROAD, ROAD_DRAW_WIDTH, ZONE, generateWorld } from "./world";
import { addSegment } from "./roads";
import { buildZoneBlocks } from "./zoneblocks";
import { checkLots, lotCoverage, lotPose, planOrientedLots } from "./orientedlots";
import type { ZoneBlock, ZoneBlockSet } from "./zonecells";
import { CELL_DEPTH } from "./zonecells";
import { lotYaw } from "../render/lots";

function block(rows = 8, opts: Partial<Pick<ZoneBlock, "side" | "zone" | "level" | "frame">> = {}): ZoneBlock {
  const frame = opts.frame ?? new Float32Array(rows * 4);
  if (!opts.frame) {
    for (let r = 0; r < rows; r++) {
      frame[r * 4] = r + 0.5;
      frame[r * 4 + 1] = 1;
      frame[r * 4 + 2] = 1;
      frame[r * 4 + 3] = 0;
    }
  }
  const n = rows * CELL_DEPTH;
  return {
    key: `7:${opts.side ?? -1}:0`,
    seg: 7,
    side: opts.side ?? -1,
    block: 0,
    rows,
    s0: 0,
    lat0: 1,
    frame,
    valid: new Uint8Array(n).fill(1),
    zone: opts.zone ?? new Uint8Array(n),
    level: opts.level ?? new Uint8Array(n),
    lot: new Int32Array(n).fill(-1),
    age: 7,
  };
}

function filled(rows: number, zone: number, level: number): ZoneBlockSet {
  const b = block(rows);
  b.zone.fill(zone);
  b.level.fill(level);
  return new Map([[b.key, b]]);
}

const stableRng = () => 0.999;

describe("oriented lot planner", () => {
  it("packs a fully zoned commercial 8x4 block with full coverage", () => {
    const set = filled(8, ZONE.COM, 2);
    const lots = planOrientedLots(set, { rng: stableRng });
    expect(lotCoverage(set)).toBe(1);
    expect(lots.length).toBeGreaterThanOrEqual(2);
    for (const l of lots) {
      expect(l.w).toBeGreaterThanOrEqual(2);
      expect(l.w).toBeLessThanOrEqual(4);
      expect(l.d).toBe(4);
      expect(l.col).toBe(0);
    }
    // Rows partition without gaps or overlaps.
    const rows = lots.sort((a, b) => a.row - b.row);
    expect(rows[0].row).toBe(0);
    for (let i = 1; i < rows.length; i++) expect(rows[i].row).toBe(rows[i - 1].row + rows[i - 1].w);
    expect(rows[rows.length - 1].row + rows[rows.length - 1].w).toBe(8);
  });

  it("keeps level-0 residential frontage in small-width lots", () => {
    const lots = planOrientedLots(filled(8, ZONE.RES, 0), { rng: stableRng });
    expect(lots.every((l) => l.w <= 2)).toBe(true);
    expect(lots.some((l) => l.w === 2)).toBe(true);
  });

  it("re-emits a persisted 2x2 level-3 lot with the same id", () => {
    const set = filled(4, ZONE.COM, 3);
    const keep = [{
      id: 42, seg: 7, side: -1 as const, block: 0, row: 1, col: 0, w: 2, d: 2,
      zone: ZONE.COM, level: 3, cx: 0, cz: 0, yaw: 0, tiles: [1],
    }];
    const lots = planOrientedLots(set, { rng: stableRng, keep });
    expect(lots.find((l) => l.id === 42)).toMatchObject({ id: 42, row: 1, col: 0, w: 2, d: 2, level: 3 });
  });

  it("does not span rows whose tangent yaw differs by more than six degrees", () => {
    const frame = new Float32Array(4 * 4);
    for (let r = 0; r < 4; r++) {
      const yaw = r < 2 ? Math.PI / 2 : Math.PI / 2 + 0.2;
      frame[r * 4] = r + 0.5;
      frame[r * 4 + 1] = 1;
      frame[r * 4 + 2] = Math.sin(yaw);
      frame[r * 4 + 3] = Math.cos(yaw);
    }
    const b = block(4, { frame });
    b.zone.fill(ZONE.COM);
    b.level.fill(2);
    const lots = planOrientedLots(new Map([[b.key, b]]), { rng: stableRng });
    expect(lots.every((l) => l.w <= 2)).toBe(true);
  });

  it("points lot yaw toward the road", () => {
    const b = block(2, { side: -1 });
    const pose = lotPose(b, { row: 0, col: 0, w: 1, d: 1 });
    expect(pose.yaw).toBeCloseTo(lotYaw({ facing: { dx: 0, dy: 1 } }));
  });

  it("is deterministic for the same seed", () => {
    const make = () => filled(8, ZONE.COM, 2);
    expect(planOrientedLots(make(), { rng: stableRng })).toEqual(planOrientedLots(make(), { rng: stableRng }));
  });

  it("Z4: back cells are not stranded as never-ready col>0 1x1 lots", () => {
    const b = block(4);
    for (let r = 0; r < 4; r++) for (let c = 0; c < CELL_DEPTH; c++) {
      const i = r * CELL_DEPTH + c;
      b.zone[i] = ZONE.RES;
      b.level[i] = c === 0 ? 1 : 0;
    }
    const set = new Map([[b.key, b]]);
    const lots = planOrientedLots(set, { rng: stableRng });
    // lotsReady skips col !== 0, so any col>0 lot never grows. After the fix there are none.
    expect(lots.filter((l) => l.col > 0)).toHaveLength(0);
    expect(lotCoverage(set)).toBeLessThan(1);
  });

  it("Z4: painting one extra cell at the far end keeps other lots stable", () => {
    const make = (rows: number) => {
      const b = block(8);
      for (let r = 0; r < rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
        const i = r * CELL_DEPTH + c;
        b.zone[i] = ZONE.COM;
        b.level[i] = 2;
      }
      return b;
    };
    const b1 = make(7);
    const set1 = new Map([[b1.key, b1]]);
    const lots1 = planOrientedLots(set1, { rng: stableRng, seed: 11 });
    const b2 = make(8);
    const set2 = new Map([[b2.key, b2]]);
    const lots2 = planOrientedLots(set2, { rng: stableRng, seed: 11, keep: lots1 });
    for (const l1 of lots1) {
      const l2 = lots2.find((l) => l.id === l1.id);
      expect(l2).toMatchObject({ row: l1.row, col: l1.col, w: l1.w, d: l1.d });
    }
  });

  it("Z4: checkLots finds no overlaps on diagonal and curve fixtures", () => {
    const w = generateWorld(48, 7);
    w.road.fill(0); w.roadSurface.fill(0); w.roadDeck.fill(0); w.roadTunnel.fill(0); w.deckH.fill(NaN);
    w.zone.fill(0); w.level.fill(0); w.facility.fill(0); w.connected.fill(0);
    w.segments.length = 0; w.nodes.length = 0; w.nextNodeId = 1; w.nextSegmentId = 1;
    w.heights.fill(1);
    addSegment(w, ROAD.STREET, [{ x: 6.5, z: 6.5 }, { x: 20.5, z: 20.5 }]);
    addSegment(w, ROAD.STREET, [{ x: 26.5, z: 10.5 }, { x: 26.5, z: 20.5 }, { x: 36.5, z: 20.5 }]);
    const set = buildZoneBlocks(w);
    for (const b of set.blocks.values()) for (let i = 0; i < b.zone.length; i++) {
      if (b.valid[i]) { b.zone[i] = ZONE.RES; b.level[i] = 1; }
    }
    const lots = planOrientedLots(set.blocks, { rng: stableRng, seed: 7 });
    expect(lots.length).toBeGreaterThan(5);
    const roads = w.segments.map((s) => ({ pts: s.pts, half: ROAD_DRAW_WIDTH[s.type] / 2 }));
    expect(checkLots(set.blocks, lots, roads)).toEqual({ lotLot: 0, lotRoad: 0 });
  });
});
