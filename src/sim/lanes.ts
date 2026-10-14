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

export interface LaneArm { segId: number; end: "a" | "b"; type: RoadType; dx: number; dz: number; trim: number }
export interface LaneConnector {
  inArm: number; outArm: number; inLane: number; outLane: number;
  turn: TurnKind; points: Pt[]; curvature: number;
}
export interface LaneArrow { arm: number; lane: number; turns: TurnKind[] }

const cross = (a: Pt, b: Pt, c: Pt): number => (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
export function pointInPolygon(p: Pt, ring: readonly Pt[]): boolean {
  let hit = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i], b=ring[j];
    if (((a.z>p.z)!==(b.z>p.z)) && p.x < (b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x) hit=!hit;
  }
  return hit;
}
function laneOffsets(a: LaneArm, incoming: boolean): number[] {
  const all=profileOf(a.type).laneCentres;
  // At end b, a→b (negative side) enters; at end a b→a (positive side) enters.
  const wantNeg = incoming ? a.end === "b" : a.end === "a";
  return all.filter(x => wantNeg ? x < 0 : x > 0);
}
function endpoint(c: Pt, a: LaneArm, off: number): Pt {
  return { x:c.x+a.dx*a.trim-a.dz*off, z:c.z+a.dz*a.trim+a.dx*off };
}
function sampleCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
  const out: Pt[]=[];
  for(let i=0;i<=n;i++){ const t=i/n,u=1-t; out.push({x:u*u*u*p0.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t*t*t*p3.x,z:u*u*u*p0.z+3*u*u*t*p1.z+3*u*t*t*p2.z+t*t*t*p3.z}); }
  return out;
}
export function polylineCurvature(p: readonly Pt[]): number { let k=0; for(let i=1;i+1<p.length;i++){const a=Math.hypot(p[i].x-p[i-1].x,p[i].z-p[i-1].z),b=Math.hypot(p[i+1].x-p[i].x,p[i+1].z-p[i].z),c=Math.hypot(p[i+1].x-p[i-1].x,p[i+1].z-p[i-1].z); if(a*b*c>1e-9) k=Math.max(k,Math.abs(2*cross(p[i-1],p[i],p[i+1])/(a*b*c)));} return k; }

/** Build legal lane-to-lane turns; U turns only occur at a physical dead end. */
export function buildLaneConnectors(centre: Pt, arms: readonly LaneArm[], asphalt: readonly Pt[]): { connectors: LaneConnector[]; arrows: LaneArrow[] } {
  const connectors: LaneConnector[]=[]; const arrows: LaneArrow[]=[];
  if (arms.length < 2 || asphalt.length < 3) return { connectors, arrows };
  for(let i=0;i<arms.length;i++) {
    const ins=laneOffsets(arms[i],true); const allowed: TurnKind[][]=ins.map(()=>[]);
    for(let o=0;o<arms.length;o++) if(o!==i) {
      const turn=classifyTurn(-arms[i].dx,-arms[i].dz,arms[o].dx,arms[o].dz);
      if(turn === "uturn" && arms.length > 1) continue;
      const outs=laneOffsets(arms[o],false); if(!outs.length) continue;
      for(let li=0;li<ins.length;li++) {
        // proportional rank for straight; outer lanes own their near turn.
        if(turn === "left" && li !== 0) continue;
        if(turn === "right" && li !== ins.length-1) continue;
        const lo = turn === "left" ? 0 : turn === "right" ? outs.length-1 : Math.min(outs.length-1, Math.floor(li*outs.length/ins.length));
        const p0=endpoint(centre,arms[i],ins[li]), p3=endpoint(centre,arms[o],outs[lo]);
        const d=Math.hypot(p3.x-p0.x,p3.z-p0.z), h=Math.min(.46*d,2), steps=Math.max(3,Math.min(14,Math.ceil(d/.2)));
        const pts=sampleCubic(p0,{x:p0.x-arms[i].dx*h,z:p0.z-arms[i].dz*h},{x:p3.x-arms[o].dx*h,z:p3.z-arms[o].dz*h},p3,steps);
        const curvature=polylineCurvature(pts), limit=2/Math.min(profileOf(arms[i].type).laneWidth,profileOf(arms[o].type).laneWidth);
        if(pts.every(p=>pointInPolygon(p,asphalt)) && curvature<=limit+1e-3) { connectors.push({inArm:i,outArm:o,inLane:li,outLane:lo,turn,points:pts,curvature}); if(!allowed[li].includes(turn)) allowed[li].push(turn); }
      }
    }
    allowed.forEach((turns,lane)=>arrows.push({arm:i,lane,turns:turns.sort()}));
  }
  return { connectors, arrows };
}
