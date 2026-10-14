import { describe, expect, it } from "vitest";
import { getFrontage } from "./blocks";
import { addSegment } from "./roads";
import { buildZoneBlocks, blocksForSegment, cellIndex, cellPose, migrateCells, nearestCell, type ZoneBlockSet } from "./zoneblocks";
import { ROAD, ZONE, generateWorld, idx, rasterizeRoad, rebuildRoadRaster, type Pt, type RoadSegment, type RoadType, type World } from "./world";
import { CELL_DEPTH, type ZoneBlock } from "./zonecells";

function blank(size = 32): World {
  const w = generateWorld(size, 7);
  w.road.fill(0); w.roadSurface.fill(0); w.roadDeck.fill(0); w.roadTunnel.fill(0); w.deckH.fill(NaN);
  w.zone.fill(0); w.level.fill(0); w.facility.fill(0); w.connected.fill(0);
  w.segments.length = 0; w.nodes.length = 0; w.nextNodeId = 1; w.nextSegmentId = 1;
  w.heights.fill(1);
  return w;
}

function segment(w: World, pts: Pt[], type: RoadType = ROAD.STREET): RoadSegment {
  const seg: RoadSegment = { id: w.nextSegmentId++, type, pts: pts.map((p) => ({ ...p })), tiles: [], a: 0, b: 0 };
  seg.tiles = rasterizeRoad(w, type, seg.pts).tiles;
  w.segments.push(seg);
  rebuildRoadRaster(w);
  w.graphRevision++;
  w.roadRevision++;
  return seg;
}

function cells(set: ZoneBlockSet) {
  const out: { b: ZoneBlock; row: number; col: number; x: number; z: number }[] = [];
  for (const b of set.blocks.values()) for (let row = 0; row < b.rows; row++) for (let col = 0; col < CELL_DEPTH; col++) {
    if (!b.valid[cellIndex(row, col)]) continue;
    const p = cellPose(b, row, col);
    out.push({ b, row, col, x: p.x, z: p.z });
  }
  return out;
}

function roundedCellTiles(set: ZoneBlockSet, w: World): Set<number> {
  return new Set(cells(set).map((c) => idx(w, Math.floor(c.x), Math.floor(c.z))));
}

