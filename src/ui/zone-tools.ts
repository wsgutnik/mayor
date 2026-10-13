/** Zoning shapes for UI-3 (Marquee and Fill). Pure geometry: no sim imports, so unit tests stay tiny. */

export type ZoneMode = "paint" | "marquee" | "fill";

export interface ZoneTile { x: number; y: number }

/** Largest region the Fill tool paints in one tap. */
export const ZONE_FILL_CAP = 400;

/** Every tile of the inclusive rectangle a..b, normalised, row-major from the top-left. */
export function rectangleTiles(a: ZoneTile, b: ZoneTile): ZoneTile[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const out: ZoneTile[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

/**
 * 4-connected flood fill from `start` over tiles where `isOpen` holds.
 * Returns at most `cap` tiles in BFS order (fixed neighbour order, so deterministic).
 * Empty when `start` itself is closed or `cap` <= 0.
 */
export function floodFill(
  start: ZoneTile,
  isOpen: (t: ZoneTile) => boolean,
  cap: number = ZONE_FILL_CAP,
): ZoneTile[] {
  if (cap <= 0 || !isOpen(start)) return [];
  const seen = new Set<string>([`${start.x},${start.y}`]);
  const queue: ZoneTile[] = [start];
  const out: ZoneTile[] = [];
  // Index pointer instead of shift(): the queue can hold the whole region plus its rim.
  for (let head = 0; head < queue.length && out.length < cap; head++) {
    const t = queue[head];
    out.push(t);
    const next: ZoneTile[] = [
      { x: t.x + 1, y: t.y },
      { x: t.x - 1, y: t.y },
      { x: t.x, y: t.y + 1 },
      { x: t.x, y: t.y - 1 },
    ];
    for (const n of next) {
      const key = `${n.x},${n.y}`;
      if (!seen.has(key) && isOpen(n)) {
        seen.add(key);
        queue.push(n);
      }
    }
  }
  return out;
}
