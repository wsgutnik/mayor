import * as THREE from "three";
import {
  Pt, RoadSegment, RoadType, World, baseRoadType, curvePoints,
  makeDeckSampler, segElevation, DeckSampler,
} from "../sim/world";
import { nodeArms, nodeById } from "../sim/roads";
import { junctionsOf, type JunctionLayout } from "../sim/junction";
import { profileOf, sidewalkEdge } from "../sim/corridor";
import { asIndexed, sampleRing, sameSample, triangulateBand, triangulateRing } from "./earclip";
import type { RingSample } from "./earclip";

/**
 * Junction road geometry: ribbons stop at the corner offsets and every node
 * gets its own asphalt polygon with kerb fillets, so crossings join without
 * gaps, overlaps or per-segment lift hacks. One lift per layer for the network.
 */
export const ROAD_LIFT = 0.06;
const KERB_LIFT = ROAD_LIFT + 0.006;
const MARK_LIFT = ROAD_LIFT + 0.004;
const NODE_ASPHALT_LIFT = ROAD_LIFT + 0.02;
/** Markings drawn on a junction patch must ride above its asphalt. */
const NODE_MARK_LIFT = NODE_ASPHALT_LIFT + 0.004;

const ASPHALT = "#3b3f46";
const KERB = "#c4c7cc";
const HW_ASPHALT = "#4a4f57";
const HW_EDGE = "#b8bec6";
const LINE = "#d8d4b0";
const AVE_LINE = "#e8e4c8";
const MEDIAN = "#5f8a4a";
const ZEBRA = "#f1f1ea";
const CONCRETE = "#a8adb5";
const PILLAR = "#8b9098";
const PORTAL_DARK = "#0b0d12";
const DECK_SHADOW = "#46555f";

export interface StripSeg {
  type: RoadType;
  pts: Pt[];
  width?: number;
  color?: string;
  lift?: number;
  /** 0 = two-way; otherwise chevron arrows point along (1) or against (-1) the point order. */
  dirSign?: number;
}

/** Texture class per vertex (aClass attribute); 0 keeps the vertex-colour path. */
export const ROAD_CLASS = {
  FLAT: 0, STREET: 1, AVENUE: 2, ONEWAY_STREET: 3, ONEWAY_AVENUE: 4,
  HIGHWAY: 5, JUNCTION: 6, CROSSWALK: 7, STOP_BAR: 8, ARROW: 9,
} as const;
/** World units covered by one cross-section texture tile along the road. */
export const ROAD_TILE_LENGTH = 4;
/** World units covered by one junction-asphalt tile (world-space UV). */
export const JUNCTION_TILE = 2;

export function roadClassFor(type: RoadType, dirSign: number): number {
  const base = baseRoadType(type);
  if (base === 3) return ROAD_CLASS.HIGHWAY;
  if (dirSign !== 0 || type === 4 || type === 5) {
    return base === 2 ? ROAD_CLASS.ONEWAY_AVENUE : ROAD_CLASS.ONEWAY_STREET;
  }
  return base === 2 ? ROAD_CLASS.AVENUE : ROAD_CLASS.STREET;
}

class Geo {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  cls: number[] = [];
  ind: number[] = [];
  /** When set, every vertex takes this colour (build preview tint). */
  force: string | null = null;
  private palette = new Map<string, THREE.Color>();
  private n = 0;

  vert(x: number, y: number, z: number, color: string, uv?: [number, number], cls = 0): number {
    return this.vertFast(x, y, z, this.colorFor(color), uv, cls);
  }

  /** Resolve a colour once for a multi-vertex emission (hot paths hoist this). */
  colorFor(color: string): THREE.Color {
    const key = this.force ?? color;
    let c = this.palette.get(key);
    if (!c) {
      c = new THREE.Color(key);
      this.palette.set(key, c);
    }
    return c;
  }

  /** Vertices emitted so far (base index for indexed triangle batches). */
  get count(): number {
    return this.n;
  }

  /** Vertex with a pre-resolved colour (see colorFor). */
  vertFast(x: number, y: number, z: number, c: THREE.Color, uv?: [number, number], cls = 0): number {
    const vi = this.n++;
    this.pos.push(x, y, z);
    this.col.push(c.r, c.g, c.b);
    if (uv === undefined) this.uv.push(x / 0.6, z / 0.6);
    else this.uv.push(uv[0], uv[1]);
    this.cls.push(cls);
    return vi;
  }

  /** Textured quad: corners in order, UVs (0,0) (1,0) (1,1) (0,1). */
  texQuad(corners: { x: number; z: number }[], y: number, groundY: (x: number, z: number) => number, cls: number): void {
    const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const ids = corners.map((p, i) => this.vert(p.x, groundY(p.x, p.z) + y, p.z, "#ffffff", uvs[i], cls));
    this.tri(ids[0], ids[1], ids[2]);
    this.tri(ids[0], ids[2], ids[3]);
  }

  tri(a: number, b: number, c: number): void {
    this.ind.push(a, b, c);
  }

  /** Flat quad on the ground following the terrain. */
  quad(
    ax: number, az: number, bx: number, bz: number, cx: number, cz: number,
    dx: number, dz: number, y: number, color: string, groundY: (x: number, z: number) => number,
  ): void {
    const col = this.colorFor(color);
    const a = this.vertFast(ax, groundY(ax, az) + y, az, col);
    const b = this.vertFast(bx, groundY(bx, bz) + y, bz, col);
    const c = this.vertFast(cx, groundY(cx, cz) + y, cz, col);
    const d = this.vertFast(dx, groundY(dx, dz) + y, dz, col);
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("aClass", new THREE.Float32BufferAttribute(this.cls, 1));
    g.setIndex(this.ind);
    computeNormals(g);
    return g;
  }
}

/**
 * Area-weighted vertex normals, same math as THREE's computeVertexNormals
 * (face cross (C-B)x(A-B) accumulated per corner, then normalized) over the
 * raw arrays instead of Vector3 round-trips. Falls back to THREE for the
 * non-indexed case, which Geo never emits.
 */
