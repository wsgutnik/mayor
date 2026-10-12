import * as THREE from "three";
import { Pt, RoadType, ROAD_DRAW_WIDTH, World, curvePoints } from "../sim/world";
import { NodeLayout, NodeLayoutArm, halfAsphalt, kerbWidth, nodeById, nodeLayout } from "../sim/roads";

/**
 * Junction road geometry: ribbons stop at the corner offsets and every node
 * gets its own asphalt polygon with kerb fillets, so crossings join without
 * gaps, overlaps or per-segment lift hacks. One lift per layer for the network.
 */
export const ROAD_LIFT = 0.06;
const KERB_LIFT = ROAD_LIFT + 0.006;
const MARK_LIFT = ROAD_LIFT + 0.004;

const ASPHALT = "#3b3f46";
const KERB = "#c4c7cc";
const HW_ASPHALT = "#4a4f57";
const HW_EDGE = "#b8bec6";
const LINE = "#d8d4b0";
const AVE_LINE = "#e8e4c8";
const MEDIAN = "#5f8a4a";
const ZEBRA = "#f1f1ea";

export interface StripSeg {
  type: RoadType;
  pts: Pt[];
  width?: number;
  color?: string;
  lift?: number;
}

class Geo {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  ind: number[] = [];
  /** When set, every vertex takes this colour (build preview tint). */
  force: string | null = null;
  private palette = new Map<string, THREE.Color>();

  vert(x: number, y: number, z: number, color: string): number {
    const key = this.force ?? color;
    let c = this.palette.get(key);
    if (!c) {
      c = new THREE.Color(key);
      this.palette.set(key, c);
    }
    const vi = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.col.push(c.r, c.g, c.b);
    this.uv.push(x / 0.6, z / 0.6);
    return vi;
  }

  tri(a: number, b: number, c: number): void {
    this.ind.push(a, b, c);
  }

  /** Flat quad on the ground following the terrain. */
  quad(
    ax: number, az: number, bx: number, bz: number, cx: number, cz: number,
    dx: number, dz: number, y: number, color: string, groundY: (x: number, z: number) => number,
  ): void {
    const a = this.vert(ax, groundY(ax, az) + y, az, color);
    const b = this.vert(bx, groundY(bx, bz) + y, bz, color);
    const c = this.vert(cx, groundY(cx, cz) + y, cz, color);
    const d = this.vert(dx, groundY(dx, dz) + y, dz, color);
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.ind);
    g.computeVertexNormals();
    return g;
  }
}

interface Sample { x: number; z: number; s: number }

/** Dense centreline samples with arclength, endpoints included. */
function sampleCurve(pts: Pt[], step = 0.25): Sample[] {
  const raw = curvePoints(pts, step);
  const out: Sample[] = [];
  let s = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) s += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z);
    out.push({ x: raw[i].x, z: raw[i].z, s });
  }
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
  /** Per-side trims (lateral -1 / +1), near end then far end, asphalt then kerb. */
  aNeg: number; aPos: number;
  kNeg: number; kPos: number;
  eANeg: number; eAPos: number;
  eKNeg: number; eKPos: number;
}

export const NO_TRIM: RibbonOpts = {
  aNeg: 0, aPos: 0, kNeg: 0, kPos: 0, eANeg: 0, eAPos: 0, eKNeg: 0, eKPos: 0,
};

/**
 * One road ribbon between two trims: asphalt halves and edge (kerb+sidewalk)
 * halves per side, so each side starts exactly at its own corner. Markings sit
 * above the asphalt on their own lift.
 */
