import { describe, expect, it } from "vitest";
import { placeTooltip, tipMoney } from "./tooltip";

describe("placeTooltip", () => {
  const vp = { w: 1024, h: 768 };

  it("sits centred above the anchor by default", () => {
    const p = placeTooltip({ left: 500, top: 400, bottom: 440, width: 80 }, { w: 200, h: 100 }, vp);
    expect(p.below).toBe(false);
    expect(p.y).toBe(400 - 100 - 12);
    expect(p.x).toBe(500 + 40 - 100);
    expect(p.arrowX).toBe(100);
  });

  it("drops below the anchor when there is no room above", () => {
    const p = placeTooltip({ left: 500, top: 10, bottom: 50, width: 80 }, { w: 200, h: 100 }, vp);
    expect(p.below).toBe(true);
    expect(p.y).toBe(50 + 12);
  });

  it("clamps horizontally into the viewport", () => {
    const left = placeTooltip({ left: 0, top: 400, bottom: 440, width: 40 }, { w: 300, h: 100 }, vp);
    expect(left.x).toBe(8);
    const right = placeTooltip({ left: 1000, top: 400, bottom: 440, width: 40 }, { w: 300, h: 100 }, vp);
    expect(right.x).toBe(1024 - 300 - 8);
    expect(right.arrowX).toBeLessThanOrEqual(300 - 14);
    expect(right.arrowX).toBeGreaterThanOrEqual(14);
  });

  it("lifts above the open flyout so sibling UI is never covered", () => {
    const p = placeTooltip(
      { left: 500, top: 600, bottom: 640, width: 80 }, { w: 200, h: 100 }, vp, 560,
    );
    expect(p.below).toBe(false);
    expect(p.y).toBe(560 - 100 - 10);
  });
});

describe("tipMoney", () => {
  it("formats whole dollars with grouping", () => {
    expect(tipMoney(1234)).toBe("$1,234");
    expect(tipMoney(-50)).toBe("$50");
  });
});
