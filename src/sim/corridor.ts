import {
  curvePoints, segElevation,
  type Pt, type RoadSegment, type RoadType, type World,
} from "./world";

import { derive, specOf, type MedianKind } from "./roadprofile";
export type CorridorOffsetName = "asphaltEdge" | "kerbEdge" | "sidewalkEdge" | "setbackLine";
export type CorridorSide = "left" | "right";

export interface RoadProfile {
  type: RoadType;
  asphaltHalf: number;
  kerb: number;
  sidewalk: number;
  setback: number;
  drawHalf: number;
  lanes: number;
  /** Signed lane-centre offsets (tiles; +z is south, so POSITIVE = right of a→b); right-hand traffic. */
  laneCentres: number[];
  /** Half width of the centre median (avenue planted, highway barrier); 0 otherwise. */
  medianHalf: number;
  median: MedianKind;
  /** Asphalt outside the outer lane, per side (highway). */
  shoulder: number;
  /** Lane width (roadprofile.ts). */
  laneWidth: number;
  propOffsets: {
    streetlight: number;
    hydrant: number;
    bench: number;
    planter: number;
    signal: number;
  };
}

export interface CentreSample extends Pt {
  s: number;
  tx: number;
  tz: number;
}

export interface SegmentCorridor {
  segId: number;
  type: RoadType;
  centre: CentreSample[];
  offsets: Record<CorridorOffsetName, { left: Pt[]; right: Pt[] }>;
}

export interface CorridorSet {
  graphRevision: number;
  bySeg: Map<number, SegmentCorridor>;
}

/** Per-type road profiles; hot loops read `.laneWidth` directly to avoid call overhead. */
export const PROFILES: Record<RoadType, RoadProfile> = {
  1: makeProfile(1),
  2: makeProfile(2),
  3: makeProfile(3),
  4: makeProfile(4),
  5: makeProfile(5),
  6: makeProfile(6),
};

const corridorCache = new WeakMap<World, CorridorSet>();

function makeProfile(type: RoadType): RoadProfile {
  const s = specOf(type), d = derive(type);
  // Same arithmetic as before the table (drawHalf + sidewalk) so prop offsets stay bit-identical.
  const edge = d.drawHalf + s.sidewalk;
  return {
    type,
    asphaltHalf: d.asphaltHalf,
    kerb: s.kerb,
    sidewalk: s.sidewalk,
    setback: Math.max(0, s.tileWidth / 2 - edge),
    drawHalf: d.drawHalf,
    lanes: d.totalLanes,
    laneCentres: d.laneCentres,
    medianHalf: s.medianHalf,
    median: s.median,
    shoulder: s.shoulder,
    laneWidth: s.laneWidth,
    propOffsets: {
      streetlight: edge + 0.2,
      hydrant: edge + 0.14,
      bench: edge + 0.2,
      planter: edge + 0.2,
      signal: edge + 0.08,
    },
  };
}

export function profileOf(type: RoadType): RoadProfile {
  return PROFILES[type];
}

export function profileOffset(type: RoadType, name: CorridorOffsetName): number {
  const p = profileOf(type);
  if (name === "asphaltEdge") return p.asphaltHalf;
  if (name === "kerbEdge") return p.drawHalf;
  if (name === "sidewalkEdge") return p.drawHalf + p.sidewalk;
  return p.drawHalf + p.sidewalk + p.setback;
}

/** Outer edge of asphalt + kerb (the drawn ribbon width). Excludes the sidewalk. */
export function fullHalf(type: RoadType): number {
  return profileOf(type).drawHalf;
}

/** Outer edge of the sidewalk: drawHalf + sidewalk. */
export function sidewalkEdge(type: RoadType): number {
  const p = profileOf(type);
  return p.drawHalf + p.sidewalk;
}

/** Vertical layer of a segment (re-export of segElevation for corridor consumers). */
export function layerOf(seg: { elevation?: "ground" | "bridge" | "tunnel" }): "ground" | "bridge" | "tunnel" {
  return segElevation(seg);
}