function ribbon(
  g: Geo, pts: Pt[], type: RoadType, o: RibbonOpts,
  groundY: (x: number, z: number) => number, tint?: THREE.Color,
): void {
  g.force = tint ? `#${tint.getHexString()}` : null;
  const samples = sampleCurve(pts);
  const total = samples[samples.length - 1].s;
  if (total < 1e-6) return;
  const hw = type === 3 ? ROAD_DRAW_WIDTH[3] / 2 : halfAsphalt(type);
  const kw = type === 3 ? 0 : kerbWidth(type);
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
    for (const s of stations) {
      const p = walk(s);
      const nx = -p.dz * side, nz = p.dx * side;
      const i0 = g.vert(p.x + nx * inner, groundY(p.x + nx * inner, p.z + nz * inner) + y, p.z + nz * inner, color);
      const i1 = g.vert(p.x + nx * outer, groundY(p.x + nx * outer, p.z + nz * outer) + y, p.z + nz * outer, color);
      if (prev) {
        g.tri(prev[0], prev[1], i0);
        g.tri(prev[1], i1, i0);
      }
      prev = [i0, i1];
    }
  };
  const endA = (side: -1 | 1): number => total - (side < 0 ? o.eANeg : o.eAPos);
  const endK = (side: -1 | 1): number => total - (side < 0 ? o.eKNeg : o.eKPos);
  for (const side of [-1, 1] as const) {
    const sA = side < 0 ? o.aNeg : o.aPos;
    const sK = side < 0 ? o.kNeg : o.kPos;
    half(side, sA, endA(side), 0, hw, ROAD_LIFT, type === 3 ? HW_ASPHALT : ASPHALT);
    if (kw > 0) half(side, sK, endK(side), hw, hw + kw, KERB_LIFT, KERB);
  }
  // Markings above the asphalt: dashes, avenue median, highway lines.
  const aMin = Math.min(o.aNeg, o.aPos);
  const eMin = Math.min(o.eANeg, o.eAPos);
  const mEnd = total - eMin;
  const mark = (offset: number, halfW: number, color: string, dashed: boolean, every = 4, on = 2): void => {
    const a = aMin;
    if (mEnd - a < 0.3) return;
    const stations: number[] = [];
    const n = Math.max(2, Math.ceil((mEnd - a) / 0.25) + 1);
    for (let i = 0; i < n; i++) stations.push(a + ((mEnd - a) * i) / (n - 1));
    let prev: number[] | null = null;
    let prevOn = false;
    for (let i = 0; i < stations.length; i++) {
      const onSeg = !dashed || i % every < on;
      if (!onSeg) { prev = null; prevOn = false; continue; }
      const first = !prevOn;
      const p = walk(stations[i]);
      const nx = -p.dz, nz = p.dx;
      const ax = p.x + nx * offset, az = p.z + nz * offset;
      const v0 = g.vert(ax + nx * halfW, groundY(ax + nx * halfW, az + nz * halfW) + MARK_LIFT, az + nz * halfW, color);
      const v1 = g.vert(ax - nx * halfW, groundY(ax - nx * halfW, az - nz * halfW) + MARK_LIFT, az - nz * halfW, color);
      if (!first && prev) {
        g.tri(prev[0], prev[1], v0);
        g.tri(prev[1], v1, v0);
      }
      prev = [v0, v1];
      prevOn = true;
    }
  };
  if (type === 1) mark(0, 0.012, LINE, true);
  else if (type === 2) {
    // Median then the two carriageway dashes.
    strip(g, samples, aMin, mEnd, 0.16, MARK_LIFT, MEDIAN, groundY, false);
    mark(hw * 0.5, 0.012, AVE_LINE, true);
    mark(-hw * 0.5, 0.012, AVE_LINE, true);
  } else {
    strip(g, samples, aMin, mEnd, 0.14, MARK_LIFT, HW_EDGE, groundY, false);
    mark(ROAD_DRAW_WIDTH[3] * 0.25, 0.012, LINE, true);
    mark(-ROAD_DRAW_WIDTH[3] * 0.25, 0.012, LINE, true);
  }
  g.force = null;
}

/** Ground height sampler (world units). */
export type GroundY = (x: number, z: number) => number;

/** Plain centred band (used for the median and highway edge lines). */
function strip(
  g: Geo, samples: Sample[], a: number, b: number, halfW: number, y: number,
  color: string, groundY: (x: number, z: number) => number, dashed: boolean,
): void {
  if (b - a < 0.3) return;
  const n = Math.max(2, Math.ceil((b - a) / 0.25) + 1);
  const walk = makeWalker(samples);
  let prev: number[] | null = null;
  let prevOn = false;
  for (let i = 0; i < n; i++) {
    const onSeg = !dashed || i % 4 < 2;
    if (!onSeg) { prev = null; prevOn = false; continue; }
    const first = !prevOn;
    const p = walk(a + ((b - a) * i) / (n - 1));
    const nx = -p.dz, nz = p.dx;
    const v0 = g.vert(p.x + nx * halfW, groundY(p.x + nx * halfW, p.z + nz * halfW) + y, p.z + nz * halfW, color);
    const v1 = g.vert(p.x - nx * halfW, groundY(p.x - nx * halfW, p.z - nz * halfW) + y, p.z - nz * halfW, color);
    if (!first && prev) {
      g.tri(prev[0], prev[1], v0);
      g.tri(prev[1], v1, v0);
    }
    prev = [v0, v1];
    prevOn = true;
  }
}

