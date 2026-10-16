import { isOneWayType } from "../sim/world";
import * as THREE from "three";
import {
  Pt, RoadSegment, RoadType, World, baseRoadType, curvePoints, heightAt,
  makeDeckSampler, segElevation, DeckSampler,
} from "../sim/world";
import { nodeArms, nodeById } from "../sim/roads";
import { junctionsOf, type JunctionLayout, type JunctionMouthLayer, type JunctionMouthSide } from "../sim/junction";
import { profileOf, sidewalkEdge } from "../sim/corridor";
import { inboundArmOffset, pointInPolygon } from "../sim/lanes";
import { specOf } from "../sim/roadprofile";
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
export const MARK_LIFT_FOR_TESTS = MARK_LIFT;

const ASPHALT = "#31353c";
const KERB = "#ccd0d6";
const HW_ASPHALT = "#41464e";
const HW_EDGE = "#b8bec6";
const LINE = "#d8d4b0";
const AVE_LINE = "#e8e4c8";
const MEDIAN = "#5f8a4a";
const ZEBRA = "#f1f1ea";
const CONCRETE = "#a8adb5";
/** Concrete at the foot of a face: gentle vertical shading, no texture. */
const CONCRETE_LOW = "#949aa2";
const SLAB_UNDER = "#7b8189";
const PILLAR = "#8b9098";
const PILLAR_LOW = "#767b83";
const PORTAL_DARK = "#0b0d12";
/** Neutral dark tint (no blue cast) for the deck shadow over water. */
const DECK_SHADOW = "#2c2d2e";

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
  /** Structures (bridge barrier, slab, piers, tunnel portal, deck shadow):
   * plain vertex colour, never the atlas nor the asphalt/kerb detail maps. */
  PLAIN: 10,
  /** Ramp (type 6): its own cross-section strip with shoulders, no kerb. */
  RAMP: 11,
} as const;
/** World units covered by one cross-section texture tile along the road. */
export const ROAD_TILE_LENGTH = 4;
/** World units covered by one junction-asphalt tile (world-space UV), across x. */
export const JUNCTION_TILE = 2;
/** ...and along z: junction_asphalt.png is 512x1024, so square texels need 2x. */
export const JUNCTION_TILE_V = 4;
/** Atlas-tier pad kerb/sidewalk colour: the decoded mean of every road_*.png kerb+sidewalk zone. */
export const ATLAS_SIDEWALK = "#a7abb1";
/** Atlas-tier median nose colour: road_avenue.png planted-median mean. */
export const ATLAS_MEDIAN = "#567a42";

