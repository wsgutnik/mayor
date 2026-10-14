import * as THREE from "three";
import type { FacadeStyle } from "./facade";

/** Lightweight shared material for B5's merged procedural boxes; no per-frame allocations. */
export function createFacadeMaterial(style: FacadeStyle, color = 0xb8afa1): THREE.MeshStandardMaterial {
  const glass = style === "curtain";
  return new THREE.MeshStandardMaterial({ color, roughness: glass ? 0.1 : 0.88, metalness: glass ? 0.05 : 0, name: `proc_facade_${style}` });
}
