import {
  ROAD_DRAW_WIDTH, ROAD_TILE_WIDTH, baseRoadType, curvePoints, segElevation,
  type Pt, type RoadSegment, type RoadType, type World,
} from "./world";

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
  /** Half width of the centre median (avenue only); 0 otherwise. */
  medianHalf: number;
  /** Lane width: 2 * (asphaltHalf - medianHalf) / lanes. */
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

const PROFILES: Record<RoadType, RoadProfile> = {
  1: makeProfile(1),
  2: makeProfile(2),
  3: makeProfile(3),
  4: makeProfile(4),
  5: makeProfile(5),
};

const corridorCache = new WeakMap<World, CorridorSet>();

function kerbFor(type: RoadType): number {
  const b = baseRoadType(type);
  return b === 1 ? 0.07 : b === 2 ? 0.09 : 0;
}

function sidewalkFor(type: RoadType): number {
  const b = baseRoadType(type);
  return b === 1 ? 0.12 : b === 2 ? 0.16 : 0;
}

function medianHalfFor(type: RoadType): number {
  return baseRoadType(type) === 2 ? 0.16 : 0;
}

function laneCentresFor(asphaltHalf: number, medianHalf: number, lanes: number): { centres: number[]; width: number } {
  const width = (2 * (asphaltHalf - medianHalf)) / lanes;
  if (medianHalf > 0) {
    const inner = medianHalf + width / 2;
    const outer = medianHalf + width * 1.5;
    return { centres: [-outer, -inner, inner, outer], width };
  }
  const centres: number[] = [];
  for (let i = 0; i < lanes; i++) centres.push((i - (lanes - 1) / 2) * width);
  return { centres, width };
}

function makeProfile(type: RoadType): RoadProfile {
  const kerb = kerbFor(type);
  const asphaltHalf = ROAD_DRAW_WIDTH[type] / 2 - kerb;
  const drawHalf = ROAD_DRAW_WIDTH[type] / 2;
  const sidewalk = sidewalkFor(type);
  const sidewalkEdge = drawHalf + sidewalk;
  const medianHalf = medianHalfFor(type);
  const lanes = baseRoadType(type) === 2 ? 4 : baseRoadType(type) === 3 ? 4 : 2;
  const { centres, width } = laneCentresFor(asphaltHalf, medianHalf, lanes);
  return {
    type,
    asphaltHalf,
    kerb,
    sidewalk,
    setback: Math.max(0, ROAD_TILE_WIDTH[type] / 2 - sidewalkEdge),
    drawHalf,
    lanes,
    laneCentres: centres,
    medianHalf,
    laneWidth: width,
    propOffsets: {
      streetlight: sidewalkEdge + 0.2,
      hydrant: sidewalkEdge + 0.14,
      bench: sidewalkEdge + 0.2,
      planter: sidewalkEdge + 0.2,
      signal: sidewalkEdge + 0.08,
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

export function corridorsOf(w: World): CorridorSet {
  const graphRevision = w.graphRevision ?? 0;
  const hit = corridorCache.get(w);
  if (hit && hit.graphRevision === graphRevision) return hit;
  const bySeg = new Map<number, SegmentCorridor>();
  for (const seg of [...w.segments].sort((a, b) => a.id - b.id)) {
    if (segElevation(seg) !== "ground") continue;
    bySeg.set(seg.id, buildSegmentCorridor(seg));
  }
  const set = { graphRevision, bySeg };
  corridorCache.set(w, set);
  return set;
}
