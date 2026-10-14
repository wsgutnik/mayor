import { describe, expect, it } from "vitest";
import { PAINT_COLOURS, boxOf, paintOf, weightedTable } from "./vehicle-palette";

describe("vehicle palette", () => {
  it("is deterministic per seed", () => {
    expect(paintOf(7)).toEqual(paintOf(7));
    expect(boxOf(42)).toEqual(boxOf(42));
    expect(paintOf(7)).toEqual(paintOf(7 + 256));
  });

  it("matches the author weights within one table slot", () => {
    const { table } = weightedTable(PAINT_COLOURS);
    const total = PAINT_COLOURS.reduce((s, p) => s + p[0], 0);
    const hist = new Array(PAINT_COLOURS.length).fill(0);
    for (const k of table) hist[k]++;
    for (let i = 0; i < PAINT_COLOURS.length; i++) {
      expect(Math.abs(hist[i] / 256 - PAINT_COLOURS[i][0] / total)).toBeLessThanOrEqual(1 / 256 + 1e-9);
    }
  });

  it("favours neutrals: most seeds land on the first seven entries", () => {
    const { table } = weightedTable(PAINT_COLOURS);
    let neutral = 0;
    for (const k of table) if (k < 7) neutral++;
    expect(neutral / 256).toBeGreaterThan(0.55);
  });
});
