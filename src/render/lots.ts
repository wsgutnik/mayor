import type { WorldLot } from "../sim/world";
import type { OrientedLot } from "../sim/zonecells";

type Footprint = Pick<WorldLot, "x" | "y" | "w" | "h">;
export interface LotFrame { cx: number; cz: number; yaw: number; w: number; d: number }
export interface LotPadInstance { x: number; z: number; sx: number; sz: number; yaw: number; shade: number; plot: boolean }
export interface LotKerbInstance { x: number; z: number; sx: number; sz: number; yaw: number }
export interface LotModelInstance { x: number; z: number; yaw: number }
export interface LotInstancePlan {
  area: number;
  centre: { x: number; z: number };
  pad: LotPadInstance[];
  kerb: LotKerbInstance[];
  models: LotModelInstance[];
}

/** Yaw (three.js rotation.y) so a model whose front is +z faces the lot's street. */
export function lotYaw(lot: Pick<WorldLot, "facing">): number {
  return Math.atan2(lot.facing.dx, lot.facing.dy);
}

/** Footprint centre in world units. */
export function lotCentre(lot: Footprint): { x: number; z: number } {
  return { x: lot.x + lot.w / 2, z: lot.y + lot.h / 2 };
}

/**
 * World positions where the lot's composed 1x1 models sit: one per tile up to
 * 2x2; bigger footprints hold a centred 2x2 cluster so a 4x4 mill does not
 * become sixteen houses.
 */
export function lotModelCells(lot: Footprint): { x: number; z: number }[] {
  if (lot.w <= 2 && lot.h <= 2) {
    const out: { x: number; z: number }[] = [];
    for (let y = lot.y; y < lot.y + lot.h; y++) {
      for (let x = lot.x; x < lot.x + lot.w; x++) out.push({ x: x + 0.5, z: y + 0.5 });
    }
    return out;
  }
  const c = lotCentre(lot);
  return [
    { x: c.x - 0.5, z: c.z - 0.5 },
    { x: c.x + 0.5, z: c.z - 0.5 },
    { x: c.x - 0.5, z: c.z + 0.5 },
    { x: c.x + 0.5, z: c.z + 0.5 },
  ];
}

/** Front-kerb strip for a lot: centre, footprint size, or null when it fronts no street. */
export function lotKerb(lot: Footprint & Pick<WorldLot, "facing" | "depthFromRoad">): {
  x: number; z: number; w: number; d: number;
} | null {
  // Only a lot whose front edge sits on the road gets a kerb strip; deeper lots would show a floating bar.
  if (lot.depthFromRoad !== 0) return null;
  const { dx, dy } = lot.facing;
  // Centred 0.06 inside the front edge (like orientedKerb): the strip stays on the lot, never on the road's sidewalk.
  const IN = 0.06;
  if (dy !== 0) return { x: lot.x + lot.w / 2, z: dy > 0 ? lot.y + lot.h - IN : lot.y + IN, w: lot.w, d: 0.12 };
  if (dx !== 0) return { x: dx > 0 ? lot.x + lot.w - IN : lot.x + IN, z: lot.y + lot.h / 2, w: 0.12, d: lot.h };
  return null;
}

/** The tile just beyond the middle of a lot's front edge (where the road should be), or null without a facing. */
export function lotFrontTile(lot: Footprint & Pick<WorldLot, "facing">): { x: number; y: number } | null {
  const { dx, dy } = lot.facing;
  if (dy !== 0) return { x: lot.x + Math.floor(lot.w / 2), y: dy > 0 ? lot.y + lot.h : lot.y - 1 };
  if (dx !== 0) return { x: dx > 0 ? lot.x + lot.w : lot.x - 1, y: lot.y + Math.floor(lot.h / 2) };
  return null;
}

/** Brightness for an empty-lot pad by kerb depth (0..3): the front row is full, rear rows shade off. */
export function depthShade(depth: number): number {
  return depth < 0 ? 0.55 : Math.max(0.6, 1 - depth * 0.13);
}

function rotateCell(f: LotFrame, ax: number, dz: number): { x: number; z: number } {
  const s = Math.sin(f.yaw), c = Math.cos(f.yaw);
  return { x: f.cx + ax * c + dz * s, z: f.cz - ax * s + dz * c };
}

