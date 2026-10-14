/**
 * Zone/road invariant oracle (docs/process/05-oriented-lots.md §1.8): "zoned building areas never invade the road".
 *
 * Independent of the oriented validity code in zoneblocks.ts: every zoned cell, lot, rendered pad and kerb strip is
 * tested with a 5 x 5 sample grid against the physical road surface of `roadsurface.ts` (asphalt + kerb + sidewalk
 * of every ground centreline, sampled at 0.1 tile, plus every junction `sidewalkOuter` ring). Pure; used by tests and
 * diagnostics, never by the frame loop.
 */
import { lotCorners } from "./orientedlots";
import { lotInstances, lotKerb } from "../render/lots";
import { getFrontage } from "./blocks";
import { LOT_EDGE_BAND, TILE_INSET, distToPolyline, quadOnRoad, rectOnRoad, rectQuad, roadDist, roadSurface, setbackGap, type RoadSurface } from "./roadsurface";
import { cellCorners, cellIndex, cellPose, type ZoneBlockSet } from "./zoneblocks";
import { CELL_DEPTH, type OrientedLot } from "./zonecells";
import type { World } from "./world";

export interface ZoneInvariantReport {
  /** Zoned valid cells whose quad intersects the road surface. */
  cellRoad: number;
  /** Valid cells (zoned or not: the grid the tools offer) whose quad intersects the road surface. */
  validRoad: number;
  /** Cells holding zone/level/lot state while not valid (stale state). */
  zonedInvalid: number;
  /** Mirror tiles zoned (w.zone) or lotted (w.lotAt) on a road raster tile. */
  mirrorRoad: number;
  /** Oriented mode: mirror tiles zoned with no valid zoned cell centred in them. */
  mirrorOrphan: number;
  /** Lots whose rigid footprint (oriented: the lotPose rectangle buildings and ground plans use) hits the road. */
  lotRoad: number;
  /** Oriented lots referencing a missing block or a cell that is invalid, of another zone or owned by another lot. */
  lotStale: number;
  /** Lots with a rendered pad (lotInstances) on the road surface. */
  padRoad: number;
  /** Rendered kerb strips on the road surface or more than 0.2 tile off a road's setback line. */
  kerbOff: number;
  /** Lot-lot overlaps (trapezoid SAT). */
  lotLot: number;
  /** Tile mode: zoned tiles whose square (inset TILE_INSET) touches drawn asphalt or kerb ("kerb" surface). */
  tileRoad: number;
  /** Tile mode: zoned tiles with no road within the zoning depth. */
  tileOrphan: number;
}

export const EMPTY_REPORT: Readonly<ZoneInvariantReport> = Object.freeze({
  cellRoad: 0, validRoad: 0, zonedInvalid: 0, mirrorRoad: 0, mirrorOrphan: 0, lotRoad: 0, lotStale: 0, padRoad: 0,
  kerbOff: 0, lotLot: 0, tileRoad: 0, tileOrphan: 0,
});

/** Slack inside the surface edge: below drawing precision (0.08 m), above float noise. */
const EPS = 0.01;

/** SAT with unit axes: touching within 1e-3 tile is not an overlap, whatever the edge lengths. */
function quadsOverlap(a: Float32Array, b: Float32Array): boolean {
  for (const p of [a, b]) for (let i = 0; i < 4; i++) {
    const j = (i + 1) & 3, ex = p[j * 2] - p[i * 2], ez = p[j * 2 + 1] - p[i * 2 + 1], el = Math.hypot(ex, ez) || 1;
    const ax = -ez / el, az = ex / el;
    let alo = Infinity, ahi = -Infinity, blo = Infinity, bhi = -Infinity;
    for (let k = 0; k < 4; k++) {
      const va = a[k * 2] * ax + a[k * 2 + 1] * az, vb = b[k * 2] * ax + b[k * 2 + 1] * az;
      alo = Math.min(alo, va); ahi = Math.max(ahi, va); blo = Math.min(blo, vb); bhi = Math.max(bhi, vb);
    }
    if (Math.min(ahi, bhi) - Math.max(alo, blo) <= 1e-3) return false;
  }
  return true;
}

/** Rectangle sampled every 0.1 tile (edges included) against the surface with the oracle's slack; rings exact. */
function rectSampled(surface: RoadSurface, cx: number, cz: number, sx: number, sz: number, yaw: number): boolean {
  if (surface.quadTouchesRing(rectQuad(cx, cz, sx, sz, yaw))) return true;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const nu = Math.max(2, Math.ceil(sx / 0.1) + 1), nv = Math.max(2, Math.ceil(sz / 0.1) + 1);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const lx = -sx / 2 + (sx * i) / (nu - 1), lz = -sz / 2 + (sz * j) / (nv - 1);
    if (surface.hits(cx + lx * c + lz * s, cz - lx * s + lz * c, EPS)) return true;
  }
  return false;
}