export function roadClassFor(type: RoadType, dirSign: number): number {
  if (type === 6) return ROAD_CLASS.RAMP;
  const base = baseRoadType(type);
  if (base === 3) return ROAD_CLASS.HIGHWAY;
  if (dirSign !== 0 || isOneWayType(type)) {
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
  /** Across-mouth lines (junction ring crossings) at the near / far end. */
  mA?: RibbonMouth;
  mB?: RibbonMouth;
  /**
   * Gore notch (follows arm at a merge/diverge): the ramp-side half routes its
   * outer boundary through these stations so it stops where the gore pad
   * starts instead of cutting over the pad nose. Ribbon stations, ribbon side.
   */
  notchA?: GoreNotch;
  notchB?: GoreNotch;
  /**
   * Barrier start/end stations (near/far end) from the layout's gore ring. The
   * mouth-average stop would leave the barrier's half width inside the pad on
   * the shallow gore diagonal. Absent: mouth average ± medianHalf.
   */
  barrierA?: number;
  barrierB?: number;
}

/** Outer-boundary via rows (exact points) for one ribbon side at one end. */
interface GoreNotch {
  side: -1 | 1;
  rows: { s: number; p: Pt }[];
}

/**
 * A junction layer ring's across-mouth edge in the ribbon frame: stations
 * measured from that ribbon end inward, ring points on the -/+ side edges at
 * lateral offset R. Ribbon layers start ON this edge, so ribbon and pad never
 * cover the same ground at the same height.
 */
interface MouthLine {
  nS: number; pS: number; nP?: Pt; pP?: Pt; R: number;
  /** Inner-layer ring corners at an offset, used verbatim when they lie on this edge. */
  snaps?: { off: number; n: JunctionMouthSide; p: JunctionMouthSide }[];
}
interface RibbonMouth { asphalt: MouthLine; band: MouthLine }

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
  const prof = profileOf(type);
  const hw = prof.asphaltHalf;
  const kw = prof.kerb;
  const sw = prof.sidewalk;
  const walk = makeWalker(samples);
  const endpointFrame = (start: boolean, s: number): { x: number; z: number; dx: number; dz: number } => {
    const tip = start ? pts[0] : pts[pts.length - 1];
    const candidates = start ? pts.slice(1) : pts.slice(0, -1).reverse();
    const inner = candidates.find((p) => Math.hypot(p.x - tip.x, p.z - tip.z) > 1e-6) ?? tip;
    let dx = start ? inner.x - tip.x : tip.x - inner.x;
    let dz = start ? inner.z - tip.z : tip.z - inner.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const d = start ? s : s - total;
    return { x: tip.x + dx * d, z: tip.z + dz * d, dx, dz };
  };
  // Half-strip between two offsets. Endpoint offsets may use different
  // stations, so layer handoffs and asymmetric junction mouths need a
  // trapezoidal first/last row rather than a centreline-normal row.
  // Half-strip between two offsets. Endpoint rows may use different stations
  // (and exact ring points), so asymmetric junction mouths get a trapezoidal
  // first/last row rather than a centreline-normal row.
  type RowEnd = { inner: number; outer: number; pi?: Pt; po?: Pt; anchor?: boolean };
  const half = (
    side: -1 | 1, st: RowEnd, en: RowEnd,
    inner: number, outer: number,
    y: number, color: string, uv?: (off: number) => number, cls = 0,
    via: { s: number; p: Pt }[] = [],
  ): void => {
    const clamp = (s: number): number => Math.max(0, Math.min(total, s));
    const si = clamp(st.inner), so = clamp(st.outer);
    const ei = clamp(en.inner), eo = clamp(en.outer);
    if (Math.max(ei - si, eo - so) < 0.02) return;
    const first: RowEnd = { inner: si, outer: so, pi: st.pi, po: st.po };
    const last: RowEnd = { inner: ei, outer: eo, pi: en.pi, po: en.po };
    // Straight roads on flat ground need no intermediate stations; curves and
    // slopes follow the samples so the ribbon hugs the terrain.
    let dense = pts.length > 2;
    const a = Math.min(si, so), b = Math.max(ei, eo);
    if (!dense && b - a > 0.5) {
      const pa = walk(a), pm = walk((a + b) / 2), pb = walk(b);
      const ya = groundY(pa.x, pa.z), ym = groundY(pm.x, pm.z), yb = groundY(pb.x, pb.z);
      dense = Math.max(ya, ym, yb) - Math.min(ya, ym, yb) > 0.06;
    }
    const interior: RowEnd[] = [];
    if (dense) {
      const commonStart = Math.max(si, so), commonEnd = Math.min(ei, eo);
      for (const p of samples) {
        if (p.s > commonStart + 0.01 && p.s < commonEnd - 0.01) interior.push({ inner: p.s, outer: p.s });
      }
    }
    // Gore-notch via rows splice into the interior in station order; samples
    // too close to a via row are dropped so no sliver spans the notch.
    const lo = Math.max(si, so), hi = Math.min(ei, eo);
    for (const v of via) {
      if (v.s > lo + 1e-6 && v.s < hi - 1e-6) interior.push({ inner: v.s, outer: v.s, po: v.p });
    }
    interior.sort((r1, r2) => (r1.inner + r1.outer) - (r2.inner + r2.outer));
    const rows: RowEnd[] = [first];
    if (via.length === 0) rows.push(...interior);
    else for (const r of interior) {
      const prevRow = rows[rows.length - 1];
      const gap = Math.min(r.inner, r.outer) - Math.max(prevRow.inner, prevRow.outer);
      if (gap < 0.03 && !r.po) continue; // sample hugs a via row: keep the exact point
      rows.push(r);
    }
    rows.push(last);
    let prev0 = -1, prev1 = -1;
    const c = g.colorFor(uv ? "#ffffff" : color);
    const anchorStart = st.anchor !== false, anchorEnd = en.anchor !== false;
    const at = (s: number, off: number, atStart: boolean, atEnd: boolean, fixed?: Pt): Pt => {
      if (fixed) return fixed;
      const f = atStart ? endpointFrame(true, s) : atEnd ? endpointFrame(false, s) : walk(s);
      return { x: f.x - f.dz * side * off, z: f.z + f.dx * side * off };
    };
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const atStart = ri === 0 && anchorStart;
      const atEnd = ri === rows.length - 1 && anchorEnd;
      const pi = at(row.inner, inner, atStart, atEnd, row.pi);
      const po = at(row.outer, outer, atStart, atEnd, row.po);
      const vi = (dirSign < 0 ? total - row.inner : row.inner) / ROAD_TILE_LENGTH;
      const vo = (dirSign < 0 ? total - row.outer : row.outer) / ROAD_TILE_LENGTH;
      const i0 = uv
        ? g.vertFast(pi.x, groundY(pi.x, pi.z) + y, pi.z, c, [uv(side * inner), vi], cls)
        : g.vertFast(pi.x, groundY(pi.x, pi.z) + y, pi.z, c);
      const i1 = uv
        ? g.vertFast(po.x, groundY(po.x, po.z) + y, po.z, c, [uv(side * outer), vo], cls)
        : g.vertFast(po.x, groundY(po.x, po.z) + y, po.z, c);
      if (prev0 >= 0) {
        g.tri(prev0, prev1, i0);
        g.tri(prev1, i1, i0);
      }
      prev0 = i0; prev1 = i1;
    }
  };
  // Mouth lines: every layer starts on its junction ring's across-mouth edge
  // (junction.ts `attachMouths`). Without a layout the line is station 0.
  const bandR = hw + kw + sw;
  const mA: RibbonMouth = o.mA ?? { asphalt: { nS: 0, pS: 0, R: hw }, band: { nS: 0, pS: 0, R: bandR } };
  const mB: RibbonMouth = o.mB ?? { asphalt: { nS: 0, pS: 0, R: hw }, band: { nS: 0, pS: 0, R: bandR } };
  /** Row end on line L at offsets [inner, outer] of side; ribbon stations. */
  const rowOn = (L: MouthLine, side: -1 | 1, inner: number, outer: number, start: boolean): RowEnd => {
    const cS = (L.nS + L.pS) / 2, sS = side < 0 ? L.nS : L.pS;
    const P = side < 0 ? L.nP : L.pP;
    const pt = (off: number): { s: number; p?: Pt } => {
      const f = L.R > 1e-9 ? off / L.R : 0;
      const s = cS + (sS - cS) * f;
      if (!L.nP || !L.pP || !P) return { s };
      for (const sn of L.snaps ?? []) {
        const q = side < 0 ? sn.n : sn.p;
        if (Math.abs(sn.off - off) < 1e-9 && Math.abs(q.s - s) < 1e-6) return { s, p: q.p };
      }
      const cx = (L.nP.x + L.pP.x) / 2, cz = (L.nP.z + L.pP.z) / 2;
      return { s, p: { x: cx + (P.x - cx) * f, z: cz + (P.z - cz) * f } };
    };
    const a = pt(inner), b = pt(outer);
    return start
      ? { inner: a.s, outer: b.s, pi: a.p, po: b.p }
      : { inner: total - a.s, outer: total - b.s, pi: a.p, po: b.p };
  };
  const startMouth = (mA.asphalt.nS + mA.asphalt.pS) / 2;
  const endMouth = total - (mB.asphalt.nS + mB.asphalt.pS) / 2;
  // A zero-station reflex mouth passes through the node centre. Radially
  // shrinking a pad leaves that centre fixed, so retaining a centre vertex
  // there is also an ambiguous seam for overlap tests. Start/end with one
  // full-width cell in that case, then split into halves outside the pad.
  const zeroStart = startMouth < 1e-9;
  const zeroEnd = total - endMouth < 1e-9;
  const bridgeDepth = Math.min(0.25, Math.max(0, (endMouth - startMouth) / 2));
  const startCentre = zeroStart ? startMouth + bridgeDepth : startMouth;
  const endCentre = zeroEnd ? endMouth - bridgeDepth : endMouth;
  const atlasUv = atlas && !tint ? (off: number): number => 0.5 + off / (2 * sidewalkEdge(type)) : undefined;
  const atlasCls = roadClassFor(type, dirSign);
  const aMin = Math.min(o.aNeg, o.aPos);
  const eMin = Math.min(o.eANeg, o.eAPos);
  const mEnd = total - eMin;
  /** Full-width asphalt cell from a mouth row to a centreline-normal row. */
  const asphaltBridge = (mouth: MouthLine, start: boolean, depth: number, uv?: (off: number) => number, cls = 0): void => {
    if (depth < 0.02) return;
    const c = g.colorFor(uv ? "#ffffff" : type === 3 ? HW_ASPHALT : ASPHALT);
    const vertex = (side: -1 | 1, r: RowEnd | null, s: number): number => {
      let x: number, z: number;
      if (r?.po) { x = r.po.x; z = r.po.z; s = r.outer; } else {
        const p = s < 1e-9 ? endpointFrame(true, s) : total - s < 1e-9 ? endpointFrame(false, s) : walk(s);
        x = p.x - p.dz * side * hw; z = p.z + p.dx * side * hw;
      }
      const v = (dirSign < 0 ? total - s : s) / ROAD_TILE_LENGTH;
      return uv
        ? g.vertFast(x, groundY(x, z) + ROAD_LIFT, z, c, [uv(side * hw), v], cls)
        : g.vertFast(x, groundY(x, z) + ROAD_LIFT, z, c);
    };
    const rn = rowOn(mouth, -1, 0, hw, start), rp = rowOn(mouth, 1, 0, hw, start);
    const sMouth = start ? Math.max(0, Math.min(rn.outer, rp.outer)) : Math.min(total, Math.max(rn.outer, rp.outer));
    const sIn = start ? startCentre : endCentre;
    const aNeg = vertex(-1, rn, sMouth), aPos = vertex(1, rp, sMouth);
    const bNeg = vertex(-1, null, sIn), bPos = vertex(1, null, sIn);
    if (start) { g.tri(aNeg, aPos, bNeg); g.tri(aPos, bPos, bNeg); }
    else { g.tri(bNeg, bPos, aNeg); g.tri(bPos, aPos, aNeg); }
  };
  const surface = (uv?: (off: number) => number, cls = 0): void => {
    if (zeroStart) asphaltBridge(mA.asphalt, true, bridgeDepth, uv, cls);
    if (zeroEnd) asphaltBridge(mB.asphalt, false, bridgeDepth, uv, cls);
    const asphaltCol = type === 3 ? HW_ASPHALT : ASPHALT;
    for (const side of [-1, 1] as const) {
      const via = [
        ...(o.notchA && o.notchA.side === side ? o.notchA.rows : []),
        ...(o.notchB && o.notchB.side === side ? o.notchB.rows : []),
      ];
      half(side,
        zeroStart ? { inner: startCentre, outer: startCentre, anchor: false } : rowOn(mA.asphalt, side, 0, hw, true),
        zeroEnd ? { inner: endCentre, outer: endCentre, anchor: false } : rowOn(mB.asphalt, side, 0, hw, false),
        0, hw, ROAD_LIFT, asphaltCol, uv, cls, via);
      // Kerb and sidewalk both start on the outermost band ring's mouth edge:
      // the pad bands fill everything between the asphalt ring and it.
      if (kw > 0) half(side, rowOn(mA.band, side, hw, hw + kw, true), rowOn(mB.band, side, hw, hw + kw, false),
        hw, hw + kw, KERB_LIFT, KERB, uv, cls);
      if (sw > 0) half(side, rowOn(mA.band, side, hw + kw, bandR, true), rowOn(mB.band, side, hw + kw, bandR, false),
        hw + kw, bandR, KERB_LIFT, KERB, uv, cls);
    }
  };
  surface(atlasUv, atlasCls);
  // Jersey barrier on the median in both tiers (never on preview ghosts).
  if (!tint && baseRoadType(type) === 3) {
    // The ribbon's own dense rule: straight flat spans need only the end
    // rows; curves, slopes and decks follow the sampled stations.
    const bA = o.barrierA ?? startMouth + prof.medianHalf, bB = o.barrierB ?? endMouth - prof.medianHalf;
    let dense = pts.length > 2;
    if (!dense && bB - bA > 0.5) {
      const pa = walk(bA), pm = walk((bA + bB) / 2), pb = walk(bB);
      const ya = groundY(pa.x, pa.z), ym = groundY(pm.x, pm.z), yb = groundY(pb.x, pb.z);
      dense = Math.max(ya, ym, yb) - Math.min(ya, ym, yb) > 0.06;
    }
    jerseyBarrier(g, samples, walk, bA, bB, groundY, dense);
  }
  if (atlasUv) {
    // One-way arrows are atlas decals; keep them clear of both junction pads.
    if (dirSign !== 0) {
      for (let s = Math.max(0.9, aMin + 0.4); s < mEnd - 0.3; s += 3.6) {
        const p = walk(s);
        const tx = p.dx * dirSign, tz = p.dz * dirSign;
        const nx = -tz, nz = tx;
        const c = (off: number, side: number) => ({ x: p.x + tx * off + nx * side, z: p.z + tz * off + nz * side });
        g.texQuad([c(-0.35, -0.14), c(-0.35, 0.14), c(0.35, 0.14), c(0.35, -0.14)],
          MARK_LIFT + 0.002, groundY, ROAD_CLASS.ARROW);
      }
    }
    g.force = null;
    return;
  }
  // Markings above the asphalt: dashes, avenue median, highway lines.
  const mark = (offset: number, halfW: number, color: string, a0 = aMin, b0 = mEnd): void => {
    const every = 4, on = 2;
    const a = a0;
    if (b0 - a < 0.3) return;
    const n = Math.max(2, Math.ceil((b0 - a) / 0.25) + 1);
    const step = (b0 - a) / (n - 1);
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
    if (rangeIsStraightFlat(walk, groundY, a, b0)) {
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
  const laneLines = (range?: (offset: number) => [number, number]): void => {
    const c = prof.laneCentres;
    for (let i = 0; i < c.length - 1; i++) {
      if (dirSign !== 0 || (c[i] > 0) === (c[i + 1] > 0)) {
        const off = (c[i] + c[i + 1]) / 2;
        if (range) {
          const [a0, b0] = range(off);
          mark(off, 0.012, AVE_LINE, a0, b0);
        } else mark(off, 0.012, AVE_LINE);
      }
    }
  };
  if (dirSign !== 0) {
    // One-way: amber chevrons along the centreline point the way traffic flows.
    laneLines();
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
    strip(g, samples, aMin, mEnd, prof.medianHalf, MARK_LIFT, MEDIAN, groundY);
    laneLines();
  } else {
    // Gore-aware: each marking runs only where its own side's ribbon runs, so
    // the ramp-side shoulder and lane lines stop where the gore pad starts.
    const sideRange = (offset: number): [number, number] =>
      offset > 0 ? [o.aPos, total - o.eAPos]
      : offset < 0 ? [o.aNeg, total - o.eANeg]
      : [startMouth, endMouth];
    strip(g, samples, startMouth, endMouth, prof.medianHalf, MARK_LIFT, HW_EDGE, groundY);
    const [ap0, ap1] = sideRange(1);
    const [an0, an1] = sideRange(-1);
    mark(prof.asphaltHalf - prof.shoulder, 0.012, LINE, ap0, ap1);
    mark(-(prof.asphaltHalf - prof.shoulder), 0.012, LINE, an0, an1);
    laneLines(sideRange);
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

/** Jersey barrier cross-section: (lateral offset, height above the road surface). */
const JERSEY_PROFILE: [number, number][] = [
  [-0.06, 0], [-0.045, 0.03], [-0.025, 0.10],
  [0.025, 0.10], [0.045, 0.03], [0.06, 0],
];

/**
 * Concrete Jersey barrier along a highway centreline: one quad strip per face
 * per station row (lower and upper face per side plus the flat top) at the
 * ribbon's own stations — just the end rows when straight and flat, the
 * sampled stations on curves, slopes and decks; PLAIN class, merged into the
 * road geometry. Both ends close with a cap over the profile.
 */
function jerseyBarrier(
  g: Geo, samples: Sample[], walk: (s: number) => { x: number; z: number; dx: number; dz: number },
  s0: number, s1: number, gy: (x: number, z: number) => number, dense: boolean,
): void {
  if (s1 - s0 < 0.05) return;
  const rows = dense
    ? [s0, ...samples.map((p) => p.s).filter((s) => s > s0 + 0.01 && s < s1 - 0.01), s1]
    : [s0, s1];
  const c = g.colorFor(CONCRETE);
  const pt = (s: number, off: number, h: number): number => {
    const f = walk(s);
    const x = f.x - f.dz * off, z = f.z + f.dx * off;
    return g.vertFast(x, gy(x, z) + ROAD_LIFT + h, z, c, undefined, ROAD_CLASS.PLAIN);
  };
  // Faces as profile index pairs: lower/upper per side, then the flat top.
  const faces: [number, number][] = [[0, 1], [1, 2], [3, 4], [4, 5], [2, 3]];
  let prev: number[] | null = null;
  for (const s of rows) {
    const cur = JERSEY_PROFILE.map(([off, h]) => pt(s, off, h));
    if (prev) {
      for (const [a, b] of faces) {
        g.tri(prev[a], prev[b], cur[a]);
        g.tri(prev[b], cur[b], cur[a]);
      }
    }
    prev = cur;
  }
  // End caps: convex hexagon fan.
  for (const s of [s0, s1]) {
    const hex = JERSEY_PROFILE.map(([off, h]) => pt(s, off, h));
    for (let k = 1; k + 1 < hex.length; k++) g.tri(hex[0], hex[k], hex[k + 1]);
  }
}

// ------------------------------------------------------------ bridges & tunnels


/** Solid box with absolute heights, yawed around Y. Winding is irrelevant (the road mesh is double-sided). */
function box(
  g: Geo, cx: number, cz: number, baseY: number,
  sx: number, sy: number, sz: number, yaw: number, color: string, low = color,
): void {
  // Plain concrete (PLAIN class), one vertex set per face so edges stay crisp;
  // the foot of each side face is a shade darker (gentle vertical shading).
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const top = g.colorFor(color), foot = g.colorFor(low);
  const at = (lx: number, y: number, lz: number, col: THREE.Color): number =>
    g.vertFast(cx + lx * c + lz * s, y, cz - lx * s + lz * c, col, undefined, ROAD_CLASS.PLAIN);
  const hx = sx / 2, hz = sz / 2, y1 = baseY + sy;
  const corners: [number, number][] = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
  const t = corners.map(([x, z]) => at(x, y1, z, top));
  g.tri(t[0], t[1], t[2]);
  g.tri(t[0], t[2], t[3]);
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
    const b0 = at(ax, baseY, az, foot), b1 = at(bx, baseY, bz, foot);
    const t0 = at(ax, y1, az, top), t1 = at(bx, y1, bz, top);
    g.tri(b0, t0, t1);
    g.tri(b0, t1, b1);
  }
}

/** Barrier height (tile) and the fade that opens the ramp mouth at grade. */
export const BRIDGE_BARRIER_H = 0.14;
const BARRIER_BASE = 0.03;
const BARRIER_CAP = 0.03;
/** The barrier is gone wherever the deck is this close to the ground. */
const BARRIER_OPEN = 0.06;
const BARRIER_FULL = 0.3;
/** Slab depth under the deck; fascia and underside only where the deck clears the ground by more. */
export const BRIDGE_SLAB_DEPTH = 0.12;
const SLAB_MIN_CLEAR = 0.2;

type DeckRow = { s: number; x: number; z: number; dx: number; dz: number; y: number; clear: number };

/** Deck rows at <= 0.4 spacing plus exact rows where the clearance crosses the barrier and slab thresholds. */
function deckRows(deck: DeckSampler, groundY: GroundY): DeckRow[] {
  const row = (s: number): DeckRow => {
    const p = deck.pos(s);
    const q = deck.pos(Math.min(deck.length, s + 0.05));
    const r = s + 0.05 > deck.length ? deck.pos(Math.max(0, s - 0.05)) : null;
    let dx = r ? p.x - r.x : q.x - p.x, dz = r ? p.z - r.z : q.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const y = deck.yAt(s);
    return { s, x: p.x, z: p.z, dx, dz, y, clear: y - groundY(p.x, p.z) };
  };
  const n = Math.max(1, Math.ceil(deck.length / 0.4));
  const rows: DeckRow[] = [];
  for (let i = 0; i <= n; i++) {
    const r = row((deck.length * i) / n);
    const prev = rows[rows.length - 1];
    if (prev) {
      for (const th of [BARRIER_OPEN, SLAB_MIN_CLEAR]) {
        if ((prev.clear - th) * (r.clear - th) >= 0) continue;
        let a = prev.s, b = r.s;
        const up = prev.clear < th;
        for (let k = 0; k < 30; k++) {
          const m = (a + b) / 2;
          if ((row(m).clear < th) === up) a = m; else b = m;
        }
        const x = row((a + b) / 2);
        x.clear = th;
        // Keep rows sorted when both thresholds fall in one interval.
        let at = rows.length;
        while (at > 0 && rows[at - 1].s > x.s) at--;
        rows.splice(at, 0, x);
      }
    }
    rows.push(r);
  }
  return rows;
}

/**
 * Concrete barrier along both deck edges on the sidewalk's outer edge: 0.14
 * tile (≈1.1 m) visible above the carriageway (top at deck + ROAD_LIFT +
 * 0.14), 0.03 cap, both faces; it fades to nothing on the ramps so the mouth
 * is open at grade. Under each edge the outer face continues down: a 0.12
 * fascia plus the underside where the deck clears the ground by > 0.2, and a
 * retaining face to just below the ground on the ramps below that, so the
 * approach reads as filled and the span as a slab. The slab's end face at the
 * ramp also reaches the ground. All PLAIN class.
 */
function bridgeStructure(g: Geo, type: RoadType, deck: DeckSampler, groundY: GroundY): void {
  const edge = sidewalkEdge(type);
  const rows = deckRows(deck, groundY);
  const hi = g.colorFor(CONCRETE), lo = g.colorFor(CONCRETE_LOW), under = g.colorFor(SLAB_UNDER);
  const v = (r: DeckRow, side: number, off: number, y: number, c: THREE.Color): number =>
    g.vertFast(r.x - r.dz * side * off, y, r.z + r.dx * side * off, c, undefined, ROAD_CLASS.PLAIN);
  const rise = ROAD_LIFT + BRIDGE_BARRIER_H - BARRIER_BASE;
  const fade = (clear: number): number => {
    const u = Math.max(0, Math.min(1, (clear - BARRIER_OPEN) / (BARRIER_FULL - BARRIER_OPEN)));
    return rise * u * u * (3 - 2 * u);
  };
  /** Strip between consecutive rows; a zero-height end collapses to one triangle (no slivers). */
  const strip = (a: DeckRow, b: DeckRow, lowV: (r: DeckRow) => number, highV: (r: DeckRow) => number, flatA = false, flatB = false): void => {
    const a0 = lowV(a), b0 = lowV(b);
    const a1 = flatA ? a0 : highV(a), b1 = flatB ? b0 : highV(b);
    if (!flatA) g.tri(a0, b0, a1);
    if (!flatB) g.tri(a1, b0, b1);
  };
  const slab = (r: DeckRow): boolean => r.clear >= SLAB_MIN_CLEAR - 1e-9;
  const foot = (r: DeckRow): number => r.y - r.clear - 0.02; // just below the ground
  const base = (r: DeckRow): number => r.y + BARRIER_BASE;
  for (const side of [-1, 1] as const) {
    const inner = edge - BARRIER_CAP;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      const ha = fade(a.clear), hb = fade(b.clear);
      if (ha > 1e-6 || hb > 1e-6) {
        const top = (r: DeckRow): number => base(r) + fade(r.clear);
        const fa = ha <= 1e-6, fb = hb <= 1e-6;
        strip(a, b, (r) => v(r, side, inner, base(r), lo), (r) => v(r, side, inner, top(r), hi), fa, fb);
        strip(a, b, (r) => v(r, side, edge, base(r), hi), (r) => v(r, side, edge, top(r), hi), fa, fb);
        strip(a, b, (r) => v(r, side, inner, top(r), hi), (r) => v(r, side, edge, top(r), hi));
      }
      if (slab(a) && slab(b)) {
        strip(a, b, (r) => v(r, side, edge, r.y - BRIDGE_SLAB_DEPTH, lo), (r) => v(r, side, edge, base(r), hi));
      } else if (Math.max(a.clear, b.clear) > 1e-6) {
        // Ramp: retaining face from just below the ground to the deck edge.
        strip(a, b, (r) => v(r, side, edge, foot(r), lo), (r) => v(r, side, edge, base(r), hi));
      }
    }
  }
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (!slab(a) || !slab(b)) continue;
    strip(a, b, (r) => v(r, -1, edge, r.y - BRIDGE_SLAB_DEPTH, under), (r) => v(r, 1, edge, r.y - BRIDGE_SLAB_DEPTH, under));
  }
  // End faces where a slab run starts or stops. Toward a ramp it reaches the
  // ground (no gap under the slab end); at a deck end it is the slab depth.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!slab(r)) continue;
    const prevRamp = i > 0 && !slab(rows[i - 1]), nextRamp = i < rows.length - 1 && !slab(rows[i + 1]);
    const runEdge = i === 0 || i === rows.length - 1 || prevRamp || nextRamp;
    if (!runEdge) continue;
    const y0 = prevRamp || nextRamp ? foot(r) : r.y - BRIDGE_SLAB_DEPTH;
    const a0 = v(r, -1, edge, y0, lo), a1 = v(r, -1, edge, base(r), hi);
    const b0 = v(r, 1, edge, y0, lo), b1 = v(r, 1, edge, base(r), hi);
    g.tri(a0, b0, a1);
    g.tri(a1, b0, b1);
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
    box(g, cx, cz, base, 0.36, top - base, 0.36, 0, PILLAR, PILLAR_LOW);
  }
}

