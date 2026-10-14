// Portions adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10): buildings/generators.js#house, #apartment, #shop, #mixed, #office, #industrial, #wallBox.
/**
 * Pure, deterministic mass recipes for B5. Coordinates are local to an oriented
 * lot: +x follows the road, +z faces it, y=0 is the site platform. These plans
 * deliberately contain only coarse parts: B5 can merge them without allocating
 * a scene graph per building.
 */
import { KIT_STOREY, facadeParams, type FacadeStyle } from "./facade";
import type { ProcShape } from "./procgeo";

export const PROC_TRIANGLE_CAP = 1400;
export const STANDARD_HEIGHT_CAP = 2.6;
export const HERO_HEIGHT_CAP = 4.2;
export type ProcKind = "house" | "apartment" | "shop" | "mixed" | "office" | "industrial";
export interface ProcLot { id: number; w: number; d: number; zone: number; level: number }
export interface ProcPart { shape: ProcShape; material: "wall" | "roof" | "glass" | "metal"; x: number; y: number; z: number; w: number; h: number; d: number; style: FacadeStyle }
export interface ProcBuilding { kind: ProcKind; floors: number; height: number; cap: number; parts: readonly ProcPart[]; triangles: number }

const TRIANGLES: Record<ProcShape, number> = { box: 12, gable: 10, hip: 10, wedge: 10 };
function rng(seed: number): () => number { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t=s; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
function hash(lot: ProcLot): number { return Math.imul(lot.id ^ (lot.level << 11) ^ (lot.zone << 21), 0x9e3779b1) >>> 0; }
function clamp(n:number, lo:number, hi:number):number { return Math.max(lo, Math.min(hi,n)); }
function kindFor(lot: ProcLot): ProcKind { return lot.zone === 1 ? (lot.level <= 1 ? "house" : "apartment") : lot.zone === 2 ? (lot.level >= 3 && lot.w * lot.d >= 9 ? "office" : lot.level >= 3 ? "mixed" : "shop") : "industrial"; }
function floorsFor(kind: ProcKind, level: number, _area: number, r: () => number): number {
  void _area;
  const jitter = () => Math.floor(r() * 2);
  if (kind === "house") return level === 1 ? 1 : level === 2 ? 1 + jitter() : 2;
  if (kind === "apartment") return [3, 5, 8][Math.min(2, Math.max(0, level - 1))] + jitter();
  if (kind === "shop") return level <= 1 ? 1 : 1 + jitter();
  if (kind === "mixed") return 2 + [5, 8, 12][Math.min(2, Math.max(0, level - 1))] + jitter();
  if (kind === "office") return [3, 6, 12][Math.min(2, Math.max(0, level - 1))] + jitter();
  return 1;
}
function part(parts: ProcPart[], p: ProcPart): void { if (p.w > 0 && p.h > 0 && p.d > 0) parts.push(p); }

/** Generates only multi-cell lots; callers retain the Blender kit for 1×1. */
export function proceduralBuilding(lot: ProcLot): ProcBuilding | null {
  if (lot.w * lot.d < 4 || lot.w <= 0 || lot.d <= 0 || lot.level <= 0) return null;
  const r = rng(hash(lot)), kind = kindFor(lot), style: FacadeStyle = kind === "house" ? "house" : kind === "apartment" ? "apartment" : kind === "shop" || kind === "mixed" ? "retail" : kind === "office" ? "curtain" : "industrial";
  const cap = lot.w * lot.d >= 9 ? HERO_HEIGHT_CAP : STANDARD_HEIGHT_CAP;
  let floors = floorsFor(kind, lot.level, lot.w * lot.d, r);
  const fp = facadeParams(style, floors);
  const floor = kind === "industrial" ? KIT_STOREY * 2.2 : fp.floorH;
  floors = Math.max(1, Math.min(floors, Math.floor(cap / floor)));
  const h = floors * floor;
  const parts: ProcPart[] = [];
  const side = kind === "house" ? 0.19 : kind === "shop" ? 0.08 : kind === "industrial" ? 0.32 : 0.22;
  const front = kind === "house" ? clamp(lot.d * (0.2 + r() * 0.1), 0.44, 0.875) : kind === "industrial" ? 0.2 : 0.16;
  const w = Math.max(0.2, lot.w - side * 2), d = Math.max(0.2, lot.d - front - (kind === "house" ? 0.25 : side));
  const z = front / 2 - side / 2;
  if (kind === "mixed") {
    const podium = Math.min(h, KIT_STOREY * 2); part(parts,{shape:"box",material:"wall",x:0,y:0,z,w,h:podium,d,style:"retail"});
    const towerH = Math.max(0, h - podium); part(parts,{shape:"box",material:"glass",x:0,y:podium,z:-0.04,w:w*.68,h:towerH,d:d*.68,style:"curtain"});
  } else {
    part(parts,{shape:"box",material:kind === "office" ? "glass" : kind === "industrial" ? "metal" : "wall",x:0,y:0,z,w,h,d,style});
  }
  if (kind === "house") part(parts,{shape:r() < .45 && lot.level >= 3 ? "hip" : "gable",material:"roof",x:0,y:h,z,w:w+.11,h:Math.min(.22, h*.3),d:d+.11,style:"house"});
  else if (kind === "industrial") part(parts,{shape:"gable",material:"roof",x:0,y:h,z,w:w+.06,h:Math.min(.18, h*.2),d:d+.06,style:"industrial"});
  else part(parts,{shape:"box",material:"roof",x:0,y:h,z,w:w+.03,h:.055,d:d+.03,style});
  const triangles = parts.reduce((n,p)=>n+TRIANGLES[p.shape],0);
  return { kind, floors, height: h + (kind === "house" || kind === "industrial" ? Math.min(.22,h*.3) : .055), cap, parts, triangles };
}

/** Headless invariant for plans before B5 turns parts into merged geometry. */
export function checkProceduralBuilding(b: ProcBuilding, lot: Pick<ProcLot,"w"|"d">): boolean {
  if (b.triangles > PROC_TRIANGLE_CAP || b.height > b.cap + 1e-6 || !Number.isFinite(b.height)) return false;
  return b.parts.every((p) => p.w > 0 && p.h > 0 && p.d > 0 && Math.abs(p.x) + p.w / 2 <= lot.w / 2 + 1e-6 && Math.abs(p.z) + p.d / 2 <= lot.d / 2 + 1e-6 && p.y >= 0);
}