// ---------------------------------------------------------------- network

/** Round dead-end cap: asphalt semicircle plus the kerb annulus around it. */
function deadEnd(
  g: Geo, tip: Pt, backAngle: number, hw: number, kw: number, groundY: GroundY,
): void {
  const N = 10;
  const ring = (r: number, y: number, color: string, a0: number, a1: number): number[] => {
    const ids: number[] = [];
    for (let k = 0; k <= N; k++) {
      const a = a0 + ((a1 - a0) * k) / N;
      const x = tip.x + Math.cos(a) * r, z = tip.z + Math.sin(a) * r;
      ids.push(g.vert(x, groundY(x, z) + y, z, color));
    }
    return ids;
  };
  const c = g.vert(tip.x, groundY(tip.x, tip.z) + ROAD_LIFT, tip.z, ASPHALT);
  const edge = ring(hw, ROAD_LIFT, ASPHALT, backAngle - Math.PI / 2, backAngle + Math.PI / 2);
  for (let k = 0; k < N; k++) g.tri(c, edge[k], edge[k + 1]);
  if (kw > 0) {
    const inner = ring(hw, KERB_LIFT, KERB, backAngle - Math.PI / 2, backAngle + Math.PI / 2);
    const outer = ring(hw + kw, KERB_LIFT, KERB, backAngle - Math.PI / 2, backAngle + Math.PI / 2);
    for (let k = 0; k < N; k++) {
      g.tri(inner[k], outer[k], inner[k + 1]);
      g.tri(outer[k], outer[k + 1], inner[k + 1]);
    }
  }
}

/** Zebra crossing plus stop line on one arm, just outside the junction. */
function zebra(
  g: Geo, l: NodeLayout, arm: NodeLayoutArm, groundY: GroundY,
): void {
  const hw = arm.halfWidth;
  const d = Math.max(arm.trimK.neg, arm.trimK.pos) + 0.1;
  const cx = l.cx + arm.dx * d, cz = l.cz + arm.dz * d;
  const px = -arm.dz, pz = arm.dx;
  const stripes = Math.max(4, Math.round(hw * 9));
  for (let k = 0; k < stripes; k++) {
    const t = ((k + 0.5) / stripes) * 2 - 1;
    const sx = cx + px * hw * t * 0.9, sz = cz + pz * hw * t * 0.9;
    const sw = (hw * 0.9) / stripes * 0.5;
    g.quad(
      sx + arm.dx * 0.13 + px * sw, sz + arm.dz * 0.13 + pz * sw,
      sx - arm.dx * 0.13 + px * sw, sz - arm.dz * 0.13 + pz * sw,
      sx - arm.dx * 0.13 - px * sw, sz - arm.dz * 0.13 - pz * sw,
      sx + arm.dx * 0.13 - px * sw, sz + arm.dz * 0.13 - pz * sw,
      MARK_LIFT, ZEBRA, groundY,
    );
  }
  const lx = l.cx + arm.dx * (d + 0.25), lz = l.cz + arm.dz * (d + 0.25);
  g.quad(
    lx + px * hw * 0.92 + arm.dx * 0.012, lz + pz * hw * 0.92 + arm.dz * 0.012,
    lx + px * hw * 0.92 - arm.dx * 0.012, lz + pz * hw * 0.92 - arm.dz * 0.012,
    lx - px * hw * 0.92 - arm.dx * 0.012, lz - pz * hw * 0.92 - arm.dz * 0.012,
    lx - px * hw * 0.92 + arm.dx * 0.012, lz - pz * hw * 0.92 + arm.dz * 0.012,
    MARK_LIFT, ZEBRA, groundY,
  );
}

/**
 * Corner and junction patch at a node: an asphalt disc over the ribbon ends (hiding dashes and medians there) and
 * kerb sectors only in the gaps between the arms, so bends and junctions get rounded kerb corners without arcs
 * cutting across an arm's roadway.
 */
