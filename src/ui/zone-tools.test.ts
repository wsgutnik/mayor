import { describe, expect, it } from "vitest";
import { ZONE_FILL_CAP, floodFill, rectangleTiles, type ZoneTile } from "./zone-tools";

const open = (tiles: string) => {
  const set = new Set(
    tiles.trim().split("\n").flatMap((row, y) =>
      [...row].flatMap((ch, x) => (ch === "." ? [`${x},${y}`] : [])),
    ),
  );
  return (t: ZoneTile) => set.has(`${t.x},${t.y}`);
};

describe("rectangleTiles", () => {
  it("is one tile when the corners match", () => {
    expect(rectangleTiles({ x: 3, y: 5 }, { x: 3, y: 5 })).toEqual([{ x: 3, y: 5 }]);
  });

  it("normalises corner order and covers every tile", () => {
    expect(rectangleTiles({ x: 2, y: 1 }, { x: 0, y: 0 })).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
    ]);
  });
});

describe("floodFill", () => {
  it("is empty when the start tile is closed", () => {
    expect(floodFill({ x: 0, y: 0 }, open("#\n#"))).toEqual([]);
  });

  it("stays inside walls and skips other regions", () => {
    const isOpen = open("...#\n.#.#\n...#\n####\n....");
    const got = floodFill({ x: 0, y: 0 }, isOpen).map((t) => `${t.x},${t.y}`).sort();
    expect(got).toEqual(["0,0", "0,1", "0,2", "1,0", "1,2", "2,0", "2,1", "2,2"]);
  });

  it("does not leak diagonally", () => {
    const isOpen = open(".#\n#.");
    expect(floodFill({ x: 0, y: 0 }, isOpen)).toEqual([{ x: 0, y: 0 }]);
  });

  it("caps large regions at ZONE_FILL_CAP", () => {
    expect(ZONE_FILL_CAP).toBe(400);
    const got = floodFill({ x: 0, y: 0 }, () => true);
    expect(got.length).toBe(ZONE_FILL_CAP);
    expect(got[0]).toEqual({ x: 0, y: 0 });
  });

  it("honours an explicit smaller cap", () => {
    expect(floodFill({ x: 0, y: 0 }, () => true, 3).length).toBe(3);
    expect(floodFill({ x: 0, y: 0 }, () => true, 0)).toEqual([]);
  });
});
