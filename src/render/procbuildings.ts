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
  // Readable silhouette/detail tier: thin slabs are still pooled boxes, never
  // independent scene nodes.  They remain inside the parent lot envelope.
  if (kind === "apartment") {
    for (let y = floor; y < h - .02; y += floor * 2) part(parts, { shape: "box", material: "metal", x: 0, y, z: z + d * .47, w: w * .82, h: .025, d: .10, style });
  } else if (kind === "office" || kind === "mixed") {
    const crownH = Math.min(.18, h * .18);
    part(parts, { shape: "box", material: "glass", x: 0, y: Math.max(0, h - crownH), z, w: w * .72, h: crownH, d: d * .72, style: "curtain" });
  } else if (kind === "shop") {
    part(parts, { shape: "wedge", material: "metal", x: 0, y: Math.min(h * .48, .16), z: z + d * .48, w: w * .82, h: .07, d: .16, style: "retail" });
  } else if (kind === "industrial") {
    // Dock apron and a restrained rear annex make the industrial recipe legible at game zoom.
    part(parts, { shape: "box", material: "metal", x: 0, y: 0, z: z - d * .48, w: w * .7, h: .05, d: .20, style });
    part(parts, { shape: "box", material: "metal", x: w * .28, y: 0, z, w: Math.min(.5, w * .25), h: h * .55, d: d * .35, style });
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

/** Coarse, bounded site kit.  It deliberately shares the normal part contract so B5 pools it too. */
export function constructionParts(main: ProcBuilding, lot: Pick<ProcLot, "w" | "d">, progress: number): ProcPart[] {
  const p = clamp(progress, 0, 1), h = Math.max(.04, main.height * Math.min(1, p * 1.15));
  const base = main.parts[0];
  if (!base) return [];
  const out: ProcPart[] = [];
  part(out, { shape: "box", material: "wall", x: base.x, y: 0, z: base.z, w: base.w * .94, h, d: base.d * .94, style: base.style });
  for (let y = KIT_STOREY; y < h; y += KIT_STOREY) part(out, { shape: "box", material: "metal", x: base.x, y: y - .018, z: base.z, w: Math.min(lot.w, base.w + .06), h: .036, d: Math.min(lot.d, base.d + .06), style: base.style });
  // fence stays just inside the lot boundary; four rails are cheaper and clearer than alpha chain-link.
  const fw = Math.max(.1, lot.w - .08), fd = Math.max(.1, lot.d - .08);
  for (const [x, z, w, d] of [[0, -lot.d / 2 + .04, fw, .025], [0, lot.d / 2 - .04, fw, .025], [-lot.w / 2 + .04, 0, .025, fd], [lot.w / 2 - .04, 0, .025, fd]] as const) part(out, { shape: "box", material: "metal", x, y: 0, z, w, h: .18, d, style: base.style });
  if (main.height > 1) { // compact crane, deliberately bounded to max lot dimension + 2.
    const mast = Math.min(main.height + .75, Math.max(lot.w, lot.d) + 1.5);
    part(out, { shape: "box", material: "metal", x: -base.w * .42, y: 0, z: base.z, w: .045, h: mast, d: .045, style: base.style });
    part(out, { shape: "box", material: "metal", x: 0, y: mast - .04, z: base.z, w: Math.min(Math.max(lot.w, lot.d) + 1.5, 2.5), h: .045, d: .045, style: base.style });
  }
  return out;
}

export function checkConstructionParts(parts: readonly ProcPart[], lot: Pick<ProcLot, "w" | "d">): boolean {
  return parts.every((p) => p.w > 0 && p.h > 0 && p.d > 0 && p.y >= 0 && Math.abs(p.x) + p.w / 2 <= Math.max(lot.w, lot.d) / 2 + 1 && Math.abs(p.z) + p.d / 2 <= Math.max(lot.w, lot.d) / 2 + 1);
}
