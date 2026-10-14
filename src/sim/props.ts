import { FAC, World, baseRoadType, curvePoints, idx, inBounds, isLand, segElevation } from "./world";
import { nodeArms } from "./roads";
import { corridorsOf, profileOf, profileOffset, type SegmentCorridor } from "./corridor";

/** Street furniture kinds; the names double as the prop GLB file stems. */
export const NEW_PROP_KINDS = [
  "shelter_small", "shelter_glass", "bench_road", "planter_street",
  "streetlight_b", "kiosk_route", "ticket_machine", "stop_sign_bus",
] as const;
export type NewPropKind = (typeof NEW_PROP_KINDS)[number];
export type PropKind = "hydrant" | "trash_bin" | "bench" | "bus_shelter" | "planter_tree" | NewPropKind;
export const PROP_KINDS: PropKind[] = ["hydrant", "trash_bin", "bench", "bus_shelter", "planter_tree", ...NEW_PROP_KINDS];

/** Rotation from the GLB's stored +Z front to the planner's road-facing yaw. */
export const PROP_YAW_OFFSET: Record<NewPropKind, number> = {
  // Shelters, bench and route board are long on GLB Z and open/read on +X.
  shelter_small: -Math.PI / 2, shelter_glass: -Math.PI / 2, bench_road: -Math.PI / 2,
  planter_street: 0, streetlight_b: 0, kiosk_route: -Math.PI / 2,
  ticket_machine: 0, stop_sign_bus: 0,
};

export interface PropPlacement {
  kind: PropKind;
  x: number;
  z: number;
  /** Facing yaw (rotation around Y, model front is +z). */
  yaw: number;
}