function nodePatch(g: Geo, l: NodeLayout, groundY: GroundY): void {
  const arms = l.arms
    .map((a) => ({ a, ang: Math.atan2(a.dz, a.dx) }))
    .sort((p, q) => p.ang - q.ang);
  // A straight continuation (two arms, opposite) needs no patch.
  if (arms.length === 2) {
    const dot = arms[0].a.dx * arms[1].a.dx + arms[0].a.dz * arms[1].a.dz;
    if (dot < -0.985) return;
  }
  const r = Math.max(...arms.map((p) => p.a.halfWidth));
  const kw = Math.max(...arms.map((p) => kerbWidth(p.a.type)));
  const lift = ROAD_LIFT + 0.02;
  // Kerb sectors in the gaps between consecutive arms (angles wrap around).
  if (kw > 0) {
    for (let i = 0; i < arms.length; i++) {
      const p = arms[i], q = arms[(i + 1) % arms.length];
      const open0 = p.ang + Math.asin(Math.min(1, p.a.halfWidth / (r + kw * 0.5)));
      let end = q.ang;
      if (end <= p.ang) end += Math.PI * 2;
      const open1 = end - Math.asin(Math.min(1, q.a.halfWidth / (r + kw * 0.5)));
      if (open1 - open0 < 0.05) continue;
      const steps = Math.max(2, Math.ceil((open1 - open0) / 0.2));
      let prev: number[] | null = null;
      for (let k = 0; k <= steps; k++) {
        const ang = open0 + ((open1 - open0) * k) / steps;
        const ix = l.cx + Math.cos(ang) * r, iz = l.cz + Math.sin(ang) * r;
        const ox = l.cx + Math.cos(ang) * (r + kw), oz = l.cz + Math.sin(ang) * (r + kw);
        const v0 = g.vert(ix, groundY(ix, iz) + KERB_LIFT + 0.012, iz, KERB);
        const v1 = g.vert(ox, groundY(ox, oz) + KERB_LIFT + 0.012, oz, KERB);
        if (prev) {
          g.tri(prev[0], v0, prev[1]);
          g.tri(prev[1], v0, v1);
        }
        prev = [v0, v1];
      }
    }
  }
  // Asphalt disc on top of everything laid by the ribbons.
  const N = 24;
  const c0 = g.vert(l.cx, groundY(l.cx, l.cz) + lift, l.cz, ASPHALT);
  const ring: number[] = [];
  for (let k = 0; k < N; k++) {
    const ang = (k / N) * Math.PI * 2;
    const x = l.cx + Math.cos(ang) * r, z = l.cz + Math.sin(ang) * r;
    ring.push(g.vert(x, groundY(x, z) + lift, z, ASPHALT));
  }
  for (let k = 0; k < N; k++) g.tri(c0, ring[k], ring[(k + 1) % N]);
}

/**
 * Full road network in one geometry: trimmed ribbons, one asphalt polygon per
 * junction with kerb fillets, round dead-end caps, zebras on 3+ arm nodes.
 */
export function buildRoadNetworkGeometry(w: World, groundY: GroundY): THREE.BufferGeometry {
  const g = new Geo();
  const cache = new Map<number, NodeLayout | null>();
  const layoutOf = (id: number): NodeLayout | null => {
    if (!cache.has(id)) cache.set(id, nodeLayout(w, id));
    return cache.get(id)!;
  };
  for (const seg of w.segments) {
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
    // Ribbons run the full length to each node centre; the node patch below rounds the corners over them.
    ribbon(g, seg.pts, seg.type, NO_TRIM, groundY);
    // Dead ends close with a round cap (a lone arm, or a missing layout).
    for (const [end, l] of [["a", la], ["b", lb]] as const) {
      if ((l && l.arms.length > 1) || seg.type === 3) continue;
      const tip = end === "a" ? seg.pts[0] : seg.pts[seg.pts.length - 1];
      const dir = end === "a"
        ? { x: samples[0].x - samples[1].x, z: samples[0].z - samples[1].z }
        : { x: samples[samples.length - 1].x - samples[samples.length - 2].x, z: samples[samples.length - 1].z - samples[samples.length - 2].z };
      const hw = halfAsphalt(seg.type);
      const kw = kerbWidth(seg.type);
      deadEnd(g, tip, Math.atan2(dir.z, dir.x), hw, kw, groundY);
    }
  }

  for (const node of w.nodes) {
    const l = layoutOf(node.id);
    if (!l || l.arms.length < 2) continue;
    nodePatch(g, l, groundY);
    if (l.arms.length >= 3) {
      for (const arm of l.arms) {
        zebra(g, l, arm, groundY);
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
    ribbon(g, seg.pts, seg.type, NO_TRIM, groundY, tint);
  });
  return g.build();
}
