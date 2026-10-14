import { CityState, newCity, placeRoad, placeRoundabout } from "./sim";
import { cidx, Pt, RoadType } from "./world";

/**
 * Deterministic junction/road hard-case builders, shared by the dev
 * showcase (`src/dev/showcase.ts`, `?showcase=1`) and the headless
 * geometric gate (`src/sim/showcase-gate.test.ts`).
 *
 * Every case builds through the public tools (`placeRoad`,
 * `placeRoundabout`), exactly as a player would draw. Case geometry is
 * a pure function of (case, origin): same origin, same world, bit for bit.
 * Case footprints fit in a 17x17 tile box so the full showcase stages all
 * 12 on one 96x96 map on a 20-tile pitch without overlap.
 */

export const SHOWCASE_SEED = 7;
export const SHOWCASE_SIZE = 96;
/** Showcase budgets the player wallet so no build can fail on cost. */
const SHOWCASE_MONEY = 1e9;

export type ShowcaseCaseName =
  | "cross-street"
  | "cross-avenue-street"
  | "tee"
  | "y-25"
  | "five-arm"
  | "dead-end"
  | "curve-node"
  | "bend"
  | "avenue-street-transition"
  | "bridge-ramp"
  | "short-pair"
  | "roundabout";

export const SHOWCASE_CASES: ShowcaseCaseName[] = [
  "cross-street",
  "cross-avenue-street",
  "tee",
  "y-25",
  "five-arm",
  "dead-end",
  "curve-node",
  "bend",
  "avenue-street-transition",
  "bridge-ramp",
  "short-pair",
  "roundabout",
];

export const SHOWCASE_TITLES: Record<ShowcaseCaseName, string> = {
  "cross-street": "4-way street cross",
  "cross-avenue-street": "4-way avenue + street",
  "tee": "T junction",
  "y-25": "Y with 25 deg branch gap",
  "five-arm": "5-arm junction",
  "dead-end": "dead end (round cap)",
  "curve-node": "curve through node (T on a curve)",
  "bend": "2-arm 90 deg bend",
  "avenue-street-transition": "avenue to street transition",
  "bridge-ramp": "bridge ramp over a street",
  "short-pair": "short segment pair (two crosses 1.5 apart)",
  "roundabout": "roundabout",
};

/** Grid slot of each case in the full showcase world (tile origin). */
export const SHOWCASE_GRID: Record<ShowcaseCaseName, { ox: number; oz: number }> = {
  "cross-street": { ox: 8, oz: 8 },
  "cross-avenue-street": { ox: 30, oz: 8 },
  "tee": { ox: 52, oz: 8 },
  "y-25": { ox: 74, oz: 8 },
  "five-arm": { ox: 8, oz: 30 },
  "dead-end": { ox: 30, oz: 30 },
  "curve-node": { ox: 52, oz: 30 },
  "bend": { ox: 74, oz: 30 },
  "avenue-street-transition": { ox: 8, oz: 56 },
  "bridge-ramp": { ox: 30, oz: 56 },
  "short-pair": { ox: 52, oz: 56 },
  "roundabout": { ox: 74, oz: 56 },
};

/** Case-local focus (junction centre or feature point) for an origin. */
export function caseFocus(name: ShowcaseCaseName, ox: number, oz: number): Pt {
  switch (name) {
    case "dead-end": return { x: ox + 9.5, z: oz + 8.5 };
    case "curve-node": return { x: ox + 8.5, z: oz + 9.0 };
    default: return { x: ox + 8.5, z: oz + 8.5 };
  }
}

type Ctx = { s: CityState; ox: number; oz: number };

function mustOk(ctx: Ctx, what: string, r: { ok: boolean; reason?: string }): void {
  if (!r.ok) throw new Error(`showcase case failed to build (${what} at ${ctx.ox},${ctx.oz}): ${r.reason}`);
}

const road = (ctx: Ctx, type: RoadType, pts: Pt[], level?: "ground" | "elevated"): void =>
  mustOk(ctx, `${type} ${JSON.stringify(pts)}`, placeRoad(ctx.s, type, pts, level ?? "ground"));

/** Straight arm from the junction centre outward at `angleDeg` (atan2 convention). */
function arm(ctx: Ctx, type: RoadType, cx: number, cz: number, angleDeg: number, len: number): void {
  const a = (angleDeg * Math.PI) / 180;
  road(ctx, type, [{ x: cx, z: cz }, { x: cx + Math.cos(a) * len, z: cz + Math.sin(a) * len }]);
}

function hBar(ctx: Ctx, type: RoadType, cx: number, cz: number, half: number): void {
  road(ctx, type, [{ x: cx - half, z: cz }, { x: cx + half, z: cz }]);
}

function vBar(ctx: Ctx, type: RoadType, cx: number, cz: number, half: number): void {
  road(ctx, type, [{ x: cx, z: cz - half }, { x: cx, z: cz + half }]);
}

