/**
 * Derived lane connectors for junction pads.  This deliberately contains no
 * simulation state: rebuilding after a graph edit is deterministic and costs
 * only O(arms² × lanes² × 14 samples).
 *
 * Portions adapted from Fable Cities (MIT, rawprogress/fable-cities @
 * aea8b10), LaneNetwork.js#bezierConnector and #laneGraph.  Tile units are
 * used here (8 m/tile); the 16 m handle cap becomes 2.0 tiles.
 */
import type { Pt, RoadType } from "./world";
import { profileOf } from "./corridor";
import { classifyTurn, type TurnKind } from "./signals";

export interface LaneArm { segId: number; end: "a" | "b"; type: RoadType; dx: number; dz: number; trim: number; oneWay?: boolean; dir?: 1 | -1 }
export interface LaneConnector {
  inArm: number; outArm: number; inLane: number; outLane: number;
  turn: TurnKind; points: Pt[]; curvature: number;
}
export interface LaneArrow { arm: number; lane: number; turns: TurnKind[] }
export interface MissingLaneMovement { inArm: number; outArm: number; turn: TurnKind }

const cross = (a: Pt, b: Pt, c: Pt): number => (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
export function pointInPolygon(p: Pt, ring: readonly Pt[]): boolean {
  let hit = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i], b=ring[j];
    if (((a.z>p.z)!==(b.z>p.z)) && p.x < (b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x) hit=!hit;
  }
  return hit;
}
/** Signed segment-frame centres which legally travel in this direction. */
export function laneOffsets(a: Pick<LaneArm, "end" | "type" | "oneWay" | "dir">, incoming: boolean): number[] {
  const all=profileOf(a.type).laneCentres;
  const oneWay = a.oneWay ?? (a.type === 4 || a.type === 5);
  const dir = a.dir ?? 1;
  // a→b exits endpoint a and enters endpoint b (reversed for dir -1).
  if (oneWay && incoming !== ((a.end === "b") === (dir === 1))) return [];
  // Travel along this arm is a→b when entering at end b or leaving at end a.
  const forward = incoming ? a.end === "b" : a.end === "a";
  // World z points south, so +offset in the segment frame is the RIGHT of a→b
  // (heading east, right-hand = +z). Lanes are listed LEFT to RIGHT of travel
  // (index 0 = the left-turn lane): ascending for a→b, descending for b→a.
  // One-way roads use their whole width; two-way right-hand traffic keeps a→b
  // on the positive side and b→a on the negative side.
  const lanes = oneWay ? all.slice() : all.filter(x => forward ? x > 0 : x < 0);
  return forward ? lanes : lanes.reverse();
}
/** Segment offsets use the a→b frame; arm offsets use the outward frame. */
export function armOffset(a: Pick<LaneArm, "end">, segmentOffset: number): number {
  return a.end === "a" ? segmentOffset : -segmentOffset;
}
/** Inbound lane centre in the outward arm frame, shared with road decals. */
export function inboundArmOffset(a: Pick<LaneArm, "end" | "type" | "oneWay" | "dir">, lane: number): number | undefined {
  const off = laneOffsets(a, true)[lane];
  return off === undefined ? undefined : armOffset(a, off);
}
function endpoint(c: Pt, a: LaneArm, off: number): Pt {
  // Stay a hair inside the final asphalt ring.  `trim` lies on the pad/road
  // seam, and strict polygon containment intentionally rejects boundary
  // points to avoid a connector that rides a kerb after float quantisation.
  // A zero-trim taper mouth must move the same hair behind the node, into the
  // taper polygon; clamping it to zero would leave the endpoint on its edge.
  const trim = a.trim - 0.012;
  const armOff = armOffset(a, off);
  return { x:c.x+a.dx*trim-a.dz*armOff, z:c.z+a.dz*trim+a.dx*armOff };
}
function sampleCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
  const out: Pt[]=[];
  for(let i=0;i<=n;i++){ const t=i/n,u=1-t; out.push({x:u*u*u*p0.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t*t*t*p3.x,z:u*u*u*p0.z+3*u*u*t*p1.z+3*u*t*t*p2.z+t*t*t*p3.z}); }
  return out;
}
export function polylineCurvature(p: readonly Pt[]): number { let k=0; for(let i=1;i+1<p.length;i++){const a=Math.hypot(p[i].x-p[i-1].x,p[i].z-p[i-1].z),b=Math.hypot(p[i+1].x-p[i].x,p[i+1].z-p[i].z),c=Math.hypot(p[i+1].x-p[i-1].x,p[i+1].z-p[i-1].z); if(a*b*c>1e-9) k=Math.max(k,Math.abs(2*cross(p[i-1],p[i],p[i+1])/(a*b*c)));} return k; }