function q(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function quantPt(p: Pt): Pt {
  return { x: q(p.x), z: q(p.z) };
}

function tangent(a: Pt, b: Pt): { x: number; z: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

function lineIntersection(a: Pt, ta: Pt, b: Pt, tb: Pt): Pt | null {
  const det = ta.x * tb.z - ta.z * tb.x;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((b.x - a.x) * tb.z - (b.z - a.z) * tb.x) / det;
  return { x: a.x + ta.x * t, z: a.z + ta.z * t };
}

function centreSamples(seg: RoadSegment): CentreSample[] {
  const raw = curvePoints(seg.pts, 0.5);
  const out: CentreSample[] = [];
  let s = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) s += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z);
    const prev = raw[Math.max(0, i - 1)];
    const next = raw[Math.min(raw.length - 1, i + 1)];
    const t = tangent(prev, next);
    out.push({ x: q(raw[i].x), z: q(raw[i].z), s: q(s), tx: q(t.x), tz: q(t.z) });
  }
  return out;
}

function offsetLine(samples: CentreSample[], offset: number, side: -1 | 1): Pt[] {
  if (samples.length === 0) return [];
  if (samples.length === 1) return [quantPt(samples[0])];
  const out: Pt[] = [];
  const miterLimit = Math.max(1, offset * 4);
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    const t0 = i === 0 ? tangent(p, next) : tangent(prev, p);
    const t1 = i === samples.length - 1 ? tangent(prev, p) : tangent(p, next);
    const n0 = { x: -t0.z * side, z: t0.x * side };
    const n1 = { x: -t1.z * side, z: t1.x * side };
    const a = { x: p.x + n0.x * offset, z: p.z + n0.z * offset };
    const b = { x: p.x + n1.x * offset, z: p.z + n1.z * offset };
    const hit = lineIntersection(a, t0, b, t1);
    let x = hit?.x ?? (a.x + b.x) / 2;
    let z = hit?.z ?? (a.z + b.z) / 2;
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      x = p.x + ((n0.x + n1.x) / 2) * offset;
      z = p.z + ((n0.z + n1.z) / 2) * offset;
    }
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > miterLimit) {
      const nx = (x - p.x) / (d || 1), nz = (z - p.z) / (d || 1);
      x = p.x + nx * miterLimit;
      z = p.z + nz * miterLimit;
    }
    out.push({ x: q(x), z: q(z) });
  }
  return out;
}

function buildSegmentCorridor(seg: RoadSegment): SegmentCorridor {
  const centre = centreSamples(seg);
  const offsets = {} as SegmentCorridor["offsets"];
  for (const name of ["asphaltEdge", "kerbEdge", "sidewalkEdge", "setbackLine"] as const) {
    const off = profileOffset(seg.type, name);
    offsets[name] = { left: offsetLine(centre, off, 1), right: offsetLine(centre, off, -1) };
  }
  return { segId: seg.id, type: seg.type, centre, offsets };
}

/** True when `c` was built from exactly this segment's id, type and points (buildSegmentCorridor reads nothing else). */
function corridorFits(c: SegmentCorridor, seg: RoadSegment, pts: readonly Pt[] | undefined): boolean {
  if (!pts || c.segId !== seg.id || c.type !== seg.type || pts.length !== seg.pts.length) return false;
  for (let i = 0; i < pts.length; i++) if (pts[i].x !== seg.pts[i].x || pts[i].z !== seg.pts[i].z) return false;
  return true;
}

/** Points each cached corridor was built from (copies: segments are edited in place). */
const corridorSource = new WeakMap<SegmentCorridor, Pt[]>();

export function corridorsOf(w: World): CorridorSet {
  const graphRevision = w.graphRevision ?? 0;
  const hit = corridorCache.get(w);
  if (hit && hit.graphRevision === graphRevision) return hit;
  const bySeg = new Map<number, SegmentCorridor>();
  for (const seg of [...w.segments].sort((a, b) => a.id - b.id)) {
    if (segElevation(seg) !== "ground") continue;
    // A graph revision rarely touches more than a few segments: unchanged ones keep their corridor (a pure function
    // of id, type and points), instead of re-offsetting every segment of the city on each edit.
    const old = hit?.bySeg.get(seg.id);
    if (old && corridorFits(old, seg, corridorSource.get(old))) { bySeg.set(seg.id, old); continue; }
    const c = buildSegmentCorridor(seg);
    corridorSource.set(c, seg.pts.map((p) => ({ x: p.x, z: p.z })));
    bySeg.set(seg.id, c);
  }
  const set = { graphRevision, bySeg };
  corridorCache.set(w, set);
  return set;
}