export function checkZoneInvariant(w: World, set: ZoneBlockSet): ZoneInvariantReport {
  const out: ZoneInvariantReport = { ...EMPTY_REPORT };
  const surface = roadSurface(w);
  for (let t = 0; t < w.size * w.size; t++) {
    if ((w.zone[t] || w.lotAt[t] >= 0) && (w.road[t] || w.roadSurface[t])) out.mirrorRoad++;
  }
  if (w.zoning === "tiles") return checkTiles(w, roadSurface(w, "kerb"), out);
  const q = new Float32Array(8);
  const centred = new Uint8Array(w.size * w.size);
  for (const b of set.blocks.values()) for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
    const i = cellIndex(r, c);
    if (!b.valid[i]) {
      if (b.zone[i] || b.level[i] || b.lot[i] >= 0) out.zonedInvalid++;
      continue;
    }
    cellCorners(b, r, c, q);
    const hit = quadOnRoad(surface, q, EPS);
    if (hit) out.validRoad++;
    if (b.zone[i]) {
      if (hit) out.cellRoad++;
      // The mirror maps a cell to the tile of its frame centre (mirror.ts).
      const p = cellPose(b, r, c);
      const tx = Math.floor(p.x), ty = Math.floor(p.z);
      if (tx >= 0 && ty >= 0 && tx < w.size && ty < w.size) centred[ty * w.size + tx] = 1;
    }
  }
  for (let t = 0; t < w.size * w.size; t++) if (w.zone[t] && !centred[t]) out.mirrorOrphan++;
  const lots: readonly OrientedLot[] = w.olots ?? [];
  const quads: Float32Array[] = [];
  for (const lot of lots) {
    const b = set.blocks.get(`${lot.seg}:${lot.side}:${lot.block}`);
    if (!b) { out.lotStale++; continue; }
    let stale = lot.row + lot.w > b.rows || lot.col + lot.d > CELL_DEPTH;
    for (let r = lot.row; !stale && r < lot.row + lot.w; r++) for (let c = lot.col; c < lot.col + lot.d; c++) {
      const i = cellIndex(r, c);
      if (!b.valid[i] || b.zone[i] !== lot.zone || b.lot[i] !== lot.id) { stale = true; break; }
    }
    if (stale) out.lotStale++;
    const lq = new Float32Array(8);
    lotCorners(b, lot, lq);
    quads.push(lq);
    // The rigid lot frame holds every ground rect, plinth and building the renderer draws for the lot.
    // Sampled every 0.1 tile (the planner's gate is exact): an independent check of the same rectangle.
    if (rectSampled(surface, lot.cx, lot.cz, lot.w - 2 * LOT_EDGE_BAND, lot.d - 2 * LOT_EDGE_BAND, lot.yaw)) out.lotRoad++;
    const plan = lotInstances(lot, lot.col === 0);
    for (const pad of plan.pad) if (quadOnRoad(surface, rectQuad(pad.x, pad.z, pad.sx, pad.sz, pad.yaw), EPS)) { out.padRoad++; break; }
    const own = surface.roads.find((r) => r.id === lot.seg);
    for (const k of plan.kerb) {
      const d = own ? distToPolyline(k.x, k.z, own.pts, false, false) : Infinity;
      if (!own || Math.abs(d - own.setbackLine) > 0.2 || quadOnRoad(surface, rectQuad(k.x, k.z, k.sx, k.sz, k.yaw), EPS)) out.kerbOff++;
    }
  }
  for (let i = 0; i < quads.length; i++) for (let j = i + 1; j < quads.length; j++) if (quadsOverlap(quads[i], quads[j])) out.lotLot++;
  return out;
}