function computeNormals(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const idx = g.getIndex();
  if (!idx) {
    g.computeVertexNormals();
    return;
  }
  const p = pos.array as Float32Array;
  const ix = idx.array as Uint16Array | Uint32Array;
  const n = new Float32Array(p.length);
  for (let k = 0; k < ix.length; k += 3) {
    const a = ix[k] * 3, b = ix[k + 1] * 3, c = ix[k + 2] * 3;
    const abx = p[a] - p[b], aby = p[a + 1] - p[b + 1], abz = p[a + 2] - p[b + 2];
    const cbx = p[c] - p[b], cby = p[c + 1] - p[b + 1], cbz = p[c + 2] - p[b + 2];
    const nx = cby * abz - cbz * aby;
    const ny = cbz * abx - cbx * abz;
    const nz = cbx * aby - cby * abx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]) || 1;
    n[i] /= len; n[i + 1] /= len; n[i + 2] /= len;
  }
  g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
}

interface Sample { x: number; z: number; s: number }

/** Dense centreline samples with arclength, endpoints included. */
function sampleCurveCompute(pts: Pt[], step: number): Sample[] {
  const raw = curvePoints(pts, step);
  const out: Sample[] = [];
  let s = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) s += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z);
    out.push({ x: raw[i].x, z: raw[i].z, s });
  }
  return out;
}

type SampleEntry = { step: number; s: RingSample; out: Sample[] };
const sampleCache = new WeakMap<Pt[], SampleEntry>();

/** sampleCurveCompute cached by segment-point identity + content hash. */
function sampleCurve(pts: Pt[], step = 0.25): Sample[] {
  const e = sampleCache.get(pts);
  if (e !== undefined && e.step === step && sameSample(sampleRing(pts), e.s)) return e.out;
  const out = sampleCurveCompute(pts, step);
  sampleCache.set(pts, { step, s: sampleRing(pts), out });
  return out;
}

/**
 * Walking interpolator over centreline samples. Stations are visited in
 * increasing arclength, so a cursor keeps every ribbon linear (no per-frame
 * cost either way: geometry only builds on rebuild).
 */
function makeWalker(samples: Sample[]): (s: number) => { x: number; z: number; dx: number; dz: number } {
  const n = samples.length;
  let i = 0;
  return (s: number) => {
    if (n === 1) return { x: samples[0].x, z: samples[0].z, dx: 1, dz: 0 };
    const total = samples[n - 1].s;
    const c = Math.max(0, Math.min(total, s));
    if (samples[i].s > c) i = 0;
    while (i < n - 2 && samples[i + 1].s < c) i++;
    const a = samples[i], b = samples[i + 1];
    const span = Math.max(1e-9, b.s - a.s);
    const u = (c - a.s) / span;
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, dx, dz };
  };
}

interface RibbonOpts {
  /** Per-side trims (lateral -1 / +1), near end then far end, per layer. */
  aNeg: number; aPos: number;
  kNeg: number; kPos: number;
  sNeg: number; sPos: number;
  eANeg: number; eAPos: number;
  eKNeg: number; eKPos: number;
  eSNeg: number; eSPos: number;
}

/** Junction rings for tests and SVG dumps: thin adapter over JunctionLayout. */
export interface JunctionDebugGeometry {
  asphalt: Pt[];
  kerbs: Pt[][];
}

export const NO_TRIM: RibbonOpts = {
  aNeg: 0, aPos: 0, kNeg: 0, kPos: 0, sNeg: 0, sPos: 0,
  eANeg: 0, eAPos: 0, eKNeg: 0, eKPos: 0, eSNeg: 0, eSPos: 0,
};

/**
 * One road ribbon between two trims: asphalt halves and edge (kerb+sidewalk)
 * halves per side, so each side starts exactly at its own corner. Markings sit
 * above the asphalt on their own lift.
 */
