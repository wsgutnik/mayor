import * as THREE from "three";
import type { FacadeStyle } from "./facade";
import { familyFor, patchWindowMaterial } from "./window-light";

/** Lightweight shared material for B5's merged procedural boxes; no per-frame allocations. */
export function createFacadeMaterial(style: FacadeStyle, color = 0xb8afa1): THREE.MeshStandardMaterial {
  const glass = style === "curtain";
  const mat = new THREE.MeshStandardMaterial({ color, roughness: glass ? 0.1 : 0.88, metalness: glass ? 0.05 : 0, name: `glow_window_${style === "curtain" ? "office" : style === "industrial" ? "ind" : style === "retail" ? "shop" : "res"}` });
  const family = familyFor(mat.name);
  if (family) { mat.emissive = new THREE.Color("#fff1c4"); patchWindowMaterial(mat, family); }
  return mat;
}