const BUILDERS: Record<ShowcaseCaseName, (ctx: Ctx) => void> = {
  "cross-street": (ctx) => {
    const f = caseFocus("cross-street", ctx.ox, ctx.oz);
    hBar(ctx, 1, f.x, f.z, 7);
    vBar(ctx, 1, f.x, f.z, 7);
  },
  "cross-avenue-street": (ctx) => {
    const f = caseFocus("cross-avenue-street", ctx.ox, ctx.oz);
    hBar(ctx, 2, f.x, f.z, 7);
    vBar(ctx, 1, f.x, f.z, 7);
  },
  "tee": (ctx) => {
    const f = caseFocus("tee", ctx.ox, ctx.oz);
    hBar(ctx, 1, f.x, f.z, 7);
    road(ctx, 1, [{ x: f.x, z: f.z - 7 }, { x: f.x, z: f.z }]);
  },
  "y-25": (ctx) => {
    const f = caseFocus("y-25", ctx.ox, ctx.oz);
    arm(ctx, 1, f.x, f.z, 180, 7);
    arm(ctx, 1, f.x, f.z, -12.5, 8);
    arm(ctx, 1, f.x, f.z, 12.5, 8);
  },
  "five-arm": (ctx) => {
    const f = caseFocus("five-arm", ctx.ox, ctx.oz);
    for (let k = 0; k < 5; k++) arm(ctx, 1, f.x, f.z, -90 + k * 72, 7);
  },
  "dead-end": (ctx) => {
    const f = caseFocus("dead-end", ctx.ox, ctx.oz);
    road(ctx, 1, [{ x: f.x - 8, z: f.z }, { x: f.x, z: f.z }]);
  },
  "curve-node": (ctx) => {
    // Quadratic Bezier midpoint is exactly (P0 + 2C + P2)/4; the stem ends
    // there so it T-splits the curve at t = 0.5.
    const cx = ctx.ox + 8.5, cz = ctx.oz + 8.5;
    road(ctx, 1, [{ x: cx - 7, z: cz - 3 }, { x: cx, z: cz + 4 }, { x: cx + 7, z: cz - 3 }]);
    const mx = (cx - 7 + 2 * cx + cx + 7) / 4;
    const mz = (cz - 3 + 2 * (cz + 4) + cz - 3) / 4;
    road(ctx, 1, [{ x: mx, z: mz + 7 }, { x: mx, z: mz }]);
  },
  "bend": (ctx) => {
    const f = caseFocus("bend", ctx.ox, ctx.oz);
    road(ctx, 1, [{ x: f.x - 7, z: f.z }, { x: f.x, z: f.z }]);
    road(ctx, 1, [{ x: f.x, z: f.z }, { x: f.x, z: f.z - 7 }]);
  },
  "avenue-street-transition": (ctx) => {
    const f = caseFocus("avenue-street-transition", ctx.ox, ctx.oz);
    road(ctx, 2, [{ x: f.x - 7, z: f.z }, { x: f.x, z: f.z }]);
    road(ctx, 1, [{ x: f.x, z: f.z }, { x: f.x + 7, z: f.z }]);
  },
  "bridge-ramp": (ctx) => {
    const f = caseFocus("bridge-ramp", ctx.ox, ctx.oz);
    hBar(ctx, 1, f.x, f.z, 7);
    // 16 long, crossing the street mid-span: 3-tile ground ramps at both
    // ends with a bridge deck over the street (crossings.test.ts deckCity).
    road(ctx, 2, [{ x: f.x, z: f.z - 8 }, { x: f.x, z: f.z + 8 }], "elevated");
  },
  "short-pair": (ctx) => {
    const f = caseFocus("short-pair", ctx.ox, ctx.oz);
    vBar(ctx, 1, f.x, f.z, 7);
    hBar(ctx, 1, f.x, f.z - 0.75, 7);
    hBar(ctx, 1, f.x, f.z + 0.75, 7);
  },
  "roundabout": (ctx) => {
    const f = caseFocus("roundabout", ctx.ox, ctx.oz);
    hBar(ctx, 1, f.x, f.z, 6);
    vBar(ctx, 1, f.x, f.z, 6);
    mustOk(ctx, "roundabout", placeRoundabout(ctx.s, Math.floor(f.x), Math.floor(f.z)));
  },
};

