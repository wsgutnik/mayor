import { describe, expect, it } from "vitest";
import { ZONE, generateWorld } from "./world";
import { CELL_DEPTH, type OrientedLot, type ZoneBlock } from "./zonecells";
import { type ZoneBlockSet } from "./zoneblocks";
import { checkLots, lotCoverage, lotPose } from "./orientedlots";
import { EVOLUTION_LAND_VALUE, evolveOrientedLot, evolutionFootprint } from "./lot-evolution";

function fixture(): { w: ReturnType<typeof generateWorld>; set: ZoneBlockSet; lots: OrientedLot[] } {
  const w = generateWorld(24, 9);
  w.landValue.fill(100);
  const rows = 4, n = rows * CELL_DEPTH;
  const frame = new Float32Array(rows * 4);
  for (let r = 0; r < rows; r++) { frame[r * 4] = r + 4.5; frame[r * 4 + 1] = 4.5; frame[r * 4 + 2] = 1; }
  const b: ZoneBlock = { key: "1:-1:0", seg: 1, side: -1, block: 0, rows, s0: 0, lat0: 1, frame,
    valid: new Uint8Array(n).fill(1), zone: new Uint8Array(n).fill(ZONE.RES), level: new Uint8Array(n).fill(1), lot: new Int32Array(n).fill(-1), age: 1 };
  const set = { graphRevision: 0, blocks: new Map([[b.key, b]]), bySeg: new Map([[1, [b]]]), tileIndex: new Map() };
  const lots: OrientedLot[] = [];
  let id = 1;
  for (let row = 0; row < rows; row++) for (let col = 0; col < CELL_DEPTH; col++) {
    const lot = { id: id++, seg: 1, side: -1 as const, block: 0, row, col, w: 1, d: 1, zone: ZONE.RES, level: 1, build: 1, ...lotPose(b, { row, col, w: 1, d: 1 }), tiles: [] };
    lots.push(lot); b.lot[row * CELL_DEPTH + col] = lot.id;
  }
  return { w, set, lots };
}

describe("oriented lot evolution", () => {
  it("uses the documented zone/level footprint targets", () => {
    expect(evolutionFootprint(ZONE.RES, 5)).toEqual([4, 4]);
    expect(evolutionFootprint(ZONE.COM, 2)).toEqual([1, 2]);
    expect(evolutionFootprint(ZONE.IND, 2)).toEqual([2, 3]);
  });

  it("merges only valid same-zone lower-level neighbours, with full non-overlapping coverage", () => {
    const { w, set, lots } = fixture();
    const first = lots[0];
    const evolved = evolveOrientedLot(w, set, lots, first, 2);
    expect(evolved).toMatchObject({ id: first.id, level: 2, w: 2, d: 2, build: 0 });
    expect(lotCoverage(set.blocks)).toBe(1);
    expect(checkLots(set.blocks, lots, [])).toEqual({ lotLot: 0, lotRoad: 0 });
    expect(new Set(lots.map(l => l.id)).size).toBe(lots.length);
  });

  it("is deterministic and refuses an insufficient land-value step", () => {
    const a = fixture(), b = fixture();
    expect(evolveOrientedLot(a.w, a.set, a.lots, a.lots[0], 2)).toEqual(evolveOrientedLot(b.w, b.set, b.lots, b.lots[0], 2));
    const c = fixture(); c.w.landValue.fill(EVOLUTION_LAND_VALUE[2] - 1);
    expect(evolveOrientedLot(c.w, c.set, c.lots, c.lots[0], 2)).toBeNull();
  });
});