/** Dark ribbon under the deck (water or the road below), so the crossing reads from far away. */
function deckShadow(g: Geo, type: RoadType, deck: DeckSampler, groundY: GroundY, w?: World): void {
  const hw = sidewalkEdge(type) + 0.2;
  const n = Math.max(1, Math.ceil(deck.length / 0.5));
  const shade = g.colorFor(DECK_SHADOW);
  let prev: [number, number] | null = null;
  for (let i = 0; i <= n; i++) {
    const s = (deck.length * i) / n;
    const p = deck.pos(s);
    const tx = Math.floor(p.x), ty = Math.floor(p.z);
    const overRoad = !!w && tx >= 0 && ty >= 0 && tx < w.size && ty < w.size && w.roadSurface[ty * w.size + tx] !== 0;
    const gy = groundY(p.x, p.z);
    // Never over a road: an opaque strip there hid the markings below. The
    // shadow only marks the crossing over water.
    if (overRoad || gy > 0.08) { prev = null; continue; }
    // Only under the raised deck: on the ramps the "road below" is the
    // bridge's own carriageway, which a shadow would paint over.
    if (deck.yAt(s) - gy < SLAB_MIN_CLEAR + BRIDGE_SLAB_DEPTH) { prev = null; continue; }
    const shadowY = 0.05;
    const q = deck.pos(Math.min(deck.length, s + 0.05));
    let dx = q.x - p.x, dz = q.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    // Flat dark tint (PLAIN): no asphalt detail, so no gravel patch below.
    const cur: [number, number] = [
      g.vertFast(p.x - dz * hw, shadowY, p.z + dx * hw, shade, undefined, ROAD_CLASS.PLAIN),
      g.vertFast(p.x + dz * hw, shadowY, p.z - dx * hw, shade, undefined, ROAD_CLASS.PLAIN),
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
  box(g, m.x + px * post, m.z + pz * post, gy - 0.1, 0.36, 1.7, 0.6, yaw, CONCRETE, CONCRETE_LOW);
  box(g, m.x - px * post, m.z - pz * post, gy - 0.1, 0.36, 1.7, 0.6, yaw, CONCRETE, CONCRETE_LOW);
  box(g, m.x, m.z, gy + 1.25, 2 * (hw + 0.48), 0.35, 0.6, yaw, CONCRETE);
  // The opening sits just inside the mouth so the lintel frames it.
  const ix = m.x - dx * 0.05, iz = m.z - dz * 0.05;
  const ow = hw + 0.1;
  const dark = g.colorFor(PORTAL_DARK);
  const a = g.vertFast(ix + px * ow, gy + 1.28, iz + pz * ow, dark, undefined, ROAD_CLASS.PLAIN);
  const b = g.vertFast(ix - px * ow, gy + 1.28, iz - pz * ow, dark, undefined, ROAD_CLASS.PLAIN);
  const c = g.vertFast(ix - px * ow, gy + 0.02, iz - pz * ow, dark, undefined, ROAD_CLASS.PLAIN);
  const d = g.vertFast(ix + px * ow, gy + 0.02, iz + pz * ow, dark, undefined, ROAD_CLASS.PLAIN);
  g.tri(a, b, c);
  g.tri(a, c, d);
}

// ---------------------------------------------------------------- network

/** Zebra crossing and inbound-only stop line at an asphalt mouth. */
function zebra(
  g: Geo, cx: number, cz: number, dx: number, dz: number,
  halfWidth: number, trim: number, stopSides: readonly [number, number] | null,
  groundY: GroundY, atlas = false,
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
      MARK_LIFT, groundY, ROAD_CLASS.CROSSWALK);
    if (stopSides) {
      const bx = cx + dx * (trim + 0.38), bz = cz + dz * (trim + 0.38);
      const b = (along: number, side: number) => ({ x: bx + dx * along + px * side, z: bz + dz * along + pz * side });
      g.texQuad([b(-0.02, stopSides[0]), b(-0.02, stopSides[1]), b(0.02, stopSides[1]), b(0.02, stopSides[0])],
        MARK_LIFT, groundY, ROAD_CLASS.STOP_BAR);
    }
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
      MARK_LIFT, ZEBRA, groundY,
    );
  }
  if (stopSides) {
    const lx = cx + dx * (trim + 0.38), lz = cz + dz * (trim + 0.38);
    g.quad(
      lx + px * stopSides[0] + dx * 0.02, lz + pz * stopSides[0] + dz * 0.02,
      lx + px * stopSides[1] + dx * 0.02, lz + pz * stopSides[1] + dz * 0.02,
      lx + px * stopSides[1] - dx * 0.02, lz + pz * stopSides[1] - dz * 0.02,
      lx + px * stopSides[0] - dx * 0.02, lz + pz * stopSides[0] - dz * 0.02,
      MARK_LIFT, ZEBRA, groundY,
    );
  }
}

