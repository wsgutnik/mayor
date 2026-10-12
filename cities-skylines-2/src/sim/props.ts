import { FAC, World, baseRoadType, curvePoints, idx, inBounds } from "./world";
import { halfAsphalt, kerbWidth, nodeArms } from "./roads";

/** Street furniture kinds; the names double as the prop GLB file stems. */
export type PropKind = "hydrant" | "trash_bin" | "bench" | "bus_shelter" | "planter_tree";
export const PROP_KINDS: PropKind[] = ["hydrant", "trash_bin", "bench", "bus_shelter", "planter_tree"];

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

  for (const stop of w.stops) {
    if (stop.kind !== "bus") continue;
    const tx = stop.tile % w.size, ty = (stop.tile / w.size) | 0;
    out.push({ kind: "bus_shelter", x: tx + 0.8, z: ty + 0.8, yaw: Math.PI });
  }

  for (const seg of w.segments) {
    const base = baseRoadType(seg.type);
    if (base === 3) continue;
    const pts = curvePoints(seg.pts, 0.5);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const mx = (pts[i].x + pts[i - 1].x) / 2, mz = (pts[i].z + pts[i - 1].z) / 2;
      const vx = pts[i].x - pts[i - 1].x, vz = pts[i].z - pts[i - 1].z;
      const l = Math.hypot(vx, vz) || 1;
      const dx = vx / l, dz = vz / l;
      if (base === 2 && acc >= 4) { // planter tree on the median every ~4 tiles
        acc = 0;
        if (!nearNode(mx, mz, 1.4) && keep(mx, mz, 11)) out.push({ kind: "planter_tree", x: mx, z: mz, yaw: 0 });
      } else if (acc >= 12) { // hydrant on alternating kerbs every ~12 tiles
        acc = 0;
        const side = (out.length % 2 === 0 ? 1 : -1);
        const off = halfAsphalt(seg.type) + kerbWidth(seg.type) + 0.14;
        const px = mx - dz * side * off, pz = mz + dx * side * off;
        if (!nearNode(px, pz, 0.9) && keep(px, pz, 23)) out.push({ kind: "hydrant", x: px, z: pz, yaw: 0 });
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
