import { Biome, World, entryRoadTiles, generateWorld, levelTiles, rebuildRoadRaster } from "./world";
import { CityState, newCity } from "./sim";
import { MapData, unpackHeights } from "./maps";

/** Look (colours, trees) to use for each kit terrain tag; unknown tags fall back to plains. */
export const BIOME_OF_TERRAIN: Record<string, Biome> = {
  bay: "coast", valley: "mountain", archipelago: "coast", plains: "plains",
};

/** Build a world from baked map data: terrain from the heightmap, a levelled entry road, nothing else. */
export function worldFromMap(data: MapData, biome: Biome = "plains"): World {
  const size = data.size;
  if (!Number.isInteger(size) || size < 16 || size > 512) throw new Error("Map has an invalid size");
  const w = generateWorld(size, 1, biome);
  w.heights.set(unpackHeights(data.heightsB64, size));
  const e = data.entry;
  if (Math.abs(e.dx) + Math.abs(e.dy) !== 1) throw new Error("Map entry has an invalid direction");
  for (let k = 0; k < 3; k++) {
    const x = e.x + e.dx * k, y = e.y + e.dy * k;
    if (x < 0 || y < 0 || x >= size || y >= size) throw new Error("Map entry is outside the map");
  }
  w.entry = { x: e.x, y: e.y, dx: e.dx, dy: e.dy };
  const tiles = entryRoadTiles(w);
  levelTiles(w, tiles);
  // Keep the strip above the water line so the entry never starts flooded.
  const s = size + 1;
  for (const t of tiles) {
    const x = t % size, y = (t / size) | 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const c = (y + dy) * s + x + dx;
      if (w.heights[c] < 0.3) w.heights[c] = 0.3;
    }
  }
  w.segments = [];
  w.nextSegmentId = 1;
  w.nodes = [];
  w.nextNodeId = 1;
  const { x, y, dx, dy } = w.entry;
  const na = w.nextNodeId++, nb = w.nextNodeId++;
  w.nodes.push(
    { id: na, x: x + 0.5, z: y + 0.5, segs: [w.nextSegmentId] },
    { id: nb, x: x + 0.5 + dx * 2, z: y + 0.5 + dy * 2, segs: [w.nextSegmentId] },
  );
  w.segments.push({
    id: w.nextSegmentId++, type: 1, fixed: true, tiles,
    pts: [{ x: x + 0.5, z: y + 0.5 }, { x: x + 0.5 + dx * 2, z: y + 0.5 + dy * 2 }],
    a: na, b: nb,
  });
  rebuildRoadRaster(w);
  w.revision++;
  return w;
}

export function newCityFromMap(data: MapData, terrain = "plains", seed = 1337): CityState {
  const biome = BIOME_OF_TERRAIN[terrain] ?? "plains";
  const s = newCity(seed, data.size, biome);
  s.world = worldFromMap(data, biome);
  return s;
}