/**
 * Rotated world positions where composed 1x1 models sit. At most 2 x 2 models, spread evenly over the whole lot so each
 * stays inside its own rectangle (a 1 x 4 lot gets two models down its depth, never a 2-wide pair spilling sideways).
 */
export function orientedModelCells(f: LotFrame): { x: number; z: number }[] {
  const cols = Math.max(1, Math.min(2, Math.round(f.w)));
  const rows = Math.max(1, Math.min(2, Math.round(f.d)));
  const sx = f.w / cols, sz = f.d / rows;
  const out: { x: number; z: number }[] = [];
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) out.push(rotateCell(f, (x - (cols - 1) / 2) * sx, (z - (rows - 1) / 2) * sz));
  }
  return out;
}

/**
 * Kerb strip along the front edge of an oriented lot. Lot frames face +z (toward the road, like the GLB models), so
 * the front edge is +d/2; measured on a diagonal-and-curve test city, +d/2 is the nearer edge for every lot.
 */
export function orientedKerb(f: LotFrame): { x: number; z: number; len: number; yaw: number } {
  // The strip is 0.12 deep and centred on this line: pull it inside the lot so it never overlaps the road's own kerb
  // (front face 0.015 behind the lot edge, the band zone validity keeps off junction rings: 05 §1.8).
  const p = rotateCell(f, 0, f.d / 2 - 0.075);
  return { x: p.x, z: p.z, len: f.w, yaw: f.yaw };
}

/** Rotated pad instance transform for an oriented lot. */
export function orientedPad(f: LotFrame): { x: number; z: number; sx: number; sz: number; yaw: number } {
  return { x: f.cx, z: f.cz, sx: f.w, sz: f.d, yaw: f.yaw };
}

/** Site-grading constants (fable `buildings/index.js#siteLevel`, metres ÷ 8). */
export const SITE_SPREAD_FLAT = 0.0175; // 0.14 m: corner spread below this counts as flat
export const SITE_MID_DROP = 0.025; // 0.2 m: the platform may sit this far below the corner mid
export const SITE_WATER_CLEAR = 0.0875; // 0.7 m of flood clearance above the water level
export const SITE_PLINTH_GAP = 0.1125; // 0.9 m: a concrete plinth above this platform-to-ground gap
export const SITE_PLINTH_EXTRA = 0.075; // 0.6 m: plinth buried below the low corner
export const SITE_PLINTH_SHRINK = 0.0625; // 0.5 m ÷ 8: plinth footprint inset from the lot (total)

export interface LotSite {
  /** Level platform height for the building base. */
  y: number;
  minY: number;
  maxY: number;
  spread: number;
  /** Concrete plinth depth (tiles), or 0 when the building sits straight on the ground. */
  plinthDepth: number;
}

/** World positions of the four lot corners (counter-clockwise from back-left). */
export function siteCorners(f: LotFrame): { x: number; z: number }[] {
  return [
    rotateCell(f, -f.w / 2, -f.d / 2),
    rotateCell(f, f.w / 2, -f.d / 2),
    rotateCell(f, f.w / 2, f.d / 2),
    rotateCell(f, -f.w / 2, f.d / 2),
  ];
}

/** Midpoint of the lot's front (kerb) edge, in world units. */
export function lotFrontPoint(f: LotFrame): { x: number; z: number } {
  return rotateCell(f, 0, f.d / 2);
}

/**
 * Ground sample for the `frontY` argument of `siteLevel`: just outside the
 * lot toward the road, where the sidewalk sits (fable samples the sidewalk
 * 1 m in front of the frontage; roads level Mayor's terrain, so heightAt
 * there is the right reference).
 */
export function lotFrontSample(f: LotFrame): { x: number; z: number } {
  return rotateCell(f, 0, f.d / 2 + 0.15);
}

// Portions adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10): buildings/index.js#siteLevel.
/**
 * Ground level for a lot: road-edge height, footprint spread and (if needed)
 * a concrete plinth (docs/process/09-fable-buildings-port.md §1.1, task V4).
 * Pure: the caller supplies the height sampler so sim and render share it.
 *
 * `y = max(frontY, (min+max)/2 − 0.025, water + 0.0875)`, sampled over the
 * four corners plus the centre like fable. Two deliberate deltas from fable:
 * we never flatten terrain (no lot-grading API; render must not move ground),
 * so a plinth is emitted whenever the platform-to-ground gap exceeds 0.1125
 * (fable flattens near-axis lots instead of plinthing them). The spread gate
 * in the task text is then subsumed: a plinth appears exactly when the gap
 * exceeds 0.1125, which is the only reading that also satisfies the task's
 * "never more than 0.1125 above without a plinth".
 */
