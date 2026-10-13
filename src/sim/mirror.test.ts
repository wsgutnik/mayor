import { describe, expect, it } from "vitest";
import { applyZoneAt, bulldozeAt, getZoneBlocks, newCity, placeRoad, setOLotLevel, syncLots, type CityState } from "./sim";
import { rasterizeMirror, cellAt } from "./mirror";
import { cellIndex, cellPose } from "./zoneblocks";
import { COVER, idx, ROAD, ZONE } from "./world";

function flatOriented(seed = 3): CityState {
  const s = newCity(seed, 32);
  s.world.zoning = "oriented";
  s.world.heights.fill(0.35);
  return s;
}

function services(s: CityState): void {
  const ey = s.world.entry.y;
  s.money = 100000;
  placeRoad(s, ROAD.STREET, [{ x: 2.5, z: ey + 0.5 }, { x: 18.5, z: ey + 0.5 }]);
  s.world.cover.fill(COVER.POWER | COVER.WATER | COVER.SEWAGE | COVER.GARBAGE | COVER.FIRE | COVER.EDU);
  s.world.coverageDirty = false;
}

function firstCell(s: CityState, col = 0) {
  const set = getZoneBlocks(s.world);
  for (const b of set.blocks.values()) {
    for (let row = 0; row < b.rows; row++) {
      const i = cellIndex(row, col);
      if (b.valid[i]) return { b, row, col, pose: cellPose(b, row, col) };
    }
  }
  throw new Error("no valid cell");
}

describe("oriented tile mirror", () => {
  it("rasterizeMirror is idempotent and writes cellAt", () => {
    const s = flatOriented();
    const c = firstCell(s);
    expect(applyZoneAt(s, ZONE.RES, c.pose.x, c.pose.z, { radius: 1 }).ok).toBe(true);
    syncLots(s);
    const set = getZoneBlocks(s.world);
    rasterizeMirror(s.world, set, s.world.olots ?? []);
    const a = {
      zone: [...s.world.zone],
      level: [...s.world.level],
      lotAt: [...s.world.lotAt],
      lots: JSON.stringify(s.world.lots),
    };
    rasterizeMirror(s.world, set, s.world.olots ?? []);
    expect([...s.world.zone]).toEqual(a.zone);
    expect([...s.world.level]).toEqual(a.level);
    expect([...s.world.lotAt]).toEqual(a.lotAt);
    expect(JSON.stringify(s.world.lots)).toBe(a.lots);
    const tile = idx(s.world, Math.floor(c.pose.x), Math.floor(c.pose.z));
    expect(cellAt(s.world, tile)).toMatchObject({ seg: c.b.seg, side: c.b.side, block: c.b.block });
  });

  it("bulldozing one cell clears that cell and zeroes its grown lot", () => {
    const s = flatOriented(7);
    services(s);
    const c = firstCell(s);
    expect(applyZoneAt(s, ZONE.RES, c.pose.x, c.pose.z, { radius: 2 }).ok).toBe(true);
    syncLots(s);
    const lot = (s.world.olots ?? [])[0];
    expect(lot).toBeTruthy();
    setOLotLevel(s.world, lot!, 2);
    const b = getZoneBlocks(s.world).blocks.get(`${lot!.seg}:${lot!.side}:${lot!.block}`)!;
    const p = cellPose(b, lot!.row, lot!.col);
    expect(bulldozeAt(s, p.x, p.z).ok).toBe(true);
    const after = getZoneBlocks(s.world).blocks.get(`${lot!.seg}:${lot!.side}:${lot!.block}`)!;
    expect(after.zone[cellIndex(lot!.row, lot!.col)]).toBe(0);
    expect((s.world.olots ?? []).every((l) => l.id !== lot!.id || l.level === 0)).toBe(true);
  });

  it("building a road through zoned oriented cells drops only cells under the road", () => {
    const s = flatOriented(11);
    const ey = s.world.entry.y;
    placeRoad(s, ROAD.STREET, [{ x: 4.5, z: ey - 6.5 }, { x: 20.5, z: ey - 6.5 }]);
    for (const b of getZoneBlocks(s.world).blocks.values()) {
      for (let row = 0; row < b.rows; row++) for (let col = 0; col < 2; col++) {
        const i = cellIndex(row, col);
        if (b.valid[i]) { b.zone[i] = ZONE.RES; b.level[i] = 2; }
      }
    }
    syncLots(s);
    const before = s.world.zone.reduce((n, z) => n + (z ? 1 : 0), 0);
    expect(placeRoad(s, ROAD.STREET, [{ x: 12.5, z: ey - 10.5 }, { x: 12.5, z: ey - 2.5 }]).ok).toBe(true);
    const after = s.world.zone.reduce((n, z) => n + (z ? 1 : 0), 0);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    expect(s.world.level.some((l) => l === 2)).toBe(true);
  });
});