/**
 * Lane lines through a taper pad (lead's gate: the pad read as a blank plate).
 * In the wide arm's outward frame, lateral lerps from the wide arm's value at
 * s = L to the narrow arm's at s = 0:
 *  - dashed boundaries between consecutive kept lanes of one direction
 *    (left-aligned: kept wide lanes map in order onto the narrow lanes);
 *  - for two-way roads, the dashed direction separator (wide centre -> narrow
 *    centre), starting past a planted/barrier median's nose;
 *  - solid edge lines along each tapering edge where a profile has a shoulder.
 * Dropped/added lanes are the wide-only lanes; their own boundary dashes are
 * drawn by drawTaperMarks. Each quad must fit inside the ring, else skipped.
 */
function taperLaneLines(
  l: JunctionLayout, arm: JunctionLayout["arms"][number], L: number,
  at: (s: number, lat: number) => Pt, fits: (q: Pt[]) => boolean, emit: (q: Pt[]) => void,
  diags: string[], w: World,
): void {
  const taper = l.taper!;
  const narrow = l.arms[1 - taper.wideArm];
  if (!narrow) return;
  const pw = profileOf(arm.type), pn = profileOf(narrow.type);
  const seg = w.segments.find((sg) => sg.id === arm.segId);
  const oneWay = seg?.oneWay ?? specOf(arm.type).oneWay;
  const wideOnly = [...taper.droppedLanes, ...taper.addedLanes].map((d) => d.offset);
  const kept = pw.laneCentres.filter((c) => !wideOnly.some((o) => Math.abs(o - c) < 1e-6));
  const groups: [number[], number[]][] = oneWay
    ? [[kept, [...pn.laneCentres]]]
    : [[kept.filter((c) => c < 0), pn.laneCentres.filter((c) => c < 0)], [kept.filter((c) => c > 0), pn.laneCentres.filter((c) => c > 0)]];
  const HALF = 0.012, DASH = 0.25;
  const line = (latW: number, latN: number, s0: number, s1: number, dashed: boolean): void => {
    const lat = (s: number): number => latN + (latW - latN) * (s / L);
    const step = dashed ? DASH * 2 : DASH;
    // Stay clear of the two mouth edges (the ring's across lines).
    s0 = Math.max(s0, 0.03); s1 = Math.min(s1, L - 0.03);
    for (let a = s1; a > s0 + 1e-6; a -= step) {
      const b = Math.max(s0, a - DASH);
      if (a - b < 0.05) continue;
      const q = [at(b, lat(b) - HALF), at(b, lat(b) + HALF), at(a, lat(a) + HALF), at(a, lat(a) - HALF)];
      if (fits(q)) emit(q);
      else diags.push(`taper-mark-skipped: node ${l.nodeId} lane line at ${lat((a + b) / 2).toFixed(3)}`);
    }
  };
  for (const [kw, kn] of groups) {
    const ws = [...kw].sort((a, b) => a - b), ns = [...kn].sort((a, b) => a - b);
    if (ws.length !== ns.length) continue;
    for (let j = 0; j + 1 < ws.length; j++) line((ws[j] + ws[j + 1]) / 2, (ns[j] + ns[j + 1]) / 2, 0, L, true);
  }
  if (!oneWay && pn.medianHalf <= 0) {
    const nose = pw.median === "planted" || pw.median === "barrier" ? pw.medianHalf : 0;
    line(0, 0, 0, L - nose - 0.05, true);
  }
  if (pw.shoulder > 0 || pn.shoulder > 0) {
    for (const side of [-1, 1]) {
      line(side * (pw.asphaltHalf - pw.shoulder), side * (pn.asphaltHalf - pn.shoulder), 0, L, false);
    }
  }
}