function ribbon(
  g: Geo, pts: Pt[], type: RoadType, o: RibbonOpts,
  groundY: (x: number, z: number) => number, tint?: THREE.Color, dirSign = 0, atlas = false,
): void {
  g.force = tint ? `#${tint.getHexString()}` : null;
  const samples = sampleCurve(pts);
  const total = samples[samples.length - 1].s;
  if (total < 1e-6) return;
  if (atlas && !tint) {
    // One textured strip for the whole cross-section: two triangles per
    // sample, u across the full width, v along the length in texture tiles.
    // The strip spans the sidewalk edge so mid-block meets junction flush.
    const walkA = makeWalker(samples);
    const fw = sidewalkEdge(type);
    const cls = roadClassFor(type, dirSign);
    const stations = [0];
    let dense = pts.length > 2;
    if (!dense && total > 0.5) {
      const pa = walkA(0), pm = walkA(total / 2), pb = walkA(total);
      const ya = groundY(pa.x, pa.z), ym = groundY(pm.x, pm.z), yb = groundY(pb.x, pb.z);
      dense = Math.max(ya, ym, yb) - Math.min(ya, ym, yb) > 0.06;
    }
    if (dense) for (const p of samples) if (p.s > 0.01 && p.s < total - 0.01) stations.push(p.s);
    stations.push(total);
    let prev: number[] | null = null;
    for (const s of stations) {
      const p = walkA(s);
      const nx = -p.dz, nz = p.dx;
      const v = (dirSign < 0 ? total - s : s) / ROAD_TILE_LENGTH;
      const lft = g.vert(p.x + nx * fw, groundY(p.x + nx * fw, p.z + nz * fw) + ROAD_LIFT, p.z + nz * fw, "#ffffff", [0, v], cls);
      const rgt = g.vert(p.x - nx * fw, groundY(p.x - nx * fw, p.z - nz * fw) + ROAD_LIFT, p.z - nz * fw, "#ffffff", [1, v], cls);
      if (prev) { g.tri(prev[0], prev[1], lft); g.tri(prev[1], rgt, lft); }
      prev = [lft, rgt];
    }
    // One-way arrows as textured quads (arrow_oneway alpha texture).
    if (dirSign !== 0) {
      for (let s = 0.9; s < total - 0.3; s += 3.6) {
        const p = walkA(s);
        const tx = p.dx * dirSign, tz = p.dz * dirSign;
        const nx = -tz, nz = tx;
        const c = (off: number, side: number) => ({ x: p.x + tx * off + nx * side, z: p.z + tz * off + nz * side });
        g.texQuad([c(-0.35, -0.14), c(-0.35, 0.14), c(0.35, 0.14), c(0.35, -0.14)], MARK_LIFT + 0.002, groundY, ROAD_CLASS.ARROW);
      }
    }
    g.force = null;
    return;
  }
  const prof = profileOf(type);
  const hw = prof.asphaltHalf;
  const kw = prof.kerb;
  const sw = prof.sidewalk;
  const walk = makeWalker(samples);
  // Half-strip from the centreline to one edge, starting at arclength s0.
  const half = (
    side: -1 | 1, s0: number, s1: number, inner: number, outer: number,
    y: number, color: string,
  ): void => {
    const a = Math.max(0, Math.min(total, s0));
    const b = Math.max(0, Math.min(total, s1));
    if (b - a < 0.02) return;
    const stations = [a];
    // Straight roads on flat ground need no intermediate stations; curves and
    // slopes follow the samples so the ribbon hugs the terrain.
    let dense = pts.length > 2;
    if (!dense && b - a > 0.5) {
      const pa = walk(a), pm = walk((a + b) / 2), pb = walk(b);
      const ya = groundY(pa.x, pa.z), ym = groundY(pm.x, pm.z), yb = groundY(pb.x, pb.z);
      dense = Math.max(ya, ym, yb) - Math.min(ya, ym, yb) > 0.06;
    }
    if (dense) {
      for (const p of samples) if (p.s > a + 0.01 && p.s < b - 0.01) stations.push(p.s);
    }
    stations.push(b);
    let prev: number[] | null = null;
    const c = g.colorFor(color);
    for (const s of stations) {
      const p = walk(s);
      const nx = -p.dz * side, nz = p.dx * side;
      const i0 = g.vertFast(p.x + nx * inner, groundY(p.x + nx * inner, p.z + nz * inner) + y, p.z + nz * inner, c);
      const i1 = g.vertFast(p.x + nx * outer, groundY(p.x + nx * outer, p.z + nz * outer) + y, p.z + nz * outer, c);
      if (prev) {
        g.tri(prev[0], prev[1], i0);
        g.tri(prev[1], i1, i0);
      }
      prev = [i0, i1];
    }
  };
  const endA = (side: -1 | 1): number => total - (side < 0 ? o.eANeg : o.eAPos);
  const endK = (side: -1 | 1): number => total - (side < 0 ? o.eKNeg : o.eKPos);
  const endS = (side: -1 | 1): number => total - (side < 0 ? o.eSNeg : o.eSPos);
  for (const side of [-1, 1] as const) {
    const sA = side < 0 ? o.aNeg : o.aPos;
    const sK = side < 0 ? o.kNeg : o.kPos;
    const sS = side < 0 ? o.sNeg : o.sPos;
    half(side, sA, endA(side), 0, hw, ROAD_LIFT, type === 3 ? HW_ASPHALT : ASPHALT);
    if (kw > 0) half(side, sK, endK(side), hw, hw + kw, KERB_LIFT, KERB);
    // Sidewalk band outside the kerb (same lift and material): mid-block
    // sidewalks run into the junction sidewalk ring with no step.
    if (sw > 0) half(side, sS, endS(side), hw + kw, hw + kw + sw, KERB_LIFT, KERB);
  }
  // Markings above the asphalt: dashes, avenue median, highway lines.
  const aMin = Math.min(o.aNeg, o.aPos);
  const eMin = Math.min(o.eANeg, o.eAPos);
  const mEnd = total - eMin;
  const mark = (offset: number, halfW: number, color: string): void => {
    const every = 4, on = 2;
    const a = aMin;
    if (mEnd - a < 0.3) return;
    const n = Math.max(2, Math.ceil((mEnd - a) / 0.25) + 1);
    const step = (mEnd - a) / (n - 1);
    const c = g.colorFor(color);
    const dashQuad = (i0: number, i1: number): void => {
      const p0 = walk(a + i0 * step), p1 = walk(a + i1 * step);
      const nx0 = -p0.dz, nz0 = p0.dx, nx1 = -p1.dz, nz1 = p1.dx;
      const ax0 = p0.x + nx0 * offset, az0 = p0.z + nz0 * offset;
      const ax1 = p1.x + nx1 * offset, az1 = p1.z + nz1 * offset;
      const v0 = g.vertFast(ax0 + nx0 * halfW, groundY(ax0 + nx0 * halfW, az0 + nz0 * halfW) + MARK_LIFT, az0 + nz0 * halfW, c);
      const v1 = g.vertFast(ax0 - nx0 * halfW, groundY(ax0 - nx0 * halfW, az0 - nz0 * halfW) + MARK_LIFT, az0 - nz0 * halfW, c);
      const v2 = g.vertFast(ax1 + nx1 * halfW, groundY(ax1 + nx1 * halfW, az1 + nz1 * halfW) + MARK_LIFT, az1 + nz1 * halfW, c);
      const v3 = g.vertFast(ax1 - nx1 * halfW, groundY(ax1 - nx1 * halfW, az1 - nz1 * halfW) + MARK_LIFT, az1 - nz1 * halfW, c);
      g.tri(v0, v1, v2);
      g.tri(v1, v3, v2);
    };
    // Straight+flat: dashes span known station pairs; walk only those.
    if (rangeIsStraightFlat(walk, groundY, a, mEnd)) {
      for (let k = 0; k * every < n; k++) {
        const i0 = k * every, i1 = Math.min(i0 + on - 1, n - 1);
        if (i1 > i0) dashQuad(i0, i1);
      }
      return;
    }
    let prev: number[] | null = null;
    let prevOn = false;
    for (let i = 0; i < n; i++) {
      const onSeg = i % every < on;
      if (!onSeg) { prev = null; prevOn = false; continue; }
      const first = !prevOn;
      const p = walk(a + i * step);
      const nx = -p.dz, nz = p.dx;
      const ax = p.x + nx * offset, az = p.z + nz * offset;
      const v0 = g.vertFast(ax + nx * halfW, groundY(ax + nx * halfW, az + nz * halfW) + MARK_LIFT, az + nz * halfW, c);
      const v1 = g.vertFast(ax - nx * halfW, groundY(ax - nx * halfW, az - nz * halfW) + MARK_LIFT, az - nz * halfW, c);
      if (!first && prev) {
        g.tri(prev[0], prev[1], v0);
        g.tri(prev[1], v1, v0);
      }
      prev = [v0, v1];
      prevOn = true;
    }
  };
  const base = baseRoadType(type);
  if (dirSign !== 0) {
    // One-way: amber chevrons along the centreline point the way traffic flows.
    if (base === 2) { mark(hw * 0.5, 0.012, AVE_LINE); mark(-hw * 0.5, 0.012, AVE_LINE); }
    for (let s = aMin + 0.7; s < mEnd - 0.2; s += 1.8) {
      const p = walk(s);
      const tx = p.dx * dirSign, tz = p.dz * dirSign;
      const nx = -tz, nz = tx;
      const tip = g.vert(p.x + tx * 0.17, groundY(p.x + tx * 0.17, p.z + tz * 0.17) + MARK_LIFT + 0.002, p.z + tz * 0.17, "#f5c542");
      const b1 = g.vert(p.x - tx * 0.1 + nx * 0.11, groundY(p.x - tx * 0.1 + nx * 0.11, p.z - tz * 0.1 + nz * 0.11) + MARK_LIFT + 0.002, p.z - tz * 0.1 + nz * 0.11, "#f5c542");
      const b2 = g.vert(p.x - tx * 0.1 - nx * 0.11, groundY(p.x - tx * 0.1 - nx * 0.11, p.z - tz * 0.1 - nz * 0.11) + MARK_LIFT + 0.002, p.z - tz * 0.1 - nz * 0.11, "#f5c542");
      g.tri(b1, tip, b2);
    }
  } else if (base === 1) mark(0, 0.012, LINE);
  else if (base === 2) {
    // Median then the two carriageway dashes.
    strip(g, samples, aMin, mEnd, 0.16, MARK_LIFT, MEDIAN, groundY);
    mark(hw * 0.5, 0.012, AVE_LINE);
    mark(-hw * 0.5, 0.012, AVE_LINE);
  } else {
    strip(g, samples, aMin, mEnd, 0.14, MARK_LIFT, HW_EDGE, groundY);
    mark(profileOf(3).drawHalf * 0.5, 0.012, LINE);
    mark(-profileOf(3).drawHalf * 0.5, 0.012, LINE);
  }
  g.force = null;
}

