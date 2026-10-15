/**
 * FROZEN ORACLE (task zperf): verbatim copy of src/sim/roadsurface.ts at 8afbab1, before the zone pipeline was made incremental.
 * Test-only (zone-perf.diff.test.ts swaps it in through zoneHooks and asserts byte-identical results). Never import it
 * from game code and never "fix" it: it defines the expected output.
 */
/**
 * Physical road surface as a point query (docs/process/05-oriented-lots.md §1.8).
 *
 * The surface is what the player sees as "the road": asphalt + kerb + sidewalk, i.e. every point closer than
 * `drawHalf + sidewalk` to a ground centreline (flat caps at ends whose node has a junction layout, because the
 * layout's `sidewalkOuter` ring covers the node area), plus every junction `sidewalkOuter` ring. Bridges and tunnels
 * are not ground surface. Bucketed by tile and cached by graph revision, so the oriented lot gate, tile-mode
 * reconciliation and painting, the renderer's classic kerb test and the invariant oracle share one definition.
 */
import { profileOf } from "../corridor";
import { junctionsOf } from "../junction";
import { curvePoints, segElevation, type Pt, type World } from "../world";

export interface RoadShape {
  id: number; a: number; b: number; pts: Pt[]; body: number; setbackLine: number; flatA: boolean; flatB: boolean;
}

function rawAt(p: Pt[], i: number, x: number, z: number): number {
  const a = p[i - 1], b = p[i];
  const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
  return ((x - a.x) * vx + (z - a.z) * vz) / l2;
}

/**
 * Squared distance from (x, z) to piece i (points i-1..i) of r's centreline polyline, as a swept ribbon: a point
 * whose projection falls off the piece only counts at an interior joint when it lies in that joint's outer wedge
 * (the neighbour piece covers everything else), and never beyond a flat end (junction/end-cap node: its ring is the
 * surface there; the ribbon is cut flat at the node). Without the wedge rule every joint of a sampled curve acts as
 * a round cap and the surface bulges past a square dead end or into a hairpin's inside.
 */
function pieceDist2(r: RoadShape, i: number, x: number, z: number): number {
  const p = r.pts, n = p.length;
  const raw = rawAt(p, i, x, z);
  let qx: number, qz: number;
  if (raw < 0) {
    if (i === 1 ? r.flatA : rawAt(p, i - 1, x, z) <= 1) return Infinity;
    qx = p[i - 1].x; qz = p[i - 1].z;
  } else if (raw > 1) {
    if (i === n - 1 ? r.flatB : rawAt(p, i + 1, x, z) >= 0) return Infinity;
    qx = p[i].x; qz = p[i].z;
  } else {
    qx = p[i - 1].x + (p[i].x - p[i - 1].x) * raw; qz = p[i - 1].z + (p[i].z - p[i - 1].z) * raw;
  }
  return (qx - x) * (qx - x) + (qz - z) * (qz - z);
}

/** Distance from (x, z) to the surface centreline of r (swept ribbon, flat ends cut; Infinity when none applies). */
export function roadDist(r: RoadShape, x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < r.pts.length; i++) best = Math.min(best, pieceDist2(r, i, x, z));
  return Math.sqrt(best);
}
interface Ring { ring: Pt[]; minX: number; maxX: number; minZ: number; maxZ: number }

export interface RoadSurface {
  graphRevision: number;
  roads: RoadShape[];
  /** True when (x, z) lies on the road surface (with `eps` of slack inside the edge). */
  hits(x: number, z: number, eps?: number): boolean;
  /** Ground roads whose surface or setback line may pass within ~2 tiles of tile (tx, tz). */
  near(tx: number, tz: number): readonly RoadShape[];
  /** Exact: does convex quad q (4 corners, in order) overlap any junction ring? */
  quadTouchesRing(q: ArrayLike<number>): boolean;
  /** Exact: does convex quad q overlap any centreline ribbon (half width body - eps)? */
  quadTouchesRibbon(q: ArrayLike<number>, eps: number): boolean;
  /** Memo for tileOnRoad: -1 unknown, 0 clear, 1 on the surface. */
  tileMemo: Int8Array;
}