/** True when p is inside the ring and at least `margin` from every ring edge. */
function insideWithMargin(p: Pt, ring: Pt[], margin: number): boolean {
  if (!pointInPolygon(p, ring)) return false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    if (Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z) < margin) return false;
  }
  return true;
}

/**
 * Merge arrows and dropped-lane edge dashes, all within the taper pad.
 * `droppedLanes` offsets/sides are already in the wide arm's outward frame
 * (lateral +1 = (-dz, dx)); the kept lanes sit on +perp, the left of travel
 * (travel runs toward the node, -arm direction). A mark that does not fit
 * inside the ring, even slid toward the kept lane by half a lane, is skipped
 * and reported in `diags` instead of being drawn outside the pad.
 */
function drawTaperMarks(g: Geo, l: JunctionLayout, groundY: GroundY, diags: string[], w: World): void {
  const taper = l.taper!;
  const arm = l.arms[taper.wideArm];
  const L = taper.length;
  const lw = profileOf(arm.type).laneWidth;
  const MARGIN = 0.01, STEP = 0.005;
  const px = -arm.dz, pz = arm.dx;               // +perp: toward the kept lanes
  const at = (s: number, lat: number): Pt => ({
    x: l.centre.x + arm.dx * s + px * lat,
    z: l.centre.z + arm.dz * s + pz * lat,
  });
  const fits = (q: Pt[]): boolean => q.every((p) => insideWithMargin(p, l.asphalt, MARGIN));
  // Arrow: along travel, bent toward +perp (left of travel, the kept lane).
  const tx = -arm.dx + px * 0.35, tz = -arm.dz + pz * 0.35;
  const tl = Math.hypot(tx, tz);
  const ux = tx / tl, uz = tz / tl, nx = -uz, nz = ux;
  const arrowAt = (s: number, lat: number): Pt[] => {
    const c = at(s, lat);
    const q = (a: number, b: number): Pt => ({ x: c.x + ux * a + nx * b, z: c.z + uz * a + nz * b });
    return [q(-0.3, -0.12), q(-0.3, 0.12), q(0.3, 0.12), q(0.3, -0.12)];
  };
  /** Station/lateral box of a quad (arm frame), for arrow-arrow overlap. */
  const box = (q: Pt[]): [number, number, number, number] => {
    let s0 = Infinity, s1 = -Infinity, l0 = Infinity, l1 = -Infinity;
    for (const p of q) {
      const rx = p.x - l.centre.x, rz = p.z - l.centre.z;
      const s = rx * arm.dx + rz * arm.dz, lat = rx * px + rz * pz;
      s0 = Math.min(s0, s); s1 = Math.max(s1, s); l0 = Math.min(l0, lat); l1 = Math.max(l1, lat);
    }
    return [s0, s1, l0, l1];
  };
  const placed: [number, number, number, number][] = [];
  const clear = (q: Pt[]): boolean => {
    const [a0, a1, b0, b1] = box(q);
    return placed.every(([c0, c1, d0, d1]) => a1 + 0.02 < c0 || c1 + 0.02 < a0 || b1 + 0.02 < d0 || d1 + 0.02 < b0);
  };
  taperLaneLines(l, arm, L, at, fits, (q) => {
    const [a, b, c, e] = q;
    g.quad(a.x, a.z, b.x, b.z, c.x, c.z, e.x, e.z, MARK_LIFT, LINE, groundY);
  }, diags, w);
  // Outermost dropped lane first: it needs the widest station.
  const dropped = [...taper.droppedLanes].sort((a, b) => a.offset - b.offset);
  for (const d of dropped) {
    let arrow: Pt[] | null = null;
    for (const f of [0.6, 0.75, 0.88]) {
      const s = Math.min(L * f, L - 0.35);
      for (let slide = 0; slide <= lw * 0.5 + 1e-9 && !arrow; slide += STEP) {
        const q = arrowAt(s, d.offset + slide);
        if (fits(q) && clear(q)) arrow = q;
      }
      if (arrow) break;
    }
    if (arrow) {
      placed.push(box(arrow));
      g.texQuad(arrow, MARK_LIFT, groundY, ROAD_CLASS.ARROW);
    } else {
      diags.push(`taper-mark-skipped: node ${l.nodeId} arrow lane ${d.offset.toFixed(4)}`);
    }

    // Three short dashes on the dropped lane's kept-side edge toward the seam.
    for (let k = 0; k < 3; k++) {
      const s0 = L * (0.1 + k * 0.3), s1 = s0 + 0.15;
      const dashAt = (edge: number): Pt[] =>
        [at(s0, edge - 0.012), at(s0, edge + 0.012), at(s1, edge + 0.012), at(s1, edge - 0.012)];
      let dash: Pt[] | null = null;
      const edge = d.offset + 0.5 * lw;
      for (let slide = 0; slide <= lw * 0.5 + 1e-9 && !dash; slide += STEP) {
        const q = dashAt(edge + slide);
        if (fits(q)) dash = q;
      }
      if (!dash) {
        diags.push(`taper-mark-skipped: node ${l.nodeId} dash ${k} lane ${d.offset.toFixed(4)}`);
        continue;
      }
      const [a, b, c, e] = dash;
      g.quad(a.x, a.z, b.x, b.z, c.x, c.z, e.x, e.z, MARK_LIFT, LINE, groundY);
    }
  }
}

/**
 * Gore paint triangle of a merge/diverge layout: the node gore-side corner O,
 * the follows-arm mouth gore-side point F1, and the ramp mouth far corner R1.
 * Null when the layout carries no usable gore mouths.
 */
export function goreTriangle(l: JunctionLayout): [Pt, Pt, Pt] | null {
  const gore = l.gore;
  if (!gore || (l.kind !== "merge" && l.kind !== "diverge")) return null;
  const follows = l.arms.find((a) => a.type === 3 && (a.trimNeg.asphalt > 0 || a.trimPos.asphalt > 0));
  const ramp = l.arms[gore.rampArm];
  const mouth = follows?.mouth?.asphalt;
  const rampMouth = ramp?.mouth?.asphalt;
  if (!follows || !mouth || !rampMouth) return null;
  const F1 = mouth.neg.s >= mouth.pos.s ? mouth.neg.p : mouth.pos.p;
  const goreLocal = follows.trimPos.asphalt > 0 ? 1 : -1;
  const px = -follows.dz, pz = follows.dx;
  const gated = l.asphalt.filter((v) =>
    ((v.x - l.centre.x) * px + (v.z - l.centre.z) * pz) * goreLocal > 0);
  if (gated.length === 0) return null;
  const O = gated.sort((a, b) =>
    Math.hypot(a.x - l.centre.x, a.z - l.centre.z) - Math.hypot(b.x - l.centre.x, b.z - l.centre.z))[0];
  const corners = [rampMouth.neg.p, rampMouth.pos.p].sort((a, b) =>
    Math.hypot(a.x - F1.x, a.z - F1.z) - Math.hypot(b.x - F1.x, b.z - F1.z));
  return [O, F1, corners[1]!];
}

const GORE_WHITE = "#ffffff";

/**
 * Gore paint for a merge/diverge layout, both tiers: solid edge lines along
 * both gore edges from the nose to the node, three chevrons inside the gore
 * triangle, and a dashed line (0.3 on / 0.3 off) along the ramp-side outer
 * lane boundary over gore.length. All white at MARK_LIFT, every mark clipped
 * to the gore pad.
 */
