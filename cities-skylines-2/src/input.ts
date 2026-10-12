import { CityRenderer } from "./render/scene";

type Tile = { x: number; y: number };

export interface InputHooks {
  /** Called for every tile the active tool should touch while painting. */
  /** `first` is true for the tile where the stroke began (one-shot tools use only that). */
  paint(tile: Tile, first: boolean): void;
  /** True when the current tool paints; false means one-finger drag pans. */
  paintsWithPrimary(): boolean;
  hover(tile: Tile | null): void;
}

/**
 * Every tile on the line a→b, 4-connected: diagonal steps also emit the
 * intermediate tile, so painted roads stay connected under 4-neighbour rules.
 */
export function lineTiles(a: Tile, b: Tile): Tile[] {
  const out: Tile[] = [{ x: a.x, y: a.y }];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - a.x), dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  while (x !== b.x || y !== b.y) {
    const e2 = 2 * err;
    const stepX = e2 >= dy && x !== b.x;
    const stepY = e2 <= dx && y !== b.y;
    if (stepX) { err += dy; x += sx; out.push({ x, y }); }
    if (stepY) { err += dx; y += sy; out.push({ x, y }); }
  }
  return out;
}

/**
 * Mouse: left = tool, right = pan, middle = rotate, wheel = zoom, WASD/arrows pan, Q/E rotate.
 * Touch: one finger = tool (or pan with the hand tool), two fingers = pan + pinch + twist.
 */
export function bindInput(r: CityRenderer, hooks: InputHooks): () => void {
  const el = r.canvas;
  el.style.touchAction = "none";
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: "none" | "paint" | "pan" | "rotate" | "gesture" = "none";
  let last: Tile | null = null;
  let prev = { x: 0, y: 0 };
  let gesture: { cx: number; cy: number; dist: number; ang: number } | null = null;

  const measure = () => {
    const [a, b] = [...pointers.values()];
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      ang: Math.atan2(b.y - a.y, b.x - a.x),
    };
  };

  const paintAt = (cx: number, cy: number) => {
    const t = r.pick(cx, cy);
    if (!t) return;
    const first = last === null;
    for (const tile of last ? lineTiles(last, t) : [t]) hooks.paint(tile, first);
    last = t;
  };

  const down = (e: PointerEvent) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    prev = { x: e.clientX, y: e.clientY };
    if (pointers.size === 2) {
      mode = "gesture";
      last = null;
      gesture = measure();
      return;
    }
    if (e.pointerType === "mouse") {
      if (e.button === 0) {
        if (hooks.paintsWithPrimary()) { mode = "paint"; last = null; paintAt(e.clientX, e.clientY); }
        else mode = "pan";
      } else if (e.button === 2) mode = "pan";
      else if (e.button === 1) mode = "rotate";
    } else if (hooks.paintsWithPrimary()) {
      mode = "paint"; last = null; paintAt(e.clientX, e.clientY);
    } else mode = "pan";
  };

  const move = (e: PointerEvent) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === "gesture" && pointers.size >= 2 && gesture) {
      const g = measure();
      r.rig.panPixels(g.cx - gesture.cx, g.cy - gesture.cy, r.viewportHeight);
      if (gesture.dist > 0 && g.dist > 0) r.rig.zoom(gesture.dist / g.dist);
      let da = g.ang - gesture.ang;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      r.rig.rotate(-da);
      gesture = g;
      return;
    }
    if (mode === "paint") paintAt(e.clientX, e.clientY);
    else if (mode === "pan") r.rig.panPixels(e.clientX - prev.x, e.clientY - prev.y, r.viewportHeight);
    else if (mode === "rotate") r.rig.rotate(-(e.clientX - prev.x) * 0.006, (e.clientY - prev.y) * 0.004);
    else if (e.pointerType === "mouse") hooks.hover(r.pick(e.clientX, e.clientY));
    prev = { x: e.clientX, y: e.clientY };
  };

  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) gesture = null;
    if (pointers.size === 0) { mode = "none"; last = null; }
    else if (mode === "gesture") {
      // Remaining finger shouldn't suddenly paint; wait for a fresh touch.
      mode = "none";
    }
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    r.rig.zoom(Math.exp(e.deltaY * 0.0012));
  };

  const keys = new Set<string>();
  const keydown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    keys.add(e.key.toLowerCase());
  };
  const keyup = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  let raf = 0;
  const tick = () => {
    const sp = 0.012 * r.rig.dist;
    const k = (a: string, b: string) => (keys.has(a) || keys.has(b) ? 1 : 0);
    const right = k("d", "arrowright") - k("a", "arrowleft");
    const fwd = k("w", "arrowup") - k("s", "arrowdown");
    if (right || fwd) r.rig.panWorld(right * sp, fwd * sp);
    const rot = k("e", "e") - k("q", "q");
    if (rot) r.rig.rotate(rot * 0.025);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const ctx = (e: Event) => e.preventDefault();
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", wheel, { passive: false });
  el.addEventListener("contextmenu", ctx);
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);

  return () => {
    cancelAnimationFrame(raf);
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    el.removeEventListener("wheel", wheel);
    el.removeEventListener("contextmenu", ctx);
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
  };
}
