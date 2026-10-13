import { describe, expect, it } from "vitest";
import { newCityFromMap, worldFromMap } from "./map-world";
import { MapData, packHeights, toB64 } from "./maps";
import { applyTool, step } from "./sim";
import { entryRoadTiles, isEntryTile, isLand, idx, tileHeight } from "./world";
import { deserialize, serialize } from "./save";

/** A 32-tile island map: sea around a hill, the entry on the top edge heading down. */
function island(size = 32): MapData {
  const s = size + 1;
  const h = new Float32Array(s * s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const d = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
      h[y * s + x] = 3 * (1 - d) - 0.6 + (x % 3) * 0.02;
    }
  }
  return {
    id: "test-island", size, heightsB64: packHeights(h),
    waterB64: toB64(new Uint8Array(size * size)), buildableB64: toB64(new Uint8Array(size * size).fill(1)),
    entry: { x: size / 2, y: 6, dx: 0, dy: 1 }, seaLevel: 0.23,
  };
}

describe("worldFromMap", () => {
  it("uses the baked heights and levels a dry entry road in any direction", () => {
    const w = worldFromMap(island());
    expect(w.size).toBe(32);
    const tiles = entryRoadTiles(w);
    expect(tiles).toHaveLength(3);
    for (const t of tiles) {
      expect(isLand(w, t % 32, (t / 32) | 0)).toBe(true);
      expect(w.road[t]).toBeGreaterThan(0);
    }
    // the centre of the island is higher than its shore
    expect(tileHeight(w, 16, 16)).toBeGreaterThan(tileHeight(w, 2, 2));
  });

  it("rejects an entry outside the map and bad sizes", () => {
    const bad = { ...island(), entry: { x: 99, y: 0, dx: 1 as const, dy: 0 as const } };
    expect(() => worldFromMap(bad)).toThrow(/outside/);
    expect(() => worldFromMap({ ...island(), size: 5 })).toThrow(/invalid size/);
    // heading off the map, or not a cardinal direction
    const off = { ...island(), entry: { x: 0, y: 5, dx: -1 as const, dy: 0 as const } };
    expect(() => worldFromMap(off)).toThrow(/outside/);
    const diag = { ...island(), entry: { x: 5, y: 5, dx: 1 as const, dy: 1 as const } };
    expect(() => worldFromMap(diag)).toThrow(/invalid direction/);
  });

  it("protects the entry tiles from the bulldozer, whichever edge they are on", () => {
    const s = newCityFromMap(island(), "bay");
    const { x, y, dx, dy } = s.world.entry;
    for (let k = 0; k < 3; k++) {
      expect(isEntryTile(s.world, x + dx * k, y + dy * k)).toBe(true);
      expect(applyTool(s, "bulldoze", x + dx * k, y + dy * k).ok).toBe(false);
    }
  });

  it("grows a city from a vertical entry and survives a save round trip", () => {
    const s = newCityFromMap(island(), "plains");
    s.money = 1e6;
    const { x, y } = s.world.entry;
    // a street continuing the entry, with houses on both sides
    for (let k = 3; k < 10; k++) applyTool(s, "road", x, y + k);
    for (let k = 3; k < 10; k++) { applyTool(s, "res", x - 1, y + k); applyTool(s, "res", x + 1, y + k); }
    step(s);
    expect(s.world.connected[idx(s.world, x, y + 9)]).toBe(1);
    const back = deserialize(serialize(s));
    expect(back.world.entry).toEqual(s.world.entry);
    expect(back.world.size).toBe(32);
    expect(Array.from(back.world.heights)).toEqual(Array.from(s.world.heights));
  });

  it("old saves without an entry direction load as a left-edge entry", () => {
    const old = JSON.parse(serialize(newCityFromMap(island(), "plains")));
    old.entry = { x: 0, y: 16 };
    const s = deserialize(JSON.stringify(old));
    expect(s.world.entry).toEqual({ x: 0, y: 16, dx: 1, dy: 0 });
  });
});