function checkTiles(w: World, surface: RoadSurface, out: ZoneInvariantReport): ZoneInvariantReport {
  const front = getFrontage(w);
  for (let t = 0; t < w.size * w.size; t++) {
    if (!w.zone[t]) continue;
    const x = t % w.size, y = (t / w.size) | 0;
    // Same inset the tile rules use (roadsurface.ts TILE_INSET), minus the oracle's slack.
    const tq = rectQuad(x + 0.5, y + 0.5, 1 - 2 * (TILE_INSET - EPS), 1 - 2 * (TILE_INSET - EPS), 0);
    if (quadOnRoad(surface, tq, EPS) || surface.quadTouchesRing(rectQuad(x + 0.5, y + 0.5, 1 - 2 * TILE_INSET - 0.02, 1 - 2 * TILE_INSET - 0.02, 0))) out.tileRoad++;
    if (front.road[t] < 0) out.tileOrphan++;
  }
  for (const lot of w.lots) {
    if (quadOnRoad(surface, rectQuad(lot.x + lot.w / 2, lot.y + lot.h / 2, lot.w - 2 * (TILE_INSET - EPS), lot.h - 2 * (TILE_INSET - EPS), 0), EPS)) out.lotRoad++;
    const k = lotKerb(lot);
    if (!k) continue;
    // The renderer draws a classic lot's strip only on a setback line and off the road (scene.ts); count what it
    // would draw that still touches the surface (eps slack), i.e. a disagreement between the gate and the oracle.
    if (setbackGap(surface, k.x, k.z) > 0.2 || rectOnRoad(surface, k.x, k.z, Math.max(0.08, k.w - 0.04), Math.max(0.08, k.d - 0.02), 0, 0)) continue;
    if (quadOnRoad(surface, rectQuad(k.x, k.z, Math.max(0.08, k.w - 0.04), Math.max(0.08, k.d - 0.02), 0), EPS)) out.kerbOff++;
  }
  return out;
}

export function invariantClean(r: ZoneInvariantReport): boolean {
  return r.cellRoad === 0 && r.validRoad === 0 && r.zonedInvalid === 0 && r.mirrorRoad === 0 && r.mirrorOrphan === 0 && r.lotRoad === 0 &&
    r.lotStale === 0 && r.padRoad === 0 && r.kerbOff === 0 && r.lotLot === 0 && r.tileRoad === 0 && r.tileOrphan === 0;
}

/** Debug: describe zoned valid cells that hit the road surface (first `max`). */
export function explainCellRoad(w: World, set: ZoneBlockSet, max = 5, includeUnzoned = false): string[] {
  const out: string[] = [];
  const surface = roadSurface(w);
  const q = new Float32Array(8);
  for (const b of set.blocks.values()) for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
    const i = cellIndex(r, c);
    if (!b.valid[i] || (!b.zone[i] && !includeUnzoned) || out.length >= max) continue;
    cellCorners(b, r, c, q);
    if (!quadOnRoad(surface, q, EPS)) continue;
    const near = surface.roads.map((rd) => {
      let best = Infinity;
      for (const u of [0.03, 0.5, 0.97]) for (const v of [0.03, 0.5, 0.97]) {
        const ax = q[0] + (q[2] - q[0]) * u, az = q[1] + (q[3] - q[1]) * u, bx = q[6] + (q[4] - q[6]) * u, bz = q[7] + (q[5] - q[7]) * u;
        best = Math.min(best, roadDist(rd, ax + (bx - ax) * v, az + (bz - az) * v) - rd.body);
      }
      return { id: rd.id, own: rd.id === b.seg, inside: best };
    }).filter((n) => n.inside < 0);
    const seg = w.segments.find((g) => g.id === b.seg);
    out.push(`cell ${b.key} r${r} c${c} q=${Array.from(q).map((n) => n.toFixed(2)).join(",")} seg=${JSON.stringify(seg?.pts)} type=${seg?.type} roads=${JSON.stringify(near)}`);
  }
  return out;
}

/** Debug: lots whose rendered pads or kerbs violate the invariant. */
export function explainLots(w: World, set: ZoneBlockSet, max = 6): string[] {
  const out: string[] = [];
  const surface = roadSurface(w);
  for (const lot of w.olots ?? []) {
    if (out.length >= max) break;
    const b = set.blocks.get(`${lot.seg}:${lot.side}:${lot.block}`);
    if (!b) continue;
    const plan = lotInstances(lot, lot.col === 0);
    const padHit = plan.pad.some((pad) => quadOnRoad(surface, rectQuad(pad.x, pad.z, pad.sx, pad.sz, pad.yaw), EPS));
    const own = surface.roads.find((r) => r.id === lot.seg);
    const kerbs = plan.kerb.map((k) => ({ gap: own ? +(distToPolyline(k.x, k.z, own.pts, false, false) - own.setbackLine).toFixed(3) : null, hit: quadOnRoad(surface, rectQuad(k.x, k.z, k.sx, k.sz, k.yaw), EPS) }));
    const kerbBad = kerbs.some((k) => k.gap === null || Math.abs(k.gap) > 0.2 || k.hit);
    if (!padHit && !kerbBad) continue;
    const seg = w.segments.find((g) => g.id === lot.seg);
    out.push(`lot ${lot.id} ${lot.seg}:${lot.side}:${lot.block} r${lot.row} c${lot.col} w${lot.w} d${lot.d} lv${lot.level} pose=${lot.cx.toFixed(2)},${lot.cz.toFixed(2)},${lot.yaw.toFixed(3)} padHit=${padHit} kerbs=${JSON.stringify(kerbs)} seg=${JSON.stringify(seg?.pts)} type=${seg?.type} rows=${b.rows}`);
  }
  return out;
}

