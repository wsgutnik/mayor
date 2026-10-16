import { planRoad, placeRoad, type CityState, type ToolResult } from "./sim";
import { segElevation, type Pt, type RoadSegment } from "./world";
import { nearestOnSegment, nodeArms } from "./roads";

export interface InterchangeRamp { pts: Pt[]; role: "exit" | "entry"; side: -1 | 1; }
export interface InterchangePlan { ok: boolean; reason?: string; ramps: InterchangeRamp[]; cost: number; }
export const INTERCHANGE_TERMINAL_GAP = 2;
const CROSSING_REASON = "Tap where a road crosses a highway";
const GROUND_HIGHWAY_REASON = "The highway must be at ground level here";
const ANGLE_REASON = "Interchange needs a crossing near 90 degrees";
const TERMINAL_REASON = "No room for ramp terminals";
const empty = (reason: string): InterchangePlan => ({ ok: false, reason, ramps: [], cost: 0 });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.z * b.z;
const cross2 = (a: Pt, b: Pt) => a.x * b.z - a.z * b.x;
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, z: a.z - b.z });
const add = (a: Pt, b: Pt, n: number): Pt => ({ x: a.x + b.x * n, z: a.z + b.z * n });
const unit = (p: Pt): Pt => { const l = Math.hypot(p.x, p.z) || 1; return { x: p.x / l, z: p.z / l }; };
const direction = (s: RoadSegment): Pt => unit(sub(s.pts.at(-1)!, s.pts[0]));

function intersection(a: RoadSegment, b: RoadSegment): Pt | null {
  const p = a.pts[0], r = sub(a.pts.at(-1)!, p), q = b.pts[0], s = sub(b.pts.at(-1)!, q);
  const k = r.x * s.z - r.z * s.x;
  if (Math.abs(k) < 1e-6) return null;
  const v = sub(q, p), t = (v.x * s.z - v.z * s.x) / k, u = (v.x * r.z - v.z * r.x) / k;
  return t >= -1e-4 && t <= 1.0001 && u >= -1e-4 && u <= 1.0001 ? add(p, r, t) : null;
}

/** Find a nearby deck/highway pair, then use their actual centreline intersection. */
function crossing(s: CityState, x: number, z: number): { highway: RoadSegment; cross: RoadSegment; centre: Pt } | null {
  let best: { highway: RoadSegment; cross: RoadSegment; centre: Pt; d: number } | null = null;
  for (const highway of s.world.segments.filter((g) => g.type === 3)) for (const cross of s.world.segments) {
    if (cross === highway || (segElevation(highway) === "ground") === (segElevation(cross) === "ground")) continue;
    const centre = intersection(highway, cross); if (!centre) continue;
    const d = Math.hypot(centre.x - x, centre.z - z);
    if (d <= 2.5 && (!best || d < best.d)) best = { highway, cross, centre, d };
  }
  return best;
}

function bridgeEnds(cross: RoadSegment, centre: Pt, c: Pt): { plus: number; minus: number } {
  let plus = 0, minus = 0;
  for (const p of [cross.pts[0], cross.pts.at(-1)!]) {
    const d = dot(sub(p, centre), c);
    if (d > 0) plus = Math.max(plus, d); else minus = Math.max(minus, -d);
  }
  return { plus: plus + INTERCHANGE_TERMINAL_GAP, minus: minus + INTERCHANGE_TERMINAL_GAP };
}

function terminalHasJunction(s: CityState, p: Pt): boolean {
  return s.world.nodes.some((n) => Math.hypot(n.x - p.x, n.z - p.z) < 4 - 1e-6 && nodeArms(s.world, n.id).length > 2);
}

const onGroundRoad = (s: CityState, p: Pt, type: RoadSegment["type"]): boolean =>
  s.world.segments.some((seg) => seg.type === type && segElevation(seg) === "ground"
    && nearestOnSegment(seg, p).d <= .25);

const planReason = (reason?: string): string =>
  reason === "Too close to a junction" || reason === "Overlaps another road" ? TERMINAL_REASON : reason!;

/** Plan and stamp on a private copy so validation sees the same sequential network and price as placement. */
function simulate(s: CityState, ramps: InterchangeRamp[]): { ok: true; cost: number } | { ok: false; reason: string } {
  const scratch = structuredClone(s) as CityState;
  scratch.money = Number.MAX_SAFE_INTEGER;
  let cost = 0;
  for (const ramp of ramps) {
    const planned = planRoad(scratch, 6, ramp.pts);
    if (!planned.ok) return { ok: false, reason: planReason(planned.reason) };
    const before = scratch.money;
    const placed = placeRoad(scratch, 6, ramp.pts);
    if (!placed.ok) return { ok: false, reason: planReason(placed.reason) };
    cost += before - scratch.money;
  }
  return { ok: true, cost };
}