/** Flat, dry, rich deterministic city with nothing but the entry road. */
export function blankShowcaseCity(): CityState {
  const s = newCity(SHOWCASE_SEED, SHOWCASE_SIZE, "plains");
  for (let y = 0; y < s.world.size; y++) {
    for (let x = 0; x < s.world.size; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  }
  s.money = SHOWCASE_MONEY;
  return s;
}

/** Build one case at `origin` in `s`. Throws when any road fails. */
export function buildCaseAt(s: CityState, name: ShowcaseCaseName, ox: number, oz: number): Pt {
  BUILDERS[name]({ s, ox, oz });
  return caseFocus(name, ox, oz);
}

/** Fresh world with exactly one case (headless gate, SVG dumps). */
export function buildCaseWorld(name: ShowcaseCaseName): { state: CityState; focus: Pt } {
  const s = blankShowcaseCity();
  const focus = buildCaseAt(s, name, 8, 30);
  return { state: s, focus };
}

/** One world staging all 12 cases on the fixed grid (dev showcase). */
export function buildShowcaseWorld(): { state: CityState; focusOf: Record<ShowcaseCaseName, Pt> } {
  const s = blankShowcaseCity();
  const focusOf = {} as Record<ShowcaseCaseName, Pt>;
  for (const name of SHOWCASE_CASES) {
    const g = SHOWCASE_GRID[name];
    focusOf[name] = buildCaseAt(s, name, g.ox, g.oz);
  }
  return { state: s, focusOf };
}

// ------------------------------------------------------------- 2D helpers

export interface Tri { ax: number; az: number; bx: number; bz: number; cx: number; cz: number }

export const triArea2 = (t: Tri): number =>
  Math.abs((t.bx - t.ax) * (t.cz - t.az) - (t.cx - t.ax) * (t.bz - t.az));

export function minTriAngleDeg(t: Tri): number {
  const ab = Math.hypot(t.ax - t.bx, t.az - t.bz);
  const bc = Math.hypot(t.bx - t.cx, t.bz - t.cz);
  const ca = Math.hypot(t.cx - t.ax, t.cz - t.az);
  if (ab < 1e-9 || bc < 1e-9 || ca < 1e-9) return 0;
  const ang = (x: number, y: number, z: number): number =>
    (Math.acos(Math.max(-1, Math.min(1, (x * x + y * y - z * z) / (2 * x * y)))) * 180) / Math.PI;
  return Math.min(ang(ab, ca, bc), ang(ab, bc, ca), ang(bc, ca, ab));
}

export function polyArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += p.x * q.z - q.x * p.z;
  }
  return Math.abs(s) / 2;
}

function segInt(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt): number => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when a ring self-intersects (non-simple polygon). */
export function ringSelfIntersects(ring: Pt[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === ring.length - 1)) continue;
      if (segInt(ring[i], ring[(i + 1) % ring.length], ring[j], ring[(j + 1) % ring.length])) return true;
    }
  }
  return false;
}

export function pointInPoly(poly: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z || 1e-12) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Sutherland-Hodgman intersection area of two polygons (rings are convex-ish small). */
export function intersectionArea(a: Pt[], b: Pt[]): number {
  let out = a;
  for (let i = 0; i < b.length && out.length > 0; i++) {
    const c = b[i], d = b[(i + 1) % b.length];
    const inside = (p: Pt): boolean => (d.x - c.x) * (p.z - c.z) - (d.z - c.z) * (p.x - c.x) >= 0;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j], prev = input[(j + input.length - 1) % input.length];
      const cin = inside(cur), pin = inside(prev);
      if (cin) {
        if (!pin) out.push(lineCross(prev, cur, c, d));
        out.push(cur);
      } else if (pin) {
        out.push(lineCross(prev, cur, c, d));
      }
    }
  }
  return out.length >= 3 ? polyArea(out) : 0;
}

function lineCross(p: Pt, q: Pt, c: Pt, d: Pt): Pt {
  const a1 = q.z - p.z, b1 = p.x - q.x, cc1 = a1 * p.x + b1 * p.z;
  const a2 = d.z - c.z, b2 = c.x - d.x, cc2 = a2 * c.x + b2 * c.z;
  const det = a1 * b2 - a2 * b1 || 1e-12;
  return { x: (b2 * cc1 - b1 * cc2) / det, z: (a1 * cc2 - a2 * cc1) / det };
}

/** Fan triangulation of a ring from (cx, cz), mirroring render `nodePatch`. */
export function fanTris(cx: number, cz: number, ring: Pt[]): Tri[] {
  const out: Tri[] = [];
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    out.push({ ax: cx, az: cz, bx: a.x, bz: a.z, cx: b.x, cz: b.z });
  }
  return out;
}

/** True when two rings overlap: a vertex inside the other, or edges crossing. */
export function ringsOverlap(a: Pt[], b: Pt[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  if (a.some((p) => pointInPoly(b, p)) || b.some((p) => pointInPoly(a, p))) return true;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segInt(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

function inTri(t: Tri, px: number, pz: number): boolean {
  const s = (x: number, z: number, ax: number, az: number, bx: number, bz: number): number =>
    (x - bx) * (az - bz) - (ax - bx) * (z - bz);
  const d1 = s(px, pz, t.ax, t.az, t.bx, t.bz);
  const d2 = s(px, pz, t.bx, t.bz, t.cx, t.cz);
  const d3 = s(px, pz, t.cx, t.cz, t.ax, t.az);
  return !((d1 < -1e-7 || d2 < -1e-7 || d3 < -1e-7) && (d1 > 1e-7 || d2 > 1e-7 || d3 > 1e-7));
}

/** True when (px, pz) is covered by any triangle in the set. */
export function coveredByTris(tris: Tri[], px: number, pz: number): boolean {
  return tris.some((t) => inTri(t, px, pz));
}
