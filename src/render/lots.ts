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
  if (dy !== 0) return { x: lot.x + lot.w / 2, z: dy > 0 ? lot.y + lot.h : lot.y, w: lot.w, d: 0.12 };
  if (dx !== 0) return { x: dx > 0 ? lot.x + lot.w : lot.x, z: lot.y + lot.h / 2, w: 0.12, d: lot.h };
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

/** Rotated world positions where composed 1x1 models sit. */
export function orientedModelCells(f: LotFrame): { x: number; z: number }[] {
  const cols = f.w <= 2 && f.d <= 2 ? f.w : 2;
  const rows = f.w <= 2 && f.d <= 2 ? f.d : 2;
  const out: { x: number; z: number }[] = [];
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) out.push(rotateCell(f, x - (cols - 1) / 2, z - (rows - 1) / 2));
  }
  return out;
}

/**
 * Kerb strip along the front edge of an oriented lot. Lot frames face +z (toward the road, like the GLB models), so
 * the front edge is +d/2; measured on a diagonal-and-curve test city, +d/2 is the nearer edge for every lot.
 */
export function orientedKerb(f: LotFrame): { x: number; z: number; len: number; yaw: number } {
  // The strip is 0.12 deep and centred on this line: pull it inside the lot so it never overlaps the road's own kerb.
  const p = rotateCell(f, 0, f.d / 2 - 0.07);
  return { x: p.x, z: p.z, len: f.w, yaw: f.yaw };
}

/** Rotated pad instance transform for an oriented lot. */
export function orientedPad(f: LotFrame): { x: number; z: number; sx: number; sz: number; yaw: number } {
  return { x: f.cx, z: f.cz, sx: f.w, sz: f.d, yaw: f.yaw };
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