/** Ground height sampler (world units). */
export type GroundY = (x: number, z: number) => number;

/** Plain centred band (used for the median and highway edge lines). */
/**
 * True when the walked range is geometrically straight (quadratic/lerp
 * tangents rotate monotonically, so equal tangents at three stations imply
 * zero curvature) and flat: callers may join endpoints directly instead of
 * walking dense samples. Conservative by construction: dust falls back to
 * the dense path with identical output.
 */
function rangeIsStraightFlat(
  walk: (s: number) => { x: number; z: number; dx: number; dz: number },
  groundY: (x: number, z: number) => number, a: number, b: number,
): boolean {
  const pa = walk(a), pm = walk((a + b) / 2), pb = walk(b);
  if (Math.abs(pa.dx * pm.dx + pa.dz * pm.dz) < 1 - 1e-9) return false;
  if (Math.abs(pa.dx * pb.dx + pa.dz * pb.dz) < 1 - 1e-9) return false;
  const ya = groundY(pa.x, pa.z), ym = groundY(pm.x, pm.z), yb = groundY(pb.x, pb.z);
  return Math.max(ya, ym, yb) - Math.min(ya, ym, yb) <= 0.06;
}

function strip(
  g: Geo, samples: Sample[], a: number, b: number, halfW: number, y: number,
  color: string, groundY: (x: number, z: number) => number,
): void {
  if (b - a < 0.3) return;
  const walk = makeWalker(samples);
  const c = g.colorFor(color);
  if (rangeIsStraightFlat(walk, groundY, a, b)) {
    const p0 = walk(a), p1 = walk(b);
    const nx0 = -p0.dz, nz0 = p0.dx, nx1 = -p1.dz, nz1 = p1.dx;
    g.quad(
      p0.x + nx0 * halfW, p0.z + nz0 * halfW, p1.x + nx1 * halfW, p1.z + nz1 * halfW,
      p1.x - nx1 * halfW, p1.z - nz1 * halfW, p0.x - nx0 * halfW, p0.z - nz0 * halfW,
      y, color, groundY,
    );
    return;
  }
  const n = Math.max(2, Math.ceil((b - a) / 0.25) + 1);
  let prev: number[] | null = null;
  for (let i = 0; i < n; i++) {
    const p = walk(a + ((b - a) * i) / (n - 1));
    const nx = -p.dz, nz = p.dx;
    const v0 = g.vertFast(p.x + nx * halfW, groundY(p.x + nx * halfW, p.z + nz * halfW) + y, p.z + nz * halfW, c);
    const v1 = g.vertFast(p.x - nx * halfW, groundY(p.x - nx * halfW, p.z - nz * halfW) + y, p.z - nz * halfW, c);
    if (prev) {
      g.tri(prev[0], prev[1], v0);
      g.tri(prev[1], v1, v0);
    }
    prev = [v0, v1];
  }
}

// ------------------------------------------------------------ bridges & tunnels


