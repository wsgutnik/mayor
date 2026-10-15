/** Pure street-frame placement for service buildings. */
import { facilityFootprint, idx, inBounds, isLand, segElevation, type FacilityKind, type World } from "./world";
import { nearestOnSegment } from "./roads";
import { profileOf } from "./corridor";
import { rectOnRoad, roadSurface } from "./roadsurface";

export interface FacilityPlacement { ok: boolean; cx: number; cz: number; yaw: number; tiles: number[]; snapped?: boolean; reason?: string }
export const FACILITY_PLACEMENT_REASON = "No room beside the street here";

function tilesFor(w: World, cx: number, cz: number, yaw: number, side: number): number[] {
  const c = Math.cos(yaw), s = Math.sin(yaw), out: number[] = [];
  const x0 = Math.max(0, Math.floor(cx - side)), x1 = Math.min(w.size - 1, Math.floor(cx + side));
  const z0 = Math.max(0, Math.floor(cz - side)), z1 = Math.min(w.size - 1, Math.floor(cz + side));
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const dx = x + .5 - cx, dz = z + .5 - cz;
    if (Math.abs(dx * c - dz * s) <= side / 2 + 1e-8 && Math.abs(dx * s + dz * c) <= side / 2 + 1e-8) out.push(idx(w, x, z));
  }
  return out;
}

function legacyPlacement(w: World, side: number, x: number, z: number): FacilityPlacement {
  const tx = Math.floor(x), tz = Math.floor(z), tiles: number[] = [];
  for (let yy = tz; yy < tz + side; yy++) for (let xx = tx; xx < tx + side; xx++) if (inBounds(w, xx, yy)) tiles.push(idx(w, xx, yy));
  return { ok: tiles.length === side * side, cx: tx + side / 2, cz: tz + side / 2, yaw: 0, tiles, snapped: false, reason: tiles.length === side * side ? undefined : "Facility footprint is outside the map" };
}

/** Pointer controls arclength; the normal side is chosen from its signed offset. */
export function planFacilityPlacement(w: World, kind: FacilityKind, x: number, z: number): FacilityPlacement {
  const side = facilityFootprint(kind);
  let best: { seg: typeof w.segments[number]; q: ReturnType<typeof nearestOnSegment> } | undefined;
  for (const seg of w.segments) {
    if (segElevation(seg) !== "ground") continue;
    const q = nearestOnSegment(seg, { x, z });
    if (!best || q.d < best.q.d || (q.d === best.q.d && seg.id < best.seg.id)) best = { seg, q };
  }
  // Preserve legacy free placement when there is no road in linking reach.
  if (!best || best.q.d > 5) {
    return legacyPlacement(w, side, x, z);
  }
  const pts = best.seg.pts;
  // nearestOnSegment's parameter is also the quadratic Bézier parameter.
  // Using the control-polyline here made a curved road's building tangent
  // point at the wrong direction and could push its back corner into asphalt.
  let tx: number, tz: number;
  if (pts.length === 3) {
    const t = best.q.t, u = 1 - t;
    tx = 2 * (u * (pts[1].x - pts[0].x) + t * (pts[2].x - pts[1].x));
    tz = 2 * (u * (pts[1].z - pts[0].z) + t * (pts[2].z - pts[1].z));
  } else { tx = pts[1].x - pts[0].x; tz = pts[1].z - pts[0].z; }
  const len = Math.hypot(tx, tz) || 1; tx /= len; tz /= len;
  // Cardinal streets retain the historical grid transform and exact tile
  // footprint. This is both save-compatible and visually identical to the
  // pre-orientation renderer; 0/90° is equivalent modulo the street frame.
  if (Math.abs(tx) < 1e-8 || Math.abs(tz) < 1e-8) return legacyPlacement(w, side, x, z);
  const nx = -tz, nz = tx, signed = (x - best.q.x) * nx + (z - best.q.z) * nz;
  // local +z points toward the road, exactly as OrientedLot.yaw.
  const frontX = signed >= 0 ? -nx : nx, frontZ = signed >= 0 ? -nz : nz;
  const profile = profileOf(best.seg.type);
  const yaw = Math.atan2(frontX, frontZ), dist = profile.drawHalf + profile.sidewalk + profile.setback + side / 2;
  const cx = best.q.x - frontX * dist, cz = best.q.z - frontZ * dist;
  const tiles = tilesFor(w, cx, cz, yaw, side);
  if (!tiles.length || rectOnRoad(roadSurface(w), cx, cz, side, side, yaw, 0)) return { ok: false, cx, cz, yaw, tiles, snapped: true, reason: FACILITY_PLACEMENT_REASON };
  if (tiles.some((i) => !isLand(w, i % w.size, (i / w.size) | 0))) return { ok: false, cx, cz, yaw, tiles, snapped: true, reason: "Cannot build on water" };
  return { ok: true, cx, cz, yaw, tiles, snapped: true };
}