function drawGoreMarks(g: Geo, l: JunctionLayout, groundY: GroundY): void {
  const tri = goreTriangle(l);
  const gore = l.gore;
  if (!tri || !gore || l.asphalt.length < 3) return;
  const [O, F1, R1] = tri;
  const c = g.colorFor(GORE_WHITE);
  const barCorners = (a: Pt, b: Pt, halfW: number): [Pt, Pt, Pt, Pt] | null => {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 1e-6) return null;
    const nx = (-dz / len) * halfW, nz = (dx / len) * halfW;
    return [
      { x: a.x + nx, z: a.z + nz }, { x: a.x - nx, z: a.z - nz },
      { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz },
    ];
  };
  const emitBar = (q: [Pt, Pt, Pt, Pt]): void => {
    const v0 = g.vertFast(q[0].x, groundY(q[0].x, q[0].z) + MARK_LIFT, q[0].z, c);
    const v1 = g.vertFast(q[1].x, groundY(q[1].x, q[1].z) + MARK_LIFT, q[1].z, c);
    const v2 = g.vertFast(q[2].x, groundY(q[2].x, q[2].z) + MARK_LIFT, q[2].z, c);
    const v3 = g.vertFast(q[3].x, groundY(q[3].x, q[3].z) + MARK_LIFT, q[3].z, c);
    g.tri(v0, v1, v2);
    g.tri(v1, v3, v2);
  };
  const quad = (a: Pt, b: Pt, halfW: number, margin: number): void => {
    const q = barCorners(a, b, halfW);
    if (!q || !q.every((p) => insideWithMargin(p, l.asphalt, margin))) return;
    emitBar(q);
  };
  const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  // Follows-side edge: on the pad boundary, so inset it just inside the pad.
  const ex = O.x - F1.x, ez = O.z - F1.z, eLen = Math.hypot(ex, ez) || 1;
  let inx = -ez / eLen, inz = ex / eLen;
  if (!pointInPolygon({ x: (O.x + F1.x) / 2 + inx * 0.04, z: (O.z + F1.z) / 2 + inz * 0.04 }, l.asphalt)) {
    inx = -inx; inz = -inz;
  }
  const edge1 = [F1, O].map((p) => ({ x: p.x + inx * 0.04, z: p.z + inz * 0.04 }));
  const segs1 = Math.max(1, Math.ceil(Math.hypot(F1.x - O.x, F1.z - O.z)));
  for (let k = 0; k < segs1; k++) {
    quad(lerp(edge1[0], edge1[1], k / segs1), lerp(edge1[0], edge1[1], (k + 1) / segs1), 0.02, 0.012);
  }
  // Ramp-side edge: chord from the ramp mouth near corner to the node corner,
  // kept runs only where the chord stays inside the pad.
  const ramp = l.arms[gore.rampArm]!;
  const near = [ramp.mouth!.asphalt!.neg.p, ramp.mouth!.asphalt!.pos.p].sort((a, b) =>
    Math.hypot(a.x - F1.x, a.z - F1.z) - Math.hypot(b.x - F1.x, b.z - F1.z))[0]!;
  const segs2 = Math.max(1, Math.ceil(Math.hypot(near.x - O.x, near.z - O.z) / 0.25));
  for (let k = 0; k < segs2; k++) {
    quad(lerp(near, O, k / segs2), lerp(near, O, (k + 1) / segs2), 0.02, 0.012);
  }
  // Three chevrons between the node corner and the nose, apexes toward the
  // nose. Mouth-based spans assumed the short old triangle; the fixed ring
  // stretches it until half of every V clips away, so each span shrinks to
  // fit the ring and both bars draw only when both fit (never a half-V).
  const axisLen = Math.hypot(near.x - O.x, near.z - O.z) || 1;
  const ax = (near.x - O.x) / axisLen, az = (near.z - O.z) / axisLen;
  let px = -az, pz = ax;
  if ((R1.x - O.x) * px + (R1.z - O.z) * pz < 0) { px = -px; pz = -pz; }
  for (const t of [0.25, 0.5, 0.75]) {
    const cx = O.x + ax * axisLen * t, cz = O.z + az * axisLen * t;
    const reach = 0.13, barHalf = 0.0175;
    for (let span = 0.25; span >= 0.06; span *= 0.75) {
      const A = { x: cx + ax * reach, z: cz + az * reach };
      const E1 = { x: cx - ax * reach - px * span, z: cz - az * reach - pz * span };
      const E2 = { x: cx - ax * reach + px * span, z: cz - az * reach + pz * span };
      const q1 = barCorners(A, E1, barHalf), q2 = barCorners(A, E2, barHalf);
      if (q1 && q2 && [...q1, ...q2].every((p) => insideWithMargin(p, l.asphalt, 0))) {
        emitBar(q1);
        emitBar(q2);
        break;
      }
    }
  }
  // Dashed outer-lane boundary over gore.length, clipped to the pad.
  const follows = l.arms.find((a) => a.type === 3 && (a.trimNeg.asphalt > 0 || a.trimPos.asphalt > 0))!;
  const centres = profileOf(3).laneCentres.filter((v) => (v > 0) === (gore.side > 0)).sort((a, b) => a - b);
  const outer = gore.side > 0 ? centres.slice(-2) : centres.slice(0, 2);
  const boundary = (outer[0]! + outer[1]!) / 2;
  const armOff = (follows.end === "a" ? 1 : -1) * gore.side * boundary;
  const at = (s: number): Pt => ({
    x: l.centre.x + follows.dx * s + (-follows.dz) * armOff,
    z: l.centre.z + follows.dz * s + follows.dx * armOff,
  });
  for (let a = 0.15; a < gore.length; a += 0.6) {
    quad(at(a), at(Math.min(gore.length, a + 0.3)), 0.012, 0.008);
  }
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
        MARK_LIFT + 0.002, LINE, groundY);
    }
  }
}

/**
 * One atlas arrow per inbound lane with an allowed movement.  The atlas arrow
 * points along the local +along direction, which is deliberately the travel
 * direction (back from an arm toward the junction).  Keeping this here, next
 * to the stop bars, makes the decal share their node lift and avoids a second
 * mesh or per-frame instances.
 */