const hash2 = (x: number, y: number, salt: number): number => {
  let h = (Math.floor(x * 8) * 374761393 + Math.floor(y * 8) * 668265263 + salt * 974711) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Hard cap so a dense city stays inside the instancing budget. */
export const MAX_PROPS = 4000;

function pointOnOffset(
  corridor: SegmentCorridor | undefined, side: 1 | -1, s: number, offset: number,
): { x: number; z: number } | null {
  if (!corridor) return null;
  const line = corridor.offsets.kerbEdge[side > 0 ? "left" : "right"];
  const centre = corridor.centre;
  if (line.length < 2 || centre.length !== line.length) return null;
  const total = centre[centre.length - 1].s;
  const d = Math.max(0, Math.min(total, s));
  let i = 0;
  while (i < centre.length - 2 && centre[i + 1].s < d) i++;
  const span = Math.max(1e-9, centre[i + 1].s - centre[i].s);
  const t = (d - centre[i].s) / span;
  const x = line[i].x + (line[i + 1].x - line[i].x) * t;
  const z = line[i].z + (line[i + 1].z - line[i].z) * t;
  const cx = centre[i].x + (centre[i + 1].x - centre[i].x) * t;
  const cz = centre[i].z + (centre[i + 1].z - centre[i].z) * t;
  const ex = x - cx, ez = z - cz;
  const el = Math.hypot(ex, ez) || 1;
  const extra = offset - profileOffset(corridor.type, "kerbEdge");
  return { x: x + (ex / el) * extra, z: z + (ez / el) * extra };
}

/**
 * Deterministic street-furniture plan along the road network: shelters at bus
 * stops, planter trees on avenue medians, hydrants every ~12 tiles, bins at
 * junctions and benches facing parks. `density` (0..1) thins the decorative
 * kinds out per quality tier; shelters always appear.
 */
export function planProps(w: World, density = 1): PropPlacement[] {
  const out: PropPlacement[] = [];
  const keep = (x: number, z: number, salt: number): boolean => density >= 1 || hash2(x, z, salt) < density;
  const nearNode = (x: number, z: number, d: number): boolean =>
    w.nodes.some((n) => Math.hypot(n.x - x, n.z - z) < d);

  const free = (x: number, z: number): boolean => {
    const tx = Math.floor(x), ty = Math.floor(z);
    if (!inBounds(w, tx, ty)) return false;
    const i = idx(w, tx, ty);
    return isLand(w, tx, ty) && !w.road[i] && !w.roadDeck[i] && !w.roadTunnel[i] &&
      !w.facility[i] && (!w.lotAt || w.lotAt[i] < 0) && !nearNode(x, z, 1.2);
  };
  const add = (kind: NewPropKind, x: number, z: number, yaw: number, salt: number, essential = false): boolean => {
    if (!free(x, z) || (!essential && !keep(x, z, salt))) return false;
    out.push({ kind, x, z, yaw: yaw + PROP_YAW_OFFSET[kind] });
    return true;
  };
  const nearestRoad = (x: number, z: number) => {
    let best: { dx: number; dz: number; type: number; dist: number } | undefined;
    for (const seg of w.segments) {
      if (segElevation(seg) !== "ground" || baseRoadType(seg.type) === 3) continue;
      const pts = curvePoints(seg.pts, 0.3);
      for (let i = 1; i < pts.length; i++) {
        const ax = pts[i - 1].x, az = pts[i - 1].z;
        const vx = pts[i].x - ax, vz = pts[i].z - az;
        const ll = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / ll));
        const qx = ax + vx * t, qz = az + vz * t, dist = Math.hypot(x - qx, z - qz);
        if (!best || dist < best.dist) best = { dx: vx / Math.sqrt(ll), dz: vz / Math.sqrt(ll), type: seg.type, dist };
      }
    }
    return best;
  };

  for (const stop of w.stops) {
    const tx = stop.tile % w.size, ty = (stop.tile / w.size) | 0;
    const cx = tx + 0.5, cz = ty + 0.5;
    const road = nearestRoad(cx, cz);
    if (!road) continue;
    if (stop.kind === "metro") {
      // Station occupies its own tile: use the first clear neighbouring entry apron.
      const choices = [[-road.dz, road.dx], [road.dz, -road.dx], [road.dx, road.dz], [-road.dx, -road.dz]];
      for (const [sx, sz] of choices) {
        const x = cx + sx * 0.72, z = cz + sz * 0.72;
        const yaw = Math.atan2(cx - x, cz - z);
        if (add("kiosk_route", x, z, yaw, 51, true)) {
          add("ticket_machine", x + road.dx * 0.18, z + road.dz * 0.18, yaw, 52, true);
          break;
        }
      }
      continue;
    }
    const normalX = -road.dz, normalZ = road.dx;
    const baseOff = profileOf(road.type as 1 | 2 | 3 | 4 | 5).drawHalf;
    placedStop: for (const side of [1, -1]) {
      const yaw = Math.atan2(-normalX * side, -normalZ * side);
      for (const shift of [0, 1.25, -1.25]) {
        const sx = cx + normalX * side * (baseOff + 0.28) + road.dx * shift;
        const sz = cz + normalZ * side * (baseOff + 0.28) + road.dz * shift;
        if (!add(baseRoadType(road.type as 1 | 2 | 3 | 4 | 5) === 2 ? "shelter_glass" : "shelter_small", sx, sz, yaw, 53, true)) continue;
        const signalOff = profileOf(road.type as 1 | 2 | 3 | 4 | 5).propOffsets.signal;
        add("stop_sign_bus", cx + normalX * side * signalOff + road.dx * shift,
          cz + normalZ * side * signalOff + road.dz * shift, yaw, 54, true);
        break placedStop;
      }
    }
  }

  for (const seg of w.segments) {
    const base = baseRoadType(seg.type);
    if (base === 3 || segElevation(seg) !== "ground") continue;
    const corridor = corridorsOf(w).bySeg.get(seg.id);
    const prof = profileOf(seg.type);
    const pts = curvePoints(seg.pts, 0.5);
    let acc = 0;
    let totalWalk = 0;
    for (let i = 1; i < pts.length; i++) {
      const segLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      acc += segLen;
      totalWalk += segLen;
      const mx = (pts[i].x + pts[i - 1].x) / 2, mz = (pts[i].z + pts[i - 1].z) / 2;
      const vx = pts[i].x - pts[i - 1].x, vz = pts[i].z - pts[i - 1].z;
      const l = Math.hypot(vx, vz) || 1;
      const dx = vx / l, dz = vz / l;
      if (base === 2 && acc >= 4) { // planter tree on the median every ~4 tiles
        acc = 0;
        if (!nearNode(mx, mz, 2.8) && keep(mx, mz, 11)) out.push({ kind: "planter_tree", x: mx, z: mz, yaw: 0 });
      } else if (acc >= 12) { // hydrant on alternating kerbs every ~12 tiles
        acc = 0;
        const side = (out.length % 2 === 0 ? 1 : -1);
        const off = prof.propOffsets.hydrant;
        const snapped = pointOnOffset(corridor, side, totalWalk - segLen / 2, off);
        const px = snapped?.x ?? mx - dz * side * off, pz = snapped?.z ?? mz + dx * side * off;
        if (!nearNode(px, pz, 0.9) && keep(px, pz, 23)) out.push({ kind: "hydrant", x: px, z: pz, yaw: 0 });
      }
    }

    // New avenue furniture sits beyond the kerb, alternating sides. It is
    // independent of raster traversal, so curves and straight roads match.
    if (base === 2 || base === 1) {
      const spacing = base === 2 ? 3 : 4.5;
      const pts2 = curvePoints(seg.pts, spacing);
      let walked = 0;
      for (let i = 1; i < pts2.length; i++) {
        const vx = pts2[i].x - pts2[i - 1].x, vz = pts2[i].z - pts2[i - 1].z;
        const len = Math.hypot(vx, vz); if (!len) continue;
        walked += len;
        const dx = vx / len, dz = vz / len, mx = (pts2[i].x + pts2[i - 1].x) / 2, mz = (pts2[i].z + pts2[i - 1].z) / 2;
        const side = ((Math.floor(walked / spacing) + seg.id) & 1) ? 1 : -1;
        const off = base === 1 ? prof.propOffsets.streetlight : prof.propOffsets.planter;
        const snapped = pointOnOffset(corridor, side, walked - len / 2, off);
        const px = snapped?.x ?? mx - dz * side * off;
        const pz = snapped?.z ?? mz + dx * side * off;
        const yaw = Math.atan2(dz * side, -dx * side);
        if (base === 2) {
          if (Math.floor(walked / 3) % 2 === 0) add("planter_street", px, pz, yaw, 61); // ~6 tiles
          if (Math.floor(walked / 4.5) % 2 === 0) add("bench_road", px + dx * 0.22, pz + dz * 0.22, yaw, 62); // ~9 tiles
        } else if (Math.floor(walked / 4.5) % 2 === 0) {
          add("streetlight_b", px, pz, yaw, 63); // alternates with scene lamps
        }
      }
    }
  }

  for (const node of w.nodes) {
    const arms = nodeArms(w, node.id);
    if (arms.length < 3) continue;
    const a = arms[0], b = arms[1];
    let bx = a.dx + b.dx, bz = a.dz + b.dz;
    const l = Math.hypot(bx, bz) || 1;
    bx /= l; bz /= l;
    const off = Math.max(a.halfWidth, b.halfWidth) + 0.32;
    const px = node.x + bx * off, pz = node.z + bz * off;
    if (keep(px, pz, 37)) out.push({ kind: "trash_bin", x: px, z: pz, yaw: 0 });
  }

  for (let y = 0; y < w.size; y++) {
    for (let x = 0; x < w.size; x++) {
      if (w.facility[idx(w, x, y)] !== FAC.PARK) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const rx = x + dx, ry = y + dy;
        if (!inBounds(w, rx, ry) || !w.road[idx(w, rx, ry)]) continue;
        const px = rx + 0.5 - dx * 0.36, pz = ry + 0.5 - dy * 0.36;
        if (keep(px, pz, 41)) out.push({ kind: "bench", x: px, z: pz, yaw: Math.atan2(-dx, -dy) });
        break; // one bench per park tile edge is plenty
      }
    }
  }
  return out.slice(0, MAX_PROPS);
}