/**
 * "sidewalk": asphalt + kerb + sidewalk (`drawHalf + sidewalk`, junction `sidewalkOuter`), the surface oriented cells
 * and lots must keep off. "kerb": asphalt + kerb only (`drawHalf`, junction `kerbOuter`), the classic tile mode's
 * surface: a 1-tile street is drawn 1.14 tiles wide (0.9 + two 0.12 sidewalks), so every tile beside it overlaps the
 * sidewalk by 0.07, which classic zoning has always accepted; it never accepts asphalt.
 */
export type SurfaceEdge = "sidewalk" | "kerb";

const cache = { sidewalk: new WeakMap<World, RoadSurface>(), kerb: new WeakMap<World, RoadSurface>() };

export function distToPolyline(x: number, z: number, pts: Pt[], flatA: boolean, flatB: boolean): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
    const raw = ((x - a.x) * vx + (z - a.z) * vz) / l2;
    if ((flatA && i === 1 && raw < 0) || (flatB && i === pts.length - 1 && raw > 1)) continue;
    const u = Math.max(0, Math.min(1, raw));
    const dx = a.x + vx * u - x, dz = a.z + vz * u - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function inRing(poly: Pt[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function cross(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  return (bx - ax) * (pz - az) - (bz - az) * (px - ax);
}

function inQuad(q: ArrayLike<number>, x: number, z: number): boolean {
  let pos = 0, neg = 0;
  for (let e = 0; e < 4; e++) {
    const f = (e + 1) & 3, c = cross(q[e * 2], q[e * 2 + 1], q[f * 2], q[f * 2 + 1], x, z);
    if (c > 0) pos++; else if (c < 0) neg++;
  }
  return pos === 0 || neg === 0;
}

function pointSegDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
  const u = l2 <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2));
  const dx = ax + vx * u - px, dz = az + vz * u - pz;
  return dx * dx + dz * dz;
}

function discTouchesQuad(x: number, z: number, r: number, q: ArrayLike<number>): boolean {
  if (inQuad(q, x, z)) return true;
  for (let e = 0; e < 4; e++) {
    const f = (e + 1) & 3;
    if (pointSegDist2(x, z, q[e * 2], q[e * 2 + 1], q[f * 2], q[f * 2 + 1]) < r * r) return true;
  }
  return false;
}

const pieceRect = new Float64Array(8);
/**
 * Piece i of r's ribbon (half width h) against convex quad q: the swept rectangle of the piece (SAT, strict), plus a
 * disc at its start joint when that joint is interior or a round end (the swept ribbon is the union of these).
 */
function pieceTouchesQuad(r: RoadShape, i: number, h: number, q: ArrayLike<number>): boolean {
  if (h <= 0) return false;
  const a = r.pts[i - 1], b = r.pts[i], n = r.pts.length;
  let tx = b.x - a.x, tz = b.z - a.z;
  const l = Math.hypot(tx, tz);
  if (l > 1e-9) {
    tx /= l; tz /= l;
    const nx = -tz * h, nz = tx * h;
    pieceRect[0] = a.x + nx; pieceRect[1] = a.z + nz; pieceRect[2] = b.x + nx; pieceRect[3] = b.z + nz;
    pieceRect[4] = b.x - nx; pieceRect[5] = b.z - nz; pieceRect[6] = a.x - nx; pieceRect[7] = a.z - nz;
    let separated = false;
    for (let pass = 0; pass < 2 && !separated; pass++) {
      const poly = pass === 0 ? pieceRect : q;
      for (let e = 0; e < 4 && !separated; e++) {
        const f = (e + 1) & 3;
        const ax = -(poly[f * 2 + 1] - poly[e * 2 + 1]), az = poly[f * 2] - poly[e * 2];
        let alo = Infinity, ahi = -Infinity, blo = Infinity, bhi = -Infinity;
        for (let k = 0; k < 4; k++) {
          const va = pieceRect[k * 2] * ax + pieceRect[k * 2 + 1] * az, vb = q[k * 2] * ax + q[k * 2 + 1] * az;
          alo = Math.min(alo, va); ahi = Math.max(ahi, va); blo = Math.min(blo, vb); bhi = Math.max(bhi, vb);
        }
        if (ahi <= blo || bhi <= alo) separated = true;
      }
    }
    if (!separated) return true;
  }
  // Disc at the start point: an interior joint, or a round (non-layout) end; the last piece also owns its end point.
  if ((i > 1 || !r.flatA) && discTouchesQuad(a.x, a.z, h, q)) return true;
  if (i === n - 1 && !r.flatB && discTouchesQuad(b.x, b.z, h, q)) return true;
  return false;
}