/** Solid box with absolute heights, yawed around Y. Winding is irrelevant (the road mesh is double-sided). */
function box(
  g: Geo, cx: number, cz: number, baseY: number,
  sx: number, sy: number, sz: number, yaw: number, color: string,
): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx: number, y: number, lz: number): number =>
    g.vert(cx + lx * c + lz * s, y, cz - lx * s + lz * c, color);
  const hx = sx / 2, hz = sz / 2, top = baseY + sy;
  const b0 = at(-hx, baseY, -hz), b1 = at(hx, baseY, -hz), b2 = at(hx, baseY, hz), b3 = at(-hx, baseY, hz);
  const t0 = at(-hx, top, -hz), t1 = at(hx, top, -hz), t2 = at(hx, top, hz), t3 = at(-hx, top, hz);
  g.tri(t0, t1, t2);
  g.tri(t0, t2, t3);
  g.tri(b0, t0, t1);
  g.tri(b0, t1, b1);
  g.tri(b1, t1, t2);
  g.tri(b1, t2, b2);
  g.tri(b2, t2, t3);
  g.tri(b2, t3, b3);
  g.tri(b3, t3, t0);
  g.tri(b3, t0, b0);
}

/** Parapet walls along both deck edges, following the deck profile. */
function parapets(g: Geo, type: RoadType, deck: DeckSampler): void {
  const off = sidewalkEdge(type) + 0.03;
  const n = Math.max(1, Math.ceil(deck.length / 0.4));
  for (const side of [-1, 1] as const) {
    let prev: [number, number] | null = null;
    for (let i = 0; i <= n; i++) {
      const s = (deck.length * i) / n;
      const p = deck.pos(s);
      const q = deck.pos(Math.min(deck.length, s + 0.05));
      let dx = q.x - p.x, dz = q.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const x = p.x - dz * side * off, z = p.z + dx * side * off;
      const y = deck.yAt(s);
      const cur: [number, number] = [g.vert(x, y + 0.03, z, CONCRETE), g.vert(x, y + 0.45, z, CONCRETE)];
      if (prev) {
        g.tri(prev[0], cur[0], prev[1]);
        g.tri(prev[1], cur[0], cur[1]);
      }
      prev = cur;
    }
  }
}

/** One pier every 3 tiles, from the bed (or valley floor) up to the deck. Over a road, piers sit beside it. */
function pillars(g: Geo, deck: DeckSampler, groundY: GroundY, w?: World, type?: RoadType): void {
  for (let s = 1.5; s < deck.length - 1; s += 3) {
    const p = deck.pos(s);
    const top = deck.yAt(s) - 0.05;
    const base = Math.min(groundY(p.x, p.z), 0) - 0.25;
    if (top - base < 0.4) continue;
    let cx = p.x, cz = p.z;
    if (w) {
      const tx = Math.floor(p.x), ty = Math.floor(p.z);
      if (tx >= 0 && ty >= 0 && tx < w.size && ty < w.size && w.roadSurface[ty * w.size + tx]) {
        const q = deck.pos(Math.min(deck.length, s + 0.05));
        let dx = q.x - p.x, dz = q.z - p.z;
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const off = (type ? sidewalkEdge(type) : 0.5) + 0.55;
        cx = p.x - dz * off; cz = p.z + dx * off;
        // If that side is also road (wide avenue), use the other side.
        const tx2 = Math.floor(cx), ty2 = Math.floor(cz);
        if (tx2 >= 0 && ty2 >= 0 && tx2 < w.size && ty2 < w.size && w.roadSurface[ty2 * w.size + tx2]) {
          cx = p.x + dz * off; cz = p.z - dx * off;
        }
      }
    }
    box(g, cx, cz, base, 0.36, top - base, 0.36, 0, PILLAR);
  }
}

/** Dark ribbon under the deck (water or the road below), so the crossing reads from far away. */
function deckShadow(g: Geo, type: RoadType, deck: DeckSampler, groundY: GroundY, w?: World): void {
  const hw = sidewalkEdge(type) + 0.2;
  const n = Math.max(1, Math.ceil(deck.length / 0.5));
  let prev: [number, number] | null = null;
  for (let i = 0; i <= n; i++) {
    const s = (deck.length * i) / n;
    const p = deck.pos(s);
    const tx = Math.floor(p.x), ty = Math.floor(p.z);
    const overRoad = !!w && tx >= 0 && ty >= 0 && tx < w.size && ty < w.size && w.roadSurface[ty * w.size + tx] !== 0;
    const gy = groundY(p.x, p.z);
    if (!overRoad && gy > 0.08) { prev = null; continue; }
    const shadowY = overRoad ? gy + 0.075 : 0.05;
    const q = deck.pos(Math.min(deck.length, s + 0.05));
    let dx = q.x - p.x, dz = q.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const cur: [number, number] = [
      g.vert(p.x - dz * hw, shadowY, p.z + dx * hw, DECK_SHADOW),
      g.vert(p.x + dz * hw, shadowY, p.z - dx * hw, DECK_SHADOW),
    ];
    if (prev) {
      g.tri(prev[0], cur[0], prev[1]);
      g.tri(prev[1], cur[0], cur[1]);
    }
    prev = cur;
  }
}

/** Unit tangent at one end of a segment, pointing away from the segment. */
function endOut(seg: RoadSegment, end: "a" | "b"): { dx: number; dz: number } {
  const pts = seg.pts;
  const tip = end === "a" ? pts[0] : pts[pts.length - 1];
  const inner = end === "a" ? pts[1] : pts[pts.length - 2];
  const vx = tip.x - inner.x, vz = tip.z - inner.z;
  const l = Math.hypot(vx, vz) || 1;
  return { dx: vx / l, dz: vz / l };
}