describe("oriented zone blocks", () => {
  it("matches classic frontage centres for an axis-aligned street through tile centres", () => {
    const w = blank(24);
    segment(w, [{ x: 3.5, z: 10.5 }, { x: 18.5, z: 10.5 }]);
    const f = getFrontage(w);
    const expected = new Set<number>();
    for (let i = 0; i < f.road.length; i++) if (f.road[i] >= 0) expected.add(i);
    const actual = roundedCellTiles(buildZoneBlocks(w), w);
    for (const tile of actual) expect(expected.has(tile)).toBe(true);
    expect(actual.size).toBeGreaterThan(120);
  });

  it("splits long streets into balanced blocks of at most eight rows", () => {
    const w = blank(40);
    const twelve = blocksForSegment(w, { id: 1, type: ROAD.STREET, pts: [{ x: 4.5, z: 4.5 }, { x: 15.5, z: 4.5 }], tiles: [], a: 0, b: 0 });
    expect(twelve.filter((b) => b.side === -1).map((b) => b.rows)).toEqual([6, 6]);
    const twenty = blocksForSegment(w, { id: 2, type: ROAD.STREET, pts: [{ x: 4.5, z: 8.5 }, { x: 23.5, z: 8.5 }], tiles: [], a: 0, b: 0 });
    expect(twenty.filter((b) => b.side === -1).map((b) => b.rows)).toEqual([7, 7, 6]);
  });

  it("keeps four valid columns on both sides of a 45 degree street without placing centres on road tiles", () => {
    const w = blank(32);
    segment(w, [{ x: 6.5, z: 6.5 }, { x: 18.5, z: 18.5 }]);
    const set = buildZoneBlocks(w);
    const bySide = new Map<number, Set<number>>();
    for (const c of cells(set)) {
      bySide.set(c.b.side, (bySide.get(c.b.side) ?? new Set()).add(c.col));
      expect(w.roadSurface[idx(w, Math.floor(c.x), Math.floor(c.z))]).toBe(0);
    }
    expect([...bySide.get(-1)!].sort()).toEqual([0, 1, 2, 3]);
    expect([...bySide.get(1)!].sort()).toEqual([0, 1, 2, 3]);
  });

  it("invalidates cells over a T-junction and gives the corner cell to the older segment", () => {
    const w = blank(28);
    const older = segment(w, [{ x: 4.5, z: 12.5 }, { x: 20.5, z: 12.5 }]);
    const newer = segment(w, [{ x: 12.5, z: 6.5 }, { x: 12.5, z: 12.5 }]);
    const set = buildZoneBlocks(w);
    expect(cells(set).some((c) => c.b.seg === newer.id && Math.floor(c.x) === 12 && Math.floor(c.z) === 12)).toBe(false);
    // P0: street half width grew 0.50 -> 0.57, so the cell abutting the
    // junction (13.5, 11.43) is inside the widened clearance; the first valid
    // corner cell of the older segment is one row further out.
    expect(nearestCell(set, 13.5, 11.5, 0.75)).toBeNull();
    const corner = nearestCell(set, 14.5, 11.5, 0.75);
    expect(corner?.seg).toBe(older.id);
  });

  it("resolves parallel streets by distance, then older segment on shared inner cells", () => {
    const six = blank(32);
    segment(six, [{ x: 3.5, z: 8.5 }, { x: 24.5, z: 8.5 }]);
    segment(six, [{ x: 3.5, z: 14.5 }, { x: 24.5, z: 14.5 }]);
    const sixSet = buildZoneBlocks(six);
    expect(nearestCell(sixSet, 10.5, 10.5, 0.75)?.seg).toBe(1);
    expect(nearestCell(sixSet, 10.5, 12.5, 0.75)?.seg).toBe(2);

    const four = blank(32);
    const newer = segment(four, [{ x: 3.5, z: 8.5 }, { x: 24.5, z: 8.5 }]);
    const older = segment(four, [{ x: 3.5, z: 12.5 }, { x: 24.5, z: 12.5 }]);
    newer.id = 9; older.id = 2;
    const set = buildZoneBlocks(four);
    // P0: rows sit 0.07 further out (lat0 1.0 -> 1.07), so the newer inner cell
    // now overlaps the older inner cell and loses (older wins); the newer
    // segment keeps its outer side.
    expect(nearestCell(set, 10.5, 7.5, 0.75)?.seg).toBe(newer.id);
    expect(nearestCell(set, 10.5, 9.5, 0.75)).toBeNull();
    expect(nearestCell(set, 10.5, 10.5, 0.75)?.seg).toBe(older.id);
    expect(nearestCell(set, 10.5, 11.5, 0.75)?.seg).toBe(older.id);
  });

  it("rejects steep cells and cuts off rows behind them", () => {
    const w = blank(32);
    segment(w, [{ x: 0.5, z: 10.5 }, { x: 31.5, z: 10.5 }]);
    const s = w.size + 1;
    // P0: col 0 sits at z = 11.57 (was 11.5); the cliff moves one corner row
    // south so col 0 stays flat and cols 1+ stay steep, as the test intends.
    for (let y = 13; y <= s - 1; y++) for (let x = 0; x < s; x++) w.heights[y * s + x] = 3;
    const set = buildZoneBlocks(w);
    expect(nearestCell(set, 8.5, 11.5, 0.75)).not.toBeNull();
    expect(nearestCell(set, 8.5, 12.5, 0.75)).toBeNull();
    expect(nearestCell(set, 8.5, 13.5, 0.75)).toBeNull();
  });

  it("migrates zoned cells after splitting a street", () => {
    const w = blank(32);
    addSegment(w, ROAD.STREET, [{ x: 4.5, z: 12.5 }, { x: 20.5, z: 12.5 }]);
    const before = buildZoneBlocks(w);
    let zoned = 0;
    for (const c of cells(before)) if (c.row >= 6 && c.row <= 10 && c.col <= 1) {
      c.b.zone[cellIndex(c.row, c.col)] = ZONE.RES;
      c.b.level[cellIndex(c.row, c.col)] = 2;
      zoned++;
    }
    addSegment(w, ROAD.STREET, [{ x: 12.5, z: 12.5 }, { x: 12.5, z: 18.5 }]);
    const after = buildZoneBlocks(w);
    const report = migrateCells(before, after);
    let survived = 0;
    for (const b of after.blocks.values()) for (let i = 0; i < b.zone.length; i++) {
      if (b.zone[i] === ZONE.RES && b.level[i] === 2) survived++;
    }
    expect(report.dropped).toHaveLength(0);
    expect(survived).toBe(zoned);
  });

  it("builds 2,000 segments on a 128 map within the budget", () => {
    const w = blank(128);
    for (let i = 0; i < 2000; i++) {
      const x = 1.1 + (i % 125);
      const y = 1.1 + Math.floor(i / 125) * 8;
      segment(w, [{ x, z: y }, { x: x + 0.1, z: y }]);
    }
    buildZoneBlocks(w);
    const runs: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t = performance.now();
      buildZoneBlocks(w);
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    expect(runs[3]).toBeLessThan(15);
  });

  it("is deterministic", () => {
    const make = () => {
      const w = blank(40);
      segment(w, [{ x: 4.5, z: 6.5 }, { x: 25.5, z: 6.5 }]);
      segment(w, [{ x: 10.5, z: 2.5 }, { x: 10.5, z: 16.5 }]);
      return [...buildZoneBlocks(w).blocks.values()].map((b) => ({
        key: b.key, valid: [...b.valid], frame: [...b.frame].map((n) => Math.round(n * 1000) / 1000),
      }));
    };
    expect(make()).toEqual(make());
  });
});