function junctionLaneArrows(g: Geo, l: JunctionLayout, groundY: GroundY): void {
  for (const arrow of l.laneArrows) {
    if (!arrow.turns.length) continue;
    const arm = l.arms[arrow.arm];
    if (!arm || arm.markingsSuppressed || !specOf(arm.type).junctionMarkings) continue;
    // Connector paths and decals must use the same segment-to-arm conversion.
    const off = inboundArmOffset(arm, arrow.lane);
    if (off === undefined) continue;
    const trim = Math.max(arm.trimNeg.asphalt, arm.trimPos.asphalt);
    // 0.6 t before the stop bar (whose centre is trim + 0.38 t), per 12 §3.5.
    const cx = l.centre.x + arm.dx * (trim + 0.98) - arm.dz * off;
    const cz = l.centre.z + arm.dz * (trim + 0.98) + arm.dx * off;
    const dx = -arm.dx, dz = -arm.dz; // inbound travel direction
    const px = -dz, pz = dx;
    const along = 0.11, wide = Math.min(0.14, profileOf(arm.type).laneWidth * 0.36);
    // Painted arrows are vertex-coloured polygons: the atlas arrow cell is opaque
    // and showed up as a tan square on the junction asphalt.
    const tris: [Pt, Pt, Pt][] = [];
    const turns = arrow.turns.filter((t) => t !== "uturn");
    const nT = Math.max(1, turns.length);
    turns.forEach((turn, k) => {
      const lat = (k - (nT - 1) / 2) * (wide * 1.25);
      const ang = turn === "left" ? 0.62 : turn === "right" ? -0.62 : 0;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // local frame: a along inbound travel, s lateral; rotate the head by ang
      const q = (a: number, s: number): Pt => {
        const ra = a * ca - s * sa, rs = a * sa + s * ca;
        return { x: cx + dx * ra + px * (rs + lat), z: cz + dz * ra + pz * (rs + lat) };
      };
      const sw = 0.018, headLen = along * 0.8, headW = wide * 0.5;
      // shaft
      tris.push([q(-along, -sw), q(-along, sw), q(along - headLen, sw)]);
      tris.push([q(-along, -sw), q(along - headLen, sw), q(along - headLen, -sw)]);
      // head
      tris.push([q(along - headLen, -headW), q(along - headLen, headW), q(along, 0)]);
    });
    if (tris.length) emitTris(g, tris, MARK_LIFT + 0.002, "#e9e4d4", groundY);
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
 * kerbOuter→sidewalkOuter in the ribbon kerb material. Pad and ribbon share
 * one lift per layer (asphalt ROAD_LIFT, bands KERB_LIFT); ribbons start on
 * each ring's across-mouth edge, so the two never overlap at one height. When
 * a band has no valid triangulation (degenerate input), the full outer ring
 * is stacked just below the asphalt instead.
 */
/**
 * Rounded nose where a planted or barrier median ends at a pad mouth: a
 * half-disc of radius medianHalf (8 segments) from the mouth line into the
 * pad, instead of the ribbon's square cut. Just under the markings.
 */
function medianNoses(g: Geo, l: JunctionLayout, groundY: GroundY, atlas: boolean): void {
  if (l.asphalt.length < 3) return;
  // At a merge/diverge the barrier ends in a cap before the gore pad; no nose.
  if (l.kind === "merge" || l.kind === "diverge") return;
  const SEG = 8;
  for (const arm of l.arms) {
    const prof = profileOf(arm.type);
    if (prof.medianHalf <= 0 || (prof.median !== "planted" && prof.median !== "barrier")) continue;
    const M = arm.mouth?.asphalt?.centre ?? Math.max(arm.trimNeg.asphalt, arm.trimPos.asphalt);
    const r = prof.medianHalf, px = -arm.dz, pz = arm.dx;
    const cx = l.centre.x + arm.dx * M, cz = l.centre.z + arm.dz * M;
    const col = g.colorFor(atlas ? (prof.median === "planted" ? ATLAS_MEDIAN : CONCRETE) : prof.median === "planted" ? MEDIAN : HW_EDGE);
    const cls = atlas ? ROAD_CLASS.PLAIN : ROAD_CLASS.FLAT;
    const y = MARK_LIFT - 0.002;
    const c = g.vertFast(cx, groundY(cx, cz) + y, cz, col, undefined, cls);
    let prev = -1;
    for (let k = 0; k <= SEG; k++) {
      const t = (Math.PI * k) / SEG; // +perp -> toward the node -> -perp
      const x = cx + r * (Math.cos(t) * px - Math.sin(t) * arm.dx);
      const z = cz + r * (Math.cos(t) * pz - Math.sin(t) * arm.dz);
      const v = g.vertFast(x, groundY(x, z) + y, z, col, undefined, cls);
      if (prev >= 0) g.tri(c, prev, v);
      prev = v;
    }
  }
}

type Tri2 = [Pt, Pt, Pt];
type MouthLayerName = "asphalt" | "kerb" | "sidewalk";

/**
 * Band between two nested layer rings, split into one piece per corner. The
 * junction gives every layer ring the same across-mouth station, so the band
 * pinches to zero width at each mouth; triangulating the corner pieces
 * (inner chain + reversed outer chain) keeps band geometry off the
 * carriageway. Null when the rings cannot be split at matching mouth points
 * (the caller then uses the whole-ring band).
 */
function cornerBand(l: JunctionLayout, inner: Pt[], outer: Pt[], innerL: MouthLayerName, outerL: MouthLayerName): Tri2[] | null {
  const breaks = (ring: Pt[], layer: MouthLayerName): Map<number, string> | null => {
    const out = new Map<number, string>();
    l.arms.forEach((arm, ai) => {
      const m = arm.mouth?.[layer];
      if (!m) return;
      for (const [side, ms] of [["n", m.neg], ["p", m.pos]] as const) {
        const k = ring.findIndex((r) => Math.abs(r.x - ms.p.x) < 1e-9 && Math.abs(r.z - ms.p.z) < 1e-9);
        if (k >= 0 && !out.has(k)) out.set(k, `${ai}${side}`);
      }
    });
    return out.size >= 2 && out.size % 2 === 0 ? out : null;
  };
  const bi = breaks(inner, innerL), bo = breaks(outer, outerL);
  if (!bi || !bo || bi.size !== bo.size) return null;
  /** Chains between consecutive break vertices, keyed "from>to". */
  const chains = (ring: Pt[], b: Map<number, string>): { key: string; pts: Pt[] }[] => {
    const idx = [...b.keys()].sort((x, y) => x - y);
    return idx.map((from, k) => {
      const to = idx[(k + 1) % idx.length];
      const pts: Pt[] = [];
      for (let i = from; ; i = (i + 1) % ring.length) { pts.push(ring[i]); if (i === to) break; }
      return { key: `${b.get(from)}>${b.get(to)}`, pts };
    });
  };
  const ci = chains(inner, bi), co = chains(outer, bo);
  // Across edges and corner chains alternate; the across phase is the one
  // whose chains are all single edges.
  const phase = [0, 1].find((ph) => ci.every((c, k) => (k % 2 !== ph) || c.pts.length === 2));
  if (phase === undefined) return null;
  const out: Tri2[] = [];
  for (let k = 0; k < ci.length; k++) {
    if (k % 2 === phase) continue;
    const a = ci[k], b = co.find((c) => c.key === a.key);
    if (!b) return null;
    const poly = [...a.pts, ...b.pts.slice().reverse()];
    const tris = triangulateRing(poly);
    if (tris.length === 0) return null;
    out.push(...tris);
  }
  return out;
}

const bandCache = new WeakMap<JunctionLayout, { kerb: Tri2[] | null; walk: Tri2[] | null }>();

/** Pad kerb and sidewalk band triangles (per corner when possible), cached per layout. */
export function padBandTriangles(l: JunctionLayout): { kerb: Tri2[] | null; walk: Tri2[] | null } {
  // Layouts are cached by junctionsOf, so per-corner bands are too.
  let bands = bandCache.get(l);
  if (!bands) {
    const kerb = l.kerbOuter.length >= 3 ? l.kerbOuter : null;
    const walk = l.sidewalkOuter.length >= 3 ? l.sidewalkOuter : null;
    bands = {
      kerb: kerb ? cornerBand(l, l.asphalt, kerb, "asphalt", "kerb") ?? triangulateBand(l.asphalt, kerb) : null,
      walk: kerb && walk ? cornerBand(l, kerb, walk, "kerb", "sidewalk") ?? triangulateBand(kerb, walk) : null,
    };
    bandCache.set(l, bands);
  }
  return bands;
}

function drawJunctionPatch(g: Geo, l: JunctionLayout, groundY: GroundY, atlas = false): void {
  if (l.asphalt.length < 3) return;
  const bandLift = KERB_LIFT;
  const fallbackLift = ROAD_LIFT - 0.004;
  const kerb = l.kerbOuter.length >= 3 ? l.kerbOuter : null;
  const walk = l.sidewalkOuter.length >= 3 ? l.sidewalkOuter : null;
  const bands = padBandTriangles(l);
  // Atlas tier: the ribbon bands come from the road textures, so the pad
  // bands take the textures' kerb/sidewalk mean in the flat PLAIN class
  // (the vertex-colour KERB path read brighter). Low tier: KERB as the ribbons.
  const bandCol = atlas ? ATLAS_SIDEWALK : KERB;
  const bandCls = atlas ? ROAD_CLASS.PLAIN : ROAD_CLASS.FLAT;
  if (kerb) {
    if (bands.kerb) emitTris(g, bands.kerb, bandLift, bandCol, groundY, undefined, bandCls);
    else emitTris(g, triangulateRing(kerb), fallbackLift, bandCol, groundY, undefined, bandCls);
  }
  if (kerb && walk) {
    if (bands.walk) emitTris(g, bands.walk, bandLift, bandCol, groundY, undefined, bandCls);
    else emitTris(g, triangulateRing(walk), fallbackLift, bandCol, groundY, undefined, bandCls);
  }
  const patchCol = atlas ? "#ffffff" : ASPHALT;
  const patchCls = atlas ? ROAD_CLASS.JUNCTION : ROAD_CLASS.FLAT;
  const uvOf = atlas ? (p: Pt): [number, number] => [p.x / JUNCTION_TILE, p.z / JUNCTION_TILE_V] : undefined;
  emitTris(g, triangulateRing(l.asphalt), ROAD_LIFT, patchCol, groundY, uvOf, patchCls);
}

/**
 * Barrier stop at a merge/diverge end, from the layout's own gore ring: march
 * the arm outward until the full barrier cross-section clears the pad for a
 * further medianHalf, so the end cap lands outside with margin. The
 * mouth-average stop assumes a steep mouth diagonal; the fixed gore ring (up
 * to 12 long) goes shallow enough to swallow the barrier's half width.
 * Ribbon stations; undefined keeps the default stop (non-gore ends, or a pad
 * the march cannot clear).
 */
function goreBarrierStop(l: JunctionLayout | null, seg: RoadSegment, end: "a" | "b", total: number): number | undefined {
  const gore = l?.gore;
  if (!gore || (l.kind !== "merge" && l.kind !== "diverge")) return undefined;
  if (!l.arms.some((a) => a.segId === seg.id && a.end === end && a.type === 3)) return undefined;
  if (l.asphalt.length < 3) return undefined;
  const medianHalf = profileOf(3).medianHalf;
  const half = Math.max(...JERSEY_PROFILE.map(([off]) => Math.abs(off)));
  const walk = makeWalker(sampleCurve(seg.pts));
  const toRibbon = (a: number): number => (end === "a" ? a : total - a);
  const inside = (a: number): boolean => {
    const f = walk(toRibbon(a));
    for (const off of [-half, 0, half]) {
      if (pointInPolygon({ x: f.x - f.dz * off, z: f.z + f.dx * off }, l.asphalt)) return true;
    }
    return false;
  };
  // The pad reaches gore.length along the arm; a clear span past it always
  // exists on a sane segment (the march limit keeps pathological ones safe).
  // The cap itself keeps medianHalf (0.1) from the pad edge, like plain
  // junctions: the first outside station only touches it.
  const capClear = (a: number): boolean => {
    const f = walk(toRibbon(a));
    for (const [off] of JERSEY_PROFILE) {
      const p = { x: f.x - f.dz * off, z: f.z + f.dx * off };
      if (pointInPolygon(p, l.asphalt) || distToRing(p, l.asphalt) < medianHalf - 1e-9) return false;
    }
    return true;
  };
  const limit = Math.min(total, gore.length + 1);
  for (let a = 0; a <= limit; a += 0.05) {
    if (inside(a)) continue;
    let clear = true;
    for (let b = a + 0.025; b <= a + medianHalf + 1e-9; b += 0.025) {
      if (b > limit || inside(b)) { clear = false; break; }
    }
    if (clear && capClear(a)) return toRibbon(a);
  }
  return undefined;
}

/**
 * Gore notch for the follows arm of a merge/diverge: the fixed ring puts the
 * nose crossing inside the pad span (length ≥ noseStation + 0.5), so the old
 * nose-past-the-mouth trigger can no longer fire. What remains is a curve
 * chord sagging across the mouth just outside it: sample the true outer edge
 * against the ring, and when samples land inside, route via rows through the
 * true edge so the chords clear the pad. Ribbon stations, ribbon side;
 * undefined when the edge already clears (ribbons byte-identical without it).
 */
function goreNotch(l: JunctionLayout | null, seg: RoadSegment, end: "a" | "b", total: number): GoreNotch | undefined {
  if (!l?.gore || (l.kind !== "merge" && l.kind !== "diverge")) return undefined;
  const arm = l.arms.find((a) => a.segId === seg.id && a.end === end);
  if (!arm || arm.type !== 3) return undefined;
  const goreLocal = arm.trimPos.asphalt > 0 ? 1 : arm.trimNeg.asphalt > 0 ? -1 : 0;
  if (goreLocal === 0 || l.asphalt.length < 3) return undefined;
  const mouth = arm.mouth?.asphalt;
  if (!mouth) return undefined;
  const mouthS = Math.max(mouth.neg.s, mouth.pos.s);
  const hw = profileOf(arm.type).asphaltHalf;
  // Ribbon frame: stations from end "a", lateral +1 = (-dz, dx) of a→b.
  const walk = makeWalker(sampleCurve(seg.pts));
  const toRibbonS = (a: number): number => (end === "a" ? a : total - a);
  const ribbonSide = (end === "a" ? goreLocal : -goreLocal) as -1 | 1;
  const edge = (a: number): Pt => {
    const f = walk(toRibbonS(a));
    return { x: f.x - f.dz * ribbonSide * hw, z: f.z + f.dx * ribbonSide * hw };
  };
  let lo = -1, hi = -1;
  const endA = Math.min(total, mouthS + 2);
  for (let a = mouthS + 0.05; a <= endA + 1e-9; a += 0.05) {
    if (pointInPolygon(edge(a), l.asphalt)) { if (lo < 0) lo = a; hi = a; }
  }
  if (lo < 0) return undefined;
  const rows: { s: number; p: Pt }[] = [];
  for (let a = Math.max(mouthS + 0.02, lo - 0.15); a <= hi + 0.15 + 1e-9; a += 0.05) {
    rows.push({ s: toRibbonS(a), p: edge(a) });
  }
  return { side: ribbonSide, rows };
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
  /** Render-side diagnostics (e.g. a taper mark that cannot fit), on geometry.userData.diagnostics. */
  const diags: string[] = [];
  const layouts = junctionsOf(w);
  const layoutOf = (id: number): JunctionLayout | null => layouts.byNode.get(id) ?? null;
  // Ribbon trims for one segment end from its node layout. Layout sides are in
  // the arm's outward frame; the ribbon walks a→b, so end "b" swaps sides.
  // Excluded (bridge/tunnel) arms have no layout arm: their ribbons run to
  // the node centre.
  const trimsFor = (layout: JunctionLayout | null, seg: RoadSegment, end: "a" | "b"):
    Pick<RibbonOpts, "aNeg" | "aPos" | "kNeg" | "kPos" | "sNeg" | "sPos" | "mA"> => {
    const zero = { aNeg: 0, aPos: 0, kNeg: 0, kPos: 0, sNeg: 0, sPos: 0 };
    if (!layout) return zero;
    const arm = layout.arms.find((a) => a.segId === seg.id && a.end === end);
    if (!arm) return zero;
    const neg = end === "a" ? arm.trimNeg : arm.trimPos;
    const pos = end === "a" ? arm.trimPos : arm.trimNeg;
    const prof = profileOf(seg.type);
    const line = (m: JunctionMouthLayer | undefined, R: number, fallback?: MouthLine): MouthLine => {
      if (!m) return fallback ? { nS: fallback.nS, pS: fallback.pS, R } : { nS: 0, pS: 0, R };
      const n = end === "a" ? m.neg : m.pos, p = end === "a" ? m.pos : m.neg;
      return { nS: n.s, pS: p.s, nP: n.p, pP: p.p, R };
    };
    const asphalt = line(arm.mouth?.asphalt, prof.asphaltHalf);
    const band = arm.mouth?.sidewalk
      ? line(arm.mouth.sidewalk, prof.asphaltHalf + prof.kerb + prof.sidewalk)
      : line(arm.mouth?.kerb, prof.asphaltHalf + prof.kerb, asphalt);
    // Inner ring corners that sit on the band's mouth edge (same station) are
    // used verbatim: lerped copies would leave quantisation slivers.
    band.snaps = ([[arm.mouth?.asphalt, prof.asphaltHalf], [arm.mouth?.kerb, prof.asphaltHalf + prof.kerb]] as const)
      .filter(([m]) => m)
      .map(([m, off]) => ({ off, n: end === "a" ? m!.neg : m!.pos, p: end === "a" ? m!.pos : m!.neg }));
    return {
      aNeg: neg.asphalt, aPos: pos.asphalt,
      kNeg: neg.kerb, kPos: pos.kerb,
      sNeg: neg.sidewalk, sPos: pos.sidewalk,
      mA: arm.mouth ? { asphalt, band } : undefined,
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
      mB: tb.mA,
      notchA: goreNotch(la, seg, "a", total),
      notchB: goreNotch(lb, seg, "b", total),
      barrierA: goreBarrierStop(la, seg, "a", total),
      barrierB: goreBarrierStop(lb, seg, "b", total),
    };
    ribbon(g, seg.pts, seg.type, trim, gy, undefined, seg.oneWay ? (seg.dir === -1 ? -1 : 1) : 0, atlas);
    if (deck) {
      bridgeStructure(g, seg.type, deck, groundY);
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
    medianNoses(g, l, groundY, atlas);
    if ((l.kind === "merge" || l.kind === "diverge") && l.gore) drawGoreMarks(g, l, groundY);
    if (l.kind === "taper" && l.taper) drawTaperMarks(g, l, groundY, diags, w);
    if (l.arms.length >= 3) {
      for (const arm of l.arms) {
        const spec = specOf(arm.type);
        if (arm.markingsSuppressed || !spec.junctionMarkings) continue;
        const seg = w.segments.find((candidate) => candidate.id === arm.segId);
        const oneWay = seg?.oneWay ?? spec.oneWay;
        const dir = seg?.dir ?? 1;
        const inbound = arm.end === (dir === 1 ? "b" : "a");
        const halfWidth = profileOf(arm.type).asphaltHalf;
        const stopSides: readonly [number, number] | null = oneWay
          ? inbound ? [-halfWidth, halfWidth] : null
          : [-halfWidth, 0];
        zebra(g, l.centre.x, l.centre.z, arm.dx, arm.dz,
          halfWidth, Math.max(arm.trimNeg.asphalt, arm.trimPos.asphalt),
          stopSides, groundY, atlas);
      }
      // Roundabout ring nodes read as circulation: no straight-through guides.
      const onRing = l.arms.some((arm) => w.segments.find((sg) => sg.id === arm.segId)?.roundabout);
      if (!onRing) junctionGuides(g, l, groundY);
      junctionLaneArrows(g, l, groundY);
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
            MARK_LIFT, ZEBRA, groundY,
          );
        }
      }
    }
  }
  const built = g.build();
  built.userData.diagnostics = diags;
  return built;
}