/** Procedural tunnel mouth: two posts, a lintel and a dark opening. */
function portal(g: Geo, m: Pt, dx: number, dz: number, type: RoadType, groundY: GroundY): void {
  const hw = sidewalkEdge(type);
  const gy = groundY(m.x, m.z);
  const yaw = Math.atan2(dx, dz);
  const px = -dz, pz = dx;
  const post = hw + 0.3;
  box(g, m.x + px * post, m.z + pz * post, gy - 0.1, 0.36, 1.7, 0.6, yaw, CONCRETE);
  box(g, m.x - px * post, m.z - pz * post, gy - 0.1, 0.36, 1.7, 0.6, yaw, CONCRETE);
  box(g, m.x, m.z, gy + 1.25, 2 * (hw + 0.48), 0.35, 0.6, yaw, CONCRETE);
  // The opening sits just inside the mouth so the lintel frames it.
  const ix = m.x - dx * 0.05, iz = m.z - dz * 0.05;
  const ow = hw + 0.1;
  const a = g.vert(ix + px * ow, gy + 1.28, iz + pz * ow, PORTAL_DARK);
  const b = g.vert(ix - px * ow, gy + 1.28, iz - pz * ow, PORTAL_DARK);
  const c = g.vert(ix - px * ow, gy + 0.02, iz - pz * ow, PORTAL_DARK);
  const d = g.vert(ix + px * ow, gy + 0.02, iz + pz * ow, PORTAL_DARK);
  g.tri(a, b, c);
  g.tri(a, c, d);
}

// ---------------------------------------------------------------- network

/** Zebra crossing and inbound-only stop line at an asphalt mouth. */
function zebra(
  g: Geo, cx: number, cz: number, dx: number, dz: number,
  halfWidth: number, trim: number, groundY: GroundY, atlas = false,
): void {
  const hw = halfWidth;
  // The whole zebra lies inside the patch; its outer edge meets max trim.
  const d = Math.max(0, trim - 0.15);
  const zx = cx + dx * d, zz = cz + dz * d;
  const px = -dz, pz = dx;
  if (atlas) {
    // One textured quad per marking instead of one quad per stripe.
    const c = (along: number, side: number) => ({ x: zx + dx * along + px * side, z: zz + dz * along + pz * side });
    g.texQuad([c(-0.16, -hw * 0.92), c(-0.16, hw * 0.92), c(0.16, hw * 0.92), c(0.16, -hw * 0.92)],
      NODE_MARK_LIFT, groundY, ROAD_CLASS.CROSSWALK);
    const bx = cx + dx * (trim + 0.38), bz = cz + dz * (trim + 0.38);
    const b = (along: number, side: number) => ({ x: bx + dx * along + px * side, z: bz + dz * along + pz * side });
    g.texQuad([b(-0.02, -hw * 0.92), b(-0.02, 0), b(0.02, 0), b(0.02, -hw * 0.92)],
      NODE_MARK_LIFT, groundY, ROAD_CLASS.STOP_BAR);
    return;
  }
  const stripes = Math.max(4, Math.round(hw * 9));
  for (let k = 0; k < stripes; k++) {
    const t = ((k + 0.5) / stripes) * 2 - 1;
    const sx = zx + px * hw * t * 0.9, sz = zz + pz * hw * t * 0.9;
    const sw = (hw * 0.9) / stripes * 0.5;
    g.quad(
      sx + dx * 0.13 + px * sw, sz + dz * 0.13 + pz * sw,
      sx - dx * 0.13 + px * sw, sz - dz * 0.13 + pz * sw,
      sx - dx * 0.13 - px * sw, sz - dz * 0.13 - pz * sw,
      sx + dx * 0.13 - px * sw, sz + dz * 0.13 - pz * sw,
      NODE_MARK_LIFT, ZEBRA, groundY,
    );
  }
  const lx = cx + dx * (trim + 0.38), lz = cz + dz * (trim + 0.38);
  g.quad(
    lx - px * hw * 0.92 + dx * 0.02, lz - pz * hw * 0.92 + dz * 0.02,
    lx + dx * 0.02, lz + dz * 0.02,
    lx - dx * 0.02, lz - dz * 0.02,
    lx - px * hw * 0.92 - dx * 0.02, lz - pz * hw * 0.92 - dz * 0.02,
    NODE_MARK_LIFT, ZEBRA, groundY,
  );
}

/** Centre dashes through pairs that are visually straight, clipped to trims. */
function junctionGuides(g: Geo, l: JunctionLayout, groundY: GroundY): void {
  for (let i = 0; i < l.arms.length; i++) for (let j = i + 1; j < l.arms.length; j++) {
    const a = l.arms[i], b = l.arms[j];
    if (a.markingsSuppressed || b.markingsSuppressed) continue;
    if (a.dx * b.dx + a.dz * b.dz > -0.94) continue;
    const ta = Math.max(a.trimNeg.asphalt, a.trimPos.asphalt);
    const tb = Math.max(b.trimNeg.asphalt, b.trimPos.asphalt);
    const ax = l.centre.x + a.dx * Math.max(0, ta - 0.06), az = l.centre.z + a.dz * Math.max(0, ta - 0.06);
    const bx = l.centre.x + b.dx * Math.max(0, tb - 0.06), bz = l.centre.z + b.dz * Math.max(0, tb - 0.06);
    const len = Math.hypot(bx - ax, bz - az); if (len < 0.25) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len, px = -dz, pz = dx;
    for (let s = 0.12; s < len - 0.06; s += 0.32) {
      const e = Math.min(len - 0.04, s + 0.16), ww = 0.012;
      g.quad(ax + dx * s + px * ww, az + dz * s + pz * ww, ax + dx * e + px * ww, az + dz * e + pz * ww,
        ax + dx * e - px * ww, az + dz * e - pz * ww, ax + dx * s - px * ww, az + dz * s - pz * ww,
        NODE_MARK_LIFT + 0.002, LINE, groundY);
    }
  }
}

/**
 * Thin adapter over the junction layout: the asphalt polygon and the kerb /
 * sidewalk outer rings as polylines, for tests and SVG dumps.
 */
export function junctionDebugGeometry(l: JunctionLayout): JunctionDebugGeometry {
  const kerbs: Pt[][] = [];
  if (l.kerbOuter.length >= 3) kerbs.push(l.kerbOuter);
  if (l.sidewalkOuter.length >= 3) kerbs.push(l.sidewalkOuter);
  return { asphalt: l.asphalt, kerbs };
}