export function siteLevel(
  frame: LotFrame, heightAt: (x: number, z: number) => number,
  frontY: number, waterLevel = 0,
): LotSite {
  let minY = Infinity, maxY = -Infinity;
  const consider = (h: number): void => {
    if (h < minY) minY = h;
    if (h > maxY) maxY = h;
  };
  for (const p of siteCorners(frame)) consider(heightAt(p.x, p.z));
  consider(heightAt(frame.cx, frame.cz));
  const y = Math.max(frontY, (minY + maxY) / 2 - SITE_MID_DROP, waterLevel + SITE_WATER_CLEAR);
  const spread = maxY - minY;
  const plinthDepth = y - minY > SITE_PLINTH_GAP ? y - minY + SITE_PLINTH_EXTRA : 0;
  return { y, minY, maxY, spread, plinthDepth };
}

/**
 * Ground height for one composed model cell: the site platform, but never
 * below the terrain at the cell (the task's "base never below terrain").
 * On flat ground this equals the old heightAt placement exactly.
 */
export function cellBaseY(site: LotSite, cellGround: number): number {
  return Math.max(site.y, cellGround);
}

/** Pad base: level with the site on flat ground, terrain-hugging on slopes (never floating). */
export function padBaseY(site: LotSite, terrainMean: number, lift: number): number {
  if (site.plinthDepth > 0) return terrainMean + lift;
  return Math.min(site.y, terrainMean) + lift;
}

export function lotInstances(lot: WorldLot | OrientedLot, onRoad = true): LotInstancePlan {
  if ("cx" in lot) {
    const f: LotFrame = { cx: lot.cx, cz: lot.cz, yaw: lot.yaw, w: lot.w, d: lot.d };
    const pad = orientedPad(f);
    const kerb = orientedKerb(f);
    const area = lot.w * lot.d;
    const emptyPads: LotPadInstance[] = [];
    for (let z = 0; z < lot.d; z++) {
      for (let x = 0; x < lot.w; x++) {
        const p = rotateCell(f, x - (lot.w - 1) / 2, z - (lot.d - 1) / 2);
        emptyPads.push({ x: p.x, z: p.z, sx: 0.96, sz: 0.96, yaw: lot.yaw, shade: depthShade(lot.col + z), plot: false });
      }
    }
    return {
      area,
      centre: { x: lot.cx, z: lot.cz },
      pad: lot.level === 0
        ? emptyPads
        : area > 1 ? [{ ...pad, sx: Math.max(0.08, pad.sx - 0.08), sz: Math.max(0.08, pad.sz - 0.08), shade: 1, plot: true }] : [],
      kerb: onRoad && lot.col === 0 ? [{ x: kerb.x, z: kerb.z, sx: Math.max(0.08, kerb.len - 0.04), sz: 0.12, yaw: kerb.yaw }] : [],
      models: lot.level > 0 ? orientedModelCells(f).map((cell) => ({ ...cell, yaw: lot.yaw })) : [],
    };
  }

  const area = lot.w * lot.h;
  const centre = lotCentre(lot);
  const yaw = lotYaw(lot);
  const kerb = onRoad ? lotKerb(lot) : null;
  const pad: LotPadInstance[] = [];
  if (lot.level === 0) {
    for (let y = lot.y; y < lot.y + lot.h; y++) {
      for (let x = lot.x; x < lot.x + lot.w; x++) {
        pad.push({ x: x + 0.5, z: y + 0.5, sx: 0.96, sz: 0.96, yaw: 0, shade: depthShade(lot.depthFromRoad), plot: false });
      }
    }
  } else if (area > 1) {
    pad.push({ x: centre.x, z: centre.z, sx: Math.max(0.08, lot.w - 0.08), sz: Math.max(0.08, lot.h - 0.08), yaw: 0, shade: 1, plot: true });
  }
  return {
    area,
    centre,
    pad,
    kerb: kerb ? [{ x: kerb.x, z: kerb.z, sx: Math.max(0.08, kerb.w - 0.04), sz: Math.max(0.08, kerb.d - 0.02), yaw: 0 }] : [],
    models: lot.level > 0 ? lotModelCells(lot).map((cell) => ({ ...cell, yaw })) : [],
  };
}
