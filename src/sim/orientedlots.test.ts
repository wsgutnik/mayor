import { describe, expect, it } from "vitest";
import { ZONE } from "./world";
import { lotPose, planOrientedLots } from "./orientedlots";
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
  it("packs a fully zoned commercial 8x4 block as two 4x4 lots", () => {
    const lots = planOrientedLots(filled(8, ZONE.COM, 2), { rng: stableRng });
    expect(lots.map((l) => [l.row, l.col, l.w, l.d, l.zone, l.level])).toEqual([
      [0, 0, 4, 4, ZONE.COM, 2],
      [4, 0, 4, 4, ZONE.COM, 2],
    ]);
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
});