/** Emit pre-triangulated 2-D triangles into the road mesh at one lift. */
function emitTris(
  g: Geo, tris: [Pt, Pt, Pt][], y: number, color: string, groundY: GroundY,
  uvOf?: (p: Pt) => [number, number], cls: number = ROAD_CLASS.FLAT,
): void {
  const c = g.colorFor(color);
  // Indexed: one vertex per unique corner (~3x fewer than soup). Safe: every
  // vertex in this call shares lift, colour, class, and position-derived UVs.
  // Winding is normalised here: band strips from triangulateBand mix both
  // orientations and back-face culling would drop half of them (sawtooth).
  const oriented = tris.map((t) => {
    const area2 = (t[1].x - t[0].x) * (t[2].z - t[0].z) - (t[2].x - t[0].x) * (t[1].z - t[0].z);
    return area2 < 0 ? ([t[0], t[2], t[1]] as [Pt, Pt, Pt]) : t;
  });
  const { pts, idx } = asIndexed(oriented);
  const base = g.count;
  for (const p of pts) g.vertFast(p.x, groundY(p.x, p.z) + y, p.z, c, uvOf?.(p), cls);
  for (let k = 0; k < idx.length; k += 3) g.tri(base + idx[k], base + idx[k + 1], base + idx[k + 2]);
}

/**
 * Junction patch from the layout rings: one asphalt polygon (ear clipping,
 * never a centre fan), the kerb band asphalt→kerbOuter and the sidewalk band
 * kerbOuter→sidewalkOuter in the ribbon kerb material. Bands ride above the
 * ribbon ends by lift, like the asphalt rides above the bands. When a band
 * has no valid triangulation (degenerate input), the full outer ring is
 * stacked underneath instead — same lifts, hidden by the inner surface.
 */
function drawJunctionPatch(g: Geo, l: JunctionLayout, groundY: GroundY, atlas = false): void {
  if (l.asphalt.length < 3) return;
  const bandLift = NODE_ASPHALT_LIFT + 0.004;
  const kerb = l.kerbOuter.length >= 3 ? l.kerbOuter : null;
  const walk = l.sidewalkOuter.length >= 3 ? l.sidewalkOuter : null;
  if (kerb) {
    const band = triangulateBand(l.asphalt, kerb);
    if (band) emitTris(g, band, bandLift, KERB, groundY);
    else emitTris(g, triangulateRing(kerb), bandLift, KERB, groundY);
  }
  if (kerb && walk) {
    const band = triangulateBand(kerb, walk);
    if (band) emitTris(g, band, bandLift, KERB, groundY);
    else emitTris(g, triangulateRing(walk), bandLift, KERB, groundY);
  }
  const patchCol = atlas ? "#ffffff" : ASPHALT;
  const patchCls = atlas ? ROAD_CLASS.JUNCTION : ROAD_CLASS.FLAT;
  const uvOf = atlas ? (p: Pt): [number, number] => [p.x / JUNCTION_TILE, p.z / JUNCTION_TILE] : undefined;
  emitTris(g, triangulateRing(l.asphalt), NODE_ASPHALT_LIFT, patchCol, groundY, uvOf, patchCls);
}

/**
 * Full road network in one geometry: trimmed ribbons, one asphalt polygon per
 * junction with kerb and sidewalk bands, square dead-end caps, zebras on 3+
 * arm nodes. Bridges ride their deck profile with parapets, piers and a water
 * shadow; tunnels show only their two portals (the ribbon stays buried). With
 * `hideBridges` the decks are dropped for the underground view.
 */
