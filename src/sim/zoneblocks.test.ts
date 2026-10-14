import { describe, expect, it } from "vitest";
import { getFrontage } from "./blocks";
import { addSegment } from "./roads";
import { buildZoneBlocks, blocksForSegment, cellCorners, cellIndex, cellPose, junctionDiscs, migrateCells, nearestCell, quadArea, type ZoneBlockSet } from "./zoneblocks";
import { ROAD, ROAD_DRAW_WIDTH, ZONE, curvePoints, generateWorld, idx, rasterizeRoad, rebuildRoadRaster, type Pt, type RoadSegment, type RoadType, type World } from "./world";
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

function distToLine(x: number, z: number, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
    const u = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
    best = Math.min(best, Math.hypot(a.x + vx * u - x, a.z + vz * u - z));
  }
  return best;
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

  it("keeps four valid columns on every row of both sides of a 45 degree street, all outside its sidewalk", () => {
    // Was: "without placing centres on road tiles". The raster marks every tile the centreline touches, and on a
    // diagonal such a tile reaches ~1.4 tiles from the centreline, so that rule rejected the depth-0 cell of every
    // other row (the cut-off then emptied the row): the zone floated off the kerb (zone-attach.test.ts). The
    // physical rule is the sidewalk edge: no cell corner nearer the centreline than drawHalf + sidewalk.
    const w = blank(32);
    const seg = segment(w, [{ x: 6.5, z: 6.5 }, { x: 18.5, z: 18.5 }]);
    const set = buildZoneBlocks(w);
    const bySide = new Map<number, Set<number>>();
    const line = curvePoints(seg.pts, 0.25);
    const q = new Float32Array(8);
    for (const c of cells(set)) {
      bySide.set(c.b.side, (bySide.get(c.b.side) ?? new Set()).add(c.col));
      cellCorners(c.b, c.row, c.col, q);
      for (let k = 0; k < 4; k++) expect(distToLine(q[k * 2], q[k * 2 + 1], line)).toBeGreaterThanOrEqual(0.57 - 1e-4);
    }
    expect([...bySide.get(-1)!].sort()).toEqual([0, 1, 2, 3]);
    expect([...bySide.get(1)!].sort()).toEqual([0, 1, 2, 3]);
    for (const b of set.blocks.values()) for (let r = 0; r < b.rows; r++) expect(b.valid[cellIndex(r, 0)]).toBe(1);
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
    // Rows sit 0.07 further out (lat0 1.07), so between streets 4 apart each depth-0 cell overlaps the rival's
    // depth-1 cell. Contested cells go to the nearer centreline: both streets keep their depth-0 row against
    // their own sidewalk and the 0.86-wide leftover strip lies between the backs. (Was: the older street's depth-1
    // cell beat the newer depth-0 cell under the CS1 col band, leaving grass along the newer street's kerb.)
    expect(nearestCell(set, 10.5, 7.5, 0.75)?.seg).toBe(newer.id);
    expect(nearestCell(set, 10.5, 9.5, 0.75)?.seg).toBe(newer.id);
    expect(nearestCell(set, 10.5, 10.5, 0.75)).toBeNull();
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

  it("Z1: no valid cell corner lies inside either asphalt at a 45-degree crossing", () => {
    const w = blank(40);
    addSegment(w, ROAD.STREET, [{ x: 4.5, z: 20.5 }, { x: 35.5, z: 20.5 }]);
    addSegment(w, ROAD.STREET, [{ x: 12.5, z: 8.5 }, { x: 28.5, z: 24.5 }]);
    const set = buildZoneBlocks(w);
    const lines = w.segments.map((s) => ({ half: ROAD_DRAW_WIDTH[s.type] / 2, pts: curvePoints(s.pts, 0.25) }));
    const distTo = (x: number, z: number, line: { pts: Pt[] }) => {
      let best = Infinity;
      for (let i = 1; i < line.pts.length; i++) {
        const a = line.pts[i - 1], b = line.pts[i];
        const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
        const u = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
        best = Math.min(best, Math.hypot(a.x + vx * u - x, a.z + vz * u - z));
      }
      return best;
    };
    const corners = new Float32Array(8);
    let checked = 0;
    for (const b of set.blocks.values()) for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
      if (!b.valid[cellIndex(r, c)]) continue;
      cellCorners(b, r, c, corners);
      for (let k = 0; k < 4; k++) {
        for (const line of lines) expect(distTo(corners[k * 2], corners[k * 2 + 1], line)).toBeGreaterThanOrEqual(line.half - 1e-6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("Z1: no valid cell centre lies inside a T-junction keep-out disc", () => {
    const w = blank(32);
    addSegment(w, ROAD.STREET, [{ x: 4.5, z: 14.5 }, { x: 27.5, z: 14.5 }]);
    addSegment(w, ROAD.STREET, [{ x: 16.5, z: 14.5 }, { x: 16.5, z: 26.5 }]);
    const set = buildZoneBlocks(w);
    const discs = junctionDiscs(w);
    expect(discs.length).toBeGreaterThanOrEqual(1);
    for (const b of set.blocks.values()) for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
      if (!b.valid[cellIndex(r, c)]) continue;
      const p = cellPose(b, r, c);
      for (const d of discs) expect((p.x - d.x) ** 2 + (p.z - d.z) ** 2).toBeGreaterThanOrEqual(d.r * d.r - 1e-9);
    }
    // The keep-out is the junction's sidewalk polygon, not the disc: across the through road from the stem the
    // frontage continues over the node row (the disc used to cut a one-cell notch there).
    const far = nearestCell(set, 16.5, 13.43, 0.2);
    expect(far).not.toBeNull();
    expect(far!.col).toBe(0);
  });

  it("Z1: a cell with a corner in water is invalid", () => {
    const w = blank(32);
    segment(w, [{ x: 4.5, z: 14.5 }, { x: 27.5, z: 14.5 }]);
    const s = w.size + 1;
    for (let y = 16; y <= 18; y++) for (let x = 10; x <= 14; x++) w.heights[y * s + x] = -1;
    const set = buildZoneBlocks(w);
    // South side col 0 centre near (12.5, 15.57) has corners reaching into the pond.
    expect(nearestCell(set, 12.5, 15.5, 0.75)).toBeNull();
    expect(nearestCell(set, 20.5, 15.5, 0.75)).not.toBeNull();
  });

  it("Z2: a straight street gives exactly the old unit squares", () => {
    const w = blank(24);
    const seg = { id: 1, type: ROAD.STREET, pts: [{ x: 3.5, z: 10.5 }, { x: 18.5, z: 10.5 }], tiles: [], a: 0, b: 0 } as RoadSegment;
    for (const b of blocksForSegment(w, seg)) {
      const q = new Float32Array(8);
      for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
        cellCorners(b, r, c, q);
        const p = cellPose(b, r, c);
        const nx = p.nx * b.side, nz = p.nz * b.side;
        const ax = p.tx * 0.5, az = p.tz * 0.5, bx = nx * 0.5, bz = nz * 0.5;
        const exp = [p.x - ax - bx, p.z - az - bz, p.x + ax - bx, p.z + az - bz, p.x + ax + bx, p.z + az + bz, p.x - ax + bx, p.z - az + bz];
        for (let k = 0; k < 8; k++) expect(Math.abs(q[k] - exp[k])).toBeLessThan(1e-6);
        expect(Math.abs(Math.abs(quadArea(q)) - 1)).toBeLessThan(1e-6);
      }
    }
  });

  it("Z2: adjacent cells in a row share their edge on a quarter-circle street", () => {
    const w = blank(40);
    const seg = { id: 1, type: ROAD.STREET, pts: [{ x: 8.5, z: 10.5 }, { x: 8.5, z: 18.5 }, { x: 16.5, z: 18.5 }], tiles: [], a: 0, b: 0 } as RoadSegment;
    const blocks = blocksForSegment(w, seg);
    expect(blocks.length).toBeGreaterThan(0);
    const lo = new Float32Array(8), hi = new Float32Array(8);
    let pairs = 0;
    for (const b of blocks) {
      for (let r = 0; r + 1 < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
        cellCorners(b, r, c, lo);
        cellCorners(b, r + 1, c, hi);
        // High edge of row r (P10,P11) meets low edge of row r+1 (P00,P01).
        expect(Math.hypot(lo[2] - hi[0], lo[3] - hi[1])).toBeLessThan(1e-3);
        expect(Math.hypot(lo[4] - hi[6], lo[5] - hi[7])).toBeLessThan(1e-3);
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(10);
  });

  it("Z2: inner-side cells of an R=2 curve are dropped by the area cut", () => {
    const w = blank(32);
    segment(w, [{ x: 14.5, z: 10.5 }, { x: 14.5, z: 12.5 }, { x: 16.5, z: 12.5 }]);
    const set = buildZoneBlocks(w);
    const q = new Float32Array(8);
    let cutFound = false;
    for (const b of set.blocks.values()) {
      for (let r = 0; r < b.rows; r++) {
        for (let c = 0; c < CELL_DEPTH; c++) {
          cellCorners(b, r, c, q);
          const small = Math.abs(quadArea(q)) < 0.42;
          if (small) {
            expect(b.valid[cellIndex(r, c)]).toBe(0);
            cutFound = true;
          }
        }
        // Column stops at the cut: no valid cell behind an invalid one.
        for (let c = 1; c < CELL_DEPTH; c++) {
          if (!b.valid[cellIndex(r, c - 1)]) expect(b.valid[cellIndex(r, c)]).toBe(0);
        }
      }
    }
    expect(cutFound).toBe(true);
  });

  it("Z3: shuffling segment order gives byte-identical validity", () => {
    const make = (shuffle: boolean) => {
      const w = blank(40);
      addSegment(w, ROAD.STREET, [{ x: 4.5, z: 10.5 }, { x: 30.5, z: 10.5 }]);
      addSegment(w, ROAD.STREET, [{ x: 12.5, z: 4.5 }, { x: 12.5, z: 24.5 }]);
      addSegment(w, ROAD.STREET, [{ x: 20.5, z: 6.5 }, { x: 28.5, z: 18.5 }]);
      if (shuffle) w.segments.reverse();
      const set = buildZoneBlocks(w);
      return [...set.blocks.values()].sort((a, b) => a.key.localeCompare(b.key)).map((b) => `${b.key}:${[...b.valid].join("")}`).join("|");
    };
    expect(make(true)).toBe(make(false));
  });

  it("Z3: a T-junction block has no interior holes", () => {
    const w = blank(32);
    addSegment(w, ROAD.STREET, [{ x: 4.5, z: 14.5 }, { x: 27.5, z: 14.5 }]);
    addSegment(w, ROAD.STREET, [{ x: 16.5, z: 14.5 }, { x: 16.5, z: 26.5 }]);
    const set = buildZoneBlocks(w);
    for (const b of set.blocks.values()) for (let r = 0; r < b.rows; r++) {
      for (let c = 1; c < CELL_DEPTH; c++) {
        if (b.valid[cellIndex(r, c)]) expect(b.valid[cellIndex(r, c - 1)]).toBe(1);
      }
    }
  });

  it("Z3: rebuilding axis-aligned roads drops no zoned cells", () => {
    const w = blank(32);
    addSegment(w, ROAD.STREET, [{ x: 4.5, z: 14.5 }, { x: 27.5, z: 14.5 }]);
    const before = buildZoneBlocks(w);
    let zoned = 0;
    for (const b of before.blocks.values()) for (let i = 0; i < b.zone.length; i++) {
      if (b.valid[i]) { b.zone[i] = ZONE.RES; b.level[i] = 1; zoned++; }
    }
    expect(zoned).toBeGreaterThan(10);
    const after = buildZoneBlocks(w, before);
    const report = migrateCells(before, after);
    expect(report.dropped).toHaveLength(0);
  });
});