/** Shortest distance from p to any ring edge. */
function distToRing(p: Pt, ring: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z));
  }
  return best;
}

/** True when p is inside the ring or within `margin` of any ring edge (pad exclusion for lamps). */
function nearPad(p: Pt, ring: Pt[], margin: number): boolean {
  if (pointInPolygon(p, ring)) return true;
  return distToRing(p, ring) < margin;
}

/**
 * Lamp positions for highways and ramps (pure): a twin-arm lamp on the median
 * barrier every 3 tiles per highway segment, and per ramp segment a single
 * lamp at asphaltHalf + 0.15 on the outer (right-of-travel) side every 3
 * tiles. Nothing within 1.0 of a node or inside any junction pad (plus a 0.5
 * margin, so no pole floats on pad asphalt where the barrier is cut). yaw aims
 * the lamp arm over the road (scene rotation.y maps +x to (cos yaw,
 * -sin yaw)); the scene loop adds the twin lamp's second head at yaw + π. y
 * is the mount height: the deck profile on bridge segments, the ground
 * otherwise, plus the barrier top for twins (they stand on the barrier) or
 * the verge lift for singles.
 */
export function highwayLampPositions(w: World): { x: number; z: number; yaw: number; twin: boolean; y: number }[] {
  const out: { x: number; z: number; yaw: number; twin: boolean; y: number }[] = [];
  const barrierTop = ROAD_LIFT + Math.max(...JERSEY_PROFILE.map(([, h]) => h));
  const pads = [...junctionsOf(w).byNode.values()].map((l) => l.asphalt).filter((ring) => ring.length >= 3);
  for (const seg of w.segments) {
    const isHighway = seg.type === 3, isRamp = seg.type === 6;
    if (!isHighway && !isRamp) continue;
    if (segElevation(seg) === "tunnel") continue;
    const samples = sampleCurve(seg.pts);
    const total = samples[samples.length - 1].s;
    if (total < 1) continue;
    const deck = segElevation(seg) === "bridge" ? makeDeckSampler(w, seg.pts) : null;
    const walk = makeWalker(samples);
    for (let s = 1.5; s < total - 0.5; s += 3) {
      const p = walk(s);
      let x = p.x, z = p.z, nx = -p.dz, nz = p.dx;
      const twin = isHighway;
      if (isRamp) {
        // Outer side = right of travel: +offset is right of a→b, flipped for dir -1.
        const side = seg.dir === -1 ? -1 : 1;
        const off = side * (profileOf(6).asphaltHalf + 0.15);
        x = p.x - p.dz * off; z = p.z + p.dx * off;
        nx = side * p.dz; nz = -side * p.dx;
      }
      let near = false;
      for (const node of w.nodes) {
        if (Math.hypot(x - node.x, z - node.z) < 1.0) { near = true; break; }
      }
      if (near) continue;
      let inPad = false;
      for (const ring of pads) {
        if (nearPad({ x, z }, ring, 0.5)) { inPad = true; break; }
      }
      if (inPad) continue;
      const surface = deck ? deck.yAt(s) : heightAt(w, x, z);
      out.push({ x, z, yaw: Math.atan2(-nz, nx), twin, y: surface + (twin ? barrierTop : 0.05) });
    }
  }
  return out;
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