export function buildRoadNetworkGeometry(w: World, groundY: GroundY, opts?: { hideBridges?: boolean; atlas?: boolean }): THREE.BufferGeometry {
  const atlas = !!opts?.atlas;
  const g = new Geo();
  const layouts = junctionsOf(w);
  const layoutOf = (id: number): JunctionLayout | null => layouts.byNode.get(id) ?? null;
  // Ribbon trims for one segment end from its node layout. Layout sides are in
  // the arm's outward frame; the ribbon walks a→b, so end "b" swaps sides.
  // Excluded (bridge/tunnel) arms have no layout arm: their ribbons run to
  // the node centre.
  const trimsFor = (layout: JunctionLayout | null, seg: RoadSegment, end: "a" | "b"):
    Pick<RibbonOpts, "aNeg" | "aPos" | "kNeg" | "kPos" | "sNeg" | "sPos"> => {
    const zero = { aNeg: 0, aPos: 0, kNeg: 0, kPos: 0, sNeg: 0, sPos: 0 };
    if (!layout) return zero;
    const arm = layout.arms.find((a) => a.segId === seg.id && a.end === end);
    if (!arm) return zero;
    const neg = end === "a" ? arm.trimNeg : arm.trimPos;
    const pos = end === "a" ? arm.trimPos : arm.trimNeg;
    return {
      aNeg: neg.asphalt, aPos: pos.asphalt,
      kNeg: neg.kerb, kPos: pos.kerb,
      sNeg: neg.sidewalk, sPos: pos.sidewalk,
    };
  };
  for (const seg of w.segments) {
    const elev = segElevation(seg);
    if (elev === "bridge" && opts?.hideBridges) continue;
    if (elev === "tunnel") {
      for (const end of ["a", "b"] as const) {
        const tip = end === "a" ? seg.pts[0] : seg.pts[seg.pts.length - 1];
        const o = endOut(seg, end);
        portal(g, tip, o.dx, o.dz, seg.type, groundY);
      }
      continue;
    }
    const samples = sampleCurve(seg.pts);
    const total = samples[samples.length - 1].s;
    if (total < 1e-6) {
      // Paint pad: draw it only when nothing else covers its tile.
      const node = nodeById(w, seg.a);
      if (node && node.segs.length === 1) {
        const h = 0.5;
        g.quad(node.x - h, node.z - h, node.x + h, node.z - h, node.x + h, node.z + h, node.x - h, node.z + h,
          ROAD_LIFT, ASPHALT, groundY);
      }
      continue;
    }
    const la = layoutOf(seg.a), lb = layoutOf(seg.b);
    const deck = elev === "bridge" ? makeDeckSampler(w, seg.pts) : null;
    // A deck ribbon rides the profile instead of the terrain; its ramps meet the ground at the ends.
    const gy = deck ? (x: number, z: number): number => deck.yAt(deck.sAt(x, z)) : groundY;
    const ta = trimsFor(la, seg, "a");
    const tb = trimsFor(lb, seg, "b");
    const trim: RibbonOpts = {
      ...ta,
      eANeg: tb.aNeg,
      eAPos: tb.aPos,
      eKNeg: tb.kNeg,
      eKPos: tb.kPos,
      eSNeg: tb.sNeg,
      eSPos: tb.sPos,
    };
    ribbon(g, seg.pts, seg.type, trim, gy, undefined, seg.oneWay ? (seg.dir === -1 ? -1 : 1) : 0, atlas);
    if (deck) {
      parapets(g, seg.type, deck);
      pillars(g, deck, groundY, w, seg.type);
      deckShadow(g, seg.type, deck, groundY, w);
    }
  }

  for (const node of w.nodes) {
    const l = layoutOf(node.id);
    if (!l) continue;
    // Dead ends (kind "end") draw their square cap here; middle/transition
    // and non-ground nodes carry no rings and are skipped inside.
    drawJunctionPatch(g, l, groundY, atlas);
    if (l.arms.length >= 3) {
      for (const arm of l.arms) {
        if (arm.markingsSuppressed) continue;
        zebra(g, l.centre.x, l.centre.z, arm.dx, arm.dz,
          profileOf(arm.type).asphaltHalf,
          Math.max(arm.trimNeg.asphalt, arm.trimPos.asphalt), groundY, atlas);
      }
      // Roundabout ring nodes read as circulation: no straight-through guides.
      const onRing = l.arms.some((arm) => w.segments.find((sg) => sg.id === arm.segId)?.roundabout);
      if (!onRing) junctionGuides(g, l, groundY);
    }
  }

  // Roundabout islands: kerb rim, grass disc, and a yield dash across each entry arm.
  for (const rb of w.roundabouts) {
    const SEG = 20;
    const fan = (r: number, y: number, color: string): void => {
      const c = g.vert(rb.x, groundY(rb.x, rb.z) + y, rb.z, color);
      let prev = -1;
      for (let k = 0; k <= SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        const x = rb.x + Math.cos(a) * r, z = rb.z + Math.sin(a) * r;
        const v = g.vert(x, groundY(x, z) + y, z, color);
        if (prev >= 0) g.tri(c, prev, v);
        prev = v;
      }
    };
    fan(rb.r - 0.45, KERB_LIFT, KERB);
    fan(rb.r - 0.53, KERB_LIFT + 0.002, "#6f9b4e");
    for (const node of w.nodes) {
      if (Math.abs(Math.hypot(node.x - rb.x, node.z - rb.z) - rb.r) > 0.05) continue;
      for (const arm of nodeArms(w, node.id)) {
        if (w.segments.find((s) => s.id === arm.segId)?.roundabout) continue;
        const d = 0.85, hw2 = arm.halfWidth * 0.85;
        const cx2 = node.x + arm.dx * d, cz2 = node.z + arm.dz * d;
        const px = -arm.dz, pz = arm.dx;
        for (const side of [-0.5, 0.5]) {
          const sx = cx2 + px * hw2 * side * 1.4, sz = cz2 + pz * hw2 * side * 1.4;
          g.quad(
            sx + arm.dx * 0.05 + px * hw2 * 0.28, sz + arm.dz * 0.05 + pz * hw2 * 0.28,
            sx - arm.dx * 0.05 + px * hw2 * 0.28, sz - arm.dz * 0.05 + pz * hw2 * 0.28,
            sx - arm.dx * 0.05 - px * hw2 * 0.28, sz - arm.dz * 0.05 - pz * hw2 * 0.28,
            sx + arm.dx * 0.05 - px * hw2 * 0.28, sz + arm.dz * 0.05 - pz * hw2 * 0.28,
            NODE_MARK_LIFT, ZEBRA, groundY,
          );
        }
      }
    }
  }
  return g.build();
}

/**
 * Simple strips without junctions: road preview ghosts and metro tracks.
 * `tint` paints the whole ribbon one colour (build preview).
 */
export function buildStripGeometry(
  segs: StripSeg[], groundY: GroundY, tint?: THREE.Color,
): THREE.BufferGeometry {
  const g = new Geo();
  segs.forEach((seg, idx) => {
    const lift = seg.lift ?? 0.07 + (idx % 7) * 0.002;
    if (seg.color && !tint) {
      const samples = sampleCurve(seg.pts);
      const total = samples[samples.length - 1].s;
      const hw = (seg.width ?? 0.3) / 2;
      // Single flat band in the segment colour.
      const walk = makeWalker(samples);
      let prev: number[] | null = null;
      const n = Math.max(2, Math.ceil(total / 0.25) + 1);
      for (let i = 0; i < n; i++) {
        const p = walk((total * i) / (n - 1));
        const v0 = g.vert(p.x - p.dz * hw, groundY(p.x - p.dz * hw, p.z + p.dx * hw) + lift, p.z + p.dx * hw, seg.color);
        const v1 = g.vert(p.x + p.dz * hw, groundY(p.x + p.dz * hw, p.z - p.dx * hw) + lift, p.z - p.dx * hw, seg.color);
        if (prev) {
          g.tri(prev[0], prev[1], v0);
          g.tri(prev[1], v1, v0);
        }
        prev = [v0, v1];
      }
      return;
    }
    ribbon(g, seg.pts, seg.type, NO_TRIM, groundY, tint, seg.dirSign ?? 0);
  });
  return g.build();
}
