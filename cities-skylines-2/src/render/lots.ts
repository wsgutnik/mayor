import type { WorldLot } from "../sim/world";

type Footprint = Pick<WorldLot, "x" | "y" | "w" | "h">;

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

/** Brightness for an empty-lot pad by kerb depth (0..3): the front row is full, rear rows shade off. */
export function depthShade(depth: number): number {
  return depth < 0 ? 0.55 : Math.max(0.6, 1 - depth * 0.13);
}