export function planInterchange(s: CityState, x: number, z: number): InterchangePlan {
  const hit = crossing(s, x, z); if (!hit) return empty(CROSSING_REASON);
  const { highway, cross, centre } = hit;
  if (segElevation(highway) !== "ground") return empty(GROUND_HIGHWAY_REASON);
  const h = direction(highway), n = { x: -h.z, z: h.x };
  let c = direction(cross); if (dot(c, n) < 0) c = { x: -c.x, z: -c.z };
  if (Math.abs(dot(h, c)) > Math.cos(70 * Math.PI / 180)) return empty(ANGLE_REASON);
  const ends = bridgeEnds(cross, centre, c);
  // The bridge ramp's ground end is a node 1 tile beyond the nominal terminal;
  // a ramp ending 1 tile from a through node would be refused as a tee too
  // close to it, so a terminal within 1.6 of such a node is that node (4 arms).
  const snap = (side: -1 | 1): Pt => {
    const p = add(centre, c, side === 1 ? ends.plus : -ends.minus);
    const node = s.world.nodes.find((q) => Math.hypot(q.x - p.x, q.z - p.z) <= 1.6 && onGroundRoad(s, q, cross.type)
      && Math.abs(cross2(sub(q, centre), c)) < 1e-3);
    return node ? { x: node.x, z: node.z } : p;
  };
  const snapped = { 1: snap(1), "-1": snap(-1) };
  const d = { plus: dot(sub(snapped[1], centre), c), minus: -dot(sub(snapped[-1], centre), c) };
  const angle = 20 * Math.PI / 180;
  const g = Math.max(d.plus, d.minus) / Math.tan(angle) + 2;
  const terminal = (side: -1 | 1): Pt => snapped[side];
  const ramp = (role: InterchangeRamp["role"], side: -1 | 1): InterchangeRamp => {
    const travel = { x: h.x * side, z: h.z * side };
    const t = terminal(side);
    // The -n side is staggered 6 tiles outward so its gores never coincide with
    // the +n side's (a shared gore would be a 4-arm highway node, not a merge/diverge).
    const gd = g + (side === -1 ? 6 : 0);
    const gore = add(centre, travel, role === "exit" ? -gd : gd);
    // The highway-side tangent ray points toward this ramp's side. For an
    // entry the ray is traced backwards from the gore; the driven curve ends
    // in the opposite direction. C is where that ray meets T + k*h.
    const along = role === "exit" ? 1 : -1;
    const ray = {
      x: travel.x * Math.cos(angle) * along + n.x * Math.sin(angle) * side,
      z: travel.z * Math.cos(angle) * along + n.z * Math.sin(angle) * side,
    };
    const den = cross2(ray, h);
    const rayT = cross2(sub(t, gore), h) / den;
    const ctrl = add(gore, ray, rayT);
    const pts = role === "exit" ? [gore, ctrl, t] : [t, ctrl, gore];
    return { role, side, pts };
  };
  const ramps = [
    ramp("exit", 1), ramp("entry", 1), ramp("exit", -1), ramp("entry", -1),
  ];
  const terminals = [terminal(1), terminal(-1)];
  const gores = ramps.map((r) => r.role === "exit" ? r.pts[0] : r.pts[2]);
  if (terminals.some((p) => !onGroundRoad(s, p, cross.type))
    || gores.some((p) => !onGroundRoad(s, p, highway.type))
    || terminals.some((p) => terminalHasJunction(s, p))) return empty(TERMINAL_REASON);
  const simulated = simulate(s, ramps);
  if (!simulated.ok) return empty(simulated.reason);
  return s.money < simulated.cost ? empty("Not enough money") : { ok: true, ramps, cost: simulated.cost };
}

/** All physical ramp parts go through placeRoad: levelling, zoning and revisions stay identical to road strokes. */
export function placeInterchange(s: CityState, plan: InterchangePlan): ToolResult {
  if (!plan.ok) return { ok: false, reason: plan.reason! };
  const simulated = simulate(s, plan.ramps);
  if (!simulated.ok) return { ok: false, reason: simulated.reason };
  if (s.money < simulated.cost) return { ok: false, reason: "Not enough money" };
  for (const ramp of plan.ramps) {
    const placed = placeRoad(s, 6, ramp.pts);
    if (!placed.ok) return { ok: false, reason: planReason(placed.reason) };
  }
  return { ok: true };
}
