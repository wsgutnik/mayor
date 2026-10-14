import * as THREE from "three";
import type { FacadeStyle } from "./facade";
import { familyFor, patchWindowMaterial } from "./window-light";

/** Lightweight shared material for B5's merged procedural boxes; no per-frame allocations. */
const PALETTE: Record<FacadeStyle, number> = {
  house: 0xb49a79, apartment: 0xa98f82, retail: 0x9d8771,
  curtain: 0x35536b, industrial: 0x667078,
};

/** Kit-palette procedural material. Glass is deliberately dark enough for the
 * inset lit panes to read; walls use the muted plaster/siding family rather
 * than the old flat beige fallback. */
export function createFacadeMaterial(style: FacadeStyle, windows = false, color = PALETTE[style]): THREE.MeshStandardMaterial {
  const glass = style === "curtain";
  const mat = new THREE.MeshStandardMaterial({ color, roughness: glass ? 0.16 : 0.82, metalness: glass ? 0.15 : 0, name: windows ? `glow_window_${style === "curtain" ? "office" : style === "industrial" ? "ind" : style === "retail" ? "shop" : "res"}` : `proc_${style}` });
  const family = familyFor(mat.name);
  if (family) { mat.emissive = new THREE.Color("#fff1c4"); patchWindowMaterial(mat, family); }
  return mat;
}