/** Build legal lane-to-lane turns; U turns only occur at a physical dead end. */
/**
 * How straight movements pair lanes. "proportional" (junctions) spreads the
 * inbound lanes over the outbound ones by rank. "leftAligned" (tapers) pairs
 * lane i with lane i; the excess RIGHTMOST inbound lanes merge into the last
 * outbound lane, and the excess rightmost outbound lanes are fed from the
 * last inbound lane (a lane that appears on the right).
 */
export type StraightLaneMap = "proportional" | "leftAligned";
export function buildLaneConnectors(centre: Pt, arms: readonly LaneArm[], asphalt: readonly Pt[], straightMap: StraightLaneMap = "proportional"): { connectors: LaneConnector[]; arrows: LaneArrow[]; missing: MissingLaneMovement[] } {
  const connectors: LaneConnector[]=[]; const arrows: LaneArrow[]=[]; const missing: MissingLaneMovement[]=[];
  if (arms.length < 2) return { connectors, arrows, missing };
  for(let i=0;i<arms.length;i++) {
    const ins=laneOffsets(arms[i],true); const allowed: TurnKind[][]=ins.map(()=>[]);
    for(let o=0;o<arms.length;o++) if(o!==i) {
      const turn=classifyTurn(-arms[i].dx,-arms[i].dz,arms[o].dx,arms[o].dz);
      if(turn === "uturn" && arms.length > 1) continue;
      const outs=laneOffsets(arms[o],false); if(!outs.length) continue;
      const before = connectors.length;
      for(let li=0;li<ins.length;li++) {
        // straight lanes follow straightMap; outer lanes own their near turn.
        if(turn === "left" && li !== 0) continue;
        if(turn === "right" && li !== ins.length-1) continue;
        const targets: number[] = turn === "left" ? [0] : turn === "right" ? [outs.length-1]
          : straightMap === "leftAligned"
            ? (li === ins.length-1 && outs.length > ins.length
              ? Array.from({ length: outs.length-li }, (_, k) => li+k)
              : [Math.min(li, outs.length-1)])
            : [Math.min(outs.length-1, Math.floor(li*outs.length/ins.length))];
        for (const lo of targets) {
          const p0=endpoint(centre,arms[i],ins[li]), p3=endpoint(centre,arms[o],outs[lo]);
          const d=Math.hypot(p3.x-p0.x,p3.z-p0.z), h=Math.min(.46*d,2), steps=Math.max(3,Math.min(14,Math.ceil(d/.2)));
          const pts=sampleCubic(p0,{x:p0.x-arms[i].dx*h,z:p0.z-arms[i].dz*h},{x:p3.x-arms[o].dx*h,z:p3.z-arms[o].dz*h},p3,steps);
          const curvature=polylineCurvature(pts), limit=2/Math.min(profileOf(arms[i].type).laneWidth,profileOf(arms[o].type).laneWidth);
          if(pts.every(p=>pointInPolygon(p,asphalt)) && curvature<=limit+1e-3) { connectors.push({inArm:i,outArm:o,inLane:li,outLane:lo,turn,points:pts,curvature}); if(!allowed[li].includes(turn)) allowed[li].push(turn); }
        }
      }
      if(ins.length > 0 && connectors.length === before) missing.push({inArm:i,outArm:o,turn});
    }
    allowed.forEach((turns,lane)=>arrows.push({arm:i,lane,turns:turns.sort()}));
  }
  return { connectors, arrows, missing };
}
