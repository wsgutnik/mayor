/** Pure touch-road affordances; DOM/pointer plumbing lives in main.ts. */
export const TOUCH_DRAFT_OFFSET_PX = 56;
export const TOUCH_LONG_PRESS_MS = 450;

export interface ScreenPoint { x: number; y: number }

/** Point used for world picking, raised above the finger so the draft end stays visible. */
export function touchDraftPoint(p: ScreenPoint, enabled = true): ScreenPoint {
  return enabled ? { x: p.x, y: p.y - TOUCH_DRAFT_OFFSET_PX } : { ...p };
}

/** A press becomes a cancellation only when it stays still for the full hold threshold. */
export function isTouchLongPress(downMs: number, nowMs: number, moved: boolean): boolean {
  return !moved && nowMs - downMs >= TOUCH_LONG_PRESS_MS;
}

export type TouchRoadMarker = "none" | "anchor" | "drag";
export function nextTouchRoadMarker(current: TouchRoadMarker, event: "anchor" | "drag" | "release" | "cancel"): TouchRoadMarker {
  if (event === "cancel") return "none";
  if (event === "anchor") return "anchor";
  if (event === "drag" && current === "anchor") return "drag";
  if (event === "release" && current === "drag") return "anchor";
  return current;
}