/** Debug: lots whose rigid rectangle touches the surface, with the roads involved. */
export function explainLotRoad(w: World, set: ZoneBlockSet, max = 4): string[] {
  const out: string[] = [];
  const surface = roadSurface(w);
  for (const lot of w.olots ?? []) {
    if (out.length >= max) break;
    if (!rectSampled(surface, lot.cx, lot.cz, lot.w - 2 * LOT_EDGE_BAND, lot.d - 2 * LOT_EDGE_BAND, lot.yaw)) continue;
    const c = Math.cos(lot.yaw), sn = Math.sin(lot.yaw);
    const hits: string[] = [];
    for (let j = 0; j <= 20 && hits.length < 3; j++) for (let i = 0; i <= 20 && hits.length < 3; i++) {
      const lx = (-lot.w / 2 + 0.005) + (lot.w - 0.01) * i / 20, lz = (-lot.d / 2 + 0.005) + (lot.d - 0.01) * j / 20;
      const x = lot.cx + lx * c + lz * sn, z = lot.cz - lx * sn + lz * c;
      if (!surface.hits(x, z, EPS)) continue;
      const rs = surface.roads.filter((r) => roadDist(r, x, z) < r.body - EPS).map((r) => `${r.id}${r.id === lot.seg ? "(own)" : ""} d=${(roadDist(r, x, z) - r.body).toFixed(3)}`);
      hits.push(`(${x.toFixed(2)},${z.toFixed(2)}) local=${lx.toFixed(2)},${lz.toFixed(2)} roads=[${rs.join(" ")}] ring=${rs.length === 0}`);
    }
    const seg = w.segments.find((g) => g.id === lot.seg);
    const b = set.blocks.get(`${lot.seg}:${lot.side}:${lot.block}`)!;
    out.push(`lot ${lot.id} ${lot.seg}:${lot.side}:${lot.block} r${lot.row} c${lot.col} w${lot.w} d${lot.d} rows=${b.rows} seg=${JSON.stringify(seg?.pts)} a=${seg?.a} b=${seg?.b} :: ${hits.join(" | ")}`);
  }
  return out;
}

/** Debug: overlapping lot pairs (trapezoid SAT) with their shapes. */
export function explainLotLot(w: World, set: ZoneBlockSet, max = 3): string[] {
  const out: string[] = [];
  const lots = w.olots ?? [];
  const quads = lots.map((l) => { const q = new Float32Array(8); const b = set.blocks.get(`${l.seg}:${l.side}:${l.block}`); if (b) lotCorners(b, l, q); return q; });
  for (let i = 0; i < lots.length; i++) for (let j = i + 1; j < lots.length; j++) {
    if (out.length >= max || !quadsOverlap(quads[i], quads[j])) continue;
    const f = (l: OrientedLot, q: Float32Array) => `lot ${l.id} ${l.seg}:${l.side}:${l.block} r${l.row} w${l.w} d${l.d} q=${Array.from(q).map((v) => v.toFixed(2)).join(",")} seg=${JSON.stringify(w.segments.find((g) => g.id === l.seg)?.pts)}`;
    const ri = rectQuad(lots[i].cx, lots[i].cz, lots[i].w - 0.03, lots[i].d - 0.03, lots[i].yaw), rj = rectQuad(lots[j].cx, lots[j].cz, lots[j].w - 0.03, lots[j].d - 0.03, lots[j].yaw);
    const cellsOf = (l: OrientedLot) => {
      const b = set.blocks.get(`${l.seg}:${l.side}:${l.block}`)!;
      const res: Float32Array[] = [];
      for (let r = l.row; r < l.row + l.w; r++) for (let c = l.col; c < l.col + l.d; c++) { const cq = new Float32Array(8); cellCorners(b, r, c, cq); res.push(cq); }
      return res;
    };
    let cellPairs = 0;
    for (const a of cellsOf(lots[i])) for (const b of cellsOf(lots[j])) if (quadsOverlap(a, b)) cellPairs++;

    out.push(`${f(lots[i], quads[i])} || ${f(lots[j], quads[j])} rigidOverlap=${quadsOverlap(ri, rj)} overlappingCellPairs=${cellPairs}`);
  }
  return out;
}
