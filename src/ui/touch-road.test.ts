import { describe, expect, it } from "vitest";
import { isTouchLongPress, nextTouchRoadMarker, touchDraftPoint, TOUCH_LONG_PRESS_MS } from "./touch-road";

describe("touch road helpers", () => {
  it("raises the draft endpoint above the finger and can disable that offset", () => {
    expect(touchDraftPoint({ x: 12, y: 80 })).toEqual({ x: 12, y: 24 });
    expect(touchDraftPoint({ x: 12, y: 80 }, false)).toEqual({ x: 12, y: 80 });
  });
  it("recognises only a stationary 450ms hold as a long press", () => {
    expect(isTouchLongPress(100, 100 + TOUCH_LONG_PRESS_MS - 1, false)).toBe(false);
    expect(isTouchLongPress(100, 100 + TOUCH_LONG_PRESS_MS, false)).toBe(true);
    expect(isTouchLongPress(100, 1000, true)).toBe(false);
  });
  it("keeps a marker state through anchor, drag, release and cancel", () => {
    expect(nextTouchRoadMarker("none", "anchor")).toBe("anchor");
    expect(nextTouchRoadMarker("anchor", "drag")).toBe("drag");
    expect(nextTouchRoadMarker("drag", "release")).toBe("anchor");
    expect(nextTouchRoadMarker("anchor", "cancel")).toBe("none");
  });
});