/** Exact overlap of a ring (simple polygon) with a convex quad: vertex containment either way or an edge crossing. */
export function ringTouchesQuad(ring: Pt[], q: ArrayLike<number>): boolean {
  for (const p of ring) if (inQuad(q, p.x, p.z)) return true;
  for (let e = 0; e < 4; e++) if (inRing(ring, q[e * 2], q[e * 2 + 1])) return true;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    for (let e = 0; e < 4; e++) {
      const f = (e + 1) & 3, cx = q[e * 2], cz = q[e * 2 + 1], dx = q[f * 2], dz = q[f * 2 + 1];
      if ((cross(a.x, a.z, b.x, b.z, cx, cz) > 0) !== (cross(a.x, a.z, b.x, b.z, dx, dz) > 0) &&
        (cross(cx, cz, dx, dz, a.x, a.z) > 0) !== (cross(cx, cz, dx, dz, b.x, b.z) > 0)) return true;
    }
  }
  return false;
}

export function roadSurface(w: World, edge: SurfaceEdge = "sidewalk"): RoadSurface {
  const hit = cache[edge].get(w);
  if (hit && hit.graphRevision === w.graphRevision) return hit;
  const ringOf = (l: { sidewalkOuter: Pt[]; kerbOuter: Pt[] }): Pt[] => (edge === "kerb" ? l.kerbOuter : l.sidewalkOuter);
  const layouts = [...junctionsOf(w).byNode.values()].filter((l) => ringOf(l).length >= 3);
  const polyNodes = new Set(layouts.map((l) => l.nodeId));
  const size = w.size;
  const roadBuckets = new Map<number, RoadShape[]>();
  /** Per tile: polyline pieces (road, index of the piece's end point) that can reach into the tile. */
  const pieceBuckets = new Map<number, { r: RoadShape; i: number }[]>();
  const ringBuckets = new Map<number, Ring[]>();
  const roads: RoadShape[] = [];
  for (const g of w.segments) {
    if (segElevation(g) !== "ground") continue;
    const p = profileOf(g.type);
    // Straight segments are exact with their two ends; curves at 0.25 (chord error <= 0.008 tile for radius >= 1).
    const pts = g.pts.length === 2 ? [g.pts[0], g.pts[1]] : curvePoints(g.pts, 0.25);
    const r: RoadShape = {
      id: g.id, a: g.a, b: g.b, pts, body: edge === "kerb" ? p.drawHalf : p.drawHalf + p.sidewalk,
      setbackLine: p.drawHalf + p.sidewalk + p.setback, flatA: polyNodes.has(g.a), flatB: polyNodes.has(g.b),
    };
    roads.push(r);
    const reach = Math.ceil(r.setbackLine) + 2;
    const seen = new Set<number>();
    const pieceReach = Math.ceil(r.body) + 1;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      const x0 = Math.floor(Math.min(a.x, b.x)) - pieceReach, x1 = Math.floor(Math.max(a.x, b.x)) + pieceReach;
      const z0 = Math.floor(Math.min(a.z, b.z)) - pieceReach, z1 = Math.floor(Math.max(a.z, b.z)) + pieceReach;
      for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
        if (tx < -1 || tz < -1 || tx > size || tz > size) continue;
        const k = (tz + 1) * (size + 2) + tx + 1;
        const arr = pieceBuckets.get(k);
        if (arr) arr.push({ r, i }); else pieceBuckets.set(k, [{ r, i }]);
      }
    }
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      const x0 = Math.floor(Math.min(a.x, b.x)) - reach, x1 = Math.floor(Math.max(a.x, b.x)) + reach;
      const z0 = Math.floor(Math.min(a.z, b.z)) - reach, z1 = Math.floor(Math.max(a.z, b.z)) + reach;
      for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
        if (tx < -1 || tz < -1 || tx > size || tz > size) continue;
        const k = (tz + 1) * (size + 2) + tx + 1;
        if (seen.has(k)) continue;
        seen.add(k);
        const arr = roadBuckets.get(k);
        if (arr) arr.push(r); else roadBuckets.set(k, [r]);
      }
    }
  }
  for (const l of layouts) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const pts = ringOf(l);
    for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const ring: Ring = { ring: pts, minX, maxX, minZ, maxZ };
    for (let tz = Math.floor(minZ); tz <= Math.floor(maxZ); tz++) for (let tx = Math.floor(minX); tx <= Math.floor(maxX); tx++) {
      if (tx < -1 || tz < -1 || tx > size || tz > size) continue;
      const k = (tz + 1) * (size + 2) + tx + 1;
      const arr = ringBuckets.get(k);
      if (arr) arr.push(ring); else ringBuckets.set(k, [ring]);
    }
  }
  const keyOf = (x: number, z: number): number => {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < -1 || tz < -1 || tx > size || tz > size) return -1;
    return (tz + 1) * (size + 2) + tx + 1;
  };
  const EMPTY: RoadShape[] = [];
  const surface: RoadSurface = {
    graphRevision: w.graphRevision,
    roads,
    tileMemo: new Int8Array(size * size).fill(-1),
    hits(x: number, z: number, eps = 0): boolean {
      const k = keyOf(x, z);
      if (k < 0) return false;
      for (const { r, i } of pieceBuckets.get(k) ?? []) {
        const lim = r.body - eps;
        if (pieceDist2(r, i, x, z) < lim * lim) return true;
      }
      for (const g of ringBuckets.get(k) ?? []) {
        if (x < g.minX || x > g.maxX || z < g.minZ || z > g.maxZ) continue;
        if (inRing(g.ring, x, z)) return true;
      }
      return false;
    },
    quadTouchesRibbon(q: ArrayLike<number>, eps: number): boolean {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < 4; i++) {
        minX = Math.min(minX, q[i * 2]); maxX = Math.max(maxX, q[i * 2]); minZ = Math.min(minZ, q[i * 2 + 1]); maxZ = Math.max(maxZ, q[i * 2 + 1]);
      }
      const seen = new Set<string>();
      for (let tz = Math.floor(minZ); tz <= Math.floor(maxZ); tz++) for (let tx = Math.floor(minX); tx <= Math.floor(maxX); tx++) {
        const k = keyOf(tx + 0.5, tz + 0.5);
        if (k < 0) continue;
        for (const { r, i } of pieceBuckets.get(k) ?? []) {
          const key = `${r.id}:${i}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (pieceTouchesQuad(r, i, r.body - eps, q)) return true;
        }
      }
      return false;
    },
    quadTouchesRing(q: ArrayLike<number>): boolean {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < 4; i++) {
        minX = Math.min(minX, q[i * 2]); maxX = Math.max(maxX, q[i * 2]); minZ = Math.min(minZ, q[i * 2 + 1]); maxZ = Math.max(maxZ, q[i * 2 + 1]);
      }
      const seen = new Set<Ring>();
      for (let tz = Math.floor(minZ); tz <= Math.floor(maxZ); tz++) for (let tx = Math.floor(minX); tx <= Math.floor(maxX); tx++) {
        const k = keyOf(tx + 0.5, tz + 0.5);
        if (k < 0) continue;
        for (const g of ringBuckets.get(k) ?? []) {
          if (seen.has(g)) continue;
          seen.add(g);
          if (g.maxX < minX || g.minX > maxX || g.maxZ < minZ || g.minZ > maxZ) continue;
          if (ringTouchesQuad(g.ring, q)) return true;
        }
      }
      return false;
    },
    near(tx: number, tz: number): readonly RoadShape[] {
      const k = keyOf(tx + 0.5, tz + 0.5);
      return k < 0 ? EMPTY : roadBuckets.get(k) ?? EMPTY;
    },
  };
  cache[edge].set(w, surface);
  return surface;
}

/** Corners of a three.js box footprint (rotation.y = yaw: local +x -> (cos, -sin), local +z -> (sin, cos)). */
export function rectQuad(x: number, z: number, sx: number, sz: number, yaw: number): Float32Array {
  const c = Math.cos(yaw), s = Math.sin(yaw), hx = sx / 2, hz = sz / 2;
  const q = new Float32Array(8);
  const pts = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
  for (let k = 0; k < 4; k++) {
    const [lx, lz] = pts[k];
    q[k * 2] = x + lx * c + lz * s;
    q[k * 2 + 1] = z - lx * s + lz * c;
  }
  return q;
}

/** Band along a lot's edge that drawn geometry never reaches (pads inset 0.02, kerb strip 0.015): see lotRectOnRoad. */
export const LOT_EDGE_BAND = 0.015;

/** A lot's rigid rectangle, minus LOT_EDGE_BAND on every side, against the surface (exact, see rectOnRoad). */
export function lotRectOnRoad(surface: RoadSurface, cx: number, cz: number, w: number, d: number, yaw: number, eps: number): boolean {
  // rectOnRoad already ignores a 0.005 band.
  const shrink = 2 * (LOT_EDGE_BAND - 0.005);
  return rectOnRoad(surface, cx, cz, w - shrink, d - shrink, yaw, eps);
}

/** 5 x 5 bilinear samples of quad q (corners in order), 3 % in from every edge. */
const SAMPLE_UV = [0.03, 0.25, 0.5, 0.75, 0.97];
export function quadOnRoad(surface: RoadSurface, q: ArrayLike<number>, eps = 0): boolean {
  for (const v of SAMPLE_UV) for (const u of SAMPLE_UV) {
    const ax = q[0] + (q[2] - q[0]) * u, az = q[1] + (q[3] - q[1]) * u;
    const bx = q[6] + (q[4] - q[6]) * u, bz = q[7] + (q[5] - q[7]) * u;
    if (surface.hits(ax + (bx - ax) * v, az + (bz - az) * v, eps)) return true;
  }
  return false;
}

/**
 * Exact test of a rigid rectangle (three.js box footprint, see rectQuad) against the surface, ignoring a 0.005 band
 * along its edges (flush contact is not an overlap): junction rings by polygon intersection, centrelines as the
 * swept ribbon (one rectangle per polyline piece, discs at interior joints and round ends). `eps` is slack inside
 * the ribbon edge (rings are exact).
 */
export function rectOnRoad(surface: RoadSurface, cx: number, cz: number, sx: number, sz: number, yaw: number, eps = 0): boolean {
  const q = rectQuad(cx, cz, Math.max(0.001, sx - 0.01), Math.max(0.001, sz - 0.01), yaw);
  return surface.quadTouchesRing(q) || surface.quadTouchesRibbon(q, eps);
}

/**
 * Classic tiles are axis-aligned squares on a free-form road network: at every block corner the kerb return of the
 * junction cuts ~0.08 tile into the corner tile's square. Tile mode therefore tests the square inset by TILE_INSET
 * (it still refuses any tile the asphalt really crosses: diagonals, curves, off-centre avenues). Oriented cells,
 * which follow the road frame, get no such slack.
 */
export const TILE_INSET = 0.1;

/** True when tile (tx, tz), inset by TILE_INSET, touches the given surface (tile mode passes the "kerb" surface). */
export function tileOnRoad(surface: RoadSurface, tx: number, tz: number): boolean {
  const size = Math.sqrt(surface.tileMemo.length);
  const k = tz * size + tx;
  const inside = tx >= 0 && tz >= 0 && tx < size && tz < size;
  if (inside && surface.tileMemo[k] >= 0) return surface.tileMemo[k] === 1;
  const hit = rectOnRoad(surface, tx + 0.5, tz + 0.5, 1 - 2 * TILE_INSET, 1 - 2 * TILE_INSET, 0, 0);
  if (inside) surface.tileMemo[k] = hit ? 1 : 0;
  return hit;
}

/**
 * Distance from (x, z) to the nearest ground road's setback line (where lot fronts and kerb strips belong), or
 * Infinity with no road near.
 */
export function setbackGap(surface: RoadSurface, x: number, z: number): number {
  let best = Infinity;
  for (const r of surface.near(Math.floor(x), Math.floor(z))) {
    const d = distToPolyline(x, z, r.pts, false, false);
    best = Math.min(best, Math.abs(d - r.setbackLine));
  }
  return best;
}
