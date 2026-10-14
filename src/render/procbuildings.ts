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
/** Kit-scale floor contract.  A level-three office is deliberately 7..9
 * storeys (1.75..2.25 tiles before its small parapet), never a skyline slab.
 * The top value is one below the study's 10-storey ceiling to leave space for
 * the parapet/plant while staying beside the 2-ish tile Blender hero kit. */
export const FLOOR_RANGES: Record<ProcKind, readonly [number, number][]> = {
  house: [[1, 1], [1, 2], [2, 2]],
  apartment: [[2, 3], [4, 6], [7, 9]],
  shop: [[2, 3], [4, 5], [5, 6]],
  mixed: [[2, 3], [4, 6], [7, 9]],
  office: [[2, 3], [4, 6], [7, 9]],
  industrial: [[1, 1], [1, 2], [2, 3]],
};
function floorsFor(kind: ProcKind, level: number, r: () => number): number {
  const [lo, hi] = FLOOR_RANGES[kind][Math.max(0, Math.min(2, level - 1))];
  return lo + Math.floor(r() * (hi - lo + 1));
}
function part(parts: ProcPart[], p: ProcPart): void { if (p.w > 0 && p.h > 0 && p.d > 0) parts.push(p); }

/** Four inset glazed strips per floor: visible bays/spandrels without a huge
 * per-window mesh count.  Each pane is an independently-instanced glass box,
 * hence the existing V1 glow_window shader hashes it as a distinct window. */
function facadeGrid(parts: ProcPart[], x: number, z: number, w: number, d: number, floors: number, floor: number, style: FacadeStyle): void {
  const paneH = Math.min(floor * .58, .15), inset = .012, thick = .018;
  const margin = Math.min(.12, Math.min(w, d) * .12);
  for (let f = 0; f < floors; f++) {
    const y = f * floor + Math.min(floor * .20, .055);
    // The strips terminate before the corners: exposed wall becomes mullions,
    // horizontal wall bands become spandrels, and every box remains in-lot.
    part(parts, { shape: "box", material: "glass", x, y, z: z + d / 2 - inset, w: Math.max(.08, w - margin * 2), h: paneH, d: thick, style });
    part(parts, { shape: "box", material: "glass", x, y, z: z - d / 2 + inset, w: Math.max(.08, w - margin * 2), h: paneH, d: thick, style });
    part(parts, { shape: "box", material: "glass", x: x + w / 2 - inset, y, z, w: thick, h: paneH, d: Math.max(.08, d - margin * 2), style });
    part(parts, { shape: "box", material: "glass", x: x - w / 2 + inset, y, z, w: thick, h: paneH, d: Math.max(.08, d - margin * 2), style });
  }
}

/** Generates only multi-cell lots; callers retain the Blender kit for 1×1. */
export function proceduralBuilding(lot: ProcLot): ProcBuilding | null {
  if (lot.w * lot.d < 4 || lot.w <= 0 || lot.d <= 0 || lot.level <= 0) return null;
  const r = rng(hash(lot)), kind = kindFor(lot), style: FacadeStyle = kind === "house" ? "house" : kind === "apartment" ? "apartment" : kind === "shop" || kind === "mixed" ? "retail" : kind === "office" ? "curtain" : "industrial";
  const cap = Math.min(STANDARD_HEIGHT_CAP, 2.5);
  let floors = floorsFor(kind, lot.level, r);
  const fp = facadeParams(style, floors);
  const floor = kind === "industrial" ? KIT_STOREY * 1.35 : fp.floorH;
  // Reserve 0.14 tile for the roof/parapet so the reported cap includes it.
  floors = Math.max(1, Math.min(floors, Math.floor((cap - .14) / floor)));
  const h = floors * floor;
  const parts: ProcPart[] = [];
  const side = kind === "house" ? 0.19 : kind === "shop" ? 0.08 : kind === "industrial" ? 0.32 : 0.22;
  const front = kind === "house" ? clamp(lot.d * (0.2 + r() * 0.1), 0.44, 0.875) : kind === "industrial" ? 0.2 : 0.16;
  const w = Math.max(0.2, lot.w - side * 2), d = Math.max(0.2, lot.d - front - (kind === "house" ? 0.25 : side));
  const z = front / 2 - side / 2;
  part(parts,{shape:"box",material:kind === "industrial" ? "metal" : "wall",x:0,y:0,z,w,h,d,style});
  facadeGrid(parts, 0, z, w, d, floors, floor, style);
  // A grounded parapet and small roof plant replace the rejected floating
  // crown/awning slabs. Both overlap the roof below and never exceed the body.
  if (kind === "house") part(parts,{shape:r() < .45 && lot.level >= 3 ? "hip" : "gable",material:"roof",x:0,y:h,z,w,h:Math.min(.14, h*.18),d,style:"house"});
  else if (kind === "industrial") part(parts,{shape:"gable",material:"roof",x:0,y:h,z,w,h:Math.min(.14, h*.12),d,style:"industrial"});
  else {
    part(parts,{shape:"box",material:"roof",x:0,y:h,z,w,h:.045,d,style});
    const rail = .045, parapet = .10;
    for (const [px,pz,pw,pd] of [[0,z-d/2+rail/2,w,rail],[0,z+d/2-rail/2,w,rail],[-w/2+rail/2,z,rail,d],[w/2-rail/2,z,rail,d]] as const)
      part(parts,{shape:"box",material:"metal",x:px,y:h+.04,z:pz,w:pw,h:parapet,d:pd,style});
    if (kind === "office" || kind === "mixed") part(parts,{shape:"box",material:"metal",x:0,y:h+.04,z,w:Math.min(.38,w*.28),h:.09,d:Math.min(.28,d*.28),style});
  }
  const triangles = parts.reduce((n,p)=>n+TRIANGLES[p.shape],0);
  const height = h + .14;
  return { kind, floors, height, cap, parts, triangles };
}

/** Headless invariant for plans before B5 turns parts into merged geometry. */
export function checkProceduralBuilding(b: ProcBuilding, lot: Pick<ProcLot,"w"|"d">): boolean {
  if (b.triangles > PROC_TRIANGLE_CAP || b.height > b.cap + 1e-6 || !Number.isFinite(b.height)) return false;
  const contains = (p: ProcPart) => p.w > 0 && p.h > 0 && p.d > 0 && Math.abs(p.x) + p.w / 2 <= lot.w / 2 + 1e-6 && Math.abs(p.z) + p.d / 2 <= lot.d / 2 + 1e-6 && p.y >= 0;
  const supported = (p: ProcPart) => p.y <= 1e-3 || b.parts.some((q) => q !== p && q.y + q.h >= p.y - 1e-3 && q.y < p.y && Math.abs(p.x - q.x) < (p.w + q.w) / 2 - 1e-3 && Math.abs(p.z - q.z) < (p.d + q.d) / 2 - 1e-3);
  return b.parts.every((p) => contains(p) && supported(p));
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
